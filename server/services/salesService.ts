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
    const { items, total, cliente_id, nombre_cliente, metodo_pago, monto_pagado, notes, cheque_data, usuario } = saleData;

    if (!isPostgresConfigured()) {
      return db.transaction(() => {
        const aggregatedQuantities: Record<number, number> = {};
        for (const item of items) {
          aggregatedQuantities[item.product_id] = (aggregatedQuantities[item.product_id] || 0) + item.cantidad;
        }

        const insufficientStockItems = [];
        for (const [productId, totalRequested] of Object.entries(aggregatedQuantities)) {
          const product = db.prepare('SELECT stock, name FROM products WHERE id = ?').get(productId) as { stock: number; name: string };
          if (!product || product.stock < (totalRequested as number)) {
            insufficientStockItems.push({
              product_id: parseInt(productId, 10),
              name: product?.name || 'Producto desconocido',
              requested: totalRequested,
              available: product?.stock || 0,
            });
          }
        }

        if (insufficientStockItems.length > 0) {
          const nextOrderNum = parseInt(db.prepare("SELECT value FROM settings WHERE key = 'next_order_number'").get()?.value || '1', 10);
          db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('next_order_number', '1')").run();
          db.prepare("UPDATE settings SET value = ? WHERE key = 'next_order_number'").run(String(nextOrderNum + 1));

          const info = db.prepare('INSERT INTO supplier_orders (numero_pedido, cliente, cliente_id, estado, notes) VALUES (?, ?, ?, ?, ?)')
            .run(nextOrderNum, nombre_cliente || 'Consumidor Final', cliente_id || null, 'pendiente', notes || null);
          const newOrderId = Number(info.lastInsertRowid);

          const insertOrderItem = db.prepare('INSERT INTO supplier_order_items (order_id, product_id, cantidad) VALUES (?, ?, ?)');
          for (const [productId, totalRequested] of Object.entries(aggregatedQuantities)) {
            insertOrderItem.run(newOrderId, parseInt(productId, 10), totalRequested);
          }

          return {
            insufficientStock: true,
            items: insufficientStockItems,
            orderId: newOrderId,
            orderNumber: nextOrderNum,
          };
        }

        let totalSaleCost = 0;
        const processedItems: SaleItem[] = [];

        for (const item of items) {
          const productId = item.product_id;
          const cantidad = item.cantidad;
          const precioVenta = item.precio_venta || item.precio_unitario || item.price || 0;
          let itemCost = 0;
          let remainingToConsume = cantidad;

          const movements = db.prepare(
            'SELECT * FROM purchase_invoice_items WHERE product_id = ? AND cantidad_restante > 0 ORDER BY id ASC'
          ).all(productId) as any[];

          for (const move of movements) {
            if (remainingToConsume <= 0) break;
            const consume = Math.min(remainingToConsume, move.cantidad_restante);
            itemCost += consume * move.costo_unitario;
            db.prepare('UPDATE purchase_invoice_items SET cantidad_restante = cantidad_restante - ? WHERE id = ?').run(consume, move.id);
            remainingToConsume -= consume;
          }

          if (remainingToConsume > 0) {
            const product = db.prepare('SELECT cost FROM products WHERE id = ?').get(productId) as { cost: number };
            itemCost += remainingToConsume * (product?.cost || 0);
          }

          totalSaleCost += itemCost;
          processedItems.push({
            product_id: productId,
            cantidad,
            precio_venta: precioVenta,
            costo_total_peps: itemCost,
          });

          db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(cantidad, productId);
          db.prepare(
            'INSERT INTO stock_movimientos (product_id, cantidad, costo_unitario, cantidad_restante, descripcion, tipo_movimiento, motivo, usuario) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
          ).run(productId, -cantidad, cantidad > 0 ? itemCost / cantidad : 0, 0, `Venta #${cliente_id ? cliente_id : 'Mostrador'}`, 'egreso', 'venta', usuario || 'Sistema');
        }

        const nextSaleNum = parseInt(db.prepare("SELECT value FROM settings WHERE key = 'next_sale_number'").get()?.value || '1', 10);
        db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('next_sale_number', '1')").run();
        db.prepare("UPDATE settings SET value = ? WHERE key = 'next_sale_number'").run(String(nextSaleNum + 1));

        const realPayment = toNumber(monto_pagado);
        const montoPendiente = Math.max(0, toNumber(total) - realPayment);

        const saleDataToInsert: Sale = {
          numero_venta: String(nextSaleNum),
          total,
          costo_total: totalSaleCost,
          ganancia: toNumber(total) - totalSaleCost,
          cliente_id,
          nombre_cliente,
          metodo_pago,
          monto_pagado: realPayment,
          monto_pendiente: montoPendiente,
          notes,
          usuario,
          estado: montoPendiente > 0 ? 'Pendiente' : 'Pagada',
        };

        const saleId = salesRepository.create(saleDataToInsert, processedItems) as unknown as number;

        if (realPayment > 0) {
          const nextPaymentNum = parseInt(db.prepare("SELECT value FROM settings WHERE key = 'next_payment_number'").get()?.value || '1', 10);
          db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('next_payment_number', '1')").run();
          db.prepare("UPDATE settings SET value = ? WHERE key = 'next_payment_number'").run(String(nextPaymentNum + 1));

          db.prepare(`
            INSERT INTO movimientos_financieros (tipo, origen, descripcion, categoria, forma_pago, monto, cliente_id, venta_id, usuario, numero_pago)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run('ingreso', 'venta', `Venta N° ${nextSaleNum}`, 'Ventas', metodo_pago, realPayment, cliente_id || null, saleId, usuario || 'Sistema', nextPaymentNum);
        }

        if (cliente_id && montoPendiente > 0) {
          db.prepare('UPDATE clientes SET saldo_cta_cte = saldo_cta_cte + ? WHERE id = ?').run(montoPendiente, cliente_id);
        }

        if (metodo_pago.toLowerCase().includes('cheque') && cheque_data) {
          db.prepare(`
            INSERT INTO cheques (numero_cheque, banco, importe, fecha_vencimiento, cliente_id, venta_id, estado)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(
            cheque_data.numero_cheque || cheque_data.numero,
            cheque_data.banco,
            cheque_data.importe || total,
            cheque_data.fecha_vencimiento || cheque_data.vencimiento,
            cliente_id,
            saleId,
            'en_cartera'
          );
        }

        return { success: true, saleId, saleNumber: nextSaleNum };
      })();
    }

    const pool = getPostgresPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const aggregatedQuantities: Record<number, number> = {};
      for (const item of items) {
        aggregatedQuantities[item.product_id] = (aggregatedQuantities[item.product_id] || 0) + item.cantidad;
      }

      const productIds = Object.keys(aggregatedQuantities).map((id) => Number(id));
      const productResult = await client.query(
        `SELECT id, name, stock, cost
         FROM products
         WHERE id = ANY($1::int[])`,
        [productIds]
      );

      const productMap = new Map<number, any>();
      for (const row of productResult.rows) {
        productMap.set(toNumber(row.id), row);
      }

      const insufficientStockItems = [];
      for (const [productIdRaw, totalRequested] of Object.entries(aggregatedQuantities)) {
        const productId = Number(productIdRaw);
        const product = productMap.get(productId);
        const available = toNumber(product?.stock);
        if (!product || available < totalRequested) {
          insufficientStockItems.push({
            product_id: productId,
            name: product?.name || 'Producto desconocido',
            requested: totalRequested,
            available,
          });
        }
      }

      if (insufficientStockItems.length > 0) {
        const nextOrderNum = await getAndIncrementSetting(client, 'next_order_number');
        const orderResult = await client.query(
          `INSERT INTO supplier_orders (numero_pedido, cliente, cliente_id, estado, notes)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [nextOrderNum, nombre_cliente || 'Consumidor Final', cliente_id || null, 'pendiente', notes || null]
        );

        const newOrderId = toNumber(orderResult.rows[0]?.id);

        for (const [productIdRaw, totalRequested] of Object.entries(aggregatedQuantities)) {
          await client.query(
            `INSERT INTO supplier_order_items (order_id, product_id, cantidad)
             VALUES ($1, $2, $3)`,
            [newOrderId, Number(productIdRaw), totalRequested]
          );
        }

        await client.query('COMMIT');
        return {
          insufficientStock: true,
          items: insufficientStockItems,
          orderId: newOrderId,
          orderNumber: nextOrderNum,
        };
      }

      let totalSaleCost = 0;
      const processedItems: SaleItem[] = [];

      for (const item of items) {
        const productId = Number(item.product_id);
        const cantidad = toNumber(item.cantidad);
        const precioVenta = toNumber(item.precio_venta || item.precio_unitario || item.price);
        let itemCost = 0;
        let remainingToConsume = cantidad;

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
          const product = productMap.get(productId);
          itemCost += remainingToConsume * toNumber(product?.cost);
        }

        totalSaleCost += itemCost;
        processedItems.push({
          product_id: productId,
          cantidad,
          precio_venta: precioVenta,
          costo_total_peps: itemCost,
        });

        await client.query(
          `UPDATE products
           SET stock = stock - $1
           WHERE id = $2`,
          [cantidad, productId]
        );

        await client.query(
          `INSERT INTO stock_movimientos (product_id, cantidad, costo_unitario, cantidad_restante, descripcion, tipo_movimiento, motivo, usuario)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            productId,
            -cantidad,
            cantidad > 0 ? itemCost / cantidad : 0,
            0,
            `Venta #${cliente_id ? cliente_id : 'Mostrador'}`,
            'egreso',
            'venta',
            usuario || 'Sistema',
          ]
        );
      }

      const nextSaleNum = await getAndIncrementSetting(client, 'next_sale_number');
      const realPayment = toNumber(monto_pagado);
      const montoPendiente = Math.max(0, toNumber(total) - realPayment);

      const saleDataToInsert: Sale = {
        numero_venta: String(nextSaleNum),
        total: toNumber(total),
        costo_total: totalSaleCost,
        ganancia: toNumber(total) - totalSaleCost,
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
            toNumber(cheque_data.importe, toNumber(total)),
            cheque_data.fecha_vencimiento || cheque_data.vencimiento || null,
            cliente_id || null,
            saleId,
            'en_cartera',
          ]
        );
      }

      await client.query('COMMIT');
      return { success: true, saleId, saleNumber: nextSaleNum };
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
          'SELECT id, monto_pagado, monto_pendiente FROM sales WHERE cliente_id = ? AND monto_pendiente > 0 ORDER BY fecha ASC, id ASC'
        ).all(clientId) as any[];

        if (pendingSales.length === 0) {
          throw new AppError('No hay ventas pendientes para este cliente', 400);
        }

        let remaining = paymentAmount;

        for (const sale of pendingSales) {
          if (remaining <= 0) break;
          const pendiente = toNumber(sale.monto_pendiente);
          const applied = Math.min(remaining, pendiente);
          const newMontoPagado = toNumber(sale.monto_pagado) + applied;
          const newMontoPendiente = pendiente - applied;

          db.prepare(
            'UPDATE sales SET monto_pagado = ?, monto_pendiente = ?, estado = ? WHERE id = ?'
          ).run(newMontoPagado, newMontoPendiente, newMontoPendiente <= 0 ? 'Pagada' : 'Pendiente', sale.id);

          remaining -= applied;
        }

        db.prepare('UPDATE clientes SET saldo_cta_cte = saldo_cta_cte - ? WHERE id = ?').run(paymentAmount, clientId);

        const nextPaymentNum = parseInt(db.prepare("SELECT value FROM settings WHERE key = 'next_payment_number'").get()?.value || '1', 10);
        db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('next_payment_number', '1')").run();
        db.prepare("UPDATE settings SET value = ? WHERE key = 'next_payment_number'").run(String(nextPaymentNum + 1));

        db.prepare(
          `INSERT INTO movimientos_financieros (tipo, origen, descripcion, categoria, forma_pago, monto, fecha, usuario, numero_pago, cliente_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run('ingreso', 'cobranza', `Cobranza cliente ${customer.nombre_apellido}`, 'Cobranzas', metodo_pago, paymentAmount, fecha || new Date().toISOString(), usuario || 'Sistema', nextPaymentNum, clientId);

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
        `SELECT id, monto_pagado, monto_pendiente
         FROM sales
         WHERE cliente_id = $1 AND monto_pendiente > 0
         ORDER BY fecha ASC, id ASC`,
        [clientId]
      );

      if (!pendingSalesResult.rowCount) {
        throw new AppError('No hay ventas pendientes para este cliente', 400);
      }

      let remaining = paymentAmount;

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

        remaining -= applied;
      }

      await client.query(
        `UPDATE clientes
         SET saldo_cta_cte = COALESCE(saldo_cta_cte, 0) - $1
         WHERE id = $2`,
        [paymentAmount, clientId]
      );

      const nextPaymentNum = await getAndIncrementSetting(client, 'next_payment_number');
      await client.query(
        `INSERT INTO movimientos_financieros (tipo, origen, descripcion, categoria, forma_pago, monto, fecha, usuario, numero_pago, cliente_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          'ingreso',
          'cobranza',
          `Cobranza cliente ${customer.nombre_apellido}`,
          'Cobranzas',
          metodo_pago,
          paymentAmount,
          fecha || new Date().toISOString(),
          usuario || 'Sistema',
          nextPaymentNum,
          clientId,
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
