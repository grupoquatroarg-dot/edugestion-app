import { z } from "zod";
import db from "../server/db.js";
import { ProductRepository } from "../server/repositories/productRepository.js";
import { UserRepository } from "../server/repositories/userRepository.js";
import { getPostgresPool, isPostgresConfigured } from "../server/utils/postgres.js";
import { AppError, sendError, sendSuccess } from "../server/utils/response.js";
import { requireBearerUser, type CurrentUserAuth } from "../server/services/currentUserAuthService.js";
import { bulkPriceReversalService } from "../server/services/bulkPriceReversalService.js";
import { getProductCostUnitPrice } from "../shared/productMeasurement.js";

const productSchema = z.object({
  code: z.string().min(1, "El codigo es requerido"),
  name: z.string().min(2, "El nombre debe tener al menos 2 caracteres"),
  description: z.string().optional().nullable(),
  cost: z.number().min(0, "El costo no puede ser negativo"),
  sale_price: z.number().min(0, "El precio de venta no puede ser negativo"),
  quantity_mode: z.enum(["unit", "measure"]).optional().default("unit"),
  measurement_unit: z.enum(["unidad", "kg", "g", "l", "ml", "m"]).optional().default("unidad"),
  price_reference_quantity: z.number().positive("La cantidad de referencia debe ser mayor a cero").optional().default(1),
  stock: z.number().min(0, "El stock no puede ser negativo").optional(),
  stock_minimo: z.number().min(0, "El stock minimo no puede ser negativo").optional(),
  company: z.enum(["Edu", "Peti"]),
  family_id: z.number().nullable(),
  category_id: z.number().nullable(),
  estado: z.enum(["activo", "inactivo"]).optional(),
});

const bulkApplySchema = z.object({
  scope: z.enum(["all", "family", "company", "manual"]),
  family_id: z.union([z.string(), z.number()]).optional().nullable(),
  company: z.string().optional().nullable(),
  product_id: z.union([z.string(), z.number()]).optional().nullable(),
  active_only: z.boolean().optional(),
  target_field: z.enum(["cost", "sale_price"]),
  change_type: z.enum(["increase_pct", "decrease_pct", "increase_fixed", "decrease_fixed", "replace_margin", "recalculate_peps"]),
  value: z.number(),
  update_sale_price: z.boolean().optional(),
  new_margin: z.number().optional(),
  expected_product_ids: z.array(z.number().int().positive()).min(1).optional(),
  user_email: z.string().optional(),
});

const bulkRevertSchema = z.object({
  history_id: z.number().int().positive(),
  motivo: z.string().trim().min(3).max(500),
});

type Queryable = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

const getBody = (req: any) => {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return {};
};

const permissionKeyByAction = {
  view: "can_view",
  create: "can_create",
  edit: "can_edit",
} as const;

const requireProductPermission = async (
  req: any,
  res: any,
  action: keyof typeof permissionKeyByAction
): Promise<CurrentUserAuth | null> => {
  const decoded = await requireBearerUser(req, res);
  if (!decoded) return null;

  if (decoded.role === "administrador") {
    return decoded;
  }

  const permissions = await UserRepository.getPermissions(Number(decoded.userId));
  const productPermissions = permissions?.products;
  const permissionKey = permissionKeyByAction[action];

  if (!productPermissions?.[permissionKey]) {
    sendError(res, "Forbidden: No permission for products", 403);
    return null;
  }

  return decoded;
};

