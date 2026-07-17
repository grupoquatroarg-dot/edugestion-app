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

const roundMoney = (value: any) => Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
const amountsMatch = (left: any, right: any) => Math.abs(roundMoney(left) - roundMoney(right)) <= 0.01;

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
      let rejectionContext: null | {
        paymentMovement: any;
        allocations: any[];
        customerId: number;
        routeItemId: number;
        totalAmount: number;
      } = null;

      if (normalizedState === "rechazado") {
        const paymentMovementId = toNumber(cheque.financial_movement_id);
        const customerId = toNumber(cheque.cliente_id);

        if (!paymentMovementId || !customerId) {
          throw new AppError(
            "El cheque es histórico o no posee trazabilidad suficiente para restaurar la deuda del cliente",
            409
          );
        }

        const paymentMovementResult = await client.query(
          `SELECT *
           FROM movimientos_financieros
           WHERE id = $1
           LIMIT 1
           FOR UPDATE`,
          [paymentMovementId]
        );

        if (!paymentMovementResult.rowCount) {
          throw new AppError("No existe el movimiento financiero vinculado al cheque", 409);
        }

        const paymentMovement = paymentMovementResult.rows[0];
        if (
          String(paymentMovement.tipo || "").toLowerCase() !== "ingreso" ||
          !["venta", "cobranza"].includes(String(paymentMovement.origen || "").toLowerCase()) ||
          String(paymentMovement.estado || "Activo").toLowerCase() === "anulado" ||
          toNumber(paymentMovement.cliente_id) !== customerId ||
          toNumber(paymentMovement.cheque_id) !== chequeId
        ) {
          throw new AppError("El movimiento del cheque no es compatible con un rechazo automático", 409);
        }

        const allocationsResult = await client.query(
          `SELECT
             spa.id,
             spa.sale_id,
             spa.monto,
             spa.estado AS allocation_state,
             spa.client_payment_cancellation_id,
             s.numero_venta,
             s.cliente_id,
             s.total,
             s.monto_pagado,
             s.monto_pendiente,
             s.estado AS sale_state
           FROM sale_payment_allocations spa
           JOIN sales s ON s.id = spa.sale_id
           WHERE spa.movimiento_financiero_id = $1
             AND COALESCE(spa.estado, 'Activo') = 'Activo'
           ORDER BY spa.id ASC
           FOR UPDATE OF spa, s`,
          [paymentMovementId]
        );

        if (!allocationsResult.rowCount) {
          throw new AppError("El cheque no posee asignaciones activas y trazables a ventas", 409);
        }

        const allocations = allocationsResult.rows;
        const totalAmount = roundMoney(
          allocations.reduce((sum: number, allocation: any) => sum + toNumber(allocation.monto), 0)
        );
        const chequeAmount = roundMoney(cheque.importe);
        const movementAmount = roundMoney(paymentMovement.monto);

        if (!amountsMatch(totalAmount, chequeAmount) || !amountsMatch(totalAmount, movementAmount)) {
          throw new AppError("El importe del cheque no coincide con su movimiento y asignaciones", 409);
        }

        for (const allocation of allocations) {
          const amount = roundMoney(allocation.monto);
          const paid = roundMoney(allocation.monto_pagado);
          const pending = roundMoney(allocation.monto_pendiente);
          const total = roundMoney(allocation.total);

          if (toNumber(allocation.cliente_id) !== customerId) {
            throw new AppError("El cheque contiene una asignación de otro cliente", 409);
          }
          if (String(allocation.sale_state || "").toLowerCase() === "anulada") {
            throw new AppError(
              `La Venta N° ${allocation.numero_venta || allocation.sale_id} está anulada y requiere revisión manual`,
              409
            );
          }
          if (amount <= 0 || paid + 0.01 < amount) {
            throw new AppError("La asignación del cheque es incompatible con el monto pagado", 409);
          }

          const nextPaid = roundMoney(paid - amount);
          const nextPending = roundMoney(pending + amount);
          if (nextPaid < -0.01 || nextPending > total + 0.01 || !amountsMatch(nextPaid + nextPending, total)) {
            throw new AppError("El rechazo produciría importes inconsistentes en una venta", 409);
          }
        }

        const routeItemId = toNumber(paymentMovement.route_item_id);
        if (routeItemId > 0) {
          const routeResult = await client.query(
            `SELECT id, client_id, cobranza_realizada
             FROM route_items
             WHERE id = $1
             LIMIT 1
             FOR UPDATE`,
            [routeItemId]
          );
          if (!routeResult.rowCount || toNumber(routeResult.rows[0]?.client_id) !== customerId) {
            throw new AppError("La cobranza de ruta vinculada al cheque es inconsistente", 409);
          }
        }

        rejectionContext = { paymentMovement, allocations, customerId, routeItemId, totalAmount };

        const nextPaymentNumber = await getAndIncrementPaymentNumber(client);
        const movementResult = await client.query(
          `INSERT INTO movimientos_financieros (
             tipo, origen, descripcion, categoria, forma_pago, monto, fecha, usuario,
             numero_pago, cheque_id, cliente_id, venta_id, route_item_id,
             reversed_movement_id, estado, reversion_version
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
           RETURNING id`,
          [
            "egreso",
            "cheque_rechazado",
            `Cheque rechazado N° ${cheque.numero_cheque || cheque.id} - ${cheque.banco || "Sin banco"}`,
            "Cheque Rechazado",
            "cheque",
            totalAmount,
            normalizeBusinessDateForStorage(),
            normalizedUser,
            nextPaymentNumber,
            chequeId,
            customerId,
            toNumber(paymentMovement.venta_id) || null,
            routeItemId || null,
            paymentMovementId,
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
        payment_movement: rejectionContext?.paymentMovement || null,
        payment_allocations: rejectionContext?.allocations || [],
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

      if (rejectionContext) {
        for (const allocation of rejectionContext.allocations) {
          const amount = roundMoney(allocation.monto);
          const nextPaid = roundMoney(toNumber(allocation.monto_pagado) - amount);
          const nextPending = roundMoney(toNumber(allocation.monto_pendiente) + amount);

          await client.query(
            `UPDATE sales
             SET monto_pagado = $1,
                 monto_pendiente = $2,
                 estado = $3
             WHERE id = $4`,
            [nextPaid, nextPending, nextPending <= 0.01 ? "Pagada" : "Pendiente", allocation.sale_id]
          );

          await client.query(
            `UPDATE sale_payment_allocations
             SET estado = 'Anulado',
                 anulada_at = $1,
                 anulada_por = $2,
                 anulacion_motivo = $3
             WHERE id = $4
               AND COALESCE(estado, 'Activo') = 'Activo'`,
            [changedAt, normalizedUser, `Cheque rechazado: ${normalizedReason}`, allocation.id]
          );

          await client.query(
            `INSERT INTO cheque_rejection_allocations (
               cheque_status_change_id, cheque_id, sale_payment_allocation_id, sale_id, monto
             )
             VALUES ($1, $2, $3, $4, $5)`,
            [changeId, chequeId, allocation.id, allocation.sale_id, amount]
          );
        }

        await client.query(
          `UPDATE clientes
           SET saldo_cta_cte = COALESCE(saldo_cta_cte, 0) + $1
           WHERE id = $2`,
          [rejectionContext.totalAmount, rejectionContext.customerId]
        );

        if (rejectionContext.routeItemId > 0) {
          const note = `Cobranza con cheque rechazada: ${normalizedReason}`;
          await client.query(
            `UPDATE route_items
             SET cobranza_realizada = 0,
                 notes = CASE
                   WHEN btrim(COALESCE(notes, '')) = '' THEN $2
                   ELSE notes || E'\n' || $2
                 END
             WHERE id = $1`,
            [rejectionContext.routeItemId, note]
          );
        }
      }

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

        const rejectionAllocationsResult = await client.query(
          `SELECT
             cra.id AS rejection_allocation_id,
             cra.sale_payment_allocation_id,
             cra.sale_id,
             cra.monto,
             cra.reverted_at,
             spa.estado AS allocation_state,
             spa.client_payment_cancellation_id,
             s.numero_venta,
             s.cliente_id,
             s.total,
             s.monto_pagado,
             s.monto_pendiente,
             s.estado AS sale_state
           FROM cheque_rejection_allocations cra
           JOIN sale_payment_allocations spa ON spa.id = cra.sale_payment_allocation_id
           JOIN sales s ON s.id = cra.sale_id
           WHERE cra.cheque_status_change_id = $1
             AND cra.cheque_id = $2
             AND cra.reverted_at IS NULL
           ORDER BY cra.id ASC
           FOR UPDATE OF cra, spa, s`,
          [change.id, chequeId]
        );

        if (!rejectionAllocationsResult.rowCount) {
          throw new AppError("El rechazo no tiene asignaciones de deuda trazables para restaurar", 409);
        }

        const rejectionAllocations = rejectionAllocationsResult.rows;
        const totalAmount = roundMoney(
          rejectionAllocations.reduce((sum: number, allocation: any) => sum + toNumber(allocation.monto), 0)
        );
        if (!amountsMatch(totalAmount, movement.monto)) {
          throw new AppError("Las asignaciones del rechazo no coinciden con su movimiento financiero", 409);
        }

        const customerId = toNumber(movement.cliente_id || cheque.cliente_id);
        if (!customerId) {
          throw new AppError("El rechazo no tiene un cliente trazable", 409);
        }

        const customerResult = await client.query(
          `SELECT id, saldo_cta_cte
           FROM clientes
           WHERE id = $1
           LIMIT 1
           FOR UPDATE`,
          [customerId]
        );
        if (!customerResult.rowCount) {
          throw new AppError("El cliente vinculado al cheque ya no existe", 409);
        }
        const currentBalance = roundMoney(customerResult.rows[0]?.saldo_cta_cte);
        if (currentBalance + 0.01 < totalAmount) {
          throw new AppError(
            "El cliente ya aplicó otros pagos sobre esta deuda. Anulalos antes de revertir el rechazo",
            409
          );
        }

        for (const allocation of rejectionAllocations) {
          const amount = roundMoney(allocation.monto);
          const paid = roundMoney(allocation.monto_pagado);
          const pending = roundMoney(allocation.monto_pendiente);
          const total = roundMoney(allocation.total);

          if (toNumber(allocation.cliente_id) !== customerId) {
            throw new AppError("La reversión contiene una venta de otro cliente", 409);
          }
          if (String(allocation.sale_state || "").toLowerCase() === "anulada") {
            throw new AppError(
              `La Venta N° ${allocation.numero_venta || allocation.sale_id} está anulada y no admite restaurar el pago`,
              409
            );
          }
          if (
            String(allocation.allocation_state || "").toLowerCase() !== "anulado" ||
            toNumber(allocation.client_payment_cancellation_id) > 0 ||
            allocation.reverted_at
          ) {
            throw new AppError("La asignación del cheque fue modificada por otra operación", 409);
          }

          const nextPaid = roundMoney(paid + amount);
          const nextPending = roundMoney(pending - amount);
          if (nextPending < -0.01 || nextPaid > total + 0.01 || !amountsMatch(nextPaid + nextPending, total)) {
            throw new AppError("La reversión produciría importes inconsistentes en una venta", 409);
          }
        }

        const routeItemId = toNumber(movement.route_item_id);
        if (routeItemId > 0) {
          const routeResult = await client.query(
            `SELECT id, client_id, cobranza_realizada
             FROM route_items
             WHERE id = $1
             LIMIT 1
             FOR UPDATE`,
            [routeItemId]
          );
          if (!routeResult.rowCount || toNumber(routeResult.rows[0]?.client_id) !== customerId) {
            throw new AppError("El ítem de ruta vinculado al cheque es inconsistente", 409);
          }

          const otherPaymentResult = await client.query(
            `SELECT id
             FROM movimientos_financieros
             WHERE route_item_id = $1
               AND id <> $2
               AND lower(COALESCE(tipo, '')) = 'ingreso'
               AND lower(COALESCE(origen, '')) = 'cobranza'
               AND lower(COALESCE(estado, 'Activo')) <> 'anulado'
             LIMIT 1
             FOR UPDATE`,
            [routeItemId, toNumber(cheque.financial_movement_id)]
          );
          if (otherPaymentResult.rowCount) {
            throw new AppError("La ruta ya posee otra cobranza activa y no puede restaurarse este cheque", 409);
          }
        }

        const nextPaymentNumber = await getAndIncrementPaymentNumber(client);
        const reversalResult = await client.query(
          `INSERT INTO movimientos_financieros (
             tipo, origen, descripcion, categoria, forma_pago, monto, fecha, usuario,
             numero_pago, cheque_id, cliente_id, venta_id, route_item_id,
             reversed_movement_id, estado, reversion_version
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
           RETURNING id`,
          [
            "ingreso",
            "anulacion_cheque_rechazado",
            `Reversión de rechazo del cheque N° ${cheque.numero_cheque || cheque.id}`,
            "Cheque Rechazado",
            "cheque",
            totalAmount,
            normalizeBusinessDateForStorage(),
            normalizedUser,
            nextPaymentNumber,
            chequeId,
            customerId,
            toNumber(movement.venta_id) || null,
            routeItemId || null,
            financialMovementId,
            "Activo",
            0,
          ]
        );
        reversalMovementId = toNumber(reversalResult.rows[0]?.id) || null;

        const restoredAt = new Date().toISOString();
        await client.query(
          `UPDATE movimientos_financieros
           SET estado = 'Anulado',
               anulada_at = $1,
               anulada_por = $2,
               anulacion_motivo = $3
           WHERE id = $4`,
          [restoredAt, normalizedUser, normalizedReason, financialMovementId]
        );

        for (const allocation of rejectionAllocations) {
          const amount = roundMoney(allocation.monto);
          const nextPaid = roundMoney(toNumber(allocation.monto_pagado) + amount);
          const nextPending = roundMoney(toNumber(allocation.monto_pendiente) - amount);

          await client.query(
            `UPDATE sales
             SET monto_pagado = $1,
                 monto_pendiente = $2,
                 estado = $3
             WHERE id = $4`,
            [nextPaid, Math.max(0, nextPending), nextPending <= 0.01 ? "Pagada" : "Pendiente", allocation.sale_id]
          );

          await client.query(
            `UPDATE sale_payment_allocations
             SET estado = 'Activo',
                 anulada_at = NULL,
                 anulada_por = NULL,
                 anulacion_motivo = NULL
             WHERE id = $1
               AND COALESCE(estado, 'Activo') = 'Anulado'
               AND client_payment_cancellation_id IS NULL`,
            [allocation.sale_payment_allocation_id]
          );

          await client.query(
            `UPDATE cheque_rejection_allocations
             SET reverted_at = $1,
                 reverted_by = $2,
                 reversion_reason = $3
             WHERE id = $4`,
            [restoredAt, normalizedUser, normalizedReason, allocation.rejection_allocation_id]
          );
        }

        await client.query(
          `UPDATE clientes
           SET saldo_cta_cte = COALESCE(saldo_cta_cte, 0) - $1
           WHERE id = $2`,
          [totalAmount, customerId]
        );

        if (routeItemId > 0) {
          const note = `Rechazo de cheque revertido: ${normalizedReason}`;
          await client.query(
            `UPDATE route_items
             SET cobranza_realizada = 1,
                 notes = CASE
                   WHEN btrim(COALESCE(notes, '')) = '' THEN $2
                   ELSE notes || E'\n' || $2
                 END
             WHERE id = $1`,
            [routeItemId, note]
          );
        }
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
