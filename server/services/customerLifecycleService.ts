import { getPostgresPool, isPostgresConfigured } from "../utils/postgres.js";
import { AppError } from "../utils/response.js";

export type CustomerLifecycleAction = "deactivate" | "reactivate";

type TransactionClient = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

type LifecycleInput = {
  customerId: number;
  action: CustomerLifecycleAction;
  motivo: string;
  usuario: string;
};

const ACTIVE_ORDER_STATES = ["pendiente_aprobacion", "aprobado_pendiente_entrega"];
const ACTIVE_ROUTE_STATES = ["planificada", "pendiente", "en curso"];
const ACTIVE_CHEQUE_STATES = ["en_cartera", "depositado", "entregado_proveedor"];
const BALANCE_TOLERANCE = 0.01;

const normalize = (value: unknown) => String(value ?? "").trim();
const toNumber = (value: any, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const validateInput = ({ customerId, motivo }: LifecycleInput) => {
  if (!Number.isInteger(customerId) || customerId <= 0) {
    throw new AppError("ID de cliente inválido", 400);
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

const assertTransition = (customer: any, action: CustomerLifecycleAction) => {
  if (!customer) throw new AppError("Cliente no encontrado", 404);
  if (Number(customer.id) === 1) {
    throw new AppError("El cliente Consumidor Final no puede darse de baja", 409);
  }

  const active = Number(customer.activo ?? 1) !== 0;
  if (action === "deactivate" && !active) {
    throw new AppError("El cliente ya está dado de baja", 409);
  }
  if (action === "reactivate" && active) {
    throw new AppError("El cliente ya está activo", 409);
  }

  return active ? "activo" : "inactivo";
};

const handleSqlite = async ({ customerId, action, motivo, usuario }: LifecycleInput) => {
  const reason = validateInput({ customerId, action, motivo, usuario });
  const normalizedUser = normalize(usuario) || "Sistema";
  const { default: db } = await import("../db.js");

  return db.transaction(() => {
    const customer = db.prepare("SELECT * FROM clientes WHERE id = ? LIMIT 1").get(customerId) as any;
    const previousStatus = assertTransition(customer, action);

    if (action === "deactivate") {
      if (Math.abs(toNumber(customer.saldo_cta_cte)) > BALANCE_TOLERANCE) {
        throw new AppError("El cliente tiene saldo en cuenta corriente. Regularizá el saldo antes de darlo de baja.", 409);
      }

      const pendingSale = db.prepare(`
        SELECT id, numero_venta, monto_pendiente
        FROM sales
        WHERE cliente_id = ?
          AND COALESCE(estado, '') <> 'Anulada'
          AND COALESCE(monto_pendiente, 0) > ?
        LIMIT 1
      `).get(customerId, BALANCE_TOLERANCE) as any;
      if (pendingSale) {
        throw new AppError(`El cliente tiene la venta #${pendingSale.numero_venta || pendingSale.id} con saldo pendiente.`, 409);
      }

      const activeOrder = db.prepare(`
        SELECT id, numero_pedido
        FROM customer_orders
        WHERE cliente_id = ?
          AND LOWER(COALESCE(estado, '')) IN ('pendiente_aprobacion', 'aprobado_pendiente_entrega')
        LIMIT 1
      `).get(customerId) as any;
      if (activeOrder) {
        throw new AppError(`El cliente tiene el pedido #${activeOrder.numero_pedido || activeOrder.id} todavía activo.`, 409);
      }

      const activeRoute = db.prepare(`
        SELECT r.id, r.name, r.date
        FROM route_items ri
        JOIN routes r ON r.id = ri.route_id
        WHERE ri.client_id = ?
          AND LOWER(COALESCE(r.status, 'planificada')) IN ('planificada', 'pendiente', 'en curso')
        LIMIT 1
      `).get(customerId) as any;
      if (activeRoute) {
        throw new AppError(`El cliente está incluido en la ruta ${activeRoute.name || activeRoute.id}. Cerrá o cancelá la ruta antes de darlo de baja.`, 409);
      }

      const activeCheque = db.prepare(`
        SELECT id, numero_cheque, estado
        FROM cheques
        WHERE cliente_id = ?
          AND LOWER(COALESCE(estado, '')) IN ('en_cartera', 'depositado', 'entregado_proveedor')
        LIMIT 1
      `).get(customerId) as any;
      if (activeCheque) {
        throw new AppError(`El cliente tiene el cheque ${activeCheque.numero_cheque || activeCheque.id} todavía en proceso.`, 409);
      }
    }

    const nextStatus = action === "deactivate" ? "inactivo" : "activo";
    db.prepare(`
      INSERT INTO customer_status_history (
        customer_id, action, reason, performed_by, previous_status, new_status, snapshot
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      customerId,
      action,
      reason,
      normalizedUser,
      previousStatus,
      nextStatus,
      JSON.stringify({ customer })
    );

    if (action === "deactivate") {
      db.prepare(`
        UPDATE clientes
        SET activo = 0,
            portal_enabled = 0,
            portal_session_version = COALESCE(portal_session_version, 1) + 1,
            deactivated_at = CURRENT_TIMESTAMP,
            deactivated_by = ?,
            deactivation_reason = ?
        WHERE id = ?
      `).run(normalizedUser, reason, customerId);
    } else {
      db.prepare(`
        UPDATE clientes
        SET activo = 1,
            deactivated_at = NULL,
            deactivated_by = NULL,
            deactivation_reason = NULL
        WHERE id = ?
      `).run(customerId);
    }

    return db.prepare("SELECT * FROM clientes WHERE id = ? LIMIT 1").get(customerId);
  })();
};

const handlePostgres = async (
  { customerId, action, motivo, usuario }: LifecycleInput,
  executor?: TransactionClient
) => {
  const reason = validateInput({ customerId, action, motivo, usuario });
  const normalizedUser = normalize(usuario) || "Sistema";
  const ownsTransaction = !executor;
  const pool = executor ? null : getPostgresPool();
  const client = executor || (await pool!.connect());

  try {
    if (ownsTransaction) await client.query("BEGIN");

    const customerResult = await client.query(
      `SELECT *
       FROM clientes
       WHERE id = $1
       LIMIT 1
       FOR UPDATE`,
      [customerId]
    );

    if (!customerResult.rowCount) throw new AppError("Cliente no encontrado", 404);
    const customer = customerResult.rows[0];
    const previousStatus = assertTransition(customer, action);

    if (action === "deactivate") {
      if (Math.abs(toNumber(customer.saldo_cta_cte)) > BALANCE_TOLERANCE) {
        throw new AppError("El cliente tiene saldo en cuenta corriente. Regularizá el saldo antes de darlo de baja.", 409);
      }

      const pendingSaleResult = await client.query(
        `SELECT id, numero_venta, monto_pendiente
         FROM sales
         WHERE cliente_id = $1
           AND COALESCE(estado, '') <> 'Anulada'
           AND COALESCE(monto_pendiente, 0) > $2
         ORDER BY id ASC
         LIMIT 1
         FOR UPDATE`,
        [customerId, BALANCE_TOLERANCE]
      );
      if (pendingSaleResult.rowCount) {
        const sale = pendingSaleResult.rows[0];
        throw new AppError(`El cliente tiene la venta #${sale.numero_venta || sale.id} con saldo pendiente.`, 409);
      }

      const activeOrderResult = await client.query(
        `SELECT id, numero_pedido
         FROM customer_orders
         WHERE cliente_id = $1
           AND LOWER(COALESCE(estado, '')) = ANY($2::text[])
         ORDER BY id ASC
         LIMIT 1
         FOR UPDATE`,
        [customerId, ACTIVE_ORDER_STATES]
      );
      if (activeOrderResult.rowCount) {
        const order = activeOrderResult.rows[0];
        throw new AppError(`El cliente tiene el pedido #${order.numero_pedido || order.id} todavía activo.`, 409);
      }

      const activeRouteResult = await client.query(
        `SELECT r.id, r.name, r.date
         FROM route_items ri
         JOIN routes r ON r.id = ri.route_id
         WHERE ri.client_id = $1
           AND LOWER(COALESCE(r.status, 'planificada')) = ANY($2::text[])
         ORDER BY r.date ASC, r.id ASC
         LIMIT 1
         FOR UPDATE OF r, ri`,
        [customerId, ACTIVE_ROUTE_STATES]
      );
      if (activeRouteResult.rowCount) {
        const route = activeRouteResult.rows[0];
        throw new AppError(`El cliente está incluido en la ruta ${route.name || route.id}. Cerrá o cancelá la ruta antes de darlo de baja.`, 409);
      }

      const activeChequeResult = await client.query(
        `SELECT id, numero_cheque, estado
         FROM cheques
         WHERE cliente_id = $1
           AND LOWER(COALESCE(estado, '')) = ANY($2::text[])
         ORDER BY id ASC
         LIMIT 1
         FOR UPDATE`,
        [customerId, ACTIVE_CHEQUE_STATES]
      );
      if (activeChequeResult.rowCount) {
        const cheque = activeChequeResult.rows[0];
        throw new AppError(`El cliente tiene el cheque ${cheque.numero_cheque || cheque.id} todavía en proceso.`, 409);
      }
    }

    const nextStatus = action === "deactivate" ? "inactivo" : "activo";
    const historyResult = await client.query(
      `INSERT INTO customer_status_history (
         customer_id, action, reason, performed_by, previous_status, new_status, snapshot
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       RETURNING id, performed_at`,
      [
        customerId,
        action,
        reason,
        normalizedUser,
        previousStatus,
        nextStatus,
        JSON.stringify({ customer }),
      ]
    );

    const updateResult = action === "deactivate"
      ? await client.query(
          `UPDATE clientes
           SET activo = 0,
               portal_enabled = 0,
               portal_session_version = COALESCE(portal_session_version, 1) + 1,
               deactivated_at = $1,
               deactivated_by = $2,
               deactivation_reason = $3
           WHERE id = $4
           RETURNING *`,
          [historyResult.rows[0]?.performed_at || new Date().toISOString(), normalizedUser, reason, customerId]
        )
      : await client.query(
          `UPDATE clientes
           SET activo = 1,
               deactivated_at = NULL,
               deactivated_by = NULL,
               deactivation_reason = NULL
           WHERE id = $1
           RETURNING *`,
          [customerId]
        );

    if (ownsTransaction) await client.query("COMMIT");

    return {
      customer: updateResult.rows[0],
      history_id: historyResult.rows[0]?.id,
      action,
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

export const customerLifecycleService = {
  async changeStatus(input: LifecycleInput, executor?: TransactionClient) {
    if (!isPostgresConfigured() && !executor) return handleSqlite(input);
    return handlePostgres(input, executor);
  },
};
