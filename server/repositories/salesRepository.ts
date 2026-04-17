import db from '../db.js';
import { getPostgresPool, isPostgresConfigured } from '../utils/postgres.js';

type Queryable = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

export interface SaleItem {
  product_id: number;
  cantidad: number;
  precio_venta: number;
  costo_total_peps: number;
}

export interface Sale {
  id?: number;
  numero_venta: string | number;
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
  estado?: string | null;
}

const toNumber = (value: any, fallback: number = 0) => {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const mapSale = (row: any) => {
  if (!row) return null;

  return {
    id: toNumber(row.id),
    numero_venta: row.numero_venta,
    fecha: row.fecha,
    total: toNumber(row.total),
    costo_total: toNumber(row.costo_total),
    ganancia: toNumber(row.ganancia),
    cliente_id: row.cliente_id === null || row.cliente_id === undefined ? null : toNumber(row.cliente_id),
    nombre_cliente: row.nombre_cliente ?? null,
    metodo_pago: row.metodo_pago,
    monto_pagado: toNumber(row.monto_pagado),
    monto_pendiente: toNumber(row.monto_pendiente),
    notes: row.notes ?? null,
    usuario: row.usuario ?? null,
    estado: row.estado ?? null,
  };
};

const mapSaleItem = (row: any) => ({
  id: toNumber(row.id),
  sale_id: toNumber(row.sale_id),
  product_id: toNumber(row.product_id),
  cantidad: toNumber(row.cantidad),
  precio_venta: toNumber(row.precio_venta),
  costo_total_peps: toNumber(row.costo_total_peps),
  product_name: row.product_name ?? null,
  codigo_unico: row.codigo_unico ?? null,
});

const getExecutor = (executor?: Queryable) => executor || getPostgresPool();

export const salesRepository = {
  getAll(executor?: Queryable) {
    if (!isPostgresConfigured()) {
      return db.prepare(`
        SELECT s.*, COALESCE(c.nombre_apellido, s.nombre_cliente) as nombre_cliente
        FROM sales s
        LEFT JOIN clientes c ON s.cliente_id = c.id
        ORDER BY s.fecha DESC, s.id DESC
      `).all();
    }

    const queryable = getExecutor(executor);
    return queryable
      .query(
        `SELECT s.*, COALESCE(c.nombre_apellido, s.nombre_cliente) AS nombre_cliente
         FROM sales s
         LEFT JOIN clientes c ON s.cliente_id = c.id
         ORDER BY s.fecha DESC, s.id DESC`
      )
      .then((result) => result.rows.map(mapSale));
  },

  getById(id: number, executor?: Queryable) {
    if (!isPostgresConfigured()) {
      const sale = db.prepare(`
        SELECT s.*, COALESCE(c.nombre_apellido, s.nombre_cliente) as nombre_cliente
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
    }

    const queryable = getExecutor(executor);
    return queryable
      .query(
        `SELECT s.*, COALESCE(c.nombre_apellido, s.nombre_cliente) AS nombre_cliente
         FROM sales s
         LEFT JOIN clientes c ON s.cliente_id = c.id
         WHERE s.id = $1
         LIMIT 1`,
        [id]
      )
      .then(async (saleResult) => {
        if (!saleResult.rowCount) return null;

        const itemsResult = await queryable.query(
          `SELECT si.*, p.name AS product_name, p.codigo_unico
           FROM sale_items si
           JOIN products p ON si.product_id = p.id
           WHERE si.sale_id = $1
           ORDER BY si.id ASC`,
          [id]
        );

        return {
          ...mapSale(saleResult.rows[0]),
          items: itemsResult.rows.map(mapSaleItem),
        };
      });
  },

  create(saleData: Sale, items: SaleItem[], executor?: Queryable) {
    if (!isPostgresConfigured()) {
      return db.transaction(() => {
        const info = db.prepare(`
          INSERT INTO sales (numero_venta, total, costo_total, ganancia, cliente_id, nombre_cliente, metodo_pago, monto_pagado, monto_pendiente, notes, usuario, estado)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          saleData.usuario || 'Sistema',
          saleData.estado || (saleData.monto_pendiente > 0 ? 'Pendiente' : 'Pagada')
        );

        const saleId = Number(info.lastInsertRowid);
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

    const queryable = getExecutor(executor);
    return queryable
      .query(
        `INSERT INTO sales (
           numero_venta, total, costo_total, ganancia, cliente_id, nombre_cliente,
           metodo_pago, monto_pagado, monto_pendiente, notes, usuario, estado
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING id`,
        [
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
          saleData.usuario || 'Sistema',
          saleData.estado || (saleData.monto_pendiente > 0 ? 'Pendiente' : 'Pagada'),
        ]
      )
      .then(async (insertSaleResult) => {
        const saleId = toNumber(insertSaleResult.rows[0]?.id);

        for (const item of items) {
          await queryable.query(
            `INSERT INTO sale_items (sale_id, product_id, cantidad, precio_venta, costo_total_peps)
             VALUES ($1, $2, $3, $4, $5)`,
            [saleId, item.product_id, item.cantidad, item.precio_venta, item.costo_total_peps]
          );
        }

        return saleId;
      });
  },
};
