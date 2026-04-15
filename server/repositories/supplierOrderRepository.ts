import db from '../db.js';

export const supplierOrderRepository = {
  getAll: () => {
    const orders = db.prepare("SELECT * FROM supplier_orders ORDER BY fecha DESC").all();
    return orders.map(order => {
      const items = db.prepare(`
        SELECT soi.*, p.name as product_name, p.company as proveedor, p.codigo_unico
        FROM supplier_order_items soi
        JOIN products p ON soi.product_id = p.id
        WHERE soi.order_id = ?
      `).all(order.id);
      return { ...order, productos: items };
    });
  },

  create: (orderData: any) => {
    const { cliente, cliente_id, items, notes } = orderData;
    return db.transaction(() => {
      const nextOrderNum = parseInt(db.prepare("SELECT value FROM settings WHERE key = 'next_order_number'").get()?.value || '1');
      db.prepare("UPDATE settings SET value = ? WHERE key = 'next_order_number'").run((nextOrderNum + 1).toString());

      const info = db.prepare("INSERT INTO supplier_orders (cliente, cliente_id, numero_pedido, notes) VALUES (?, ?, ?, ?)").run(cliente, cliente_id || null, nextOrderNum, notes || null);
      const orderId = info.lastInsertRowid;

      const insertItem = db.prepare("INSERT INTO supplier_order_items (order_id, product_id, cantidad) VALUES (?, ?, ?)");
      for (const item of items) {
        insertItem.run(orderId, item.product_id, item.cantidad);
      }

      return orderId;
    })();
  },

  updateStatus: (id: number, estado: string) => {
    return db.transaction(() => {
      const order = db.prepare("SELECT * FROM supplier_orders WHERE id = ?").get(id) as any;
      if (!order) throw new Error("Order not found");

      const oldEstado = order.estado;
      if (oldEstado === estado) return;

      if (estado === 'entregado') {
        throw new Error("No se puede cambiar el estado a 'entregado' manualmente. Use 'Completar Entrega'.");
      }

      db.prepare("UPDATE supplier_orders SET estado = ? WHERE id = ?").run(estado, id);
    })();
  }
};
