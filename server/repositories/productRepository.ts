import db from "../db.js";
import { getPostgresPool, isPostgresConfigured } from "../utils/postgres.js";
import { AppError } from "../utils/response.js";

type Queryable = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

const toNumber = (value: any, fallback: number = 0) => {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const mapProduct = (row: any) => {
  if (!row) return null;

  return {
    id: toNumber(row.id),
    code: row.code,
    codigo_unico: row.codigo_unico,
    name: row.name,
    description: row.description,
    cost: toNumber(row.cost),
    sale_price: toNumber(row.sale_price),
    stock: toNumber(row.stock),
    stock_minimo: toNumber(row.stock_minimo),
    company: row.company,
    family_id: row.family_id === null || row.family_id === undefined ? null : toNumber(row.family_id),
    category_id: row.category_id === null || row.category_id === undefined ? null : toNumber(row.category_id),
    estado: row.estado,
    eliminado: toNumber(row.eliminado),
    active: toNumber(row.active, 1),
    created_at: row.created_at,
    family_name: row.family_name ?? null,
    category_name: row.category_name ?? null,
  };
};

const getExecutor = (executor?: Queryable) => executor || getPostgresPool();

export const ProductRepository = {
  findAll(executor?: Queryable) {
    if (!isPostgresConfigured()) {
      return db.prepare(`
        SELECT p.*, f.name as family_name, c.name as category_name
        FROM products p
        LEFT JOIN product_families f ON p.family_id = f.id
        LEFT JOIN product_categories c ON p.category_id = c.id
        WHERE p.eliminado = 0
        ORDER BY p.name ASC
      `).all();
    }

    const queryable = getExecutor(executor);
    return queryable
      .query(
        `SELECT p.*, f.name AS family_name, c.name AS category_name
         FROM products p
         LEFT JOIN product_families f ON p.family_id = f.id
         LEFT JOIN product_categories c ON p.category_id = c.id
         WHERE p.eliminado = 0
         ORDER BY p.name ASC`
      )
      .then((result) => result.rows.map(mapProduct));
  },

  findById(id: number, executor?: Queryable) {
    if (!isPostgresConfigured()) {
      return db.prepare(`
        SELECT p.*, f.name as family_name, c.name as category_name
        FROM products p
        LEFT JOIN product_families f ON p.family_id = f.id
        LEFT JOIN product_categories c ON p.category_id = c.id
        WHERE p.id = ? AND p.eliminado = 0
      `).get(id);
    }

    const queryable = getExecutor(executor);
    return queryable
      .query(
        `SELECT p.*, f.name AS family_name, c.name AS category_name
         FROM products p
         LEFT JOIN product_families f ON p.family_id = f.id
         LEFT JOIN product_categories c ON p.category_id = c.id
         WHERE p.id = $1 AND p.eliminado = 0
         LIMIT 1`,
        [id]
      )
      .then((result) => mapProduct(result.rows[0]));
  },

  create(productData: any, executor?: Queryable) {
    const {
      code,
      name,
      description,
      cost,
      sale_price,
      stock = 0,
      stock_minimo = 0,
      company,
      family_id,
      category_id,
      estado = "activo",
    } = productData;

    const codigo_unico = `${company}-${code}`;

    if (!isPostgresConfigured()) {
      const existing = db.prepare("SELECT id, eliminado FROM products WHERE codigo_unico = ?").get(codigo_unico) as any;
      if (existing) {
        if (existing.eliminado) {
          throw new AppError(`El código ${codigo_unico} ya existe en un producto eliminado. Por favor use otro código o restaure el producto.`, 400);
        }
        throw new AppError(`El código ${codigo_unico} ya está en uso.`, 400);
      }

      const info = db.prepare(`
        INSERT INTO products (code, codigo_unico, name, description, cost, sale_price, stock, stock_minimo, company, family_id, category_id, estado)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        code,
        codigo_unico,
        name,
        description || null,
        cost,
        sale_price,
        stock,
        stock_minimo,
        company,
        family_id ?? null,
        category_id ?? null,
        estado
      );

      return this.findById(Number(info.lastInsertRowid));
    }

    const queryable = getExecutor(executor);
    return queryable
      .query("SELECT id, eliminado FROM products WHERE codigo_unico = $1 LIMIT 1", [codigo_unico])
      .then(async (existingResult) => {
        const existing = existingResult.rows[0];
        if (existing) {
          if (toNumber(existing.eliminado) === 1) {
            throw new AppError(`El código ${codigo_unico} ya existe en un producto eliminado. Por favor use otro código o restaure el producto.`, 400);
          }
          throw new AppError(`El código ${codigo_unico} ya está en uso.`, 400);
        }

        const insertResult = await queryable.query(
          `INSERT INTO products (code, codigo_unico, name, description, cost, sale_price, stock, stock_minimo, company, family_id, category_id, estado)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           RETURNING id`,
          [
            code,
            codigo_unico,
            name,
            description || null,
            cost,
            sale_price,
            stock,
            stock_minimo,
            company,
            family_id ?? null,
            category_id ?? null,
            estado,
          ]
        );

        return this.findById(toNumber(insertResult.rows[0]?.id), queryable) as Promise<any>;
      });
  },

  update(id: number, productData: any, executor?: Queryable) {
    const {
      code,
      name,
      description,
      cost,
      sale_price,
      stock = 0,
      stock_minimo = 0,
      company,
      family_id,
      category_id,
      estado = "activo",
    } = productData;

    const codigo_unico = `${company}-${code}`;

    if (!isPostgresConfigured()) {
      const existing = db.prepare("SELECT id, eliminado FROM products WHERE codigo_unico = ? AND id != ?").get(codigo_unico, id) as any;
      if (existing) {
        if (existing.eliminado) {
          throw new AppError(`El código ${codigo_unico} ya existe en un producto eliminado.`, 400);
        }
        throw new AppError(`El código ${codigo_unico} ya está en uso por otro producto.`, 400);
      }

      db.prepare(`
        UPDATE products
        SET code = ?, codigo_unico = ?, name = ?, description = ?, cost = ?, sale_price = ?, stock = ?, stock_minimo = ?, company = ?, family_id = ?, category_id = ?, estado = ?
        WHERE id = ?
      `).run(
        code,
        codigo_unico,
        name,
        description || null,
        cost,
        sale_price,
        stock,
        stock_minimo,
        company,
        family_id ?? null,
        category_id ?? null,
        estado,
        id
      );

      return this.findById(id);
    }

    const queryable = getExecutor(executor);
    return queryable
      .query("SELECT id, eliminado FROM products WHERE codigo_unico = $1 AND id != $2 LIMIT 1", [codigo_unico, id])
      .then(async (existingResult) => {
        const existing = existingResult.rows[0];
        if (existing) {
          if (toNumber(existing.eliminado) === 1) {
            throw new AppError(`El código ${codigo_unico} ya existe en un producto eliminado.`, 400);
          }
          throw new AppError(`El código ${codigo_unico} ya está en uso por otro producto.`, 400);
        }

        const updateResult = await queryable.query(
          `UPDATE products
           SET code = $1,
               codigo_unico = $2,
               name = $3,
               description = $4,
               cost = $5,
               sale_price = $6,
               stock = $7,
               stock_minimo = $8,
               company = $9,
               family_id = $10,
               category_id = $11,
               estado = $12
           WHERE id = $13
           RETURNING id`,
          [
            code,
            codigo_unico,
            name,
            description || null,
            cost,
            sale_price,
            stock,
            stock_minimo,
            company,
            family_id ?? null,
            category_id ?? null,
            estado,
            id,
          ]
        );

        if (!updateResult.rowCount) {
          throw new AppError("Producto no encontrado", 404);
        }

        return this.findById(id, queryable) as Promise<any>;
      });
  },

  softDelete(id: number, executor?: Queryable) {
    if (!isPostgresConfigured()) {
      return db.prepare("UPDATE products SET eliminado = 1 WHERE id = ?").run(id);
    }

    const queryable = getExecutor(executor);
    return queryable.query("UPDATE products SET eliminado = 1 WHERE id = $1", [id]);
  },

  hasSales(id: number, executor?: Queryable) {
    if (!isPostgresConfigured()) {
      return db.prepare("SELECT id FROM sale_items WHERE product_id = ? LIMIT 1").get(id);
    }

    const queryable = getExecutor(executor);
    return queryable
      .query("SELECT id FROM sale_items WHERE product_id = $1 LIMIT 1", [id])
      .then((result) => result.rows[0] || null);
  },
};
