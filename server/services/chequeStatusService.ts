import { getPostgresPool, isPostgresConfigured } from "../utils/postgres.js";
import { AppError } from "../utils/response.js";
import { normalizeBusinessDateForStorage } from "../utils/businessDate.js";

export type ChequeTransactionClient = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

type ChangeStatusInput = {
  chequeId: number;
  estado: string;
  motivo: string;
  usuario: string;
};

type RevertStatusInput = {
  chequeId: number;
  motivo: string;
  usuario: string;
};

const VALID_STATES = new Set([
  "en_cartera",
  "depositado",
  "entregado_proveedor",
  "cobrado",
  "rechazado",
  "anulado",
]);

const MANUAL_TRANSITIONS: Record<string, string[]> = {
  en_cartera: ["depositado"],
  depositado: ["cobrado", "rechazado"],
};

const toNumber = (value: any, fallback = 0) => {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const normalizeReason = (motivo: unknown) => {
  const value = String(motivo || "").trim();
  if (value.length < 3) {
    throw new AppError("El motivo es obligatorio y debe tener al menos 3 caracteres", 400);
  }
  if (value.length > 500) {
    throw new AppError("El motivo no puede superar los 500 caracteres", 400);
  }
  return value;
};

const normalizeUser = (usuario: unknown) => String(usuario || "Sistema").trim() || "Sistema";

const getAndIncrementPaymentNumber = async (client: ChequeTransactionClient) => {
  await client.query(
    `INSERT INTO settings (key, value)
     VALUES ($1, $2)
     ON CONFLICT (key) DO NOTHING`,
    ["next_payment_number", "1"]
  );

  const currentResult = await client.query(
    `SELECT value
     FROM settings
     WHERE key = $1
     LIMIT 1
     FOR UPDATE`,
    ["next_payment_number"]
  );

  const current = parseInt(String(currentResult.rows[0]?.value || "1"), 10) || 1;

  await client.query(
    `UPDATE settings
     SET value = $2
     WHERE key = $1`,
    ["next_payment_number", String(current + 1)]
  );

  return current;
};

const requirePostgres = (executor?: ChequeTransactionClient) => {
  if (!executor && !isPostgresConfigured()) {
    throw new AppError("La gestión auditada de cheques requiere PostgreSQL", 409);
  }
};

export const chequeStatusService = {
  getAllowedTransitions(estado: unknown) {
    return [...(MANUAL_TRANSITIONS[String(estado || "").toLowerCase()] || [])];
  },

  async getHistory(chequeId: number, executor?: ChequeTransactionClient) {
    if (!Number.isInteger(chequeId) || chequeId <= 0) {
      throw new AppError("ID de cheque inválido", 400);
    }

    requirePostgres(executor);
    const queryable = executor || getPostgresPool();
    const result = await queryable.query(
      `SELECT
         csc.id,
         csc.cheque_id,
         csc.estado_anterior,
         csc.estado_nuevo,
         csc.motivo,
         csc.cambiado_por,
         csc.cambiado_at,
         csc.origen,
         csc.financial_movement_id,
         csc.revertido_at,
         csc.revertido_por,
         csc.reversion_motivo,
         csc.reversal_movement_id
       FROM cheque_status_changes csc
       WHERE csc.cheque_id = $1
       ORDER BY csc.cambiado_at DESC, csc.id DESC`,
      [chequeId]
    );

    return result.rows;
  },

  async changeStatus(
    { chequeId, estado, motivo, usuario }: ChangeStatusInput,
    executor?: ChequeTransactionClient
  ) {
    const normalizedReason = normalizeReason(motivo);
    const normalizedUser = normalizeUser(usuario);
    const normalizedState = String(estado || "").trim().toLowerCase();

    if (!Number.isInteger(chequeId) || chequeId <= 0) {
      throw new AppError("ID de cheque inválido", 400);
    }
    if (!VALID_STATES.has(normalizedState)) {
      throw new AppError("Estado de cheque inválido", 400);
    }

    requirePostgres(executor);
    const ownsTransaction = !executor;
    const pool = executor ? null : getPostgresPool();
    const client = executor || (await pool!.connect());

    try {
      if (ownsTransaction) await client.query("BEGIN");

      const chequeResult = await client.query(
        `SELECT *
         FROM cheques
         WHERE id = $1
         LIMIT 1
         FOR UPDATE`,
        [chequeId]
      );

      if (!chequeResult.rowCount) {
        throw new AppError("Cheque no encontrado", 404);
      }

      const cheque = chequeResult.rows[0];
      const currentState = String(cheque.estado || "en_cartera").toLowerCase();

      if (!VALID_STATES.has(currentState)) {
        throw new AppError("El cheque tiene un estado histórico no reconocido", 409);
      }
      if (currentState === normalizedState) {
        throw new AppError("El cheque ya se encuentra en ese estado", 409);
      }
      if (["anulado", "entregado_proveedor", "cobrado", "rechazado"].includes(currentState)) {
        const guidance = currentState === "entregado_proveedor"
          ? "Debe anularse el egreso que entregó el cheque al proveedor."
          : currentState === "anulado"
            ? "El cheque fue anulado desde su operación de origen."
            : "Utilice Revertir último cambio si necesita corregirlo.";
        throw new AppError(`No se puede cambiar directamente un cheque ${currentState}. ${guidance}`, 409);
      }

      const allowed = MANUAL_TRANSITIONS[currentState] || [];
      if (!allowed.includes(normalizedState)) {
        throw new AppError(
          `Transición no permitida: ${currentState} → ${normalizedState}`,
          409
        );
      }

      let financialMovementId: number | null = null;

      if (normalizedState === "rechazado") {
        const nextPaymentNumber = await getAndIncrementPaymentNumber(client);
        const movementResult = await client.query(
          `INSERT INTO movimientos_financieros (
             tipo,
             origen,
             descripcion,
             categoria,
             forma_pago,
             monto,
             fecha,
             usuario,
             numero_pago,
             cheque_id,
             estado,
             reversion_version
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           RETURNING id`,
          [
            "egreso",
            "cheque_rechazado",
            `Cheque rechazado N° ${cheque.numero_cheque || cheque.id} - ${cheque.banco || "Sin banco"}`,
            "Cheque Rechazado",
            "cheque",
            toNumber(cheque.importe),
            normalizeBusinessDateForStorage(),
            normalizedUser,
            nextPaymentNumber,
            chequeId,
            "Activo",
            1,
          ]
        );
        financialMovementId = toNumber(movementResult.rows[0]?.id) || null;
      }

      const snapshot = {
        cheque,
        estado_anterior: currentState,
        estado_nuevo: normalizedState,
        financial_movement_id: financialMovementId,
      };

      const changeResult = await client.query(
        `INSERT INTO cheque_status_changes (
           cheque_id,
           estado_anterior,
           estado_nuevo,
           motivo,
           cambiado_por,
           origen,
           financial_movement_id,
           snapshot
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
         RETURNING id, cambiado_at`,
        [
          chequeId,
          currentState,
          normalizedState,
          normalizedReason,
          normalizedUser,
          "manual",
          financialMovementId,
          JSON.stringify(snapshot),
        ]
      );

      const changeId = toNumber(changeResult.rows[0]?.id);
      const changedAt = changeResult.rows[0]?.cambiado_at || new Date().toISOString();

      await client.query(
        `UPDATE cheques
         SET estado = $1,
             estado_actualizado_at = $2,
             estado_actualizado_por = $3,
             ultimo_cambio_estado_id = $4
         WHERE id = $5`,
        [normalizedState, changedAt, normalizedUser, changeId, chequeId]
      );

      if (ownsTransaction) await client.query("COMMIT");

      return {
        cheque_id: chequeId,
        estado_anterior: currentState,
        estado_nuevo: normalizedState,
        cambio_id: changeId,
        movimiento_financiero_id: financialMovementId,
      };
    } catch (error) {
      if (ownsTransaction) await client.query("ROLLBACK");
      throw error;
    } finally {
      if (ownsTransaction && "release" in client && typeof (client as any).release === "function") {
        (client as any).release();
      }
    }
  },

  async revertLastStatus(
    { chequeId, motivo, usuario }: RevertStatusInput,
    executor?: ChequeTransactionClient
  ) {
    const normalizedReason = normalizeReason(motivo);
    const normalizedUser = normalizeUser(usuario);

    if (!Number.isInteger(chequeId) || chequeId <= 0) {
      throw new AppError("ID de cheque inválido", 400);
    }

    requirePostgres(executor);
    const ownsTransaction = !executor;
    const pool = executor ? null : getPostgresPool();
    const client = executor || (await pool!.connect());

    try {
      if (ownsTransaction) await client.query("BEGIN");

      const chequeResult = await client.query(
        `SELECT *
         FROM cheques
         WHERE id = $1
         LIMIT 1
         FOR UPDATE`,
        [chequeId]
      );

      if (!chequeResult.rowCount) {
        throw new AppError("Cheque no encontrado", 404);
      }

      const cheque = chequeResult.rows[0];
      const currentState = String(cheque.estado || "en_cartera").toLowerCase();

      if (["anulado", "entregado_proveedor"].includes(currentState)) {
        throw new AppError(
          currentState === "anulado"
            ? "Un cheque anulado solo puede gestionarse desde su operación de origen"
            : "El cheque entregado a proveedor se restaura anulando el egreso vinculado",
          409
        );
      }

      const changeResult = await client.query(
        `SELECT *
         FROM cheque_status_changes
         WHERE cheque_id = $1
           AND id = $2
           AND revertido_at IS NULL
         LIMIT 1
         FOR UPDATE`,
        [chequeId, toNumber(cheque.ultimo_cambio_estado_id)]
      );

      if (!changeResult.rowCount) {
        throw new AppError(
          "El estado actual no posee una transición auditada que pueda revertirse automáticamente",
          409
        );
      }

      const change = changeResult.rows[0];
      if (String(change.estado_nuevo || "").toLowerCase() !== currentState) {
        throw new AppError("El historial del cheque no coincide con su estado actual", 409);
      }

      let reversalMovementId: number | null = null;
      const financialMovementId = toNumber(change.financial_movement_id);

      if (currentState === "rechazado") {
        if (!financialMovementId) {
          throw new AppError("El rechazo no tiene un movimiento financiero trazable", 409);
        }

        const movementResult = await client.query(
          `SELECT *
           FROM movimientos_financieros
           WHERE id = $1
           LIMIT 1
           FOR UPDATE`,
          [financialMovementId]
        );

        if (!movementResult.rowCount) {
          throw new AppError("No existe el movimiento financiero del cheque rechazado", 409);
        }

        const movement = movementResult.rows[0];
        if (
          String(movement.origen || "").toLowerCase() !== "cheque_rechazado" ||
          String(movement.estado || "Activo").toLowerCase() === "anulado" ||
          toNumber(movement.cheque_id) !== chequeId
        ) {
          throw new AppError("El movimiento del cheque rechazado no es reversible de forma segura", 409);
        }

        const nextPaymentNumber = await getAndIncrementPaymentNumber(client);
        const reversalResult = await client.query(
          `INSERT INTO movimientos_financieros (
             tipo,
             origen,
             descripcion,
             categoria,
             forma_pago,
             monto,
             fecha,
             usuario,
             numero_pago,
             cheque_id,
             reversed_movement_id,
             estado,
             reversion_version
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           RETURNING id`,
          [
            "ingreso",
            "anulacion_cheque_rechazado",
            `Reversión de rechazo del cheque N° ${cheque.numero_cheque || cheque.id}`,
            "Cheque Rechazado",
            "cheque",
            toNumber(movement.monto),
            normalizeBusinessDateForStorage(),
            normalizedUser,
            nextPaymentNumber,
            chequeId,
            financialMovementId,
            "Activo",
            0,
          ]
        );
        reversalMovementId = toNumber(reversalResult.rows[0]?.id) || null;

        await client.query(
          `UPDATE movimientos_financieros
           SET estado = 'Anulado',
               anulada_at = $1,
               anulada_por = $2,
               anulacion_motivo = $3
           WHERE id = $4`,
          [new Date().toISOString(), normalizedUser, normalizedReason, financialMovementId]
        );
      }

      const revertedAt = new Date().toISOString();
      await client.query(
        `UPDATE cheque_status_changes
         SET revertido_at = $1,
             revertido_por = $2,
             reversion_motivo = $3,
             reversal_movement_id = $4
         WHERE id = $5`,
        [revertedAt, normalizedUser, normalizedReason, reversalMovementId, change.id]
      );

      const previousChangeResult = await client.query(
        `SELECT id
         FROM cheque_status_changes
         WHERE cheque_id = $1
           AND id <> $2
           AND revertido_at IS NULL
         ORDER BY cambiado_at DESC, id DESC
         LIMIT 1`,
        [chequeId, change.id]
      );
      const previousChangeId = toNumber(previousChangeResult.rows[0]?.id) || null;

      await client.query(
        `UPDATE cheques
         SET estado = $1,
             estado_actualizado_at = $2,
             estado_actualizado_por = $3,
             ultimo_cambio_estado_id = $4
         WHERE id = $5`,
        [change.estado_anterior, revertedAt, normalizedUser, previousChangeId, chequeId]
      );

      if (ownsTransaction) await client.query("COMMIT");

      return {
        cheque_id: chequeId,
        estado_anterior: currentState,
        estado_restaurado: change.estado_anterior,
        cambio_revertido_id: toNumber(change.id),
        movimiento_reversion_id: reversalMovementId,
      };
    } catch (error) {
      if (ownsTransaction) await client.query("ROLLBACK");
      throw error;
    } finally {
      if (ownsTransaction && "release" in client && typeof (client as any).release === "function") {
        (client as any).release();
      }
    }
  },
};
