import { getPostgresPool, isPostgresConfigured } from "../utils/postgres.js";
import { AppError } from "../utils/response.js";

export type ProviderLifecycleAction = "deactivate" | "reactivate";

type TransactionClient = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

type LifecycleInput = {
  providerId: number;
  action: ProviderLifecycleAction;
  motivo: string;
  usuario: string;
};

const ACTIVE_CHEQUE_STATES = ["en_cartera", "depositado", "entregado_proveedor"];
const BALANCE_TOLERANCE = 0.01;

const normalize = (value: unknown) => String(value ?? "").trim();
const toNumber = (value: any, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeStatus = (value: unknown) => {
  const status = normalize(value).toLowerCase();
  return status === "inactivo" ? "inactivo" : "activo";
};

const validateInput = ({ providerId, motivo }: LifecycleInput) => {
  if (!Number.isInteger(providerId) || providerId <= 0) {
    throw new AppError("ID de proveedor inválido", 400);
  }

  const reason = normalize(motivo);
  if (reason.length < 3) {
    throw new AppError("El motivo es obligatorio y debe tener al menos 3 caracteres", 400);
  }
  if (reason.length > 500) {
    throw new AppError("El motivo no puede superar los 500 caracteres", 400);
  }

  return reason;
};

const assertTransition = (provider: any, action: ProviderLifecycleAction) => {
  if (!provider) throw new AppError("Proveedor no encontrado", 404);

  const currentStatus = normalizeStatus(provider.estado);
  if (action === "deactivate" && currentStatus === "inactivo") {
    throw new AppError("El proveedor ya está dado de baja", 409);
  }
  if (action === "reactivate" && currentStatus === "activo") {
    throw new AppError("El proveedor ya está activo", 409);
  }

  return currentStatus;
};

const handleSqlite = async ({ providerId, action, motivo, usuario }: LifecycleInput) => {
  const reason = validateInput({ providerId, action, motivo, usuario });
  const normalizedUser = normalize(usuario) || "Sistema";
  const { default: db } = await import("../db.js");

  return db.transaction(() => {
    const provider = db.prepare("SELECT * FROM proveedores WHERE id = ? LIMIT 1").get(providerId) as any;
    const previousStatus = assertTransition(provider, action);

    if (action === "deactivate") {
      const pendingInvoice = db.prepare(`
        SELECT id, numero_factura, total, monto_pagado
        FROM purchase_invoices
        WHERE proveedor_id = ?
          AND LOWER(COALESCE(estado, 'Activa')) <> 'anulada'
          AND (COALESCE(total, 0) - COALESCE(monto_pagado, 0)) > ?
        ORDER BY id ASC
        LIMIT 1
      `).get(providerId, BALANCE_TOLERANCE) as any;
      if (pendingInvoice) {
        throw new AppError(
          `El proveedor tiene la factura ${pendingInvoice.numero_factura || pendingInvoice.id} con saldo pendiente.`,
          409
        );
      }

      const activeCheque = db.prepare(`
        SELECT id, numero_cheque, estado
        FROM cheques
        WHERE proveedor_id = ?
          AND LOWER(COALESCE(estado, '')) IN ('en_cartera', 'depositado', 'entregado_proveedor')
        ORDER BY id ASC
        LIMIT 1
      `).get(providerId) as any;
      if (activeCheque) {
        throw new AppError(
          `El proveedor tiene el cheque ${activeCheque.numero_cheque || activeCheque.id} todavía en proceso.`,
          409
        );
      }
    }

    const nextStatus = action === "deactivate" ? "inactivo" : "activo";
    const history = db.prepare(`
      INSERT INTO provider_status_history (
        provider_id, action, reason, performed_by, previous_status, new_status, snapshot
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      providerId,
      action,
      reason,
      normalizedUser,
      previousStatus,
      nextStatus,
      JSON.stringify({ provider })
    );

    if (action === "deactivate") {
      db.prepare(`
        UPDATE proveedores
        SET estado = 'inactivo',
            deactivated_at = CURRENT_TIMESTAMP,
            deactivated_by = ?,
            deactivation_reason = ?
        WHERE id = ?
      `).run(normalizedUser, reason, providerId);
    } else {
      db.prepare(`
        UPDATE proveedores
        SET estado = 'activo',
            deactivated_at = NULL,
            deactivated_by = NULL,
            deactivation_reason = NULL
        WHERE id = ?
      `).run(providerId);
    }

    return {
      provider: db.prepare("SELECT * FROM proveedores WHERE id = ? LIMIT 1").get(providerId),
      historyId: Number(history.lastInsertRowid),
    };
  })();
};

const handlePostgres = async (
  { providerId, action, motivo, usuario }: LifecycleInput,
  executor?: TransactionClient
) => {
  const reason = validateInput({ providerId, action, motivo, usuario });
  const normalizedUser = normalize(usuario) || "Sistema";
  const ownsTransaction = !executor;
  const pool = executor ? null : getPostgresPool();
  const client = executor || (await pool!.connect());

  try {
    if (ownsTransaction) await client.query("BEGIN");

    const providerResult = await client.query(
      `SELECT *
       FROM proveedores
       WHERE id = $1
       LIMIT 1
       FOR UPDATE`,
      [providerId]
    );

    if (!providerResult.rowCount) throw new AppError("Proveedor no encontrado", 404);
    const provider = providerResult.rows[0];
    const previousStatus = assertTransition(provider, action);

    if (action === "deactivate") {
      const pendingInvoiceResult = await client.query(
        `SELECT id, numero_factura, total, monto_pagado
         FROM purchase_invoices
         WHERE proveedor_id = $1
           AND LOWER(COALESCE(estado, 'Activa')) <> 'anulada'
           AND (COALESCE(total, 0) - COALESCE(monto_pagado, 0)) > $2
         ORDER BY id ASC
         LIMIT 1
         FOR UPDATE`,
        [providerId, BALANCE_TOLERANCE]
      );
      if (pendingInvoiceResult.rowCount) {
        const invoice = pendingInvoiceResult.rows[0];
        throw new AppError(
          `El proveedor tiene la factura ${invoice.numero_factura || invoice.id} con saldo pendiente.`,
          409
        );
      }

      const activeChequeResult = await client.query(
        `SELECT id, numero_cheque, estado
         FROM cheques
         WHERE proveedor_id = $1
           AND LOWER(COALESCE(estado, '')) = ANY($2::text[])
         ORDER BY id ASC
         LIMIT 1
         FOR UPDATE`,
        [providerId, ACTIVE_CHEQUE_STATES]
      );
      if (activeChequeResult.rowCount) {
        const cheque = activeChequeResult.rows[0];
        throw new AppError(
          `El proveedor tiene el cheque ${cheque.numero_cheque || cheque.id} todavía en proceso.`,
          409
        );
      }
    }

    const nextStatus = action === "deactivate" ? "inactivo" : "activo";
    const historyResult = await client.query(
      `INSERT INTO provider_status_history (
         provider_id, action, reason, performed_by, previous_status, new_status, snapshot
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       RETURNING id, performed_at`,
      [
        providerId,
        action,
        reason,
        normalizedUser,
        previousStatus,
        nextStatus,
        JSON.stringify({ provider }),
      ]
    );

    const updateResult = action === "deactivate"
      ? await client.query(
          `UPDATE proveedores
           SET estado = 'inactivo',
               deactivated_at = $1,
               deactivated_by = $2,
               deactivation_reason = $3
           WHERE id = $4
           RETURNING *`,
          [historyResult.rows[0]?.performed_at || new Date().toISOString(), normalizedUser, reason, providerId]
        )
      : await client.query(
          `UPDATE proveedores
           SET estado = 'activo',
               deactivated_at = NULL,
               deactivated_by = NULL,
               deactivation_reason = NULL
           WHERE id = $1
           RETURNING *`,
          [providerId]
        );

    if (ownsTransaction) await client.query("COMMIT");

    return {
      provider: updateResult.rows[0],
      historyId: toNumber(historyResult.rows[0]?.id),
    };
  } catch (error) {
    if (ownsTransaction) await client.query("ROLLBACK");
    throw error;
  } finally {
    if (ownsTransaction && "release" in client && typeof (client as any).release === "function") {
      (client as any).release();
    }
  }
};

export const providerLifecycleService = {
  async changeStatus(input: LifecycleInput, executor?: TransactionClient) {
    if (!isPostgresConfigured() && !executor) return handleSqlite(input);
    return handlePostgres(input, executor);
  },
};
