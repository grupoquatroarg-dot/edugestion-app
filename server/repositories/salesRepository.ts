import db from '../db.js';

export interface SaleItem {
  product_id: number;
  cantidad: number;
  precio_venta: number;
  costo_total_peps: number;
}

export interface Sale {
  id?: number;
  numero_venta: string;
  fecha?: string;
  total: number;
  costo_total: number;
  ganancia: number;
  cliente_id?: number | null;
  nombre_cliente?: string | null;
  metodo_pago: string;
  monto_pagado: number;
  monto_pendiente: number;
  notes?: string | null;
  usuario?: string | null;
}

export const salesRepository = {
  getAll: () => {
    return db.prepare(`
      SELECT s.*, c.nombre_apellido as nombre_cliente 
      FROM sales s 
      LEFT JOIN clientes c ON s.cliente_id = c.id 
      ORDER BY s.fecha DESC
    `).all();
  },

  getById: (id: number) => {
    const sale = db.prepare(`
      SELECT s.*, c.nombre_apellido as nombre_cliente 
      FROM sales s 
      LEFT JOIN clientes c ON s.cliente_id = c.id 
      WHERE s.id = ?
    `).get(id);

    if (!sale) return null;

    const items = db.prepare(`
      SELECT si.*, p.name as product_name, p.codigo_unico 
      FROM sale_items si 
      JOIN products p ON si.product_id = p.id 
      WHERE si.sale_id = ?
    `).all(id);

    return { ...sale, items };
  },

  create: (saleData: Sale, items: SaleItem[]) => {
    return db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO sales (numero_venta, total, costo_total, ganancia, cliente_id, nombre_cliente, metodo_pago, monto_pagado, monto_pendiente, notes, usuario)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        saleData.numero_venta,
        saleData.total,
        saleData.costo_total,
        saleData.ganancia,
        saleData.cliente_id || null,
        saleData.nombre_cliente || null,
        saleData.metodo_pago,
        saleData.monto_pagado,
        saleData.monto_pendiente,
        saleData.notes || null,
        saleData.usuario || 'Sistema'
      );

      const saleId = info.lastInsertRowid as number;

      const insertItem = db.prepare(`
        INSERT INTO sale_items (sale_id, product_id, cantidad, precio_venta, costo_total_peps)
        VALUES (?, ?, ?, ?, ?)
      `);

      for (const item of items) {
        insertItem.run(saleId, item.product_id, item.cantidad, item.precio_venta, item.costo_total_peps);
      }

      return saleId;
    })();
  }
};
