import { Router } from 'express';
import db from '../db.js';
import { requirePermission } from '../middleware/authMiddleware.js';
import { validate } from '../middleware/validate.js';
import { z } from 'zod';
import { sendSuccess, sendError } from '../utils/response.js';
import { getPostgresPool, isPostgresConfigured } from '../utils/postgres.js';
import {
  configurationItemLifecycleService,
  type ConfigurationItemType,
  type ConfigurationLifecycleAction,
} from '../services/configurationItemLifecycleService.js';
import {
  configurationItemContentLifecycleService,
  type ConfigurationContentItemType,
} from '../services/configurationItemContentLifecycleService.js';

const router = Router();
const PROTECTED_PAYMENT_NAMES = new Set(['Cta Cte', 'Cheque']);

const nameSchema = z.object({
  body: z.object({
    name: z.string().min(2, 'Nombre demasiado corto'),
    description: z.string().optional(),
    category_id: z.number().optional().nullable(),
    tipo: z.string().optional(),
    motivo: z.string().optional(),
    expectedContentVersion: z.number().int().min(0).optional(),
  }),
});

const lifecycleSchema = z.object({
  body: z.object({
    action: z.enum(['deactivate', 'reactivate']),
    motivo: z.string().trim().min(3, 'El motivo debe tener al menos 3 caracteres').max(500),
  }),
});

const mapCategory = (row: any) => ({
  id: Number(row.id),
  name: row.name,
  description: row.description || '',
  estado: row.estado || 'activo',
  deactivated_at: row.deactivated_at ?? null,
  deactivated_by: row.deactivated_by ?? null,
  deactivation_reason: row.deactivation_reason ?? null,
  content_version: Number(row.content_version || 0),
  content_changed_at: row.content_changed_at ?? null,
  content_changed_by: row.content_changed_by ?? null,
  content_change_reason: row.content_change_reason ?? null,
});

const mapFamily = (row: any) => ({
  id: Number(row.id),
  name: row.name,
  category_id: row.category_id === null || row.category_id === undefined ? null : Number(row.category_id),
  estado: row.estado || 'activo',
  category_name: row.category_name || null,
  deactivated_at: row.deactivated_at ?? null,
  deactivated_by: row.deactivated_by ?? null,
  deactivation_reason: row.deactivation_reason ?? null,
  content_version: Number(row.content_version || 0),
  content_changed_at: row.content_changed_at ?? null,
  content_changed_by: row.content_changed_by ?? null,
  content_change_reason: row.content_change_reason ?? null,
});

const mapPaymentMethod = (row: any) => ({
  id: Number(row.id),
  name: row.name,
  tipo: row.tipo || 'Efectivo',
  activo: Number(row.activo ?? 1),
  deactivated_at: row.deactivated_at ?? null,
  deactivated_by: row.deactivated_by ?? null,
  deactivation_reason: row.deactivation_reason ?? null,
  content_version: Number(row.content_version || 0),
  content_changed_at: row.content_changed_at ?? null,
  content_changed_by: row.content_changed_by ?? null,
  content_change_reason: row.content_change_reason ?? null,
});

const getActor = (req: any) => req.user?.userName || req.user?.email || 'Sistema';

const runLifecycle = (itemType: ConfigurationItemType) => async (req: any, res: any) => {
  try {
    const result = await configurationItemLifecycleService.changeStatus({
      itemType,
      itemId: Number(req.params.id),
      action: req.body.action as ConfigurationLifecycleAction,
      motivo: req.body.motivo,
      usuario: getActor(req),
    });
    return sendSuccess(
      res,
      result,
      req.body.action === 'deactivate' ? 'Elemento dado de baja correctamente' : 'Elemento reactivado correctamente'
    );
  } catch (error: any) {
    return sendError(res, error.message || 'No se pudo cambiar el estado', error.statusCode || 400, error.errors || []);
  }
};

const runContentUpdate = (itemType: ConfigurationContentItemType) => async (req: any, res: any) => {
  try {
    const result = await configurationItemContentLifecycleService.update({
      itemType,
      itemId: Number(req.params.id),
      name: req.body.name,
      tipo: req.body.tipo,
      description: req.body.description,
      categoryId: req.body.category_id,
      motivo: req.body.motivo,
      usuario: getActor(req),
      expectedContentVersion: Number(req.body.expectedContentVersion),
    });
    return sendSuccess(res, result, 'Elemento actualizado con trazabilidad');
  } catch (error: any) {
    return sendError(res, error.message || 'No se pudo actualizar la configuración', error.statusCode || 400, error.errors || []);
  }
};

const physicalDeleteDisabled = (_req: any, res: any) => sendError(
  res,
  'La eliminación física de elementos de configuración está deshabilitada. Usá Dar de baja.',
  405
);

