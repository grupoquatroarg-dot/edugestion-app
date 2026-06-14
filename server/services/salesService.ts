import db from '../db.js';
import { salesRepository, SaleItem, Sale } from '../repositories/salesRepository.js';
import { getPostgresPool, isPostgresConfigured } from '../utils/postgres.js';
import { AppError } from '../utils/response.js';

type TransactionClient = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

const toNumber = (value: any, fallback: number = 0) => {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
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
  async createSale(saleData: any) {
    const { items, cliente_id, nombre_cliente, metodo_pago, monto_pagado, notes, cheque_data, usuario } = saleData;

    const normalizeSaleItem = (item: any) => {
      const cantidad = toNumber(item.cantidad);
      const precioOriginal = toNumber(
        item.precio_unitario_original ?? item.precio_original ?? item.precio_venta ?? item.precio_unitario ?? item.price
      );
      const bonificacionTipo = String(item.bonificacion_tipo || 'none');
      const bonificacionValor = toNumber(item.bonificacion_valor);

      let precioBonificado = toNumber(item.precio_venta, precioOriginal);

      if (bonificacionTipo === 'percentage') {
        precioBonificado = precioOriginal * (1 - Math.min(Math.max(bonificacionValor, 0), 100) / 100);
      }

      if (bonificacionTipo === 'fixed') {
        precioBonificado = Math.max(0, precioOriginal - Math.max(bonificacionValor, 0));
      }

      return {
        product_id: Number(item.product_id),
        cantidad,
        precio_unitario_original: precioOriginal,
        bonificacion_tipo: bonificacionTipo,
        bonificacion_valor: bonificacionValor,
        precio_unitario_bonificado: precioBonificado,
        precio_venta: precioBonificado,
      };
    };

    const normalizedItems = items.map(normalizeSaleItem);
    const totalVenta = normalizedItems.reduce((sum: number, item: any) => sum + item.cantidad * item.precio_venta, 0);

    if (!isPostgresConfigured()) {
      // Flujo local de respaldo: conserva el comportamiento anterior para desarrollo local.
      return db.transaction(() => {
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
        }));

        const saleId = salesRepository.create(saleDataToInsert, processedItems) as unknown as number;
        return { success: true, saleId, saleNumber: nextSaleNum };
      })();
    }

    const pool = getPostgresPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const productIds = Array.from(new Set(normalizedItems.map((item: any) => item.product_id)));
      const productResult = await client.query(
        `SELECT id, name, stock, cost
         FROM products
         WHERE id = ANY($1::int[])`,
        [productIds]
      );

      const productMap = new Map<number, any>();
      const availableStockByProduct = new Map<number, number>();

      for (const row of productResult.rows) {
        const productId = toNumber(row.id);
        productMap.set(productId, row);
        availableStockByProduct.set(productId, Math.max(0, toNumber(row.stock)));
      }

      let totalSaleCost = 0;
      const processedItems: SaleItem[] = [];
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

        if (remainingToConsume > 0) {
          const fifoResult = await client.query(
            `SELECT id, cantidad_restante, costo_unitario
             FROM purchase_invoice_items
             WHERE product_id = $1 AND cantidad_restante > 0
             ORDER BY id ASC`,
            [productId]
          );

          for (const move of fifoResult.rows) {
            if (remainingToConsume <= 0) break;

            const availableInMove = toNumber(move.cantidad_restante);
            const consume = Math.min(remainingToConsume, availableInMove);
            itemCost += consume * toNumber(move.costo_unitario);

            await client.query(
              `UPDATE purchase_invoice_items
               SET cantidad_restante = cantidad_restante - $1
               WHERE id = $2`,
              [consume, move.id]
            );

            remainingToConsume -= consume;
          }

          if (remainingToConsume > 0) {
            itemCost += remainingToConsume * toNumber(product?.cost);
          }

          await client.query(
            `UPDATE products
             SET stock = GREATEST(0, COALESCE(stock, 0) - $1)
             WHERE id = $2`,
            [stockToConsume, productId]
          );

          await client.query(
            `INSERT INTO stock_movimientos (product_id, cantidad, costo_unitario, cantidad_restante, descripcion, tipo_movimiento, motivo, usuario)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              productId,
              -stockToConsume,
              stockToConsume > 0 ? itemCost / stockToConsume : 0,
              0,
              `Venta con stock disponible`,
              'egreso',
              'venta',
              usuario || 'Sistema',
            ]
          );
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
        });
      }

      const nextSaleNum = await getAndIncrementSetting(client, 'next_sale_number');
      const realPayment = toNumber(monto_pagado);
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
      };

      const saleId = await salesRepository.create(saleDataToInsert, processedItems, client);

      let supplierOrderId: number | null = null;
      let supplierOrderNumber: number | null = null;
      const shortageItems = Array.from(supplierShortageMap.values()).filter((item) => item.cantidad > 0);

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

      if (realPayment > 0) {
        const nextPaymentNum = await getAndIncrementSetting(client, 'next_payment_number');
        await client.query(
          `INSERT INTO movimientos_financieros (tipo, origen, descripcion, categoria, forma_pago, monto, cliente_id, venta_id, usuario, numero_pago)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          ['ingreso', 'venta', `Venta N° ${nextSaleNum}`, 'Ventas', metodo_pago, realPayment, cliente_id || null, saleId, usuario || 'Sistema', nextPaymentNum]
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

      if (typeof metodo_pago === 'string' && metodo_pago.toLowerCase().includes('cheque') && cheque_data) {
        await client.query(
          `INSERT INTO cheques (numero_cheque, banco, importe, fecha_vencimiento, cliente_id, venta_id, estado)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            cheque_data.numero_cheque || cheque_data.numero || null,
            cheque_data.banco || null,
            toNumber(cheque_data.importe, totalVenta),
            cheque_data.fecha_vencimiento || cheque_data.vencimiento || null,
            cliente_id || null,
            saleId,
            'en_cartera',
          ]
        );
      }

      await client.query('COMMIT');
      return {
        success: true,
        saleId,
        saleNumber: nextSaleNum,
        supplierOrderGenerated: shortageItems.length > 0,
        orderId: supplierOrderId,
        orderNumber: supplierOrderNumber,
        shortageItems,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  async registerClientPayment(paymentData: any) {
    const { cliente_id, monto, metodo_pago, fecha, observaciones, usuario } = paymentData;
    const clientId = Number(cliente_id);
    const paymentAmount = toNumber(monto);

    if (!clientId) {
      throw new AppError('Cliente inválido', 400);
    }

    if (paymentAmount <= 0) {
      throw new AppError('El monto debe ser mayor a cero', 400);
    }

    if (!isPostgresConfigured()) {
      return db.transaction(() => {
        const customer = db.prepare('SELECT id, nombre_apellido, saldo_cta_cte FROM clientes WHERE id = ?').get(clientId) as any;
        if (!customer) {
          throw new AppError('Cliente no encontrado', 404);
        }

        const saldoActual = toNumber(customer.saldo_cta_cte);
        if (saldoActual <= 0) {
          throw new AppError('El cliente no tiene saldo pendiente', 400);
        }

        if (paymentAmount > saldoActual) {
          throw new AppError('El monto supera el saldo pendiente del cliente', 400);
        }

        const pendingSales = db.prepare(
          'SELECT id, numero_venta, monto_pagado, monto_pendiente FROM sales WHERE cliente_id = ? AND monto_pendiente > 0 ORDER BY fecha ASC, id ASC'
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
          String(observaciones || '').trim(),
        ].filter(Boolean);

        db.prepare(
          `INSERT INTO movimientos_financieros (tipo, origen, descripcion, categoria, forma_pago, monto, fecha, usuario, numero_pago, cliente_id, venta_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run('ingreso', 'cobranza', descriptionParts.join(' - '), 'Cobranzas', metodo_pago, paymentAmount, fecha || new Date().toISOString(), usuario || 'Sistema', nextPaymentNum, clientId, linkedSaleId);

        const updatedCustomer = db.prepare('SELECT * FROM clientes WHERE id = ?').get(clientId);
        return {
          success: true,
          cliente_id: clientId,
          saldo_actual: toNumber(updatedCustomer?.saldo_cta_cte),
          monto_aplicado: paymentAmount,
        };
      })();
    }

    const pool = getPostgresPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const customerResult = await client.query(
        `SELECT id, nombre_apellido, saldo_cta_cte
         FROM clientes
         WHERE id = $1
         LIMIT 1`,
        [clientId]
      );

      if (!customerResult.rowCount) {
        throw new AppError('Cliente no encontrado', 404);
      }

      const customer = customerResult.rows[0];
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
         ORDER BY fecha ASC, id ASC`,
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

      await client.query(
        `INSERT INTO movimientos_financieros (tipo, origen, descripcion, categoria, forma_pago, monto, fecha, usuario, numero_pago, cliente_id, venta_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          'ingreso',
          'cobranza',
          descriptionParts.join(' - '),
          'Cobranzas',
          metodo_pago,
          paymentAmount,
          fecha || new Date().toISOString(),
          usuario || 'Sistema',
          nextPaymentNum,
          clientId,
          linkedSaleId,
        ]
      );

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
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },
};
