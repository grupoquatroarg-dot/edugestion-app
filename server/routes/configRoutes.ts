import { Router } from "express";
import db from "../db.js";
import { requirePermission } from "../middleware/authMiddleware.js";
import { validate } from "../middleware/validate.js";
import { z } from "zod";
import { sendSuccess, sendError } from "../utils/response.js";
import { getPostgresPool, isPostgresConfigured } from "../utils/postgres.js";

const router = Router();

const nameSchema = z.object({
  body: z.object({
    name: z.string().min(2, "Nombre demasiado corto"),
    description: z.string().optional(),
    estado: z.string().optional(),
    category_id: z.number().optional().nullable(),
    tipo: z.string().optional(),
    activo: z.number().optional(),
  }),
});

const mapCategory = (row: any) => ({
  id: Number(row.id),
  name: row.name,
  description: row.description,
  estado: row.estado,
});

const mapFamily = (row: any) => ({
  id: Number(row.id),
  name: row.name,
  category_id: row.category_id === null || row.category_id === undefined ? null : Number(row.category_id),
  estado: row.estado,
});

// Settings
router.get("/settings", requirePermission('settings', 'view'), (req, res) => {
  const settings = db.prepare("SELECT * FROM settings").all();
  const settingsMap = settings.reduce((acc: any, curr: any) => {
    acc[curr.key] = curr.value;
    return acc;
  }, {});
  return sendSuccess(res, settingsMap);
});

router.post("/settings", requirePermission('settings', 'create'), (req, res) => {
  const settings = req.body;
  const upsert = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");

  const transaction = db.transaction((data) => {
    for (const [key, value] of Object.entries(data)) {
      upsert.run(key, String(value));
    }
  });

  transaction(settings);
  return sendSuccess(res, null, "Configuración guardada");
});

// Product Families
router.get("/product-families", requirePermission('settings', 'view'), async (req, res) => {
  if (!isPostgresConfigured()) {
    const families = db.prepare("SELECT * FROM product_families ORDER BY name ASC").all();
    return sendSuccess(res, families);
  }

  try {
    const pool = getPostgresPool();
    const result = await pool.query("SELECT * FROM product_families ORDER BY name ASC");
    return sendSuccess(res, result.rows.map(mapFamily));
  } catch (error: any) {
    return sendError(res, error.message || "Error al obtener familias", 400);
  }
});

router.get("/families", requirePermission('settings', 'view'), async (req, res) => {
  if (!isPostgresConfigured()) {
    const families = db.prepare("SELECT * FROM product_families ORDER BY name ASC").all();
    return sendSuccess(res, families);
  }

  try {
    const pool = getPostgresPool();
    const result = await pool.query("SELECT * FROM product_families ORDER BY name ASC");
    return sendSuccess(res, result.rows.map(mapFamily));
  } catch (error: any) {
    return sendError(res, error.message || "Error al obtener familias", 400);
  }
});

router.post("/product-families", requirePermission('settings', 'create'), validate(nameSchema), async (req, res) => {
  const { name, category_id } = req.body;

  if (!isPostgresConfigured()) {
    const info = db.prepare("INSERT INTO product_families (name, category_id) VALUES (?, ?)").run(name, category_id || null);
    return sendSuccess(res, { id: info.lastInsertRowid, name, category_id: category_id || null }, "Familia creada", 201);
  }

  try {
    const pool = getPostgresPool();
    const result = await pool.query(
      `INSERT INTO product_families (name, category_id)
       VALUES ($1, $2)
       RETURNING id, name, category_id, estado`,
      [name, category_id || null]
    );

    return sendSuccess(res, mapFamily(result.rows[0]), "Familia creada", 201);
  } catch (error: any) {
    return sendError(res, error.message || "Error al crear familia", 400);
  }
});

router.put("/product-families/:id", requirePermission('settings', 'edit'), validate(nameSchema), async (req, res) => {
  const { id } = req.params;
  const { name, category_id } = req.body;

  if (!isPostgresConfigured()) {
    db.prepare("UPDATE product_families SET name = ?, category_id = ? WHERE id = ?").run(name, category_id || null, id);
    return sendSuccess(res, null, "Familia actualizada");
  }

  try {
    const pool = getPostgresPool();
    await pool.query(
      "UPDATE product_families SET name = $1, category_id = $2 WHERE id = $3",
      [name, category_id || null, Number(id)]
    );
    return sendSuccess(res, null, "Familia actualizada");
  } catch (error: any) {
    return sendError(res, error.message || "Error al actualizar familia", 400);
  }
});

