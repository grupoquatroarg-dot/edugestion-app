import { Router } from "express";
import db from "../db.js";
import { requirePermission } from "../middleware/authMiddleware.js";
import { validate } from "../middleware/validate.js";
import { z } from "zod";
import { sendSuccess } from "../utils/response.js";

const router = Router();

const nameSchema = z.object({
  body: z.object({
    name: z.string().min(2, "Nombre demasiado corto"),
    description: z.string().optional(),
    estado: z.string().optional(),
    category_id: z.number().optional(),
    tipo: z.string().optional(),
    activo: z.number().optional(),
  }),
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
router.get("/product-families", requirePermission('settings', 'view'), (req, res) => {
  const families = db.prepare("SELECT * FROM product_families ORDER BY name ASC").all();
  return sendSuccess(res, families);
});

router.get("/families", requirePermission('settings', 'view'), (req, res) => {
  const families = db.prepare("SELECT * FROM product_families ORDER BY name ASC").all();
  return sendSuccess(res, families);
});

router.post("/product-families", requirePermission('settings', 'create'), validate(nameSchema), (req, res) => {
  const { name, category_id } = req.body;
  const info = db.prepare("INSERT INTO product_families (name, category_id) VALUES (?, ?)").run(name, category_id || null);
  return sendSuccess(res, { id: info.lastInsertRowid, name, category_id }, "Familia creada", 201);
});

router.put("/product-families/:id", requirePermission('settings', 'edit'), validate(nameSchema), (req, res) => {
  const { id } = req.params;
  const { name, category_id } = req.body;
  db.prepare("UPDATE product_families SET name = ?, category_id = ? WHERE id = ?").run(name, category_id || null, id);
  return sendSuccess(res, null, "Familia actualizada");
});

router.delete("/product-families/:id", requirePermission('settings', 'delete'), (req, res) => {
  const { id } = req.params;
  db.prepare("DELETE FROM product_families WHERE id = ?").run(id);
  return sendSuccess(res, null, "Familia eliminada");
});

// Categories
router.get("/product-categories", requirePermission('settings', 'view'), (req, res) => {
  const activeOnly = req.query.active === 'true';
  let query = "SELECT * FROM product_categories";
  if (activeOnly) {
    query += " WHERE estado = 'activo'";
  }
  query += " ORDER BY name ASC";
  
  const categories = db.prepare(query).all();
  return sendSuccess(res, categories);
});

router.post("/product-categories", requirePermission('settings', 'create'), validate(nameSchema), (req, res) => {
  const { name, description } = req.body;
  const info = db.prepare("INSERT INTO product_categories (name, description) VALUES (?, ?)").run(name, description || null);
  return sendSuccess(res, { id: info.lastInsertRowid, name, description }, "Categoría creada", 201);
});

router.put("/product-categories/:id", requirePermission('settings', 'edit'), validate(nameSchema), (req, res) => {
  const { name, description, estado } = req.body;
  db.prepare("UPDATE product_categories SET name = ?, description = ?, estado = ? WHERE id = ?")
    .run(name, description || null, estado || 'activo', req.params.id);
  return sendSuccess(res, null, "Categoría actualizada");
});

router.delete("/product-categories/:id", requirePermission('settings', 'delete'), (req, res) => {
  db.prepare("DELETE FROM product_categories WHERE id = ?").run(req.params.id);
  return sendSuccess(res, null, "Categoría eliminada");
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
