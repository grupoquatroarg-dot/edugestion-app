import { getPostgresPool, isPostgresConfigured } from "../utils/postgres.js";
import { AppError } from "../utils/response.js";

type TransactionClient = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

type CancellationInput = {
  purchaseInvoiceId: number;
  motivo: string;
  usuario: string;
};

const toNumber = (value: any, fallback: number = 0) => {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const amountsMatch = (left: number, right: number) =>
  Math.abs(roundMoney(left) - roundMoney(right)) <= 0.01;

const appendAuditNote = (existing: unknown, note: string) => {
  const current = String(existing || "").trim();
  return current ? `${current}\n${note}` : note;
};

const getAndIncrementSetting = async (
  client: TransactionClient,
  key: string,
  defaultValue: number = 1
) => {
  await client.query(
    `INSERT INTO settings (key, value)
     VALUES ($1, $2)
     ON CONFLICT (key) DO NOTHING`,
    [key, String(defaultValue)]
  );

  const currentResult = await client.query(
    `SELECT value
     FROM settings
     WHERE key = $1
     LIMIT 1
     FOR UPDATE`,
    [key]
  );

  const currentValue = parseInt(currentResult.rows[0]?.value || String(defaultValue), 10) || defaultValue;

  await client.query(
    `UPDATE settings
     SET value = $2
     WHERE key = $1`,
    [key, String(currentValue + 1)]
  );

  return currentValue;
};

export const purchaseInvoiceCancellationService = {
  async cancelPurchaseInvoice(
    { purchaseInvoiceId, motivo, usuario }: CancellationInput,
    executor?: TransactionClient
  ) {
    const normalizedReason = String(motivo || "").trim();
    const normalizedUser = String(usuario || "Sistema").trim() || "Sistema";

    if (!Number.isInteger(purchaseInvoiceId) || purchaseInvoiceId <= 0) {
      throw new AppError("ID de factura inválido", 400);
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
      throw new AppError(
        "La anulación de facturas de compra requiere PostgreSQL y trazabilidad completa",
        409
      );
    }

    const pool = executor ? null : getPostgresPool();
    const client = executor || (await pool!.connect());

    try {
      await client.query("BEGIN");

      const invoiceResult = await client.query(
        `SELECT pi.*, p.nombre AS proveedor
         FROM purchase_invoices pi
         JOIN proveedores p ON p.id = pi.proveedor_id
         WHERE pi.id = $1
         LIMIT 1
         FOR UPDATE OF pi`,
        [purchaseInvoiceId]
      );

      if (!invoiceResult.rowCount) {
        throw new AppError("Factura de compra no encontrada", 404);
      }

      const invoice = invoiceResult.rows[0];
      const invoiceNumber = invoice.numero_factura || invoice.id;

      if (String(invoice.estado || "").toLowerCase() === "anulada" || invoice.anulada_at) {
        throw new AppError(`La factura ${invoiceNumber} ya fue anulada`, 409);
      }

      if (toNumber(invoice.reversion_version) !== 1) {
        throw new AppError(
          "Esta factura es anterior a la trazabilidad de anulaciones y no puede revertirse automáticamente",
          409
        );
      }

      const existingCancellation = await client.query(
        `SELECT id
         FROM purchase_invoice_cancellations
         WHERE purchase_invoice_id = $1
         LIMIT 1`,
        [purchaseInvoiceId]
      );

      if (existingCancellation.rowCount) {
        throw new AppError(`La factura ${invoiceNumber} ya posee una anulación registrada`, 409);
      }

      const preliminaryItemsResult = await client.query(
        `SELECT id, product_id
         FROM purchase_invoice_items
         WHERE invoice_id = $1
         ORDER BY id ASC`,
        [purchaseInvoiceId]
      );

      if (!preliminaryItemsResult.rowCount) {
        throw new AppError(
          "La factura no contiene productos y no puede anularse automáticamente",
          409
        );
      }

      const preliminaryProductIds = [
        ...new Set<number>(
          preliminaryItemsResult.rows
            .map((item: any) => toNumber(item.product_id))
            .filter((productId: number) => productId > 0)
        ),
      ].sort((a, b) => a - b);

      const lockedProductsResult = await client.query(
        `SELECT id, name, stock, cost
         FROM products
         WHERE id = ANY($1::int[])
         ORDER BY id ASC
         FOR UPDATE`,
        [preliminaryProductIds]
      );

      if (lockedProductsResult.rows.length !== preliminaryProductIds.length) {
        throw new AppError(
          "No se pudieron bloquear todos los productos de la factura",
          409
        );
      }

      const itemsResult = await client.query(
        `SELECT
           pii.*,
           p.name AS product_name,
           p.stock AS product_stock,
           p.cost AS product_cost
         FROM purchase_invoice_items pii
         JOIN products p ON p.id = pii.product_id
         WHERE pii.invoice_id = $1
         ORDER BY pii.id ASC
         FOR UPDATE OF pii`,
        [purchaseInvoiceId]
      );

      if (itemsResult.rows.length !== preliminaryItemsResult.rows.length) {
        throw new AppError(
          "Los productos de la factura cambiaron durante la validación",
          409
        );
      }

      const quantityByProduct = new Map<number, number>();
      const earliestPreviousCostByProduct = new Map<number, number>();
      const latestInvoiceCostByProduct = new Map<number, number>();
      const latestItemIdByProduct = new Map<number, number>();
      const productById = new Map<number, any>();
      const movementIds: number[] = [];

      for (const item of itemsResult.rows) {
        const itemId = toNumber(item.id);
        const productId = toNumber(item.product_id);
        const quantity = toNumber(item.cantidad);
        const remaining = toNumber(item.cantidad_restante);
        const stockMovementId = toNumber(item.stock_movement_id);
        const previousCost = toNumber(item.previous_product_cost, Number.NaN);

        if (!itemId || !productId || quantity <= 0 || !stockMovementId || Number.isNaN(previousCost)) {
          throw new AppError(
            `La trazabilidad del producto ${item.product_name || productId} está incompleta`,
            409
          );
        }

        const consumedQuantity = roundMoney(quantity - remaining);
        if (consumedQuantity > 0.0001) {
          throw new AppError(
            `No se puede anular la factura porque el producto ${item.product_name || productId} ya consumió ${consumedQuantity} unidad(es) de este lote`,
            409
          );
        }

        if (remaining > quantity + 0.0001) {
          throw new AppError(
            `El lote del producto ${item.product_name || productId} tiene una cantidad restante inválida`,
            409
          );
        }

        quantityByProduct.set(
          productId,
          toNumber(quantityByProduct.get(productId)) + quantity
        );

        if (!earliestPreviousCostByProduct.has(productId)) {
          earliestPreviousCostByProduct.set(productId, previousCost);
        }

        latestInvoiceCostByProduct.set(productId, toNumber(item.costo_unitario));
        latestItemIdByProduct.set(productId, itemId);
        productById.set(productId, item);
        movementIds.push(stockMovementId);
      }

      const productIds = [...quantityByProduct.keys()].sort((a, b) => a - b);

      if (
        productIds.length !== preliminaryProductIds.length ||
        productIds.some((productId, index) => productId !== preliminaryProductIds[index])
      ) {
        throw new AppError(
          "La composición de productos de la factura cambió durante la validación",
          409
        );
      }

      for (const productId of productIds) {
        const product = productById.get(productId);
        const quantityToRemove = toNumber(quantityByProduct.get(productId));
        const currentStock = toNumber(product?.product_stock);
        const currentCost = toNumber(product?.product_cost);
        const expectedCurrentCost = toNumber(latestInvoiceCostByProduct.get(productId));

        if (currentStock + 0.0001 < quantityToRemove) {
          throw new AppError(
            `No se puede anular la factura porque el stock actual de ${product?.product_name || productId} es insuficiente`,
            409
          );
        }

        if (!amountsMatch(currentCost, expectedCurrentCost)) {
          throw new AppError(
            `No se puede anular la factura porque el costo actual de ${product?.product_name || productId} fue modificado después de la compra`,
            409
          );
        }
      }

      const laterItemsResult = await client.query(
        `SELECT
           pii.id,
           pii.product_id,
           pi.numero_factura
         FROM purchase_invoice_items pii
         JOIN purchase_invoices pi ON pi.id = pii.invoice_id
         WHERE pii.product_id = ANY($1::int[])
           AND pii.invoice_id <> $2
           AND COALESCE(pi.estado, 'Activa') <> 'Anulada'
         ORDER BY pii.id ASC
         FOR UPDATE OF pii`,
        [productIds, purchaseInvoiceId]
      );

      const laterItem = laterItemsResult.rows.find((row: any) => {
        const productId = toNumber(row.product_id);
        return toNumber(row.id) > toNumber(latestItemIdByProduct.get(productId));
      });

      if (laterItem) {
        const product = productById.get(toNumber(laterItem.product_id));
        throw new AppError(
          `No se puede anular la factura porque ${product?.product_name || laterItem.product_id} tiene una compra posterior (${laterItem.numero_factura || laterItem.id}) que reemplazó su costo`,
          409
        );
      }

      const stockMovementsResult = await client.query(
        `SELECT
           id,
           product_id,
           cantidad,
           costo_unitario,
           tipo_movimiento,
           motivo,
           purchase_invoice_id,
           purchase_invoice_item_id
         FROM stock_movimientos
         WHERE id = ANY($1::int[])
         ORDER BY id ASC
         FOR UPDATE`,
        [movementIds]
      );

      if (stockMovementsResult.rows.length !== movementIds.length) {
        throw new AppError(
          "Faltan movimientos originales de stock de la factura",
          409
        );
      }

      const movementById = new Map<number, any>();
      for (const movement of stockMovementsResult.rows) {
        movementById.set(toNumber(movement.id), movement);
      }

      for (const item of itemsResult.rows) {
        const movement = movementById.get(toNumber(item.stock_movement_id));
        if (
          !movement ||
          String(movement.tipo_movimiento) !== "ingreso" ||
          toNumber(movement.purchase_invoice_id) !== purchaseInvoiceId ||
          toNumber(movement.purchase_invoice_item_id) !== toNumber(item.id) ||
          !amountsMatch(Math.abs(toNumber(movement.cantidad)), toNumber(item.cantidad))
        ) {
          throw new AppError(
            `El movimiento de stock del producto ${item.product_name || item.product_id} no coincide con la factura`,
            409
          );
        }
      }

      const previousStockReversal = await client.query(
        `SELECT id
         FROM stock_movimientos
         WHERE reversed_movement_id = ANY($1::int[])
         LIMIT 1`,
        [movementIds]
      );

      if (previousStockReversal.rowCount) {
        throw new AppError("La factura ya posee contramovimientos de stock", 409);
      }

      const paymentAllocationsResult = await client.query(
        `SELECT
           pia.*,
           mf.tipo,
           mf.origen,
           mf.forma_pago,
           mf.monto AS movimiento_monto,
           mf.cheque_id,
           mf.purchase_invoice_id
         FROM purchase_invoice_payment_allocations pia
         JOIN movimientos_financieros mf ON mf.id = pia.movimiento_financiero_id
         WHERE pia.purchase_invoice_id = $1
         ORDER BY pia.id ASC
         FOR UPDATE OF pia, mf`,
        [purchaseInvoiceId]
      );

      const paymentAllocations = paymentAllocationsResult.rows;
      const paidAmount = roundMoney(toNumber(invoice.monto_pagado));
      const allocatedPaidAmount = roundMoney(
        paymentAllocations.reduce(
          (sum: number, allocation: any) => sum + toNumber(allocation.monto),
          0
        )
      );

      if (!amountsMatch(paidAmount, allocatedPaidAmount)) {
        throw new AppError(
          "La trazabilidad financiera de la factura no coincide con el importe pagado",
          409
        );
      }

      const paymentMovementIds: number[] = [];
      const chequeIds = new Set<number>();

      for (const allocation of paymentAllocations) {
        const movementId = toNumber(allocation.movimiento_financiero_id);
        const amount = toNumber(allocation.monto);

        if (
          !movementId ||
          amount <= 0 ||
          String(allocation.tipo) !== "egreso" ||
          toNumber(allocation.purchase_invoice_id) !== purchaseInvoiceId ||
          amount > toNumber(allocation.movimiento_monto) + 0.01
        ) {
          throw new AppError(
            "La trazabilidad de un pago de la factura está incompleta",
            409
          );
        }

        paymentMovementIds.push(movementId);
        if (toNumber(allocation.cheque_id)) {
          chequeIds.add(toNumber(allocation.cheque_id));
        }
      }

      if (paymentMovementIds.length) {
        const previousFinancialReversal = await client.query(
          `SELECT id
           FROM movimientos_financieros
           WHERE reversed_movement_id = ANY($1::int[])
           LIMIT 1`,
          [paymentMovementIds]
        );

        if (previousFinancialReversal.rowCount) {
          throw new AppError("La factura ya posee contramovimientos financieros", 409);
        }
      }

      const chequesResult = await client.query(
        `SELECT *
         FROM cheques
         WHERE purchase_invoice_id = $1
            OR id = ANY($2::int[])
         ORDER BY id ASC
         FOR UPDATE`,
        [purchaseInvoiceId, [...chequeIds]]
      );

      const blockingCheque = chequesResult.rows.find(
        (cheque: any) =>
          !["en_cartera", "anulado"].includes(
            String(cheque.estado || "").toLowerCase()
          )
      );

      if (blockingCheque) {
        throw new AppError(
          `No se puede anular la factura porque el cheque N° ${blockingCheque.numero_cheque || blockingCheque.id} está ${blockingCheque.estado}`,
          409
        );
      }

      const snapshot = {
        invoice,
        items: itemsResult.rows,
        payment_allocations: paymentAllocations,
        cheques: chequesResult.rows,
      };

      const cancellationResult = await client.query(
        `INSERT INTO purchase_invoice_cancellations (
           purchase_invoice_id,
           motivo,
           anulada_por,
           estado_original,
           estado_pago_original,
           total_original,
           monto_pagado_original,
           snapshot
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
         RETURNING id, anulada_at`,
        [
          purchaseInvoiceId,
          normalizedReason,
          normalizedUser,
          invoice.estado || null,
          invoice.estado_pago || null,
          toNumber(invoice.total),
          paidAmount,
          JSON.stringify(snapshot),
        ]
      );

      const cancellationId = toNumber(cancellationResult.rows[0]?.id);
      const cancelledAt = cancellationResult.rows[0]?.anulada_at;

      for (const productId of productIds) {
        await client.query(
          `UPDATE products
           SET stock = COALESCE(stock, 0) - $1,
               cost = $2
           WHERE id = $3`,
          [
            toNumber(quantityByProduct.get(productId)),
            toNumber(earliestPreviousCostByProduct.get(productId)),
            productId,
          ]
        );
      }

      await client.query(
        `UPDATE purchase_invoice_items
         SET cantidad_restante = 0
         WHERE invoice_id = $1`,
        [purchaseInvoiceId]
      );

      const stockReversalMovementIds: number[] = [];

      for (const item of itemsResult.rows) {
        const movementId = toNumber(item.stock_movement_id);
        const reversalResult = await client.query(
          `INSERT INTO stock_movimientos (
             product_id,
             cantidad,
             costo_unitario,
             cantidad_restante,
             descripcion,
             tipo_movimiento,
             motivo,
             usuario,
             purchase_invoice_id,
             purchase_invoice_item_id,
             reversed_movement_id
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING id`,
          [
            toNumber(item.product_id),
            -toNumber(item.cantidad),
            toNumber(item.costo_unitario),
            0,
            `Anulación Factura Compra #${invoiceNumber}: ${normalizedReason}`,
            "egreso",
            "anulacion_compra",
            normalizedUser,
            purchaseInvoiceId,
            toNumber(item.id),
            movementId,
          ]
        );

        stockReversalMovementIds.push(toNumber(reversalResult.rows[0]?.id));
      }

      const financialReversalMovementIds: number[] = [];

      for (const allocation of paymentAllocations) {
        const nextPaymentNumber = await getAndIncrementSetting(
          client,
          "next_payment_number"
        );

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
             purchase_invoice_cancellation_id
           )
           VALUES ($1, $2, $3, $4, $5, $6, now(), $7, $8, $9, $10, $11, $12)
           RETURNING id`,
          [
            "ingreso",
            "anulacion_compra",
            `Contramovimiento por anulación de Factura Compra #${invoiceNumber}: ${normalizedReason}`,
            "Anulación de compras",
            allocation.forma_pago || "Sin especificar",
            toNumber(allocation.monto),
            normalizedUser,
            nextPaymentNumber,
            allocation.cheque_id || null,
            purchaseInvoiceId,
            toNumber(allocation.movimiento_financiero_id),
            cancellationId,
          ]
        );

        financialReversalMovementIds.push(toNumber(reversalResult.rows[0]?.id));
      }

      for (const cheque of chequesResult.rows) {
        if (String(cheque.estado || "").toLowerCase() === "en_cartera") {
          await client.query(
            `UPDATE cheques
             SET estado = 'anulado',
                 observaciones = $1
             WHERE id = $2`,
            [
              appendAuditNote(
                cheque.observaciones,
                `Anulado por Factura Compra #${invoiceNumber}. Motivo: ${normalizedReason}`
              ),
              cheque.id,
            ]
          );
        }
      }

      await client.query(
        `UPDATE purchase_invoices
         SET estado = 'Anulada',
             estado_pago = 'anulada',
             anulada_at = $1,
             anulada_por = $2,
             anulacion_motivo = $3
         WHERE id = $4`,
        [cancelledAt, normalizedUser, normalizedReason, purchaseInvoiceId]
      );

      await client.query("COMMIT");

      return {
        invoice: {
          ...invoice,
          estado: "Anulada",
          estado_pago: "anulada",
          saldo_pendiente: 0,
          anulada_at: cancelledAt,
          anulada_por: normalizedUser,
          anulacion_motivo: normalizedReason,
        },
        cancellation_id: cancellationId,
        stock_reversal_movement_ids: stockReversalMovementIds,
        financial_reversal_movement_ids: financialReversalMovementIds,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      if (!executor && "release" in client && typeof (client as any).release === "function") {
        (client as any).release();
      }
    }
  },
};