router.delete("/product-families/:id", requirePermission('settings', 'delete'), async (req, res) => {
  const { id } = req.params;

  if (!isPostgresConfigured()) {
    db.prepare("DELETE FROM product_families WHERE id = ?").run(id);
    return sendSuccess(res, null, "Familia eliminada");
  }

  try {
    const pool = getPostgresPool();
    await pool.query("DELETE FROM product_families WHERE id = $1", [Number(id)]);
    return sendSuccess(res, null, "Familia eliminada");
  } catch (error: any) {
    return sendError(res, error.message || "Error al eliminar familia", 400);
  }
});

// Categories
router.get("/product-categories", requirePermission('settings', 'view'), async (req, res) => {
  const activeOnly = req.query.active === 'true';

  if (!isPostgresConfigured()) {
    let query = "SELECT * FROM product_categories";
    if (activeOnly) {
      query += " WHERE estado = 'activo'";
    }
    query += " ORDER BY name ASC";

    const categories = db.prepare(query).all();
    return sendSuccess(res, categories);
  }

  try {
    const pool = getPostgresPool();
    const result = activeOnly
      ? await pool.query("SELECT * FROM product_categories WHERE estado = 'activo' ORDER BY name ASC")
      : await pool.query("SELECT * FROM product_categories ORDER BY name ASC");

    return sendSuccess(res, result.rows.map(mapCategory));
  } catch (error: any) {
    return sendError(res, error.message || "Error al obtener categorías", 400);
  }
});

router.post("/product-categories", requirePermission('settings', 'create'), validate(nameSchema), async (req, res) => {
  const { name, description } = req.body;

  if (!isPostgresConfigured()) {
    const info = db.prepare("INSERT INTO product_categories (name, description) VALUES (?, ?)").run(name, description || null);
    return sendSuccess(res, { id: info.lastInsertRowid, name, description }, "Categoría creada", 201);
  }

  try {
    const pool = getPostgresPool();
    const result = await pool.query(
      `INSERT INTO product_categories (name, description)
       VALUES ($1, $2)
       RETURNING id, name, description, estado`,
      [name, description || null]
    );

    return sendSuccess(res, mapCategory(result.rows[0]), "Categoría creada", 201);
  } catch (error: any) {
    return sendError(res, error.message || "Error al crear categoría", 400);
  }
});

router.put("/product-categories/:id", requirePermission('settings', 'edit'), validate(nameSchema), async (req, res) => {
  const { name, description, estado } = req.body;

  if (!isPostgresConfigured()) {
    db.prepare("UPDATE product_categories SET name = ?, description = ?, estado = ? WHERE id = ?")
      .run(name, description || null, estado || 'activo', req.params.id);
    return sendSuccess(res, null, "Categoría actualizada");
  }

  try {
    const pool = getPostgresPool();
    await pool.query(
      "UPDATE product_categories SET name = $1, description = $2, estado = $3 WHERE id = $4",
      [name, description || null, estado || 'activo', Number(req.params.id)]
    );
    return sendSuccess(res, null, "Categoría actualizada");
  } catch (error: any) {
    return sendError(res, error.message || "Error al actualizar categoría", 400);
  }
});

router.delete("/product-categories/:id", requirePermission('settings', 'delete'), async (req, res) => {
  if (!isPostgresConfigured()) {
    db.prepare("DELETE FROM product_categories WHERE id = ?").run(req.params.id);
    return sendSuccess(res, null, "Categoría eliminada");
  }

  try {
    const pool = getPostgresPool();
    await pool.query("DELETE FROM product_categories WHERE id = $1", [Number(req.params.id)]);
    return sendSuccess(res, null, "Categoría eliminada");
  } catch (error: any) {
    return sendError(res, error.message || "Error al eliminar categoría", 400);
  }
});

// Payment Methods
router.get("/payment-methods", requirePermission('settings', 'view'), (req, res) => {
  const methods = db.prepare("SELECT * FROM payment_methods ORDER BY name ASC").all();
  return sendSuccess(res, methods);
});

router.post("/payment-methods", requirePermission('settings', 'create'), validate(nameSchema), (req, res) => {
  const { name, tipo } = req.body;
  const info = db.prepare("INSERT INTO payment_methods (name, tipo) VALUES (?, ?)").run(name, tipo || 'Efectivo');
  return sendSuccess(res, { id: info.lastInsertRowid, name, tipo }, "Método de pago creado", 201);
});

router.put("/payment-methods/:id", requirePermission('settings', 'edit'), validate(nameSchema), (req, res) => {
  const { name, tipo, activo } = req.body;
  db.prepare("UPDATE payment_methods SET name = ?, tipo = ?, activo = ? WHERE id = ?")
    .run(name, tipo || 'Efectivo', activo !== undefined ? activo : 1, req.params.id);
  return sendSuccess(res, null, "Método de pago actualizado");
});

router.delete("/payment-methods/:id", requirePermission('settings', 'delete'), (req, res) => {
  db.prepare("DELETE FROM payment_methods WHERE id = ?").run(req.params.id);
  return sendSuccess(res, null, "Método de pago eliminado");
});

export default router;
