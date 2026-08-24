import db from '../db.js';
import { salesRepository, SaleItem, Sale } from '../repositories/salesRepository.js';
import { getPostgresPool, isPostgresConfigured } from '../utils/postgres.js';
import { AppError } from '../utils/response.js';
import { normalizeBusinessDateForStorage } from '../utils/businessDate.js';
import { saleTraceService } from './saleTraceService.js';
import type { SaleStockAllocationInput } from './saleTraceService.js';
import { assertPaymentMethodActive } from './paymentMethodAvailabilityService.js';
import {
  calculateSalePricesWithFreight,
  normalizeSaleFreightPercentage,
} from '../utils/saleFreightPricing.js';
import {
  getProductCostUnitPrice,
  getProductMeasurementUnit,
  getProductPriceReferenceQuantity,
  getProductQuantityMode,
  getProductSaleUnitPrice,
  isMeasuredProduct,
  isValidProductQuantity,
  roundMeasurementQuantity,
} from '../../shared/productMeasurement.js';

type TransactionClient = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

const toNumber = (value: any, fallback: number = 0) => {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const roundMoney = (value: any) => Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;

const isChequePayment = (method: unknown) => String(method || '').toLowerCase().includes('cheque');

const normalizeChequeData = (method: unknown, chequeData: any, expectedAmount: number) => {
  if (!isChequePayment(method)) return null;

  if (!chequeData || typeof chequeData !== 'object') {
    throw new AppError('Completá los datos del cheque', 400);
  }

  const numeroCheque = String(chequeData.numero_cheque || chequeData.numero || '').trim();
  const banco = String(chequeData.banco || '').trim();
  const fechaVencimiento = String(chequeData.fecha_vencimiento || chequeData.vencimiento || '').trim();
  const importe = roundMoney(chequeData.importe ?? expectedAmount);
  const expected = roundMoney(expectedAmount);

  if (!numeroCheque) throw new AppError('El número de cheque es obligatorio', 400);
  if (!banco) throw new AppError('El banco del cheque es obligatorio', 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaVencimiento)) {
    throw new AppError('La fecha de vencimiento del cheque es obligatoria', 400);
  }
  if (importe <= 0 || Math.abs(importe - expected) > 0.01) {
    throw new AppError('El importe del cheque debe coincidir con el monto pagado', 400);
  }

  return { numero_cheque: numeroCheque, banco, fecha_vencimiento: fechaVencimiento, importe };
};

const getAndIncrementSetting = async (client: TransactionClient, key: string, defaultValue: number = 1) => {
  await client.query(
    `INSERT INTO settings (key, value)
     VALUES ($1, $2)
     ON CONFLICT (key) DO NOTHING`,
    [key, String(defaultValue)]
  );

  const currentResult = await client.query(
    `SELECT value FROM settings WHERE key = $1 LIMIT 1`,
    [key]
  );

  const currentValue = parseInt(currentResult.rows[0]?.value || String(defaultValue), 10) || defaultValue;

  await client.query(
    `UPDATE settings SET value = $2 WHERE key = $1`,
    [key, String(currentValue + 1)]
  );

  return currentValue;
};

