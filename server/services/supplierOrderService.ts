import db from '../db.js';
import { salesRepository, Sale, SaleItem } from '../repositories/salesRepository';

export const supplierOrderService = {
  completeSale: (orderId: number, paymentData: any) => {
    const { metodo_pago, monto_pagado, usuario } = paymentData;

    return db.transaction(() => {
      const order = db.prepare("SELECT * FROM supplier_orders WHERE id = ?").get(orderId) as any;
      if (!order) throw new Error("Order not found");
      if (order.estado !== 'auditar_pedido') throw new Error("El pedido debe estar en estado 'Auditar Pedido' para completar la entrega");
      if (order.sale_id) throw new Error("El pedido ya tiene una venta asociada");

      const items = db.prepare(`
        SELECT soi.*, p.name, p.sale_price as price, p.cost
        FROM supplier_order_items soi
        JOIN products p ON soi.product_id = p.id
        WHERE soi.order_id = ?
      `).all(orderId) as any[];

      if (items.length === 0) throw new Error("El pedido no tiene productos");

      // 1. Registrar ingreso de stock y lote de compra (para PEPS)
      for (const item of items) {
        db.prepare(`
          INSERT INTO stock_movimientos (product_id, cantidad, costo_unitario, cantidad_restante, descripcion, tipo_movimiento) 
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(item.product_id, item.cantidad, item.cost || 0, item.cantidad, `Ingreso desde Pedido #${order.numero_pedido}`, 'ingreso');
        
        db.prepare("UPDATE products SET stock = stock + ? WHERE id = ?").run(item.cantidad, item.product_id);
      }

      // 2. Calcular totales y costos para la venta (FIFO)
      let totalVenta = 0;
      let totalSaleCost = 0;
      const processedItems: SaleItem[] = [];
      const nextSaleNum = parseInt(db.prepare("SELECT value FROM settings WHERE key = 'next_sale_number'").get()?.value || '1');

      for (const item of items) {
        totalVenta += item.cantidad * item.price;
        
        let itemCost = 0;
        let remainingToConsume = item.cantidad;

        // FIFO Consumption (will consume the stock we just added)
        const movements = db.prepare(
          "SELECT * FROM stock_movimientos WHERE product_id = ? AND cantidad_restante > 0 ORDER BY fecha_ingreso ASC, id ASC"
        ).all(item.product_id) as any[];

        for (const move of movements) {
          if (remainingToConsume <= 0) break;
          const consume = Math.min(remainingToConsume, move.cantidad_restante);
          itemCost += consume * move.costo_unitario;
          db.prepare("UPDATE stock_movimientos SET cantidad_restante = cantidad_restante - ? WHERE id = ?").run(consume, move.id);
          remainingToConsume -= consume;
        }

        if (remainingToConsume > 0) {
          itemCost += remainingToConsume * (item.cost || 0);
        }

        totalSaleCost += itemCost;
        processedItems.push({
          product_id: item.product_id,
          cantidad: item.cantidad,
          precio_venta: item.price,
          costo_total_peps: itemCost
        });
      }

      // 3. Generar la venta
      const saleData: Sale = {
        numero_venta: nextSaleNum.toString(),
        total: totalVenta,
        costo_total: totalSaleCost,
        ganancia: totalVenta - totalSaleCost,
        cliente_id: order.cliente_id,
        nombre_cliente: order.cliente,
        metodo_pago: metodo_pago || 'efectivo',
        monto_pagado: monto_pagado || totalVenta,
        monto_pendiente: totalVenta - (monto_pagado || totalVenta),
        notes: `Pedido #${order.numero_pedido}`,
        usuario: usuario || 'Sistema'
      };

      const saleId = salesRepository.create(saleData, processedItems);

      // 4. Actualizar el pedido
      db.prepare("UPDATE settings SET value = ? WHERE key = 'next_sale_number'").run((nextSaleNum + 1).toString());
      db.prepare("UPDATE supplier_orders SET estado = 'entregado', sale_id = ? WHERE id = ?").run(saleId, orderId);

      // 5. Registrar movimiento financiero
      const nextPaymentNum = parseInt(db.prepare("SELECT value FROM settings WHERE key = 'next_payment_number'").get()?.value || '1');
      db.prepare("UPDATE settings SET value = ? WHERE key = 'next_payment_number'").run((nextPaymentNum + 1).toString());

      db.prepare(`
        INSERT INTO movimientos_financieros (tipo, origen, descripcion, categoria, forma_pago, monto, cliente_id, usuario, numero_pago)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('ingreso', 'venta', `Venta N° ${nextSaleNum} (Pedido #${order.numero_pedido})`, 'Ventas', metodo_pago || 'efectivo', totalVenta, order.cliente_id || null, usuario || 'Sistema', nextPaymentNum);

      return { success: true, saleId, saleNumber: nextSaleNum };
    });
  }
};
