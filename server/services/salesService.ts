import db from '../db.js';
import { salesRepository, SaleItem, Sale } from '../repositories/salesRepository';

export const salesService = {
  createSale: (saleData: any) => {
    const { items, total, cliente_id, nombre_cliente, metodo_pago, monto_pagado, notes, cheque_data, usuario } = saleData;

    return db.transaction(() => {
      // 1. Validar stock total solicitado por producto
      const aggregatedQuantities: Record<number, number> = {};
      for (const item of items) {
        aggregatedQuantities[item.product_id] = (aggregatedQuantities[item.product_id] || 0) + item.cantidad;
      }

      const insufficientStockItems = [];
      for (const [productId, totalRequested] of Object.entries(aggregatedQuantities)) {
        const product = db.prepare("SELECT stock, name FROM products WHERE id = ?").get(productId) as { stock: number, name: string };
        if (!product || product.stock < (totalRequested as number)) {
          insufficientStockItems.push({
            product_id: parseInt(productId),
            name: product?.name || 'Producto desconocido',
            requested: totalRequested,
            available: product?.stock || 0
          });
        }
      }

      if (insufficientStockItems.length > 0) {
        // Si no hay stock, crear un pedido a proveedor automáticamente
        const nextOrderNum = parseInt(db.prepare("SELECT value FROM settings WHERE key = 'next_order_number'").get()?.value || '1');
        db.prepare("UPDATE settings SET value = ? WHERE key = 'next_order_number'").run((nextOrderNum + 1).toString());

        const info = db.prepare("INSERT INTO supplier_orders (numero_pedido, cliente, cliente_id, estado, notes) VALUES (?, ?, ?, ?, ?)").run(nextOrderNum, nombre_cliente, cliente_id, 'pendiente', notes || null);
        const newOrderId = info.lastInsertRowid as number;

        const insertOrderItem = db.prepare("INSERT INTO supplier_order_items (order_id, product_id, cantidad) VALUES (?, ?, ?)");
        for (const [productId, totalRequested] of Object.entries(aggregatedQuantities)) {
          insertOrderItem.run(newOrderId, parseInt(productId), totalRequested);
        }

        return { 
          insufficientStock: true, 
          items: insufficientStockItems,
          orderId: newOrderId,
          orderNumber: nextOrderNum
        };
      }

      // 2. Calcular costos y actualizar stock usando PEPS (FIFO)
      let totalSaleCost = 0;
      const processedItems: SaleItem[] = [];

      for (const item of items) {
        const productId = item.product_id;
        const cantidad = item.cantidad;
        const precioVenta = item.precio_venta || item.precio_unitario || item.price || 0;
        let itemCost = 0;
        let remainingToConsume = cantidad;

        // Consumir stock usando PEPS (FIFO) de purchase_invoice_items
        const movements = db.prepare(
          "SELECT * FROM purchase_invoice_items WHERE product_id = ? AND cantidad_restante > 0 ORDER BY id ASC"
        ).all(productId) as any[];

        for (const move of movements) {
          if (remainingToConsume <= 0) break;
          const consume = Math.min(remainingToConsume, move.cantidad_restante);
          itemCost += consume * move.costo_unitario;
          db.prepare("UPDATE purchase_invoice_items SET cantidad_restante = cantidad_restante - ? WHERE id = ?").run(consume, move.id);
          remainingToConsume -= consume;
        }

        // Si por alguna razón falta stock en los movimientos (no debería pasar por la validación inicial)
        if (remainingToConsume > 0) {
          const product = db.prepare("SELECT cost FROM products WHERE id = ?").get(productId) as { cost: number };
          itemCost += remainingToConsume * (product.cost || 0);
        }

        totalSaleCost += itemCost;
        processedItems.push({
          product_id: productId,
          cantidad: cantidad,
          precio_venta: precioVenta,
          costo_total_peps: itemCost
        });

        // Actualizar stock total del producto
        db.prepare("UPDATE products SET stock = stock - ? WHERE id = ?").run(cantidad, productId);

        // Registrar movimiento de stock (egreso)
        db.prepare(
          "INSERT INTO stock_movimientos (product_id, cantidad, costo_unitario, cantidad_restante, descripcion, tipo_movimiento, motivo, usuario) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        ).run(productId, -cantidad, itemCost / cantidad, 0, `Venta #${cliente_id ? cliente_id : 'Mostrador'}`, "egreso", "venta", usuario || 'Sistema');
      }

      // 3. Generar la venta
      const nextSaleNum = parseInt(db.prepare("SELECT value FROM settings WHERE key = 'next_sale_number'").get()?.value || '1');
      db.prepare("UPDATE settings SET value = ? WHERE key = 'next_sale_number'").run((nextSaleNum + 1).toString());

      const saleDataToInsert: Sale = {
        numero_venta: nextSaleNum.toString(),
        total: total,
        costo_total: totalSaleCost,
        ganancia: total - totalSaleCost,
        cliente_id: cliente_id,
        nombre_cliente: nombre_cliente,
        metodo_pago: metodo_pago,
        monto_pagado: monto_pagado || 0,
        monto_pendiente: total - (monto_pagado || 0),
        notes: notes,
        usuario: usuario
      };

      const saleId = salesRepository.create(saleDataToInsert, processedItems);

      // 4. Registrar movimiento financiero (ingreso) - Solo si hubo pago real
      const realPayment = monto_pagado || 0;
      if (realPayment > 0) {
        const nextPaymentNum = parseInt(db.prepare("SELECT value FROM settings WHERE key = 'next_payment_number'").get()?.value || '1');
        db.prepare("UPDATE settings SET value = ? WHERE key = 'next_payment_number'").run((nextPaymentNum + 1).toString());

        db.prepare(`
          INSERT INTO movimientos_financieros (tipo, origen, descripcion, categoria, forma_pago, monto, cliente_id, usuario, numero_pago)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run('ingreso', 'venta', `Venta N° ${nextSaleNum}`, 'Ventas', metodo_pago, realPayment, cliente_id || null, usuario || 'Sistema', nextPaymentNum);
      }

      // 5. Actualizar saldo de cliente si hay deuda
      const montoPendiente = total - realPayment;
      if (cliente_id && montoPendiente > 0) {
        db.prepare("UPDATE clientes SET saldo_cta_cte = saldo_cta_cte + ? WHERE id = ?").run(montoPendiente, cliente_id);
      }

      // 6. Si es cheque, registrar en la tabla de cheques
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
    });
  }
};
