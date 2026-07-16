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

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const amountsMatch = (left: number, right: number) => Math.abs(roundMoney(left) - roundMoney(right)) <= 0.01;

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

export const clientPaymentCancellationService = {
  async cancelClientPayment(
    { movementId, motivo, usuario }: CancellationInput,
    executor?: TransactionClient
  ) {
    const normalizedReason = String(motivo || "").trim();
    const normalizedUser = String(usuario || "Sistema").trim() || "Sistema";

    if (!Number.isInteger(movementId) || movementId <= 0) {
      throw new AppError("ID de cobranza inválido", 400);
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
      throw new AppError("La anulación de cobranzas requiere PostgreSQL", 409);
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
        throw new AppError("Cobranza no encontrada", 404);
      }

      const movement = movementResult.rows[0];
      const state = String(movement.estado || "Activo").toLowerCase();
      const origin = String(movement.origen || "").toLowerCase();
      const type = String(movement.tipo || "").toLowerCase();
      const customerId = toNumber(movement.cliente_id);
      const routeItemId = toNumber(movement.route_item_id);
      const movementAmount = roundMoney(toNumber(movement.monto));

      if (state === "anulado" || movement.anulada_at) {
        throw new AppError("La cobranza ya fue anulada", 409);
      }

      if (origin !== "cobranza" || type !== "ingreso") {
        throw new AppError(
          "Solo pueden anularse cobranzas de clientes. Los demás movimientos deben revertirse desde su operación de origen.",
          409
        );
      }

      if (toNumber(movement.reversion_version) !== 1) {
        throw new AppError(
          "Esta cobranza fue creada sin trazabilidad completa y no puede anularse automáticamente.",
          409
        );
      }

      if (!customerId || movementAmount <= 0) {
        throw new AppError("La cobranza tiene datos inconsistentes y no puede anularse", 409);
      }

      if (
        movement.sale_cancellation_id ||
        movement.purchase_invoice_cancellation_id ||
        movement.financial_movement_cancellation_id ||
        movement.client_payment_cancellation_id ||
        movement.reversed_movement_id
      ) {
        throw new AppError("La cobranza ya posee vínculos de reversión incompatibles", 409);
      }

      const existingCancellationResult = await client.query(
        `SELECT id
         FROM client_payment_cancellations
         WHERE movimiento_financiero_id = $1
         LIMIT 1`,
        [movementId]
      );

      if (existingCancellationResult.rowCount) {
        throw new AppError("La cobranza ya posee una anulación registrada", 409);
      }

      const existingReversalResult = await client.query(
        `SELECT id
         FROM movimientos_financieros
         WHERE reversed_movement_id = $1
         LIMIT 1
         FOR UPDATE`,
        [movementId]
      );

      if (existingReversalResult.rowCount) {
        throw new AppError("La cobranza ya posee un contramovimiento y no puede anularse nuevamente", 409);
      }

      const customerResult = await client.query(
        `SELECT id, nombre_apellido, saldo_cta_cte
         FROM clientes
         WHERE id = $1
         LIMIT 1
         FOR UPDATE`,
        [customerId]
      );

      if (!customerResult.rowCount) {
        throw new AppError("El cliente de la cobranza ya no existe", 409);
      }

      const customer = customerResult.rows[0];
      const customerBalanceBefore = roundMoney(toNumber(customer.saldo_cta_cte));

      let routeItem: any = null;
      if (routeItemId > 0) {
        const routeItemResult = await client.query(
          `SELECT ri.id, ri.route_id, ri.client_id, ri.cobranza_realizada, ri.status
           FROM route_items ri
           WHERE ri.id = $1
           LIMIT 1
           FOR UPDATE OF ri`,
          [routeItemId]
        );

        if (!routeItemResult.rowCount) {
          throw new AppError('El ítem de ruta vinculado a la cobranza ya no existe', 409);
        }

        routeItem = routeItemResult.rows[0];
        if (toNumber(routeItem.client_id) !== customerId) {
          throw new AppError('El ítem de ruta no pertenece al cliente de la cobranza', 409);
        }
        if (toNumber(routeItem.cobranza_realizada) !== 1) {
          throw new AppError('El ítem de ruta no refleja una cobranza activa y requiere revisión manual', 409);
        }

        const otherRoutePaymentResult = await client.query(
          `SELECT id
           FROM movimientos_financieros
           WHERE route_item_id = $1
             AND id <> $2
             AND lower(COALESCE(tipo, '')) = 'ingreso'
             AND lower(COALESCE(origen, '')) = 'cobranza'
             AND lower(COALESCE(estado, 'Activo')) <> 'anulado'
           LIMIT 1
           FOR UPDATE`,
          [routeItemId, movementId]
        );

        if (otherRoutePaymentResult.rowCount) {
          throw new AppError('El ítem de ruta posee otra cobranza activa y no puede revertirse automáticamente', 409);
        }
      }

      const allocationsResult = await client.query(
        `SELECT
           spa.id,
           spa.sale_id,
           spa.monto,
           spa.allocation_type,
           spa.estado AS allocation_state,
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
        [movementId]
      );

      if (!allocationsResult.rowCount) {
        throw new AppError("La cobranza no tiene asignaciones trazables a ventas", 409);
      }

      const allocations = allocationsResult.rows;
      const allocatedAmount = roundMoney(
        allocations.reduce((sum: number, allocation: any) => sum + toNumber(allocation.monto), 0)
      );

      if (!amountsMatch(allocatedAmount, movementAmount)) {
        throw new AppError("La trazabilidad de la cobranza no coincide con su importe", 409);
      }

      const saleSnapshots: any[] = [];

      for (const allocation of allocations) {
        const allocationAmount = roundMoney(toNumber(allocation.monto));
        const saleCustomerId = toNumber(allocation.cliente_id);
        const salePaid = roundMoney(toNumber(allocation.monto_pagado));
        const salePending = roundMoney(toNumber(allocation.monto_pendiente));
        const saleTotal = roundMoney(toNumber(allocation.total));

        if (saleCustomerId !== customerId) {
          throw new AppError("La cobranza contiene una asignación de otro cliente", 409);
        }

        if (String(allocation.sale_state || "").toLowerCase() === "anulada") {
          throw new AppError(
            `La Venta N° ${allocation.numero_venta || allocation.sale_id} está anulada y la cobranza no puede revertirse desde Finanzas.`,
            409
          );
        }

        if (allocationAmount <= 0 || salePaid + 0.01 < allocationAmount) {
          throw new AppError("La cobranza tiene una asignación incompatible con el monto pagado de la venta", 409);
        }

        const nextPaid = roundMoney(salePaid - allocationAmount);
        const nextPending = roundMoney(salePending + allocationAmount);

        if (nextPaid < -0.01 || nextPending > saleTotal + 0.01 || !amountsMatch(nextPaid + nextPending, saleTotal)) {
          throw new AppError("La anulación produciría importes inconsistentes en una venta", 409);
        }

        saleSnapshots.push({
          sale_id: toNumber(allocation.sale_id),
          numero_venta: allocation.numero_venta,
          monto_pagado: salePaid,
          monto_pendiente: salePending,
          estado: allocation.sale_state,
          allocation_id: toNumber(allocation.id),
          allocation_amount: allocationAmount,
        });
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
          throw new AppError("El cheque vinculado a la cobranza no existe", 409);
        }

        cheque = chequeResult.rows[0];
        if (String(cheque.estado || "").toLowerCase() !== "en_cartera") {
          throw new AppError(
            `No se puede anular la cobranza porque el cheque N° ${cheque.numero_cheque || cheque.id} está ${cheque.estado || "en un estado no reversible"}.`,
            409
          );
        }
      }

      const snapshot = {
        movement,
        customer,
        sales: saleSnapshots,
        allocations,
        cheque,
        route_item: routeItem,
      };

      const cancellationResult = await client.query(
        `INSERT INTO client_payment_cancellations (
           movimiento_financiero_id,
           cliente_id,
           motivo,
           anulada_por,
           monto_original,
           saldo_cliente_original,
           snapshot
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
         RETURNING id, anulada_at`,
        [
          movementId,
          customerId,
          normalizedReason,
          normalizedUser,
          movementAmount,
          customerBalanceBefore,
          JSON.stringify(snapshot),
        ]
      );

      const cancellationId = toNumber(cancellationResult.rows[0]?.id);
      const cancelledAt = cancellationResult.rows[0]?.anulada_at || new Date().toISOString();

      for (const allocation of allocations) {
        const allocationAmount = roundMoney(toNumber(allocation.monto));
        const salePaid = roundMoney(toNumber(allocation.monto_pagado));
        const salePending = roundMoney(toNumber(allocation.monto_pendiente));
        const nextPaid = roundMoney(salePaid - allocationAmount);
        const nextPending = roundMoney(salePending + allocationAmount);

        await client.query(
          `UPDATE sales
           SET monto_pagado = $1,
               monto_pendiente = $2,
               estado = $3
           WHERE id = $4`,
          [nextPaid, nextPending, nextPending <= 0.01 ? "Pagada" : "Pendiente", allocation.sale_id]
        );
      }

      await client.query(
        `UPDATE clientes
         SET saldo_cta_cte = COALESCE(saldo_cta_cte, 0) + $1
         WHERE id = $2`,
        [movementAmount, customerId]
      );

      await client.query(
        `UPDATE sale_payment_allocations
         SET estado = 'Anulado',
             anulada_at = $1,
             anulada_por = $2,
             anulacion_motivo = $3,
             client_payment_cancellation_id = $4
         WHERE movimiento_financiero_id = $5
           AND COALESCE(estado, 'Activo') = 'Activo'`,
        [cancelledAt, normalizedUser, normalizedReason, cancellationId, movementId]
      );

      if (routeItemId > 0) {
        const routeCancellationNote = `Cobranza anulada: ${normalizedReason}`;
        await client.query(
          `UPDATE route_items
           SET cobranza_realizada = 0,
               notes = CASE
                 WHEN btrim(COALESCE(notes, '')) = '' THEN $2
                 ELSE notes || E'\n' || $2
               END
           WHERE id = $1`,
          [routeItemId, routeCancellationNote]
        );
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
           cliente_id,
           route_item_id,
           reversed_movement_id,
           client_payment_cancellation_id,
           estado,
           reversion_version
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         RETURNING id`,
        [
          "egreso",
          "anulacion_cobranza",
          `Anulación de cobranza N° ${movement.numero_pago || movement.id}: ${movement.descripcion || "Sin descripción"}`,
          "Anulación de cobranzas",
          movement.forma_pago || "Sin especificar",
          movementAmount,
          normalizeBusinessDateForStorage(),
          normalizedUser,
          nextPaymentNumber,
          chequeId || null,
          customerId,
          routeItemId || null,
          movementId,
          cancellationId,
          "Activo",
          0,
        ]
      );

      const reversalMovementId = toNumber(reversalResult.rows[0]?.id);

      await client.query(
        `UPDATE client_payment_cancellations
         SET reversal_movement_id = $1
         WHERE id = $2`,
        [reversalMovementId, cancellationId]
      );

      await client.query(
        `UPDATE movimientos_financieros
         SET estado = 'Anulado',
             anulada_at = $1,
             anulada_por = $2,
             anulacion_motivo = $3,
             client_payment_cancellation_id = $4
         WHERE id = $5`,
        [cancelledAt, normalizedUser, normalizedReason, cancellationId, movementId]
      );

      if (chequeId > 0) {
        await client.query(
          `UPDATE cheques
           SET estado = 'anulado',
               observaciones = $1
           WHERE id = $2`,
          [`Cobranza anulada: ${normalizedReason}`, chequeId]
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
          client_payment_cancellation_id: cancellationId,
        },
        cancellation_id: cancellationId,
        reversal_movement_id: reversalMovementId,
        customer_balance_before: customerBalanceBefore,
        customer_balance_after: roundMoney(customerBalanceBefore + movementAmount),
        affected_sales: saleSnapshots.length,
        cheque_cancelled: chequeId > 0,
        route_item_reset: routeItemId > 0,
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
