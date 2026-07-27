import { Router } from "express";
import db from "../db.js";
import { requirePermission } from "../middleware/authMiddleware.js";
import { getIo } from "../socket.js";
import { bulkPriceReversalService } from "../services/bulkPriceReversalService.js";
import { AppError, sendError, sendSuccess } from "../utils/response.js";

const router = Router();

const toNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const ensurePriceHistoryTables = () => {
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

const buildWhere = (source: any, params: any[]) => {
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

const calculateNewPrices = (product: any, body: any) => {
  let newCost = toNumber(product.cost);
  let newSalePrice = toNumber(product.sale_price);
  const value = toNumber(body.value);

  if (body.target_field === "cost") {
    if (body.change_type === "increase_pct") newCost *= 1 + value / 100;
    else if (body.change_type === "decrease_pct") newCost *= 1 - value / 100;
    else if (body.change_type === "increase_fixed") newCost += value;
    else if (body.change_type === "decrease_fixed") newCost -= value;

    if (body.update_sale_price) {
      const margin = toNumber(body.new_margin) / 100;
      if (margin < 1) newSalePrice = newCost / (1 - margin);
    }
  } else {
    if (body.change_type === "increase_pct") newSalePrice *= 1 + value / 100;
    else if (body.change_type === "decrease_pct") newSalePrice *= 1 - value / 100;
    else if (body.change_type === "increase_fixed") newSalePrice += value;
    else if (body.change_type === "decrease_fixed") newSalePrice -= value;
    else if (body.change_type === "replace_margin" || body.change_type === "recalculate_peps") {
      const margin = value / 100;
      if (margin < 1) newSalePrice = newCost / (1 - margin);
    }
  }

  return {
    newCost: Math.max(0, Number(newCost.toFixed(2))),
    newSalePrice: Math.max(0, Number(newSalePrice.toFixed(2))),
  };
};

router.get("/preview", requirePermission("products", "view"), (req, res) => {
  const params: any[] = [];
  const where = buildWhere(req.query, params);
  const products = db.prepare(`
    SELECT p.*, f.name AS family_name, c.name AS category_name
    FROM products p
    LEFT JOIN product_families f ON p.family_id = f.id
    LEFT JOIN product_categories c ON p.category_id = c.id
    ${where}
    ORDER BY p.name ASC
  `).all(...params);
  return sendSuccess(res, products);
});

router.post("/apply", requirePermission("products", "edit"), (req: any, res) => {
  try {
    ensurePriceHistoryTables();
    const body = req.body || {};
    const numericValue = Number(body.value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      throw new AppError("El valor del cambio debe ser mayor a cero", 400);
    }

    const updatedProducts: any[] = [];
    const transactionResult = db.transaction(() => {
      const params: any[] = [];
      const where = buildWhere(body, params);
      const products = db.prepare(`
        SELECT p.id, p.cost, p.sale_price
        FROM products p
        ${where}
        ORDER BY p.id ASC
      `).all(...params) as any[];

      if (!products.length) throw new AppError("No hay productos para actualizar", 400);

      if (Array.isArray(body.expected_product_ids) && body.expected_product_ids.length) {
        const actual = products.map((product) => Number(product.id)).sort((a, b) => a - b);
        const expected = Array.from(new Set<number>((body.expected_product_ids as unknown[]).map((value) => Number(value)))).sort((a, b) => a - b);
        if (actual.length !== expected.length || actual.some((id, index) => id !== expected[index])) {
          throw new AppError("La selección cambió después de la vista previa. Volvé a revisar.", 409);
        }
      }

      const history = db.prepare(`
        INSERT INTO price_update_history (
          usuario, alcance, tipo_cambio, valor, productos_afectados, reversion_version
        ) VALUES (?, ?, ?, ?, ?, 1)
      `).run(
        req.user?.name || body.user_email || "Sistema",
        `${body.scope} (${body.target_field})`,
        body.change_type,
        numericValue,
        products.length
      );
      const historyId = Number(history.lastInsertRowid);

      for (const product of products) {
        const { newCost, newSalePrice } = calculateNewPrices(product, body);
        db.prepare(`
          INSERT INTO price_update_history_items (
            price_update_history_id, product_id,
            previous_cost, previous_sale_price,
            new_cost, new_sale_price
          ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(historyId, product.id, product.cost, product.sale_price, newCost, newSalePrice);

        db.prepare("UPDATE products SET cost = ?, sale_price = ? WHERE id = ?")
          .run(newCost, newSalePrice, product.id);
        updatedProducts.push(db.prepare(`
          SELECT p.*, f.name AS family_name, c.name AS category_name
          FROM products p
          LEFT JOIN product_families f ON p.family_id = f.id
          LEFT JOIN product_categories c ON p.category_id = c.id
          WHERE p.id = ?
        `).get(product.id));
      }

      return { count: products.length, historyId };
    })();

    updatedProducts.forEach((product) => getIo().emit("product_updated", product));
    return sendSuccess(res, { ...transactionResult, updatedProducts }, "Actualización masiva aplicada exitosamente");
  } catch (error: any) {
    return sendError(res, error?.message || "Error al aplicar cambio de precios", error?.statusCode || 400);
  }
});

router.post("/:id/revert", requirePermission("products", "edit"), async (req: any, res) => {
  try {
    ensurePriceHistoryTables();
    const result = await bulkPriceReversalService.revert({
      historyId: Number(req.params.id),
      motivo: String(req.body?.motivo || ""),
      usuario: req.user?.name || "Sistema",
    });
    result.products.forEach((product) => getIo().emit("product_updated", product));
    return sendSuccess(res, result, "Cambio de precios revertido correctamente");
  } catch (error: any) {
    return sendError(res, error?.message || "Error al revertir cambio de precios", error?.statusCode || 400);
  }
});

router.get("/history", requirePermission("products", "view"), (_req, res) => {
  ensurePriceHistoryTables();
  const history = db.prepare(`
    SELECT h.*, COUNT(i.id) AS traced_products
    FROM price_update_history h
    LEFT JOIN price_update_history_items i ON i.price_update_history_id = h.id
    GROUP BY h.id
    ORDER BY h.fecha DESC, h.id DESC
    LIMIT 50
  `).all().map((row: any) => ({
    ...row,
    can_revert:
      Number(row.reversion_version || 0) === 1 &&
      !row.reverted_at &&
      Number(row.traced_products || 0) === Number(row.productos_afectados || 0),
  }));
  return sendSuccess(res, history);
});

export default router;
