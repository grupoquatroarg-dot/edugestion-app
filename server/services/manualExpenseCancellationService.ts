import { getPostgresPool, isPostgresConfigured } from "../utils/postgres.js";
import { AppError } from "../utils/response.js";
import { normalizeBusinessDateForStorage } from "../utils/businessDate.js";

export type TransactionClient = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

type CancellationInput = {
  movementId: number;
  motivo: string;
  usuario: string;
};

const toNumber = (value: any, fallback = 0) => {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const getAndIncrementPaymentNumber = async (client: TransactionClient) => {
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

export const manualExpenseCancellationService = {
  async cancelManualExpense(
    { movementId, motivo, usuario }: CancellationInput,
    executor?: TransactionClient
  ) {
    const normalizedReason = String(motivo || "").trim();
    const normalizedUser = String(usuario || "Sistema").trim() || "Sistema";

    if (!Number.isInteger(movementId) || movementId <= 0) {
      throw new AppError("ID de movimiento inválido", 400);
    }

    if (normalizedReason.length < 3) {
      throw new AppError(
        "El motivo de anulación es obligatorio y debe tener al menos 3 caracteres",
        400
      );
    }

    if (normalizedReason.length > 500) {
      throw new AppError("El motivo de anulación no puede superar los 500 caracteres", 400);
    }

    if (!executor && !isPostgresConfigured()) {
      throw new AppError("La anulación de egresos manuales requiere PostgreSQL", 409);
    }

    const ownsTransaction = !executor;
    const pool = executor ? null : getPostgresPool();
    const client = executor || (await pool!.connect());

    try {
      if (ownsTransaction) await client.query("BEGIN");

      const movementResult = await client.query(
        `SELECT mf.*
         FROM movimientos_financieros mf
         WHERE mf.id = $1
         LIMIT 1
         FOR UPDATE OF mf`,
        [movementId]
      );

      if (!movementResult.rowCount) {
        throw new AppError("Egreso no encontrado", 404);
      }

      const movement = movementResult.rows[0];
      const state = String(movement.estado || "Activo").toLowerCase();
      const origin = String(movement.origen || "").toLowerCase();
      const type = String(movement.tipo || "").toLowerCase();

      if (state === "anulado" || movement.anulada_at) {
        throw new AppError("El egreso ya fue anulado", 409);
      }

      const existingCancellation = await client.query(
        `SELECT id
         FROM financial_movement_cancellations
         WHERE movimiento_financiero_id = $1
         LIMIT 1`,
        [movementId]
      );

      if (existingCancellation.rowCount) {
        throw new AppError("El egreso ya posee una anulación registrada", 409);
      }

      if (origin !== "egreso_manual" || type !== "egreso") {
        throw new AppError(
          "Solo pueden anularse egresos manuales. Los movimientos automáticos deben revertirse desde su operación de origen.",
          409
        );
      }

      if (toNumber(movement.reversion_version) !== 1) {
        throw new AppError(
          "Este egreso fue creado antes de habilitar la trazabilidad y no puede anularse automáticamente.",
          409
        );
      }

      if (
        movement.venta_id ||
        movement.purchase_invoice_id ||
        movement.sale_cancellation_id ||
        movement.purchase_invoice_cancellation_id ||
        movement.reversed_movement_id ||
        movement.financial_movement_cancellation_id
      ) {
        throw new AppError(
          "El movimiento tiene vínculos automáticos y no puede anularse desde Finanzas.",
          409
        );
      }

      let cheque: any = null;
      const chequeId = toNumber(movement.cheque_id);

      if (chequeId > 0) {
        const chequeResult = await client.query(
          `SELECT *
           FROM cheques
           WHERE id = $1
           LIMIT 1
           FOR UPDATE`,
          [chequeId]
        );

        if (!chequeResult.rowCount) {
          throw new AppError("El cheque vinculado no existe", 409);
        }

        cheque = chequeResult.rows[0];

        if (String(movement.forma_pago || "") !== "cheque_en_cartera") {
          throw new AppError("El cheque está vinculado de forma inconsistente", 409);
        }

        if (String(cheque.estado || "").toLowerCase() !== "entregado_proveedor") {
          throw new AppError(
            `No se puede anular el egreso porque el cheque N° ${cheque.numero_cheque || cheque.id} está ${cheque.estado || "en un estado no reversible"}.`,
            409
          );
        }

        const otherMovement = await client.query(
          `SELECT id
           FROM movimientos_financieros
           WHERE cheque_id = $1
             AND id <> $2
             AND COALESCE(estado, 'Activo') <> 'Anulado'
             AND origen = 'egreso_manual'
           LIMIT 1`,
          [chequeId, movementId]
        );

        if (otherMovement.rowCount) {
          throw new AppError("El cheque está vinculado a otro egreso activo", 409);
        }
      }

      const snapshot = { movement, cheque };
      const cancellationResult = await client.query(
        `INSERT INTO financial_movement_cancellations (
           movimiento_financiero_id,
           motivo,
           anulada_por,
           estado_original,
           cheque_estado_original,
           snapshot
         )
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         RETURNING id, anulada_at`,
        [
          movementId,
          normalizedReason,
          normalizedUser,
          movement.estado || "Activo",
          cheque?.estado || null,
          JSON.stringify(snapshot),
        ]
      );

      const cancellationId = toNumber(cancellationResult.rows[0]?.id);
      const cancelledAt =
        cancellationResult.rows[0]?.anulada_at || new Date().toISOString();
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
           financial_movement_cancellation_id,
           estado,
           reversion_version
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING id`,
        [
          "ingreso",
          "anulacion_egreso_manual",
          `Anulación del egreso N° ${movement.numero_pago || movement.id}: ${movement.descripcion || "Sin descripción"}`,
          movement.categoria || "Anulación de egreso",
          movement.forma_pago || "sin informar",
          toNumber(movement.monto),
          normalizeBusinessDateForStorage(),
          normalizedUser,
          nextPaymentNumber,
          chequeId || null,
          movementId,
          cancellationId,
          "Activo",
          0,
        ]
      );

      await client.query(
        `UPDATE movimientos_financieros
         SET estado = 'Anulado',
             anulada_at = $1,
             anulada_por = $2,
             anulacion_motivo = $3,
             financial_movement_cancellation_id = $4
         WHERE id = $5`,
        [cancelledAt, normalizedUser, normalizedReason, cancellationId, movementId]
      );

      if (chequeId > 0) {
        await client.query(
          `UPDATE cheques
           SET estado = 'en_cartera',
               proveedor_id = NULL,
               fecha_entrega = NULL
           WHERE id = $1`,
          [chequeId]
        );
      }

      if (ownsTransaction) await client.query("COMMIT");

      return {
        movement: {
          ...movement,
          estado: "Anulado",
          anulada_at: cancelledAt,
          anulada_por: normalizedUser,
          anulacion_motivo: normalizedReason,
        },
        reversal_movement_id: toNumber(reversalResult.rows[0]?.id),
        cancellation_id: cancellationId,
        cheque_restored: chequeId > 0,
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