// Settings
router.get('/settings', requirePermission('settings', 'view'), async (_req, res) => {
  if (!isPostgresConfigured()) {
    const settings = db.prepare('SELECT * FROM settings').all();
    const settingsMap = settings.reduce((acc: any, curr: any) => {
      acc[curr.key] = curr.value;
      return acc;
    }, {});
    return sendSuccess(res, settingsMap);
  }

  try {
    const result = await getPostgresPool().query('SELECT key, value FROM settings');
    const settingsMap = result.rows.reduce((acc: any, curr: any) => {
      acc[curr.key] = curr.value;
      return acc;
    }, {});
    return sendSuccess(res, settingsMap);
  } catch (error: any) {
    return sendError(res, error.message || 'Error al obtener configuración', 400);
  }
});

router.post('/settings', requirePermission('settings', 'create'), async (req, res) => {
  const settings = req.body;

  if (!isPostgresConfigured()) {
    const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    db.transaction((data) => {
      for (const [key, value] of Object.entries(data)) upsert.run(key, String(value));
    })(settings);
    return sendSuccess(res, null, 'Configuración guardada');
  }

  const client = await getPostgresPool().connect();
  try {
    await client.query('BEGIN');
    for (const [key, value] of Object.entries(settings)) {
      await client.query(
        `INSERT INTO settings (key, value)
         VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [key, String(value)]
      );
    }
    await client.query('COMMIT');
    return sendSuccess(res, null, 'Configuración guardada');
  } catch (error: any) {
    await client.query('ROLLBACK');
    return sendError(res, error.message || 'Error al guardar configuración', 400);
  } finally {
    client.release();
  }
});

// Product Families
const getFamilies = async (req: any, res: any) => {
  const activeOnly = req.query.active === 'true';

  if (!isPostgresConfigured()) {
    const query = activeOnly
      ? `SELECT f.*, c.name AS category_name
         FROM product_families f
         LEFT JOIN product_categories c ON f.category_id = c.id
         WHERE COALESCE(f.estado, 'activo') = 'activo'
           AND (f.category_id IS NULL OR COALESCE(c.estado, 'activo') = 'activo')
         ORDER BY f.name ASC`
      : `SELECT f.*, c.name AS category_name
         FROM product_families f
         LEFT JOIN product_categories c ON f.category_id = c.id
         ORDER BY f.name ASC`;
    return sendSuccess(res, db.prepare(query).all());
  }

  try {
    const result = await getPostgresPool().query(`
      SELECT f.*, c.name AS category_name
      FROM product_families f
      LEFT JOIN product_categories c ON f.category_id = c.id
      ${activeOnly ? "WHERE COALESCE(f.estado, 'activo') = 'activo' AND (f.category_id IS NULL OR COALESCE(c.estado, 'activo') = 'activo')" : ''}
      ORDER BY f.name ASC
    `);
    return sendSuccess(res, result.rows.map(mapFamily));
  } catch (error: any) {
    return sendError(res, error.message || 'Error al obtener familias', 400);
  }
};

router.get('/product-families', requirePermission('settings', 'view'), getFamilies);
router.get('/families', requirePermission('settings', 'view'), getFamilies);

router.post('/product-families', requirePermission('settings', 'create'), validate(nameSchema), async (req, res) => {
  const { name, category_id } = req.body;
  const categoryId = category_id || null;

  try {
    if (!isPostgresConfigured()) {
      if (categoryId) {
        const category = db.prepare("SELECT id FROM product_categories WHERE id = ? AND COALESCE(estado, 'activo') = 'activo' LIMIT 1").get(categoryId);
        if (!category) return sendError(res, 'La categoría seleccionada está inactiva o no existe', 409);
      }
      const info = db.prepare("INSERT INTO product_families (name, category_id, estado) VALUES (?, ?, 'activo')").run(name, categoryId);
      return sendSuccess(res, { id: info.lastInsertRowid, name, category_id: categoryId, estado: 'activo' }, 'Familia creada', 201);
    }

    const pool = getPostgresPool();
    if (categoryId) {
      const category = await pool.query("SELECT id FROM product_categories WHERE id = $1 AND COALESCE(estado, 'activo') = 'activo' LIMIT 1", [categoryId]);
      if (!category.rowCount) return sendError(res, 'La categoría seleccionada está inactiva o no existe', 409);
    }
    const result = await pool.query(
      `INSERT INTO product_families (name, category_id, estado)
       VALUES ($1, $2, 'activo')
       RETURNING *`,
      [name, categoryId]
    );
    return sendSuccess(res, mapFamily(result.rows[0]), 'Familia creada', 201);
  } catch (error: any) {
    return sendError(res, error.message || 'Error al crear familia', 400);
  }
});

router.put('/product-families/:id', requirePermission('settings', 'edit'), validate(nameSchema), runContentUpdate('product_family'));

router.post('/product-families/:id', requirePermission('settings', 'delete'), validate(lifecycleSchema), runLifecycle('product_family'));
router.delete('/product-families/:id', requirePermission('settings', 'delete'), physicalDeleteDisabled);

// Categories
router.get('/product-categories', requirePermission('settings', 'view'), async (req, res) => {
  const activeOnly = req.query.active === 'true';
  try {
    if (!isPostgresConfigured()) {
      const query = activeOnly
        ? "SELECT * FROM product_categories WHERE COALESCE(estado, 'activo') = 'activo' ORDER BY name ASC"
        : 'SELECT * FROM product_categories ORDER BY name ASC';
      return sendSuccess(res, db.prepare(query).all());
    }
    const result = activeOnly
      ? await getPostgresPool().query("SELECT * FROM product_categories WHERE COALESCE(estado, 'activo') = 'activo' ORDER BY name ASC")
      : await getPostgresPool().query('SELECT * FROM product_categories ORDER BY name ASC');
    return sendSuccess(res, result.rows.map(mapCategory));
  } catch (error: any) {
    return sendError(res, error.message || 'Error al obtener categorías', 400);
  }
});

router.post('/product-categories', requirePermission('settings', 'create'), validate(nameSchema), async (req, res) => {
  try {
    if (!isPostgresConfigured()) {
      const info = db.prepare("INSERT INTO product_categories (name, description, estado) VALUES (?, ?, 'activo')").run(req.body.name, req.body.description || null);
      return sendSuccess(res, { id: info.lastInsertRowid, name: req.body.name, description: req.body.description || '', estado: 'activo' }, 'Categoría creada', 201);
    }
    const result = await getPostgresPool().query(
      `INSERT INTO product_categories (name, description, estado)
       VALUES ($1, $2, 'activo') RETURNING *`,
      [req.body.name, req.body.description || null]
    );
    return sendSuccess(res, mapCategory(result.rows[0]), 'Categoría creada', 201);
  } catch (error: any) {
    return sendError(res, error.message || 'Error al crear categoría', 400);
  }
});

router.put('/product-categories/:id', requirePermission('settings', 'edit'), validate(nameSchema), runContentUpdate('product_category'));

router.post('/product-categories/:id', requirePermission('settings', 'delete'), validate(lifecycleSchema), runLifecycle('product_category'));
router.delete('/product-categories/:id', requirePermission('settings', 'delete'), physicalDeleteDisabled);

// Payment Methods
router.get('/payment-methods', requirePermission('settings', 'view'), async (req, res) => {
  const activeOnly = req.query.active === 'true';
  try {
    if (!isPostgresConfigured()) {
      const query = activeOnly
        ? 'SELECT * FROM payment_methods WHERE COALESCE(activo, 1) = 1 ORDER BY name ASC'
        : 'SELECT * FROM payment_methods ORDER BY name ASC';
      return sendSuccess(res, db.prepare(query).all());
    }
    const result = activeOnly
      ? await getPostgresPool().query('SELECT * FROM payment_methods WHERE COALESCE(activo, 1) = 1 ORDER BY name ASC')
      : await getPostgresPool().query('SELECT * FROM payment_methods ORDER BY name ASC');
    return sendSuccess(res, result.rows.map(mapPaymentMethod));
  } catch (error: any) {
    return sendError(res, error.message || 'Error al obtener métodos de pago', 400);
  }
});

router.post('/payment-methods', requirePermission('settings', 'create'), validate(nameSchema), async (req, res) => {
  try {
    if (!isPostgresConfigured()) {
      const info = db.prepare('INSERT INTO payment_methods (name, tipo, activo) VALUES (?, ?, 1)').run(req.body.name, req.body.tipo || 'Efectivo');
      return sendSuccess(res, { id: info.lastInsertRowid, name: req.body.name, tipo: req.body.tipo || 'Efectivo', activo: 1 }, 'Método de pago creado', 201);
    }
    const result = await getPostgresPool().query(
      `INSERT INTO payment_methods (name, tipo, activo)
       VALUES ($1, $2, 1) RETURNING *`,
      [req.body.name, req.body.tipo || 'Efectivo']
    );
    return sendSuccess(res, mapPaymentMethod(result.rows[0]), 'Método de pago creado', 201);
  } catch (error: any) {
    return sendError(res, error.message || 'Error al crear método de pago', 400);
  }
});

router.put('/payment-methods/:id', requirePermission('settings', 'edit'), validate(nameSchema), runContentUpdate('payment_method'));

router.post('/payment-methods/:id', requirePermission('settings', 'delete'), validate(lifecycleSchema), runLifecycle('payment_method'));
router.delete('/payment-methods/:id', requirePermission('settings', 'delete'), physicalDeleteDisabled);

export default router;
