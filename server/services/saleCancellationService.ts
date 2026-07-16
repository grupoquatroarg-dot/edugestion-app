import { getPostgresPool, isPostgresConfigured } from '../utils/postgres.js';
import { AppError } from '../utils/response.js';

type TransactionClient = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

type CancellationInput = {
  saleId: number;
  motivo: string;
  usuario: string;
};

const toNumber = (value: any, fallback: number = 0) => {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const amountsMatch = (left: number, right: number) => Math.abs(roundMoney(left) - roundMoney(right)) <= 0.01;

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

const appendAuditNote = (existing: any, note: string) => {
  const current = String(existing || '').trim();
  return current ? `${current}\n${note}` : note;
};

export const saleCancellationService = {
  async cancelSale({ saleId, motivo, usuario }: CancellationInput) {
    const normalizedReason = String(motivo || '').trim();
    const normalizedUser = String(usuario || 'Sistema').trim() || 'Sistema';

    if (!Number.isInteger(saleId) || saleId <= 0) {
      throw new AppError('ID de venta inválido', 400);
    }

    if (normalizedReason.length < 3) {
      throw new AppError('El motivo de anulación es obligatorio y debe tener al menos 3 caracteres', 400);
    }

    if (normalizedReason.length > 500) {
      throw new AppError('El motivo de anulación no puede superar los 500 caracteres', 400);
    }

    if (!isPostgresConfigured()) {
      throw new AppError('La anulación de ventas requiere PostgreSQL y trazabilidad completa', 409);
    }

    const pool = getPostgresPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const saleResult = await client.query(
        `SELECT s.*
         FROM sales s
         WHERE s.id = $1
         LIMIT 1
         FOR UPDATE`,
        [saleId]
      );

      if (!saleResult.rowCount) {
        throw new AppError('Venta no encontrada', 404);
      }

      const sale = saleResult.rows[0];
      const saleNumber = sale.numero_venta || sale.id;

      if (String(sale.estado || '').toLowerCase() === 'anulada' || sale.anulada_at) {
        throw new AppError(`La venta N° ${saleNumber} ya fue anulada`, 409);
      }

      if (toNumber(sale.reversion_version) !== 1) {
        throw new AppError(
          'Esta venta es anterior a la trazabilidad de anulaciones y no puede revertirse automáticamente',
          409
        );
      }

      const previousCancellationResult = await client.query(
        `SELECT id
         FROM sale_cancellations
         WHERE sale_id = $1
         LIMIT 1`,
        [saleId]
      );

      if (previousCancellationResult.rowCount) {
        throw new AppError(`La venta N° ${saleNumber} ya posee una anulación registrada`, 409);
      }

      const saleItemsResult = await client.query(
        `SELECT si.*, p.name AS product_name
         FROM sale_items si
         JOIN products p ON p.id = si.product_id
         WHERE si.sale_id = $1
         ORDER BY si.id ASC
         FOR UPDATE OF si`,
        [saleId]
      );

      if (!saleItemsResult.rowCount) {
        throw new AppError('La venta no contiene productos y no puede anularse automáticamente', 409);
      }

      const stockAllocationsResult = await client.query(
        `SELECT *
         FROM sale_stock_allocations
         WHERE sale_id = $1
         ORDER BY id ASC
         FOR UPDATE`,
        [saleId]
      );

      const stockAllocations = stockAllocationsResult.rows;
      const saleItemQuantityByProduct = new Map<number, number>();
      const allocationQuantityByProduct = new Map<number, number>();
      const allocationQuantityByMovement = new Map<number, number>();
      const allocationCostByMovement = new Map<number, number>();
      const quantityByPurchaseItem = new Map<number, number>();

      for (const item of saleItemsResult.rows) {
        const productId = toNumber(item.product_id);
        saleItemQuantityByProduct.set(
          productId,
          toNumber(saleItemQuantityByProduct.get(productId)) + toNumber(item.cantidad)
        );
      }

      for (const allocation of stockAllocations) {
        const productId = toNumber(allocation.product_id);
        const quantity = toNumber(allocation.cantidad);
        const movementId = toNumber(allocation.stock_movement_id);
        const purchaseItemId = toNumber(allocation.purchase_invoice_item_id);
        const unitCost = toNumber(allocation.costo_unitario);

        if (!productId || quantity <= 0 || !movementId) {
          throw new AppError('La trazabilidad de stock de esta venta está incompleta', 409);
        }

        allocationQuantityByProduct.set(
          productId,
          toNumber(allocationQuantityByProduct.get(productId)) + quantity
        );
        allocationQuantityByMovement.set(
          movementId,
          toNumber(allocationQuantityByMovement.get(movementId)) + quantity
        );
        allocationCostByMovement.set(
          movementId,
          toNumber(allocationCostByMovement.get(movementId)) + quantity * unitCost
        );

        if (purchaseItemId) {
          quantityByPurchaseItem.set(
            purchaseItemId,
            toNumber(quantityByPurchaseItem.get(purchaseItemId)) + quantity
          );
        }
      }

      for (const [productId, allocatedQuantity] of allocationQuantityByProduct.entries()) {
        const soldQuantity = toNumber(saleItemQuantityByProduct.get(productId));
        if (allocatedQuantity > soldQuantity + 0.0001) {
          throw new AppError('La trazabilidad de stock supera la cantidad vendida', 409);
        }
      }

      const productIds = Array.from(allocationQuantityByProduct.keys()).sort((a, b) => a - b);
      const movementIds = Array.from(allocationQuantityByMovement.keys()).sort((a, b) => a - b);
      const purchaseItemIds = Array.from(quantityByPurchaseItem.keys()).sort((a, b) => a - b);

      const productsResult = productIds.length
        ? await client.query(
            `SELECT id, name, stock
             FROM products
             WHERE id = ANY($1::int[])
             ORDER BY id ASC
             FOR UPDATE`,
            [productIds]
          )
        : { rows: [], rowCount: 0 };

      if (productsResult.rows.length !== productIds.length) {
        throw new AppError('No se pudieron bloquear todos los productos de la venta', 409);
      }

      const originalMovementsResult = movementIds.length
        ? await client.query(
            `SELECT id, product_id, cantidad, costo_unitario, tipo_movimiento, motivo, sale_id
             FROM stock_movimientos
             WHERE id = ANY($1::int[])
             ORDER BY id ASC
             FOR UPDATE`,
            [movementIds]
          )
        : { rows: [], rowCount: 0 };

      if (originalMovementsResult.rows.length !== movementIds.length) {
        throw new AppError('Faltan movimientos originales de stock para esta venta', 409);
      }

      const existingStockReversalsResult = movementIds.length
        ? await client.query(
            `SELECT reversed_movement_id
             FROM stock_movimientos
             WHERE reversed_movement_id = ANY($1::int[])
             LIMIT 1`,
            [movementIds]
          )
        : { rows: [], rowCount: 0 };

      if (existingStockReversalsResult.rowCount) {
        throw new AppError('La venta ya posee contramovimientos de stock', 409);
      }

      const originalMovementMap = new Map<number, any>();
      for (const movement of originalMovementsResult.rows) {
        const movementId = toNumber(movement.id);
        const allocatedQuantity = toNumber(allocationQuantityByMovement.get(movementId));
        const originalQuantity = Math.abs(toNumber(movement.cantidad));

        if (toNumber(movement.sale_id) !== saleId || String(movement.tipo_movimiento) !== 'egreso') {
          throw new AppError('Un movimiento de stock no pertenece correctamente a la venta', 409);
        }

        if (!amountsMatch(originalQuantity, allocatedQuantity)) {
          throw new AppError('La trazabilidad no coincide con el movimiento original de stock', 409);
        }

        originalMovementMap.set(movementId, movement);
      }

      if (purchaseItemIds.length) {
        const purchaseItemsResult = await client.query(
          `SELECT id, cantidad, cantidad_restante
           FROM purchase_invoice_items
           WHERE id = ANY($1::int[])
           ORDER BY id ASC
           FOR UPDATE`,
          [purchaseItemIds]
        );

        if (purchaseItemsResult.rows.length !== purchaseItemIds.length) {
          throw new AppError('Faltan lotes FIFO utilizados por esta venta', 409);
        }

        for (const item of purchaseItemsResult.rows) {
          const restoreQuantity = toNumber(quantityByPurchaseItem.get(toNumber(item.id)));
          const resultingQuantity = toNumber(item.cantidad_restante) + restoreQuantity;
          if (resultingQuantity > toNumber(item.cantidad) + 0.0001) {
            throw new AppError('La restauración FIFO superaría la cantidad original del lote', 409);
          }
        }
      }

      const paymentAllocationsResult = await client.query(
        `SELECT
           spa.id,
           spa.movimiento_financiero_id,
           spa.monto,
           spa.allocation_type,
           mf.tipo,
           mf.origen,
           mf.descripcion,
           mf.categoria,
           mf.forma_pago,
           mf.monto AS movimiento_monto,
           mf.cliente_id,
           mf.venta_id,
           mf.cheque_id,
           mf.numero_pago
         FROM sale_payment_allocations spa
         JOIN movimientos_financieros mf ON mf.id = spa.movimiento_financiero_id
         WHERE spa.sale_id = $1
           AND COALESCE(spa.estado, 'Activo') = 'Activo'
         ORDER BY spa.id ASC
         FOR UPDATE OF spa, mf`,
        [saleId]
      );

      const paymentAllocations = paymentAllocationsResult.rows;
      const tracedPaidAmount = roundMoney(
        paymentAllocations.reduce((sum: number, allocation: any) => sum + toNumber(allocation.monto), 0)
      );
      const salePaidAmount = roundMoney(toNumber(sale.monto_pagado));

      if (!amountsMatch(tracedPaidAmount, salePaidAmount)) {
        throw new AppError('La trazabilidad de pagos no coincide con el monto pagado de la venta', 409);
      }

      const paymentMovementIds = Array.from(
        new Set(paymentAllocations.map((allocation: any) => toNumber(allocation.movimiento_financiero_id)))
      ).filter(Boolean);

      const existingFinancialReversalsResult = paymentMovementIds.length
        ? await client.query(
            `SELECT reversed_movement_id, COALESCE(SUM(monto), 0) AS reversed_amount
             FROM movimientos_financieros
             WHERE reversed_movement_id = ANY($1::int[])
             GROUP BY reversed_movement_id`,
            [paymentMovementIds]
          )
        : { rows: [], rowCount: 0 };

      const reversedAmountByMovement = new Map<number, number>();
      for (const row of existingFinancialReversalsResult.rows) {
        reversedAmountByMovement.set(toNumber(row.reversed_movement_id), toNumber(row.reversed_amount));
      }

      const allocationAmountByMovement = new Map<number, number>();
      const originalFinancialMovementById = new Map<number, any>();
      for (const allocation of paymentAllocations) {
        const movementId = toNumber(allocation.movimiento_financiero_id);
        const amount = toNumber(allocation.monto);

        if (!movementId || amount <= 0 || String(allocation.tipo) !== 'ingreso') {
          throw new AppError('La trazabilidad financiera de esta venta está incompleta', 409);
        }

        allocationAmountByMovement.set(
          movementId,
          toNumber(allocationAmountByMovement.get(movementId)) + amount
        );
        originalFinancialMovementById.set(movementId, allocation);
      }

      for (const [movementId, allocatedAmount] of allocationAmountByMovement.entries()) {
        const originalMovement = originalFinancialMovementById.get(movementId);
        const originalAmount = toNumber(originalMovement?.movimiento_monto);
        const alreadyReversed = toNumber(reversedAmountByMovement.get(movementId));

        if (alreadyReversed + allocatedAmount > originalAmount + 0.01) {
          throw new AppError('El pago original ya posee contramovimientos incompatibles', 409);
        }
      }

      const chequesResult = await client.query(
        `SELECT *
         FROM cheques
         WHERE venta_id = $1
         ORDER BY id ASC
         FOR UPDATE`,
        [saleId]
      );

      const blockingCheque = chequesResult.rows.find(
        (cheque: any) => !['en_cartera', 'anulado'].includes(String(cheque.estado || '').toLowerCase())
      );

      if (blockingCheque) {
        throw new AppError(
          `No se puede anular la venta porque el cheque N° ${blockingCheque.numero_cheque || blockingCheque.id} está ${blockingCheque.estado}`,
          409
        );
      }

      let customerBalance = 0;
      const pendingAmount = roundMoney(toNumber(sale.monto_pendiente));
      if (sale.cliente_id) {
        const customerResult = await client.query(
          `SELECT id, saldo_cta_cte
           FROM clientes
           WHERE id = $1
           LIMIT 1
           FOR UPDATE`,
          [sale.cliente_id]
        );

        if (!customerResult.rowCount) {
          throw new AppError('El cliente de la venta ya no existe', 409);
        }

        customerBalance = toNumber(customerResult.rows[0]?.saldo_cta_cte);
        if (pendingAmount > customerBalance + 0.01) {
          throw new AppError('El saldo pendiente de la venta no coincide con la cuenta corriente del cliente', 409);
        }
      }

      const supplierOrdersResult = await client.query(
        `SELECT id, numero_pedido, cliente, cliente_id, sale_id, customer_order_id, estado, stock_actualizado, notes
         FROM supplier_orders
         WHERE sale_id = $1
         ORDER BY id ASC
         FOR UPDATE`,
        [saleId]
      );

      const customerOrdersResult = await client.query(
        `SELECT id, numero_pedido, estado, cancel_reason, admin_notes,
                cancelled_at, cancelled_by, cancellation_source, cancelled_from_status
         FROM customer_orders
         WHERE sale_id = $1
         ORDER BY id ASC
         FOR UPDATE`,
        [saleId]
      );

      const snapshot = {
        sale,
        items: saleItemsResult.rows,
        stock_allocations: stockAllocations,
        payment_allocations: paymentAllocations,
        cheques: chequesResult.rows,
        supplier_orders: supplierOrdersResult.rows,
        customer_orders: customerOrdersResult.rows,
        customer_balance_before: customerBalance,
      };

      const cancellationResult = await client.query(
        `INSERT INTO sale_cancellations (
           sale_id,
           motivo,
           anulada_por,
           estado_original,
           total_original,
           monto_pagado_original,
           monto_pendiente_original,
           costo_total_original,
           ganancia_original,
           snapshot
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
         RETURNING id, anulada_at`,
        [
          saleId,
          normalizedReason,
          normalizedUser,
          sale.estado || null,
          toNumber(sale.total),
          salePaidAmount,
          pendingAmount,
          toNumber(sale.costo_total),
          toNumber(sale.ganancia),
          JSON.stringify(snapshot),
        ]
      );

      const cancellationId = toNumber(cancellationResult.rows[0]?.id);
      const cancelledAt = cancellationResult.rows[0]?.anulada_at;

      for (const [purchaseItemId, restoreQuantity] of quantityByPurchaseItem.entries()) {
        await client.query(
          `UPDATE purchase_invoice_items
           SET cantidad_restante = cantidad_restante + $1
           WHERE id = $2`,
          [restoreQuantity, purchaseItemId]
        );
      }

      for (const [productId, restoreQuantity] of allocationQuantityByProduct.entries()) {
        await client.query(
          `UPDATE products
           SET stock = COALESCE(stock, 0) + $1
           WHERE id = $2`,
          [restoreQuantity, productId]
        );
      }

      const stockReversalMovementIds: number[] = [];
      for (const [movementId, restoreQuantity] of allocationQuantityByMovement.entries()) {
        const originalMovement = originalMovementMap.get(movementId);
        const totalCost = toNumber(allocationCostByMovement.get(movementId));
        const unitCost = restoreQuantity > 0
          ? totalCost / restoreQuantity
          : toNumber(originalMovement?.costo_unitario);

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
             sale_id,
             reversed_movement_id
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING id`,
          [
            toNumber(originalMovement?.product_id),
            restoreQuantity,
            unitCost,
            restoreQuantity,
            `Anulación Venta N° ${saleNumber}: ${normalizedReason}`,
            'ingreso',
            'anulacion_venta',
            normalizedUser,
            saleId,
            movementId,
          ]
        );

        stockReversalMovementIds.push(toNumber(reversalResult.rows[0]?.id));
      }

      const financialReversalMovementIds: number[] = [];
      for (const allocation of paymentAllocations) {
        const movementId = toNumber(allocation.movimiento_financiero_id);
        const nextPaymentNumber = await getAndIncrementSetting(client, 'next_payment_number');
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
             venta_id,
             reversed_movement_id,
             sale_cancellation_id
           )
           VALUES ($1, $2, $3, $4, $5, $6, now(), $7, $8, $9, $10, $11, $12, $13)
           RETURNING id`,
          [
            'egreso',
            'anulacion_venta',
            `Contramovimiento por anulación de Venta N° ${saleNumber}: ${normalizedReason}`,
            'Anulación de ventas',
            allocation.forma_pago || 'Sin especificar',
            toNumber(allocation.monto),
            normalizedUser,
            nextPaymentNumber,
            allocation.cheque_id || null,
            sale.cliente_id || allocation.cliente_id || null,
            saleId,
            movementId,
            cancellationId,
          ]
        );

        financialReversalMovementIds.push(toNumber(reversalResult.rows[0]?.id));
      }

      if (sale.cliente_id && pendingAmount > 0) {
        await client.query(
          `UPDATE clientes
           SET saldo_cta_cte = COALESCE(saldo_cta_cte, 0) - $1
           WHERE id = $2`,
          [pendingAmount, sale.cliente_id]
        );
      }

      for (const cheque of chequesResult.rows) {
        if (String(cheque.estado || '').toLowerCase() === 'en_cartera') {
          await client.query(
            `UPDATE cheques
             SET estado = 'anulado',
                 observaciones = $1
             WHERE id = $2`,
            [
              appendAuditNote(
                cheque.observaciones,
                `Anulado por Venta N° ${saleNumber}. Motivo: ${normalizedReason}`
              ),
              cheque.id,
            ]
          );
        }
      }

      const cancellationNote = `Cancelado por anulación de Venta N° ${saleNumber}. Motivo: ${normalizedReason}`;
      const cancelledSupplierOrderIds: number[] = [];

      for (const order of supplierOrdersResult.rows) {
        if (['pendiente', 'pedido_realizado', 'auditar_pedido'].includes(String(order.estado))) {
          await client.query(
            `INSERT INTO supplier_order_cancellations (
               supplier_order_id,
               motivo,
               cancelado_por,
               estado_original,
               cancellation_source,
               snapshot
             )
             VALUES ($1, $2, $3, $4, $5, $6::jsonb)
             ON CONFLICT (supplier_order_id) DO NOTHING`,
            [
              order.id,
              cancellationNote,
              normalizedUser,
              String(order.estado),
              'sale_cancellation',
              JSON.stringify({ order }),
            ]
          );

          await client.query(
            `UPDATE supplier_orders
             SET estado = 'cancelado',
                 notes = $1,
                 cancelled_at = now(),
                 cancelled_by = $2,
                 cancel_reason = $3,
                 cancellation_source = 'sale_cancellation',
                 cancelled_from_status = $4
             WHERE id = $5`,
            [
              appendAuditNote(order.notes, cancellationNote),
              normalizedUser,
              cancellationNote,
              String(order.estado),
              order.id,
            ]
          );
          cancelledSupplierOrderIds.push(toNumber(order.id));
        }
      }

      const cancelledCustomerOrderIds: number[] = [];
      for (const order of customerOrdersResult.rows) {
        if (String(order.estado || '').toLowerCase() !== 'cancelado') {
          await client.query(
            `INSERT INTO customer_order_cancellations (
               customer_order_id,
               motivo,
               cancelado_por,
               estado_original,
               cancellation_source,
               snapshot
             )
             VALUES ($1, $2, $3, $4, $5, $6::jsonb)
             ON CONFLICT (customer_order_id) DO NOTHING`,
            [
              order.id,
              cancellationNote,
              normalizedUser,
              String(order.estado || 'entregado'),
              'sale_cancellation',
              JSON.stringify({ order }),
            ]
          );

          await client.query(
            `UPDATE customer_orders
             SET estado = 'cancelado',
                 cancel_reason = $1,
                 cancelled_at = now(),
                 cancelled_by = $2,
                 cancellation_source = 'sale_cancellation',
                 cancelled_from_status = $3,
                 admin_notes = $4
             WHERE id = $5`,
            [
              cancellationNote,
              normalizedUser,
              String(order.estado || 'entregado'),
              appendAuditNote(order.admin_notes, cancellationNote),
              order.id,
            ]
          );
          cancelledCustomerOrderIds.push(toNumber(order.id));
        }
      }

      await client.query(
        `UPDATE sales
         SET estado = 'Anulada',
             monto_pagado = 0,
             monto_pendiente = 0,
             anulada_at = $1,
             anulada_por = $2,
             anulacion_motivo = $3
         WHERE id = $4`,
        [cancelledAt, normalizedUser, normalizedReason, saleId]
      );

      await client.query('COMMIT');

      return {
        success: true,
        saleId,
        saleNumber,
        cancellationId,
        cancelledAt,
        restoredStockUnits: Array.from(allocationQuantityByProduct.values()).reduce(
          (sum, value) => sum + toNumber(value),
          0
        ),
        reversedPayments: tracedPaidAmount,
        removedPendingBalance: pendingAmount,
        stockReversalMovementIds,
        financialReversalMovementIds,
        cancelledSupplierOrderIds,
        cancelledCustomerOrderIds,
        retainedDeliveredSupplierOrders: supplierOrdersResult.rows
          .filter((order: any) => String(order.estado) === 'entregado')
          .map((order: any) => toNumber(order.id)),
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },
};
