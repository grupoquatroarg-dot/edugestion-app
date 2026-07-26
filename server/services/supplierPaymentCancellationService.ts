import { getPostgresPool, isPostgresConfigured } from "../utils/postgres.js";
import { AppError } from "../utils/response.js";
import { normalizeBusinessDateForStorage } from "../utils/businessDate.js";

export type SupplierPaymentTransactionClient = {
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
const isCurrentAccount = (value: unknown) => String(value || "").trim().toLowerCase() === "cta cte";

const appendAuditNote = (current: unknown, note: string) => {
  const base = String(current || "").trim();
  return base ? `${base}\n${note}` : note;
};

const getAndIncrementPaymentNumber = async (client: SupplierPaymentTransactionClient) => {
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

export const supplierPaymentCancellationService = {
  async cancelSupplierPayment(
    { movementId, motivo, usuario }: CancellationInput,
    executor?: SupplierPaymentTransactionClient
  ) {
    const normalizedReason = String(motivo || "").trim();
    const normalizedUser = String(usuario || "Sistema").trim() || "Sistema";

    if (!Number.isInteger(movementId) || movementId <= 0) {
      throw new AppError("ID de pago a proveedor inválido", 400);
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
      throw new AppError("La anulación de pagos a proveedores requiere PostgreSQL", 409);
    }

    const ownsTransaction = !executor;
    const pool = executor ? null : getPostgresPool();
    const client = executor || (await pool!.connect());

    try {
      if (ownsTransaction) await client.query("BEGIN");

      const movementResult = await client.query(
        `SELECT
           mf.*,
           pia.id AS allocation_id,
           pia.monto AS allocation_amount,
           pia.allocation_type,
           pia.estado AS allocation_state,
           pia.supplier_payment_cancellation_id AS allocation_cancellation_id,
           pi.proveedor_id,
           pi.numero_factura,
           pi.total AS invoice_total,
           pi.metodo_pago AS invoice_payment_method,
           pi.estado_pago AS invoice_payment_state,
           pi.monto_pagado AS invoice_paid_amount,
           pi.fecha_pago AS invoice_payment_date,
           pi.metodo_pago_real AS invoice_real_payment_method,
           pi.estado AS invoice_state,
           pi.reversion_version AS invoice_reversion_version,
           p.nombre AS proveedor
         FROM movimientos_financieros mf
         JOIN purchase_invoice_payment_allocations pia
           ON pia.movimiento_financiero_id = mf.id
         JOIN purchase_invoices pi
           ON pi.id = pia.purchase_invoice_id
         JOIN proveedores p
           ON p.id = pi.proveedor_id
         WHERE mf.id = $1
           AND pia.allocation_type = 'supplier_payment'
         LIMIT 1
         FOR UPDATE OF mf, pia, pi`,
        [movementId]
      );

      if (!movementResult.rowCount) {
        throw new AppError("Pago a proveedor no encontrado o sin trazabilidad", 404);
      }

      const payment = movementResult.rows[0];
      const movementState = String(payment.estado || "Activo").toLowerCase();
      const allocationState = String(payment.allocation_state || "Activo").toLowerCase();
      const invoiceState = String(payment.invoice_state || "Activa").toLowerCase();
      const movementAmount = roundMoney(toNumber(payment.monto));
      const allocationAmount = roundMoney(toNumber(payment.allocation_amount));
      const invoiceTotal = roundMoney(toNumber(payment.invoice_total));
      const invoicePaid = roundMoney(toNumber(payment.invoice_paid_amount));
      const invoiceId = toNumber(payment.purchase_invoice_id);
      const providerId = toNumber(payment.proveedor_id);
      const chequeId = toNumber(payment.cheque_id);

      if (movementState === "anulado" || payment.anulada_at) {
        throw new AppError("El pago a proveedor ya fue anulado", 409);
      }

      if (allocationState === "anulado" || payment.allocation_cancellation_id) {
        throw new AppError("La asignación del pago ya fue anulada", 409);
      }

      if (String(payment.tipo || "").toLowerCase() !== "egreso" || String(payment.origen || "").toLowerCase() !== "compra") {
        throw new AppError(
          "Solo pueden anularse pagos posteriores de facturas de compra desde esta acción.",
          409
        );
      }

      if (String(payment.allocation_type || "") !== "supplier_payment") {
        throw new AppError(
          "El pago inicial de una factura solo puede revertirse anulando la factura completa.",
          409
        );
      }

      if (toNumber(payment.reversion_version) !== 1) {
        throw new AppError(
          "Este pago fue creado sin trazabilidad completa y no puede anularse automáticamente.",
          409
        );
      }

      if (!invoiceId || !providerId || movementAmount <= 0 || allocationAmount <= 0) {
        throw new AppError("El pago tiene datos inconsistentes y no puede anularse", 409);
      }

      if (!amountsMatch(movementAmount, allocationAmount)) {
        throw new AppError("La asignación del pago no coincide con el movimiento financiero", 409);
      }

      if (invoiceState === "anulada" || payment.purchase_invoice_cancellation_id) {
        throw new AppError("La factura está anulada y el pago no puede revertirse por separado", 409);
      }

      if (!isCurrentAccount(payment.invoice_payment_method)) {
        throw new AppError(
          "Solo pueden anularse pagos posteriores de facturas registradas originalmente en cuenta corriente.",
          409
        );
      }

      if (toNumber(payment.invoice_reversion_version) !== 1) {
        throw new AppError("La factura no posee trazabilidad suficiente para revertir el pago", 409);
      }

      if (
        payment.sale_cancellation_id ||
        payment.purchase_invoice_cancellation_id ||
        payment.financial_movement_cancellation_id ||
        payment.client_payment_cancellation_id ||
        payment.supplier_payment_cancellation_id ||
        payment.reversed_movement_id
      ) {
        throw new AppError("El pago ya posee vínculos de reversión incompatibles", 409);
      }

      const existingCancellationResult = await client.query(
        `SELECT id
         FROM supplier_payment_cancellations
         WHERE movimiento_financiero_id = $1
         LIMIT 1`,
        [movementId]
      );

      if (existingCancellationResult.rowCount) {
        throw new AppError("El pago ya posee una anulación registrada", 409);
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
        throw new AppError("El pago ya posee un contramovimiento", 409);
      }

      const activeAllocationsResult = await client.query(
        `SELECT
           pia.id,
           pia.movimiento_financiero_id,
           pia.monto,
           pia.allocation_type,
           pia.estado,
           mf.forma_pago,
           mf.fecha,
           mf.estado AS movement_state
         FROM purchase_invoice_payment_allocations pia
         JOIN movimientos_financieros mf
           ON mf.id = pia.movimiento_financiero_id
         WHERE pia.purchase_invoice_id = $1
           AND pia.allocation_type = 'supplier_payment'
           AND COALESCE(pia.estado, 'Activo') = 'Activo'
           AND COALESCE(mf.estado, 'Activo') <> 'Anulado'
         ORDER BY pia.id ASC
         FOR UPDATE OF pia, mf`,
        [invoiceId]
      );

      const activeAllocations = activeAllocationsResult.rows;
      const activePaidAmount = roundMoney(
        activeAllocations.reduce((sum: number, allocation: any) => sum + toNumber(allocation.monto), 0)
      );

      if (!activeAllocations.some((allocation: any) => toNumber(allocation.movimiento_financiero_id) === movementId)) {
        throw new AppError("El pago no figura entre las asignaciones activas de la factura", 409);
      }

      if (!amountsMatch(activePaidAmount, invoicePaid)) {
        throw new AppError(
          "La trazabilidad de pagos activos no coincide con el importe pagado de la factura",
          409
        );
      }

      if (invoicePaid + 0.01 < allocationAmount || invoicePaid > invoiceTotal + 0.01) {
        throw new AppError("La anulación produciría importes inconsistentes en la factura", 409);
      }

      const nextPaidAmount = roundMoney(invoicePaid - allocationAmount);
      const nextPendingAmount = roundMoney(invoiceTotal - nextPaidAmount);

      if (
        nextPaidAmount < -0.01 ||
        nextPendingAmount < -0.01 ||
        nextPendingAmount > invoiceTotal + 0.01 ||
        !amountsMatch(nextPaidAmount + nextPendingAmount, invoiceTotal)
      ) {
        throw new AppError("La anulación produciría un saldo inválido en la factura", 409);
      }

      let cheque: any = null;

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
          throw new AppError("El cheque vinculado al pago ya no existe", 409);
        }

        cheque = chequeResult.rows[0];
        const chequeState = String(cheque.estado || "").toLowerCase();

        if (chequeState !== "entregado_proveedor") {
          throw new AppError(
            `No se puede anular el pago porque el cheque N° ${cheque.numero_cheque || cheque.id} está ${cheque.estado || "en un estado no reversible"}.`,
            409
          );
        }

        if (toNumber(cheque.proveedor_id) !== providerId) {
          throw new AppError("El cheque fue entregado a otro proveedor", 409);
        }

        if (toNumber(cheque.purchase_invoice_id) !== invoiceId) {
          throw new AppError("El cheque no está vinculado a esta factura", 409);
        }

        if (!amountsMatch(toNumber(cheque.importe), movementAmount)) {
          throw new AppError("El importe del cheque no coincide con el pago", 409);
        }
      }

      const snapshot = {
        movement: payment,
        invoice: {
          id: invoiceId,
          numero_factura: payment.numero_factura,
          total: invoiceTotal,
          monto_pagado: invoicePaid,
          estado_pago: payment.invoice_payment_state,
          fecha_pago: payment.invoice_payment_date,
          metodo_pago_real: payment.invoice_real_payment_method,
          proveedor_id: providerId,
          proveedor: payment.proveedor,
        },
        allocation: {
          id: toNumber(payment.allocation_id),
          monto: allocationAmount,
          estado: payment.allocation_state,
        },
        cheque,
      };

      const cancellationResult = await client.query(
        `INSERT INTO supplier_payment_cancellations (
           movimiento_financiero_id,
           purchase_invoice_id,
           motivo,
           anulada_por,
           monto_original,
           monto_pagado_original,
           estado_pago_original,
           cheque_id,
           cheque_estado_original,
           snapshot
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
         RETURNING id, anulada_at`,
        [
          movementId,
          invoiceId,
          normalizedReason,
          normalizedUser,
          movementAmount,
          invoicePaid,
          payment.invoice_payment_state || null,
          chequeId || null,
          cheque?.estado || null,
          JSON.stringify(snapshot),
        ]
      );

      const cancellationId = toNumber(cancellationResult.rows[0]?.id);
      const cancelledAt = cancellationResult.rows[0]?.anulada_at || new Date().toISOString();

      const remainingAllocations = activeAllocations.filter(
        (allocation: any) => toNumber(allocation.movimiento_financiero_id) !== movementId
      );
      const latestRemaining = remainingAllocations.at(-1) || null;

      await client.query(
        `UPDATE purchase_invoices
         SET monto_pagado = $1,
             estado_pago = $2,
             fecha_pago = $3,
             metodo_pago_real = $4
         WHERE id = $5`,
        [
          nextPaidAmount,
          nextPendingAmount <= 0.01 ? "pagado" : "pendiente",
          latestRemaining?.fecha || null,
          latestRemaining?.forma_pago || null,
          invoiceId,
        ]
      );

      await client.query(
        `UPDATE purchase_invoice_payment_allocations
         SET estado = 'Anulado',
             anulada_at = $1,
             anulada_por = $2,
             anulacion_motivo = $3,
             supplier_payment_cancellation_id = $4
         WHERE id = $5
           AND COALESCE(estado, 'Activo') = 'Activo'`,
        [cancelledAt, normalizedUser, normalizedReason, cancellationId, payment.allocation_id]
      );

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
           purchase_invoice_id,
           reversed_movement_id,
           supplier_payment_cancellation_id,
           estado,
           reversion_version
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         RETURNING id`,
        [
          "ingreso",
          "anulacion_pago_proveedor",
          `Anulación de pago de Factura Compra #${payment.numero_factura}: ${normalizedReason}`,
          "Anulación de pagos a proveedores",
          payment.forma_pago || "Sin especificar",
          movementAmount,
          normalizeBusinessDateForStorage(),
          normalizedUser,
          nextPaymentNumber,
          chequeId || null,
          invoiceId,
          movementId,
          cancellationId,
          "Activo",
          0,
        ]
      );

      const reversalMovementId = toNumber(reversalResult.rows[0]?.id);

      await client.query(
        `UPDATE supplier_payment_cancellations
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
             supplier_payment_cancellation_id = $4
         WHERE id = $5`,
        [cancelledAt, normalizedUser, normalizedReason, cancellationId, movementId]
      );

      if (chequeId > 0) {
        await client.query(
          `UPDATE cheques
           SET estado = 'en_cartera',
               proveedor_id = NULL,
               purchase_invoice_id = NULL,
               fecha_entrega = NULL,
               observaciones = $1
           WHERE id = $2`,
          [
            appendAuditNote(
              cheque?.observaciones,
              `Pago de Factura Compra #${payment.numero_factura} anulado. Motivo: ${normalizedReason}`
            ),
            chequeId,
          ]
        );
      }

      if (ownsTransaction) await client.query("COMMIT");

      return {
        movement: {
          ...payment,
          estado: "Anulado",
          anulada_at: cancelledAt,
          anulada_por: normalizedUser,
          anulacion_motivo: normalizedReason,
          supplier_payment_cancellation_id: cancellationId,
        },
        cancellation_id: cancellationId,
        reversal_movement_id: reversalMovementId,
        invoice_id: invoiceId,
        invoice_paid_before: invoicePaid,
        invoice_paid_after: nextPaidAmount,
        invoice_pending_after: nextPendingAmount,
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