export const salesService = {
  async createSale(saleData: any, executor?: TransactionClient) {
    const { items, cliente_id, nombre_cliente, metodo_pago, monto_pagado, notes, cheque_data, usuario, actor_role, flete_porcentaje, route_item_id, allow_shortage = true, use_supplied_prices = false } = saleData;
    const routeItemId = Number(route_item_id || 0);
    const freightPercentage = normalizeSaleFreightPercentage(flete_porcentaje, actor_role);

    const rawItems = Array.isArray(items) ? items : [];
    let normalizedItems: any[] = [];
    let totalVenta = 0;

    const normalizeSaleItem = (item: any, product: any) => {
      const cantidad = roundMeasurementQuantity(item.cantidad);
      if (!isValidProductQuantity(product, cantidad)) {
        throw new AppError(
          isMeasuredProduct(product)
            ? 'La cantidad medida debe ser mayor a cero'
            : 'Los productos por unidad solo admiten cantidades enteras mayores a cero',
          400
        );
      }

      const trustSuppliedPrice = Boolean(executor && use_supplied_prices);
      const precioOriginal = trustSuppliedPrice
        ? Math.max(0, toNumber(item.precio_unitario_original ?? item.precio_venta))
        : getProductSaleUnitPrice(product);
      const bonificacionTipo = String(item.bonificacion_tipo || 'none');
      const bonificacionValor = toNumber(item.bonificacion_valor);

      const clientPrices = calculateSalePricesWithFreight({
        originalPrice: precioOriginal,
        discountType: bonificacionTipo,
        discountValue: bonificacionValor,
        freightPercentage,
        precision: isMeasuredProduct(product) ? 6 : 2,
      });

      return {
        product_id: Number(item.product_id),
        cantidad,
        precio_unitario_original: clientPrices.originalPrice,
        bonificacion_tipo: bonificacionTipo,
        bonificacion_valor: clientPrices.discountValue,
        precio_unitario_bonificado: clientPrices.discountedPrice,
        precio_venta: clientPrices.discountedPrice,
        quantity_mode: getProductQuantityMode(product),
        measurement_unit: getProductMeasurementUnit(product),
        price_reference_quantity: getProductPriceReferenceQuantity(product),
      };
    };

    if (!isPostgresConfigured()) {
      await assertPaymentMethodActive(metodo_pago);
      // Flujo local de respaldo: conserva el comportamiento anterior para desarrollo local.
      return db.transaction(() => {
        const productMap = new Map<number, any>();
        for (const item of rawItems) {
          const productId = Number(item.product_id);
          if (!productMap.has(productId)) {
            const product = db.prepare(`
              SELECT id, name, stock, cost, sale_price, quantity_mode, measurement_unit, price_reference_quantity
              FROM products
              WHERE id = ? AND eliminado = 0
              LIMIT 1
            `).get(productId) as any;
            if (!product) throw new AppError(`Producto inválido: ${productId}`, 400);
            productMap.set(productId, product);
          }
        }
        normalizedItems = rawItems.map((item: any) => normalizeSaleItem(item, productMap.get(Number(item.product_id))));
        totalVenta = roundMoney(normalizedItems.reduce((sum: number, item: any) => sum + item.cantidad * item.precio_venta, 0));

        let routeItem: any = null;
        if (routeItemId > 0) {
          routeItem = db.prepare(`
            SELECT ri.id, ri.route_id, ri.client_id, r.status AS route_status
            FROM route_items ri
            JOIN routes r ON r.id = ri.route_id
            WHERE ri.id = ?
            LIMIT 1
          `).get(routeItemId) as any;
          if (!routeItem) throw new AppError('El ítem de ruta no existe', 409);
          const routeStatus = String(routeItem.route_status || 'planificada').toLowerCase();
          if (['cancelada', 'finalizada'].includes(routeStatus)) {
            throw new AppError(`La ruta está ${routeStatus} y no admite nuevas ventas`, 409);
          }
          if (cliente_id && Number(routeItem.client_id) !== Number(cliente_id)) {
            throw new AppError('El ítem de ruta no pertenece al cliente de la venta', 409);
          }
        }

        if (cliente_id && Number(cliente_id) !== 1) {
          const customer = db.prepare('SELECT id, activo FROM clientes WHERE id = ? LIMIT 1').get(Number(cliente_id)) as any;
          if (!customer) throw new AppError('Cliente no encontrado', 404);
          if (Number(customer.activo ?? 1) === 0) {
            throw new AppError('El cliente está inactivo. Reactivalo antes de registrar una venta.', 409);
          }
        }

        const nextSaleNum = parseInt(db.prepare("SELECT value FROM settings WHERE key = 'next_sale_number'").get()?.value || '1', 10);
        db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('next_sale_number', '1')").run();
        db.prepare("UPDATE settings SET value = ? WHERE key = 'next_sale_number'").run(String(nextSaleNum + 1));

        const realPayment = toNumber(monto_pagado);
        const montoPendiente = Math.max(0, totalVenta - realPayment);

        const saleDataToInsert: Sale = {
          numero_venta: String(nextSaleNum),
          total: totalVenta,
          costo_total: 0,
          ganancia: totalVenta,
          cliente_id,
          nombre_cliente,
          metodo_pago,
          monto_pagado: realPayment,
          monto_pendiente: montoPendiente,
          notes,
          usuario,
          estado: montoPendiente > 0 ? 'Pendiente' : 'Pagada',
        };

        const processedItems: SaleItem[] = normalizedItems.map((item: any) => ({
          product_id: item.product_id,
          cantidad: item.cantidad,
          precio_venta: item.precio_venta,
          costo_total_peps: 0,
          precio_unitario_original: item.precio_unitario_original,
          bonificacion_tipo: item.bonificacion_tipo,
          bonificacion_valor: item.bonificacion_valor,
          precio_unitario_bonificado: item.precio_unitario_bonificado,
          quantity_mode: item.quantity_mode,
          measurement_unit: item.measurement_unit,
          price_reference_quantity: item.price_reference_quantity,
        }));

        const saleId = salesRepository.create(saleDataToInsert, processedItems) as unknown as number;

        if (routeItemId > 0 && routeItem) {
          const auditNote = `Venta N° ${nextSaleNum} registrada desde la ruta`;
          db.prepare(`
            UPDATE route_items
            SET status = 'venta realizada',
                visitado = 1,
                venta_registrada = 1,
                visited_at = COALESCE(visited_at, CURRENT_TIMESTAMP),
                notes = CASE
                  WHEN TRIM(COALESCE(notes, '')) = '' THEN ?
                  ELSE notes || CHAR(10) || ?
                END
            WHERE id = ?
          `).run(auditNote, auditNote, routeItemId);
          db.prepare(`
            UPDATE routes SET status = 'en curso'
            WHERE id = ? AND status IN ('planificada', 'pendiente')
          `).run(Number(routeItem.route_id));
        }

        return { success: true, saleId, saleNumber: nextSaleNum, route_item_id: routeItemId || null };
      })();
    }

    const ownsTransaction = !executor;
    const pool = executor ? null : getPostgresPool();
    const client = executor || (await pool!.connect());

    try {
      if (ownsTransaction) await client.query('BEGIN');
      await assertPaymentMethodActive(metodo_pago, client);

      let routeItem: any = null;
      if (routeItemId > 0) {
        const routeItemResult = await client.query(
          `SELECT ri.id, ri.route_id, ri.client_id, r.status AS route_status
           FROM route_items ri
           JOIN routes r ON r.id = ri.route_id
           WHERE ri.id = $1
           LIMIT 1
           FOR UPDATE OF r, ri`,
          [routeItemId]
        );
        if (!routeItemResult.rowCount) throw new AppError('El ítem de ruta no existe', 409);
        routeItem = routeItemResult.rows[0];
        const routeStatus = String(routeItem.route_status || 'planificada').toLowerCase();
        if (['cancelada', 'finalizada'].includes(routeStatus)) {
          throw new AppError(`La ruta está ${routeStatus} y no admite nuevas ventas`, 409);
        }
        if (cliente_id && toNumber(routeItem.client_id) !== toNumber(cliente_id)) {
          throw new AppError('El ítem de ruta no pertenece al cliente de la venta', 409);
        }
      }

      if (cliente_id && Number(cliente_id) !== 1) {
        const customerResult = await client.query(
          `SELECT id, nombre_apellido, activo
           FROM clientes
           WHERE id = $1
           LIMIT 1
           FOR UPDATE`,
          [Number(cliente_id)]
        );

        if (!customerResult.rowCount) {
          throw new AppError('Cliente no encontrado', 404);
        }
        if (Number(customerResult.rows[0]?.activo ?? 1) === 0) {
          throw new AppError('El cliente está inactivo. Reactivalo antes de registrar una venta.', 409);
        }
      }

      const productIds: number[] = Array.from(
        new Set<number>(rawItems.map((item: any) => Number(item.product_id)))
      )
        .sort((a, b) => a - b);
      const productResult = await client.query(
        `SELECT id, name, stock, cost, sale_price, quantity_mode, measurement_unit, price_reference_quantity
         FROM products
         WHERE id = ANY($1::int[])
         ORDER BY id ASC
         FOR UPDATE`,
        [productIds]
      );

      const productMap = new Map<number, any>();
      const availableStockByProduct = new Map<number, number>();

      for (const row of productResult.rows) {
        const productId = toNumber(row.id);
        productMap.set(productId, row);
        availableStockByProduct.set(productId, Math.max(0, toNumber(row.stock)));
      }

      normalizedItems = rawItems.map((item: any) => {
        const productId = Number(item.product_id);
        const product = productMap.get(productId);
        if (!product) throw new AppError(`Producto inválido: ${productId}`, 400);
        return normalizeSaleItem(item, product);
      });
      totalVenta = roundMoney(normalizedItems.reduce((sum: number, item: any) => sum + item.cantidad * item.precio_venta, 0));

      let totalSaleCost = 0;
      const processedItems: SaleItem[] = [];
      const stockConsumptionLines: Array<{
        product_id: number;
        cantidad: number;
        costo_total: number;
        allocations: Omit<SaleStockAllocationInput, 'stock_movement_id'>[];
      }> = [];
      const supplierShortageMap = new Map<number, { product_id: number; cantidad: number; name: string; requested: number; available: number }>();

      for (const item of normalizedItems) {
        const productId = Number(item.product_id);
        const cantidad = toNumber(item.cantidad);
        const precioVenta = toNumber(item.precio_venta);
        const product = productMap.get(productId);

        if (!product) {
          throw new AppError(`Producto inválido: ${productId}`, 400);
        }

        const availableBeforeLine = Math.max(0, toNumber(availableStockByProduct.get(productId)));
        const stockToConsume = Math.min(cantidad, availableBeforeLine);
        const shortage = Math.max(0, cantidad - stockToConsume);

        availableStockByProduct.set(productId, Math.max(0, availableBeforeLine - stockToConsume));

        if (shortage > 0) {
          const existing = supplierShortageMap.get(productId);
          supplierShortageMap.set(productId, {
            product_id: productId,
            cantidad: (existing?.cantidad || 0) + shortage,
            name: product?.name || 'Producto desconocido',
            requested: (existing?.requested || 0) + cantidad,
            available: (existing?.available || 0) + stockToConsume,
          });
        }

        let itemCost = 0;
        let remainingToConsume = stockToConsume;
        const lineAllocations: Omit<SaleStockAllocationInput, 'stock_movement_id'>[] = [];

        if (remainingToConsume > 0) {
          const fifoResult = await client.query(
            `SELECT id, cantidad_restante, costo_unitario
             FROM purchase_invoice_items
             WHERE product_id = $1 AND cantidad_restante > 0
             ORDER BY id ASC
             FOR UPDATE`,
            [productId]
          );

          for (const move of fifoResult.rows) {
            if (remainingToConsume <= 0) break;

            const availableInMove = toNumber(move.cantidad_restante);
            const consume = Math.min(remainingToConsume, availableInMove);
            const unitCost = toNumber(move.costo_unitario);
            itemCost += consume * unitCost;

            lineAllocations.push({
              product_id: productId,
              purchase_invoice_item_id: toNumber(move.id),
              source_type: 'purchase_invoice_item',
              cantidad: consume,
              costo_unitario: unitCost,
            });

            await client.query(
              `UPDATE purchase_invoice_items
               SET cantidad_restante = cantidad_restante - $1
               WHERE id = $2`,
              [consume, move.id]
            );

            remainingToConsume -= consume;
          }

          if (remainingToConsume > 0) {
            const fallbackUnitCost = getProductCostUnitPrice(product);
            itemCost += remainingToConsume * fallbackUnitCost;
            lineAllocations.push({
              product_id: productId,
              purchase_invoice_item_id: null,
              source_type: 'product_cost',
              cantidad: remainingToConsume,
              costo_unitario: fallbackUnitCost,
            });
          }

          await client.query(
            `UPDATE products
             SET stock = GREATEST(0, COALESCE(stock, 0) - $1)
             WHERE id = $2`,
            [stockToConsume, productId]
          );

          stockConsumptionLines.push({
            product_id: productId,
            cantidad: stockToConsume,
            costo_total: itemCost,
            allocations: lineAllocations,
          });
        }

        totalSaleCost += itemCost;
        processedItems.push({
          product_id: productId,
          cantidad,
          precio_venta: precioVenta,
          costo_total_peps: itemCost,
          precio_unitario_original: item.precio_unitario_original,
          bonificacion_tipo: item.bonificacion_tipo,
          bonificacion_valor: item.bonificacion_valor,
          precio_unitario_bonificado: item.precio_unitario_bonificado,
          quantity_mode: item.quantity_mode,
          measurement_unit: item.measurement_unit,
          price_reference_quantity: item.price_reference_quantity,
        });
      }

      const nextSaleNum = await getAndIncrementSetting(client, 'next_sale_number');
      const realPayment = toNumber(monto_pagado);
      const normalizedCheque = normalizeChequeData(metodo_pago, cheque_data, realPayment);
      const montoPendiente = Math.max(0, totalVenta - realPayment);

      const saleDataToInsert: Sale = {
        numero_venta: String(nextSaleNum),
        total: totalVenta,
        costo_total: totalSaleCost,
        ganancia: totalVenta - totalSaleCost,
        cliente_id,
        nombre_cliente,
        metodo_pago,
        monto_pagado: realPayment,
        monto_pendiente: montoPendiente,
        notes,
        usuario,
        estado: montoPendiente > 0 ? 'Pendiente' : 'Pagada',
        reversion_version: 1,
      };

      const saleId = await salesRepository.create(saleDataToInsert, processedItems, client);

      for (const consumption of stockConsumptionLines) {
        const stockMovementResult = await client.query(
          `INSERT INTO stock_movimientos (
             product_id,
             cantidad,
             costo_unitario,
             cantidad_restante,
             descripcion,
             tipo_movimiento,
             motivo,
             usuario,
             sale_id
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id`,
          [
            consumption.product_id,
            -consumption.cantidad,
            consumption.cantidad > 0 ? consumption.costo_total / consumption.cantidad : 0,
            0,
            `Venta con stock disponible`,
            'egreso',
            'venta',
            usuario || 'Sistema',
            saleId,
          ]
        );

        const stockMovementId = toNumber(stockMovementResult.rows[0]?.id);
        await saleTraceService.recordStockAllocations(
          client,
          saleId,
          consumption.allocations.map((allocation) => ({
            ...allocation,
            stock_movement_id: stockMovementId,
          }))
        );
      }

      let supplierOrderId: number | null = null;
      let supplierOrderNumber: number | null = null;
      const shortageItems = Array.from(supplierShortageMap.values()).filter((item) => item.cantidad > 0);

      if (!allow_shortage && shortageItems.length > 0) {
        throw new AppError(
          'No se puede completar la venta porque hay productos sin stock',
          409,
          shortageItems.map((item) => ({
            product_id: item.product_id,
            product_name: item.name,
            cantidad: item.cantidad,
            solicitado: item.requested,
            stock_actual: item.available,
          }))
        );
      }

      if (shortageItems.length > 0) {
        supplierOrderNumber = await getAndIncrementSetting(client, 'next_order_number');
        const orderResult = await client.query(
          `INSERT INTO supplier_orders (numero_pedido, cliente, cliente_id, sale_id, estado, notes)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`,
          [
            supplierOrderNumber,
            nombre_cliente || 'Consumidor Final',
            cliente_id || null,
            saleId,
            'pendiente',
            notes || `Faltante generado por Venta N° ${nextSaleNum}`,
          ]
        );

        supplierOrderId = toNumber(orderResult.rows[0]?.id);

        for (const shortageItem of shortageItems) {
          await client.query(
            `INSERT INTO supplier_order_items (order_id, product_id, cantidad)
             VALUES ($1, $2, $3)`,
            [supplierOrderId, shortageItem.product_id, shortageItem.cantidad]
          );
        }
      }

      let paymentMovementId: number | null = null;
      if (realPayment > 0) {
        const nextPaymentNum = await getAndIncrementSetting(client, 'next_payment_number');
        const movementResult = await client.query(
          `INSERT INTO movimientos_financieros (tipo, origen, descripcion, categoria, forma_pago, monto, cliente_id, venta_id, usuario, numero_pago)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING id`,
          ['ingreso', 'venta', `Venta N° ${nextSaleNum}`, 'Ventas', metodo_pago, realPayment, cliente_id || null, saleId, usuario || 'Sistema', nextPaymentNum]
        );

        paymentMovementId = toNumber(movementResult.rows[0]?.id);
        await saleTraceService.recordPaymentAllocations(
          client,
          paymentMovementId,
          [{ sale_id: saleId, monto: realPayment, allocation_type: 'initial_payment' }]
        );
      }

      if (cliente_id && montoPendiente > 0) {
        await client.query(
          `UPDATE clientes
           SET saldo_cta_cte = COALESCE(saldo_cta_cte, 0) + $1
           WHERE id = $2`,
          [montoPendiente, cliente_id]
        );
      }

      if (normalizedCheque) {
        if (!paymentMovementId) {
          throw new AppError('El cheque no posee un movimiento de pago trazable', 409);
        }

        const chequeResult = await client.query(
          `INSERT INTO cheques (
             numero_cheque, banco, importe, fecha_vencimiento, cliente_id, venta_id,
             estado, financial_movement_id
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id`,
          [
            normalizedCheque.numero_cheque,
            normalizedCheque.banco,
            normalizedCheque.importe,
            normalizedCheque.fecha_vencimiento,
            cliente_id || null,
            saleId,
            'en_cartera',
            paymentMovementId,
          ]
        );

        await client.query(
          `UPDATE movimientos_financieros
           SET cheque_id = $1
           WHERE id = $2`,
          [toNumber(chequeResult.rows[0]?.id), paymentMovementId]
        );
      }

      if (routeItemId > 0 && routeItem) {
        const auditNote = `Venta N° ${nextSaleNum} registrada desde la ruta`;
        await client.query(
          `UPDATE route_items
           SET status = 'venta realizada',
               visitado = 1,
               venta_registrada = 1,
               visited_at = COALESCE(visited_at, now()),
               notes = CASE
                 WHEN BTRIM(COALESCE(notes, '')) = '' THEN $1
                 ELSE notes || E'\n' || $1
               END
           WHERE id = $2`,
          [auditNote, routeItemId]
        );
        await client.query(
          `UPDATE routes
           SET status = 'en curso'
           WHERE id = $1 AND status IN ('planificada', 'pendiente')`,
          [toNumber(routeItem.route_id)]
        );
      }

      if (ownsTransaction) await client.query('COMMIT');
      return {
        success: true,
        saleId,
        saleNumber: nextSaleNum,
        supplierOrderGenerated: shortageItems.length > 0,
        orderId: supplierOrderId,
        orderNumber: supplierOrderNumber,
        shortageItems,
        route_item_id: routeItemId || null,
      };
    } catch (error) {
      if (ownsTransaction) await client.query('ROLLBACK');
      throw error;
    } finally {
      if (ownsTransaction && 'release' in client && typeof (client as any).release === 'function') {
        (client as any).release();
      }
    }
  },

  async registerClientPayment(paymentData: any) {
    const { cliente_id, monto, metodo_pago, fecha, observaciones, usuario, route_item_id, cheque_data } = paymentData;
    const clientId = Number(cliente_id);
    const routeItemId = Number(route_item_id || 0);
    const paymentAmount = toNumber(monto);
    const normalizedCheque = normalizeChequeData(metodo_pago, cheque_data, paymentAmount);
    const observationText = String(observaciones || '').trim();
    const routePaymentNote = `Pago registrado: $${paymentAmount.toFixed(2)}${observationText ? ` - ${observationText}` : ''}`;

    if (!clientId) {
      throw new AppError('Cliente inválido', 400);
    }

    if (paymentAmount <= 0) {
      throw new AppError('El monto debe ser mayor a cero', 400);
    }

    if (!isPostgresConfigured()) {
      await assertPaymentMethodActive(metodo_pago);
      return db.transaction(() => {
        const customer = db.prepare('SELECT id, nombre_apellido, saldo_cta_cte FROM clientes WHERE id = ?').get(clientId) as any;
        if (!customer) {
          throw new AppError('Cliente no encontrado', 404);
        }

        let routeItem: any = null;
        if (routeItemId > 0) {
          routeItem = db.prepare(`
            SELECT ri.id, ri.route_id, ri.client_id, ri.cobranza_realizada, r.status AS route_status
            FROM route_items ri
            JOIN routes r ON r.id = ri.route_id
            WHERE ri.id = ?
            LIMIT 1
          `).get(routeItemId) as any;
          if (!routeItem) throw new AppError('El ítem de ruta no existe', 409);
          const routeStatus = String(routeItem.route_status || 'planificada').toLowerCase();
          if (['cancelada', 'finalizada'].includes(routeStatus)) {
            throw new AppError(`La ruta está ${routeStatus} y no admite nuevas cobranzas`, 409);
          }
          if (Number(routeItem.client_id) !== clientId) {
            throw new AppError('El ítem de ruta no pertenece al cliente de la cobranza', 409);
          }
          if (Number(routeItem.cobranza_realizada || 0) !== 0) {
            throw new AppError('El ítem de ruta ya tiene una cobranza activa', 409);
          }
        }

        const saldoActual = toNumber(customer.saldo_cta_cte);
        if (saldoActual <= 0) {
          throw new AppError('El cliente no tiene saldo pendiente', 400);
        }

        if (paymentAmount > saldoActual) {
          throw new AppError('El monto supera el saldo pendiente del cliente', 400);
        }

        const pendingSales = db.prepare(
          `SELECT id, numero_venta, monto_pagado, monto_pendiente FROM sales WHERE cliente_id = ? AND monto_pendiente > 0 AND COALESCE(estado, '') <> 'Anulada' ORDER BY fecha ASC, id ASC`
        ).all(clientId) as any[];

        if (pendingSales.length === 0) {
          throw new AppError('No hay ventas pendientes para este cliente', 400);
        }

        let remaining = paymentAmount;
        const allocations: Array<{ id: number; numero_venta: string | number; amount: number }> = [];

        for (const sale of pendingSales) {
          if (remaining <= 0) break;
          const pendiente = toNumber(sale.monto_pendiente);
          const applied = Math.min(remaining, pendiente);
          const newMontoPagado = toNumber(sale.monto_pagado) + applied;
          const newMontoPendiente = pendiente - applied;

          db.prepare(
            'UPDATE sales SET monto_pagado = ?, monto_pendiente = ?, estado = ? WHERE id = ?'
          ).run(newMontoPagado, newMontoPendiente, newMontoPendiente <= 0 ? 'Pagada' : 'Pendiente', sale.id);

          allocations.push({
            id: Number(sale.id),
            numero_venta: sale.numero_venta || sale.id,
            amount: applied,
          });
          remaining -= applied;
        }

        db.prepare('UPDATE clientes SET saldo_cta_cte = saldo_cta_cte - ? WHERE id = ?').run(paymentAmount, clientId);

        const nextPaymentNum = parseInt(db.prepare("SELECT value FROM settings WHERE key = 'next_payment_number'").get()?.value || '1', 10);
        db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('next_payment_number', '1')").run();
        db.prepare("UPDATE settings SET value = ? WHERE key = 'next_payment_number'").run(String(nextPaymentNum + 1));

        const saleReferences = allocations.map((allocation) => `#${allocation.numero_venta}`).join(', ');
        const linkedSaleId = allocations.length === 1 ? allocations[0].id : null;
        const descriptionParts = [
          `Cobranza cliente ${customer.nombre_apellido}`,
          saleReferences ? `Aplicado a venta${allocations.length === 1 ? '' : 's'} ${saleReferences}` : '',
          observationText,
        ].filter(Boolean);

        const movementInfo = db.prepare(
          `INSERT INTO movimientos_financieros (tipo, origen, descripcion, categoria, forma_pago, monto, fecha, usuario, numero_pago, cliente_id, venta_id, route_item_id, estado, reversion_version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run('ingreso', 'cobranza', descriptionParts.join(' - '), 'Cobranzas', metodo_pago, paymentAmount, normalizeBusinessDateForStorage(fecha), usuario || 'Sistema', nextPaymentNum, clientId, linkedSaleId, routeItemId || null, 'Activo', 0);

        if (normalizedCheque) {
          const chequeInfo = db.prepare(
            `INSERT INTO cheques (
               numero_cheque, banco, importe, fecha_vencimiento, cliente_id, venta_id,
               estado, financial_movement_id
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            normalizedCheque.numero_cheque,
            normalizedCheque.banco,
            normalizedCheque.importe,
            normalizedCheque.fecha_vencimiento,
            clientId,
            linkedSaleId,
            'en_cartera',
            Number(movementInfo.lastInsertRowid)
          );
          db.prepare('UPDATE movimientos_financieros SET cheque_id = ? WHERE id = ?')
            .run(Number(chequeInfo.lastInsertRowid), Number(movementInfo.lastInsertRowid));
        }

        if (routeItemId > 0) {
          db.prepare(
            `UPDATE route_items
             SET cobranza_realizada = 1,
                 visitado = 1,
                 status = 'visitado',
                 visited_at = CURRENT_TIMESTAMP,
                 notes = CASE
                   WHEN TRIM(COALESCE(notes, '')) = '' THEN ?
                   ELSE notes || CHAR(10) || ?
                 END
             WHERE id = ?`
          ).run(routePaymentNote, routePaymentNote, routeItemId);
          db.prepare(
            `UPDATE routes
             SET status = 'en curso'
             WHERE id = ? AND status IN ('planificada', 'pendiente')`
          ).run(routeItem.route_id);
        }

        const updatedCustomer = db.prepare('SELECT * FROM clientes WHERE id = ?').get(clientId);
        return {
          success: true,
          cliente_id: clientId,
          saldo_actual: toNumber(updatedCustomer?.saldo_cta_cte),
          monto_aplicado: paymentAmount,
          movement_id: Number(movementInfo.lastInsertRowid),
          route_item_id: routeItemId || null,
        };
      })();
    }

    const pool = getPostgresPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await assertPaymentMethodActive(metodo_pago, client);

      const customerResult = await client.query(
        `SELECT id, nombre_apellido, saldo_cta_cte
         FROM clientes
         WHERE id = $1
         LIMIT 1
         FOR UPDATE`,
        [clientId]
      );

      if (!customerResult.rowCount) {
        throw new AppError('Cliente no encontrado', 404);
      }

      const customer = customerResult.rows[0];

      let routeItem: any = null;
      if (routeItemId > 0) {
        const routeItemResult = await client.query(
          `SELECT ri.id, ri.client_id, ri.cobranza_realizada, ri.status, ri.route_id,
                  r.status AS route_status
           FROM route_items ri
           JOIN routes r ON r.id = ri.route_id
           WHERE ri.id = $1
           LIMIT 1
           FOR UPDATE OF r, ri`,
          [routeItemId]
        );

        if (!routeItemResult.rowCount) {
          throw new AppError('El ítem de ruta no existe', 409);
        }

        routeItem = routeItemResult.rows[0];
        const routeStatus = String(routeItem.route_status || 'planificada').toLowerCase();
        if (['cancelada', 'finalizada'].includes(routeStatus)) {
          throw new AppError(`La ruta está ${routeStatus} y no admite nuevas cobranzas`, 409);
        }
        if (toNumber(routeItem.client_id) !== clientId) {
          throw new AppError('El ítem de ruta no pertenece al cliente de la cobranza', 409);
        }
        if (toNumber(routeItem.cobranza_realizada) !== 0) {
          throw new AppError('El ítem de ruta ya tiene una cobranza activa', 409);
        }
      }

      const saldoActual = toNumber(customer.saldo_cta_cte);

      if (saldoActual <= 0) {
        throw new AppError('El cliente no tiene saldo pendiente', 400);
      }

      if (paymentAmount > saldoActual) {
        throw new AppError('El monto supera el saldo pendiente del cliente', 400);
      }

      const pendingSalesResult = await client.query(
        `SELECT id, numero_venta, monto_pagado, monto_pendiente
         FROM sales
         WHERE cliente_id = $1 AND monto_pendiente > 0
           AND COALESCE(estado, '') <> 'Anulada'
         ORDER BY fecha ASC, id ASC
         FOR UPDATE`,
        [clientId]
      );

      if (!pendingSalesResult.rowCount) {
        throw new AppError('No hay ventas pendientes para este cliente', 400);
      }

      let remaining = paymentAmount;
      const allocations: Array<{ id: number; numero_venta: string | number; amount: number }> = [];

      for (const sale of pendingSalesResult.rows) {
        if (remaining <= 0) break;

        const pendiente = toNumber(sale.monto_pendiente);
        const applied = Math.min(remaining, pendiente);
        const newMontoPagado = toNumber(sale.monto_pagado) + applied;
        const newMontoPendiente = pendiente - applied;

        await client.query(
          `UPDATE sales
           SET monto_pagado = $1,
               monto_pendiente = $2,
               estado = $3
           WHERE id = $4`,
          [newMontoPagado, newMontoPendiente, newMontoPendiente <= 0 ? 'Pagada' : 'Pendiente', sale.id]
        );

        allocations.push({
          id: Number(sale.id),
          numero_venta: sale.numero_venta || sale.id,
          amount: applied,
        });
        remaining -= applied;
      }

      await client.query(
        `UPDATE clientes
         SET saldo_cta_cte = COALESCE(saldo_cta_cte, 0) - $1
         WHERE id = $2`,
        [paymentAmount, clientId]
      );

      const nextPaymentNum = await getAndIncrementSetting(client, 'next_payment_number');
      const saleReferences = allocations.map((allocation) => `#${allocation.numero_venta}`).join(', ');
      const linkedSaleId = allocations.length === 1 ? allocations[0].id : null;
      const descriptionParts = [
        `Cobranza cliente ${customer.nombre_apellido}`,
        saleReferences ? `Aplicado a venta${allocations.length === 1 ? '' : 's'} ${saleReferences}` : '',
        String(observaciones || '').trim(),
      ].filter(Boolean);

      const movementResult = await client.query(
        `INSERT INTO movimientos_financieros (tipo, origen, descripcion, categoria, forma_pago, monto, fecha, usuario, numero_pago, cliente_id, venta_id, route_item_id, estado, reversion_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING id`,
        [
          'ingreso',
          'cobranza',
          descriptionParts.join(' - '),
          'Cobranzas',
          metodo_pago,
          paymentAmount,
          normalizeBusinessDateForStorage(fecha),
          usuario || 'Sistema',
          nextPaymentNum,
          clientId,
          linkedSaleId,
          routeItemId || null,
          'Activo',
          1,
        ]
      );

      const movementId = toNumber(movementResult.rows[0]?.id);
      await saleTraceService.recordPaymentAllocations(
        client,
        movementId,
        allocations.map((allocation) => ({
          sale_id: allocation.id,
          monto: allocation.amount,
          allocation_type: 'client_payment' as const,
        }))
      );

      if (normalizedCheque) {
        const chequeResult = await client.query(
          `INSERT INTO cheques (
             numero_cheque, banco, importe, fecha_vencimiento, cliente_id, venta_id,
             estado, financial_movement_id
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id`,
          [
            normalizedCheque.numero_cheque,
            normalizedCheque.banco,
            normalizedCheque.importe,
            normalizedCheque.fecha_vencimiento,
            clientId,
            linkedSaleId,
            'en_cartera',
            movementId,
          ]
        );
        await client.query(
          `UPDATE movimientos_financieros SET cheque_id = $1 WHERE id = $2`,
          [toNumber(chequeResult.rows[0]?.id), movementId]
        );
      }

      if (routeItemId > 0) {
        await client.query(
          `UPDATE route_items
           SET cobranza_realizada = 1,
               visitado = 1,
               status = 'visitado',
               visited_at = now(),
               notes = CASE
                 WHEN btrim(COALESCE(notes, '')) = '' THEN $2
                 ELSE notes || E'\n' || $2
               END
           WHERE id = $1`,
          [routeItemId, routePaymentNote]
        );
        await client.query(
          `UPDATE routes
           SET status = 'en curso'
           WHERE id = $1
             AND status IN ('planificada', 'pendiente')`,
          [toNumber(routeItem.route_id)]
        );
      }

      const updatedCustomerResult = await client.query(
        'SELECT saldo_cta_cte FROM clientes WHERE id = $1 LIMIT 1',
        [clientId]
      );

      await client.query('COMMIT');

      return {
        success: true,
        cliente_id: clientId,
        saldo_actual: toNumber(updatedCustomerResult.rows[0]?.saldo_cta_cte),
        monto_aplicado: paymentAmount,
        movement_id: toNumber(movementResult.rows[0]?.id),
        route_item_id: routeItemId || null,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },
};