const toNumber = (value: any, fallback: number = 0) => {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const getEndpoint = (req: any) => {
  const rawEndpoint = Array.isArray(req.query?.endpoint) ? req.query.endpoint[0] : req.query?.endpoint;
  return String(rawEndpoint || "");
};

const mapProduct = (row: any) => ({
  id: toNumber(row.id),
  code: row.code,
  codigo_unico: row.codigo_unico,
  name: row.name,
  description: row.description,
  cost: toNumber(row.cost),
  sale_price: toNumber(row.sale_price),
  quantity_mode: row.quantity_mode === "measure" ? "measure" : "unit",
  measurement_unit: row.quantity_mode === "measure" ? (row.measurement_unit || "kg") : "unidad",
  price_reference_quantity: row.quantity_mode === "measure" ? Math.max(toNumber(row.price_reference_quantity, 1), 0.000001) : 1,
  stock: toNumber(row.stock),
  stock_minimo: toNumber(row.stock_minimo),
  company: row.company,
  family_id: row.family_id === null || row.family_id === undefined ? null : toNumber(row.family_id),
  category_id: row.category_id === null || row.category_id === undefined ? null : toNumber(row.category_id),
  estado: row.estado,
  eliminado: toNumber(row.eliminado),
  active: toNumber(row.active, 1),
  deactivated_at: row.deactivated_at ?? null,
  deactivated_by: row.deactivated_by ?? null,
  deactivation_reason: row.deactivation_reason ?? null,
  content_version: toNumber(row.content_version),
  content_changed_at: row.content_changed_at ?? null,
  content_changed_by: row.content_changed_by ?? null,
  content_change_reason: row.content_change_reason ?? null,
  created_at: row.created_at,
  family_name: row.family_name ?? null,
  category_name: row.category_name ?? null,
});

const calculateNewPrices = (params: {
  product: any;
  targetField: "cost" | "sale_price";
  changeType: string;
  value: number;
  updateSalePrice?: boolean;
  newMargin?: number;
}) => {
  let newCost = toNumber(params.product.cost);
  let newSalePrice = toNumber(params.product.sale_price);
  const value = toNumber(params.value);

  if (params.targetField === "cost") {
    if (params.changeType === "increase_pct") newCost = newCost * (1 + value / 100);
    else if (params.changeType === "decrease_pct") newCost = newCost * (1 - value / 100);
    else if (params.changeType === "increase_fixed") newCost = newCost + value;
    else if (params.changeType === "decrease_fixed") newCost = newCost - value;

    if (params.updateSalePrice) {
      const margin = toNumber(params.newMargin) / 100;
      if (margin < 1) newSalePrice = newCost / (1 - margin);
    }
  } else {
    if (params.changeType === "increase_pct") newSalePrice = newSalePrice * (1 + value / 100);
    else if (params.changeType === "decrease_pct") newSalePrice = newSalePrice * (1 - value / 100);
    else if (params.changeType === "increase_fixed") newSalePrice = newSalePrice + value;
    else if (params.changeType === "decrease_fixed") newSalePrice = newSalePrice - value;
    else if (params.changeType === "replace_margin" || params.changeType === "recalculate_peps") {
      const margin = value / 100;
      if (margin < 1) newSalePrice = newCost / (1 - margin);
    }
  }

  return {
    newCost: Math.max(0, Number(newCost.toFixed(2))),
    newSalePrice: Math.max(0, Number(newSalePrice.toFixed(2))),
  };
};

const ensurePriceHistoryTableSqlite = () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS price_update_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
      usuario TEXT,
      alcance TEXT,
      tipo_cambio TEXT,
      valor REAL,
      productos_afectados INTEGER,
      reversion_version INTEGER NOT NULL DEFAULT 0,
      reverted_at TEXT,
      reverted_by TEXT,
      revert_reason TEXT,
      reverted_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS price_update_history_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      price_update_history_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      previous_cost REAL NOT NULL,
      previous_sale_price REAL NOT NULL,
      new_cost REAL NOT NULL,
      new_sale_price REAL NOT NULL,
      reverted_at TEXT,
      UNIQUE (price_update_history_id, product_id),
      FOREIGN KEY (price_update_history_id) REFERENCES price_update_history(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE INDEX IF NOT EXISTS idx_price_update_items_history
      ON price_update_history_items (price_update_history_id, product_id);
  `);

  for (const statement of [
    "ALTER TABLE price_update_history ADD COLUMN reversion_version INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE price_update_history ADD COLUMN reverted_at TEXT",
    "ALTER TABLE price_update_history ADD COLUMN reverted_by TEXT",
    "ALTER TABLE price_update_history ADD COLUMN revert_reason TEXT",
    "ALTER TABLE price_update_history ADD COLUMN reverted_count INTEGER NOT NULL DEFAULT 0",
  ]) {
    try { db.exec(statement); } catch {}
  }
};

const ensurePriceHistoryTablePg = async (queryable: Queryable) => {
  await queryable.query(`
    CREATE TABLE IF NOT EXISTS price_update_history (
      id SERIAL PRIMARY KEY,
      fecha TIMESTAMP WITH TIME ZONE DEFAULT now(),
      usuario TEXT,
      alcance TEXT,
      tipo_cambio TEXT,
      valor NUMERIC DEFAULT 0,
      productos_afectados INTEGER DEFAULT 0,
      reversion_version INTEGER NOT NULL DEFAULT 0,
      reverted_at TIMESTAMP WITH TIME ZONE,
      reverted_by TEXT,
      revert_reason TEXT,
      reverted_count INTEGER NOT NULL DEFAULT 0
    )
  `);
  await queryable.query(`
    ALTER TABLE price_update_history
      ADD COLUMN IF NOT EXISTS reversion_version INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS reverted_at TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS reverted_by TEXT,
      ADD COLUMN IF NOT EXISTS revert_reason TEXT,
      ADD COLUMN IF NOT EXISTS reverted_count INTEGER NOT NULL DEFAULT 0
  `);
  await queryable.query(`
    CREATE TABLE IF NOT EXISTS price_update_history_items (
      id BIGSERIAL PRIMARY KEY,
      price_update_history_id INTEGER NOT NULL REFERENCES price_update_history(id) ON DELETE RESTRICT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      previous_cost NUMERIC NOT NULL,
      previous_sale_price NUMERIC NOT NULL,
      new_cost NUMERIC NOT NULL,
      new_sale_price NUMERIC NOT NULL,
      reverted_at TIMESTAMP WITH TIME ZONE,
      UNIQUE (price_update_history_id, product_id)
    )
  `);
  await queryable.query(`
    CREATE INDEX IF NOT EXISTS idx_price_update_items_history
      ON price_update_history_items (price_update_history_id, product_id)
  `);
};

const buildBulkFilters = (source: any, params: any[]) => {
  let where = " WHERE p.eliminado = 0";

  if (source.scope === "family" && source.family_id) {
    params.push(Number(source.family_id));
    where += ` AND p.family_id = $${params.length}`;
  } else if (source.scope === "company" && source.company) {
    params.push(String(source.company));
    where += ` AND p.company = $${params.length}`;
  } else if (source.scope === "manual" && source.product_id) {
    params.push(Number(source.product_id));
    where += ` AND p.id = $${params.length}`;
  }

  if (source.active_only === true || source.active_only === "true") {
    where += " AND p.estado = 'activo'";
  }

  return where;
};

const buildBulkFiltersSqlite = (source: any, params: any[]) => {
  let where = " WHERE p.eliminado = 0";

  if (source.scope === "family" && source.family_id) {
    where += " AND p.family_id = ?";
    params.push(Number(source.family_id));
  } else if (source.scope === "company" && source.company) {
    where += " AND p.company = ?";
    params.push(String(source.company));
  } else if (source.scope === "manual" && source.product_id) {
    where += " AND p.id = ?";
    params.push(Number(source.product_id));
  }

  if (source.active_only === true || source.active_only === "true") {
    where += " AND p.estado = 'activo'";
  }

  return where;
};

const assertPreviewSelectionStillMatches = (actualProducts: any[], expectedProductIds?: number[]) => {
  if (!expectedProductIds?.length) return;

  const actualIds = actualProducts.map((product) => Number(product.id)).sort((a, b) => a - b);
  const expectedIds = [...new Set(expectedProductIds.map(Number))].sort((a, b) => a - b);

  const selectionMatches =
    actualIds.length === expectedIds.length &&
    actualIds.every((id, index) => id === expectedIds[index]);

  if (!selectionMatches) {
    throw new AppError(
      "La selección de productos cambió después de generar la vista previa. Volvé a revisar antes de aplicar.",
      409
    );
  }
};

const getBulkPreview = async (req: any) => {
  const filters = {
    scope: String(req.query?.scope || "all"),
    family_id: req.query?.family_id,
    company: req.query?.company,
    product_id: req.query?.product_id,
    active_only: req.query?.active_only,
  };

  if (!isPostgresConfigured()) {
    const params: any[] = [];
    const where = buildBulkFiltersSqlite(filters, params);
    const products = db.prepare(`
      SELECT p.*, f.name AS family_name, c.name AS category_name
      FROM products p
      LEFT JOIN product_families f ON p.family_id = f.id
      LEFT JOIN product_categories c ON p.category_id = c.id
      ${where}
      ORDER BY p.name ASC
    `).all(...params);
    return products.map(mapProduct);
  }

  const pool = getPostgresPool();
  const params: any[] = [];
  const where = buildBulkFilters(filters, params);
  const result = await pool.query(
    `SELECT p.*, f.name AS family_name, c.name AS category_name
     FROM products p
     LEFT JOIN product_families f ON p.family_id = f.id
     LEFT JOIN product_categories c ON p.category_id = c.id
     ${where}
     ORDER BY p.name ASC`,
    params
  );

  return result.rows.map(mapProduct);
};

const applyBulkPriceUpdate = async (payload: z.infer<typeof bulkApplySchema>, userName: string) => {
  if (!isPostgresConfigured()) {
    ensurePriceHistoryTableSqlite();
    const updatedProducts: any[] = [];

    const transactionResult = db.transaction(() => {
      const params: any[] = [];
      const where = buildBulkFiltersSqlite(payload, params);
      const productsToUpdate = db.prepare(`SELECT p.id, p.cost, p.sale_price FROM products p ${where}`).all(...params) as any[];
      assertPreviewSelectionStillMatches(productsToUpdate, payload.expected_product_ids);

      if (productsToUpdate.length === 0) {
        throw new AppError("No hay productos para actualizar con el alcance seleccionado.", 400);
      }

      const historyInsert = db.prepare(`
        INSERT INTO price_update_history (
          usuario, alcance, tipo_cambio, valor, productos_afectados, reversion_version
        )
        VALUES (?, ?, ?, ?, ?, 1)
      `).run(
        payload.user_email || userName || "Sistema",
        `${payload.scope} (${payload.target_field})`,
        payload.change_type,
        payload.value,
        productsToUpdate.length
      );
      const historyId = Number(historyInsert.lastInsertRowid);

      for (const product of productsToUpdate) {
        const { newCost, newSalePrice } = calculateNewPrices({
          product,
          targetField: payload.target_field,
          changeType: payload.change_type,
          value: payload.value,
          updateSalePrice: payload.update_sale_price,
          newMargin: payload.new_margin,
        });

        db.prepare(`
          INSERT INTO price_update_history_items (
            price_update_history_id, product_id,
            previous_cost, previous_sale_price,
            new_cost, new_sale_price
          ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          historyId,
          product.id,
          product.cost,
          product.sale_price,
          newCost,
          newSalePrice
        );

        db.prepare("UPDATE products SET cost = ?, sale_price = ? WHERE id = ?").run(newCost, newSalePrice, product.id);
        const updated = db.prepare(`
          SELECT p.*, f.name AS family_name, c.name AS category_name
          FROM products p
          LEFT JOIN product_families f ON p.family_id = f.id
          LEFT JOIN product_categories c ON p.category_id = c.id
          WHERE p.id = ?
        `).get(product.id);
        updatedProducts.push(mapProduct(updated));
      }

      return { count: productsToUpdate.length, historyId };
    })();

    return { ...transactionResult, updatedProducts };
  }

  const pool = getPostgresPool();
  const client: any = await pool.connect();

  try {
    await client.query("BEGIN");
    await ensurePriceHistoryTablePg(client);

    const params: any[] = [];
    const where = buildBulkFilters(payload, params);
    const productsResult = await client.query(
      `SELECT p.id, p.cost, p.sale_price FROM products p ${where} ORDER BY p.id ASC FOR UPDATE`,
      params
    );

    assertPreviewSelectionStillMatches(productsResult.rows, payload.expected_product_ids);

    if (!productsResult.rowCount) {
      throw new AppError("No hay productos para actualizar con el alcance seleccionado.", 400);
    }

    const historyResult = await client.query(
      `INSERT INTO price_update_history (
         usuario, alcance, tipo_cambio, valor, productos_afectados, reversion_version
       )
       VALUES ($1, $2, $3, $4, $5, 1)
       RETURNING id`,
      [
        payload.user_email || userName || "Sistema",
        `${payload.scope} (${payload.target_field})`,
        payload.change_type,
        payload.value,
        productsResult.rows.length,
      ]
    );
    const historyId = Number(historyResult.rows[0].id);
    const updatedProducts: any[] = [];

    for (const product of productsResult.rows) {
      const { newCost, newSalePrice } = calculateNewPrices({
        product,
        targetField: payload.target_field,
        changeType: payload.change_type,
        value: payload.value,
        updateSalePrice: payload.update_sale_price,
        newMargin: payload.new_margin,
      });

      await client.query(
        `INSERT INTO price_update_history_items (
           price_update_history_id, product_id,
           previous_cost, previous_sale_price,
           new_cost, new_sale_price
         )
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [historyId, product.id, product.cost, product.sale_price, newCost, newSalePrice]
      );

      const updatedResult = await client.query(
        `UPDATE products
         SET cost = $1,
             sale_price = $2
         WHERE id = $3
         RETURNING id`,
        [newCost, newSalePrice, product.id]
      );

      const enrichedResult = await client.query(
        `SELECT p.*, f.name AS family_name, c.name AS category_name
         FROM products p
         LEFT JOIN product_families f ON p.family_id = f.id
         LEFT JOIN product_categories c ON p.category_id = c.id
         WHERE p.id = $1`,
        [updatedResult.rows[0].id]
      );

      updatedProducts.push(mapProduct(enrichedResult.rows[0]));
    }

    await client.query("COMMIT");

    return { count: productsResult.rows.length, historyId, updatedProducts };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const mapBulkHistory = (row: any) => ({
  id: toNumber(row.id),
  fecha: row.fecha,
  usuario: row.usuario,
  alcance: row.alcance,
  tipo_cambio: row.tipo_cambio,
  valor: toNumber(row.valor),
  productos_afectados: toNumber(row.productos_afectados),
  reversion_version: toNumber(row.reversion_version),
  reverted_at: row.reverted_at ?? null,
  reverted_by: row.reverted_by ?? null,
  revert_reason: row.revert_reason ?? null,
  reverted_count: toNumber(row.reverted_count),
  traced_products: toNumber(row.traced_products),
  can_revert:
    toNumber(row.reversion_version) === 1 &&
    !row.reverted_at &&
    toNumber(row.traced_products) === toNumber(row.productos_afectados),
});

const getBulkHistory = async () => {
  if (!isPostgresConfigured()) {
    ensurePriceHistoryTableSqlite();
    return db.prepare(`
      SELECT h.*, COUNT(i.id) AS traced_products
      FROM price_update_history h
      LEFT JOIN price_update_history_items i ON i.price_update_history_id = h.id
      GROUP BY h.id
      ORDER BY h.fecha DESC, h.id DESC
      LIMIT 50
    `).all().map(mapBulkHistory);
  }

  const pool = getPostgresPool();
  await ensurePriceHistoryTablePg(pool as any);
  const result = await pool.query(`
    SELECT h.*, COUNT(i.id)::int AS traced_products
    FROM price_update_history h
    LEFT JOIN price_update_history_items i ON i.price_update_history_id = h.id
    GROUP BY h.id
    ORDER BY h.fecha DESC, h.id DESC
    LIMIT 50
  `);
  return result.rows.map(mapBulkHistory);
};

export default async function handler(req: any, res: any) {
  const endpoint = getEndpoint(req);

  if (req.method === "GET" && endpoint === "bulk-price-preview") {
    const user = await requireProductPermission(req, res, "view");
    if (!user) return;

    try {
      const products = await getBulkPreview(req);
      return sendSuccess(res, products);
    } catch (error: any) {
      return sendError(res, error?.message || "Error al obtener vista previa", error?.statusCode || 400, error?.errors || []);
    }
  }

  if (req.method === "GET" && endpoint === "bulk-price-history") {
    const user = await requireProductPermission(req, res, "view");
    if (!user) return;

    try {
      const history = await getBulkHistory();
      return sendSuccess(res, history);
    } catch (error: any) {
      return sendError(res, error?.message || "Error al obtener historial", error?.statusCode || 400, error?.errors || []);
    }
  }

  if (req.method === "POST" && endpoint === "bulk-price-apply") {
    const user = await requireProductPermission(req, res, "edit");
    if (!user) return;

    const parsed = bulkApplySchema.safeParse(getBody(req));

    if (!parsed.success) {
      return sendError(
        res,
        "Validation failed",
        400,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        }))
      );
    }

    try {
      const result = await applyBulkPriceUpdate(parsed.data, user.userName || "Sistema");
      return sendSuccess(res, result, "Actualizacion masiva aplicada exitosamente");
    } catch (error: any) {
      return sendError(res, error?.message || "Error al aplicar cambio de precios", error?.statusCode || 400, error?.errors || []);
    }
  }

  if (req.method === "POST" && endpoint === "bulk-price-revert") {
    const user = await requireProductPermission(req, res, "edit");
    if (!user) return;

    const parsed = bulkRevertSchema.safeParse(getBody(req));
    if (!parsed.success) {
      return sendError(
        res,
        "Validation failed",
        400,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        }))
      );
    }

    try {
      const result = await bulkPriceReversalService.revert({
        historyId: parsed.data.history_id,
        motivo: parsed.data.motivo,
        usuario: user.userName || "Sistema",
      });
      return sendSuccess(res, result, "Cambio de precios revertido correctamente");
    } catch (error: any) {
      return sendError(res, error?.message || "Error al revertir cambio de precios", error?.statusCode || 400, error?.errors || []);
    }
  }

  if (req.method === "GET") {
    const user = await requireProductPermission(req, res, "view");
    if (!user) return;

    try {
      const activeOnly = String(req.query?.active_only || "").toLowerCase() === "true";
      const products = await ProductRepository.findAll({ activeOnly });
      return sendSuccess(res, products);
    } catch (error: any) {
      return sendError(res, error?.message || "Error al obtener productos", 400);
    }
  }

  if (req.method === "POST") {
    const user = await requireProductPermission(req, res, "create");
    if (!user) return;

    const parsed = productSchema.safeParse(getBody(req));

    if (!parsed.success) {
      return sendError(
        res,
        "Validation failed",
        400,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        }))
      );
    }

    const usuario = user.userName || "Sistema";

    try {
      if (!isPostgresConfigured()) {
        let newProduct: any;

        db.transaction(() => {
          newProduct = ProductRepository.create(parsed.data) as any;

          if (parsed.data.stock && parsed.data.stock > 0) {
            db.prepare(`
              INSERT INTO stock_movimientos (product_id, cantidad, costo_unitario, cantidad_restante, tipo_movimiento, usuario, motivo)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(newProduct.id, parsed.data.stock, getProductCostUnitPrice(parsed.data), parsed.data.stock, "ingreso", usuario, "Carga inicial");
          }
        })();

        return sendSuccess(res, newProduct, "Producto creado exitosamente", 201);
      }

      const pool = getPostgresPool();
      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        const newProduct = await ProductRepository.create(parsed.data, client);

        if (parsed.data.stock && parsed.data.stock > 0) {
          await client.query(
            `INSERT INTO stock_movimientos (product_id, cantidad, costo_unitario, cantidad_restante, tipo_movimiento, usuario, motivo)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [newProduct.id, parsed.data.stock, getProductCostUnitPrice(parsed.data), parsed.data.stock, "ingreso", usuario, "Carga inicial"]
          );
        }

        await client.query("COMMIT");
        return sendSuccess(res, newProduct, "Producto creado exitosamente", 201);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } catch (error: any) {
      return sendError(res, error?.message || "Error al crear el producto", error?.statusCode || 400, error?.errors || []);
    }
  }

  return sendError(res, "Method not allowed", 405);
}
