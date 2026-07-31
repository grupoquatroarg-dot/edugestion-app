import express from "express";
import db from "../db.js";
import { ProductRepository } from "../repositories/productRepository.js";
import { requireAuth, requirePermission } from "../middleware/authMiddleware.js";
import { validate } from "../middleware/validate.js";
import { z } from "zod";
import { sendSuccess, sendError, AppError } from "../utils/response.js";
import { getPostgresPool, isPostgresConfigured } from "../utils/postgres.js";
import { productLifecycleService } from "../services/productLifecycleService.js";
import { inventoryMovementCancellationService } from "../services/inventoryMovementCancellationService.js";
import { productContentLifecycleService } from "../services/productContentLifecycleService.js";

const router = express.Router();

const productSchema = z.object({
  body: z.object({
    code: z.string().min(1, "El código es requerido"),
    name: z.string().min(2, "El nombre debe tener al menos 2 caracteres"),
    description: z.string().optional().nullable(),
    cost: z.number().min(0, "El costo no puede ser negativo"),
    sale_price: z.number().min(0, "El precio de venta no puede ser negativo"),
    stock: z.number().min(0, "El stock no puede ser negativo").optional(),
    stock_minimo: z.number().min(0, "El stock mínimo no puede ser negativo").optional(),
    company: z.enum(["Edu", "Peti"]),
    family_id: z.number().nullable(),
    category_id: z.number().nullable(),
    estado: z.enum(["activo", "inactivo"]).optional(),
  }),
});

const productContentSchema = z.object({
  body: productSchema.shape.body.extend({
    motivo: z.string().trim().min(3, "El motivo debe tener al menos 3 caracteres").max(500),
    expectedContentVersion: z.number().int().min(0, "Versión de contenido inválida"),
  }),
});

const stockSchema = z.object({
  body: z.object({
    cantidad: z.number().min(1, "La cantidad debe ser al menos 1"),
    costo_unitario: z.number().min(0, "El costo no puede ser negativo"),
    notes: z.string().optional(),
  })
});

const minStockSchema = z.object({
  body: z.object({
    stock_minimo: z.number().min(0, "El stock mínimo no puede ser negativo"),
  })
});

const expireSchema = z.object({
  body: z.object({
    cantidad: z.number().min(1, "La cantidad debe ser al menos 1"),
    notes: z.string().optional(),
  })
});

const lifecycleSchema = z.object({
  body: z.object({
    motivo: z.string().trim().min(3, "El motivo debe tener al menos 3 caracteres").max(500),
  }),
});

const inventoryCancellationSchema = z.object({
  body: z.object({
    motivo: z.string().trim().min(3, "El motivo debe tener al menos 3 caracteres").max(500),
  }),
});

router.get("/", requireAuth, requirePermission('products', 'view'), async (req, res) => {
  const activeOnly = String(req.query.active_only || "").toLowerCase() === "true";
  const products = await ProductRepository.findAll({ activeOnly });
  return sendSuccess(res, products);
});

router.post("/", requireAuth, requirePermission('products', 'create'), validate(productSchema), async (req, res) => {
  const usuario = (req as any).user?.userName || 'Sistema';

  try {
    if (!isPostgresConfigured()) {
      let newProduct: any;

      db.transaction(() => {
        newProduct = ProductRepository.create({ ...req.body, estado: 'activo' }) as any;

        if (req.body.stock && req.body.stock > 0) {
          db.prepare(`
            INSERT INTO stock_movimientos (product_id, cantidad, costo_unitario, cantidad_restante, tipo_movimiento, usuario, motivo)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(newProduct.id, req.body.stock, req.body.cost, req.body.stock, 'ingreso', usuario, 'Carga inicial');
        }
      })();

      return sendSuccess(res, newProduct, "Producto creado exitosamente", 201);
    }

    const pool = getPostgresPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const newProduct = await ProductRepository.create({ ...req.body, estado: 'activo' }, client);

      if (req.body.stock && req.body.stock > 0) {
        await client.query(
          `INSERT INTO stock_movimientos (product_id, cantidad, costo_unitario, cantidad_restante, tipo_movimiento, usuario, motivo)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [newProduct.id, req.body.stock, req.body.cost, req.body.stock, 'ingreso', usuario, 'Carga inicial']
        );
      }

      await client.query('COMMIT');
      return sendSuccess(res, newProduct, "Producto creado exitosamente", 201);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error: any) {
    return sendError(res, error.message || "Error al crear el producto", error.statusCode || 400, error.errors || []);
  }
});

router.get("/:id/inventory-history", requireAuth, requirePermission('products', 'view'), async (req, res) => {
  try {
    const result = await inventoryMovementCancellationService.list(Number(req.params.id));
    return sendSuccess(res, result);
  } catch (error: any) {
    return sendError(res, error?.message || "No se pudo obtener el historial de inventario", error?.statusCode || 400, error?.errors || []);
  }
});

router.post(
  "/:id/inventory-movements/:movementId/revert",
  requireAuth,
  requirePermission('products', 'edit'),
  validate(inventoryCancellationSchema),
  async (req, res) => {
    try {
      const result = await inventoryMovementCancellationService.cancel({
        productId: Number(req.params.id),
        movementId: Number(req.params.movementId),
        motivo: req.body.motivo,
        usuario: (req as any).user?.userName || "Sistema",
      });
      return sendSuccess(res, result, "Movimiento de inventario anulado correctamente");
    } catch (error: any) {
      return sendError(res, error?.message || "No se pudo anular el movimiento", error?.statusCode || 400, error?.errors || []);
    }
  }
);

router.put("/:id", requireAuth, requirePermission('products', 'edit'), validate(productContentSchema), async (req, res) => {
  try {
    const updatedProduct = await productContentLifecycleService.update({
      productId: Number(req.params.id),
      code: req.body.code,
      name: req.body.name,
      description: req.body.description,
      cost: req.body.cost,
      salePrice: req.body.sale_price,
      stockMinimum: req.body.stock_minimo,
      company: req.body.company,
      familyId: req.body.family_id,
      categoryId: req.body.category_id,
      motivo: req.body.motivo,
      usuario: (req as any).user?.userName || "Sistema",
      expectedContentVersion: req.body.expectedContentVersion,
    });
    return sendSuccess(res, updatedProduct, "Producto actualizado con trazabilidad");
  } catch (error: any) {
    return sendError(res, error.message || "Error al actualizar el producto", error.statusCode || 400, error.errors || []);
  }
});

router.post("/:id/stock", requireAuth, requirePermission('products', 'edit'), validate(stockSchema), async (req, res) => {
  const productId = Number(req.params.id);
  const { cantidad, costo_unitario, notes } = req.body;
  const usuario = (req as any).user?.userName || 'Sistema';

  try {
    if (!isPostgresConfigured()) {
      db.transaction(() => {
        const product = db.prepare("SELECT id, estado FROM products WHERE id = ? AND eliminado = 0").get(productId) as any;
        if (!product) throw new AppError("Producto no encontrado", 404);
        if (String(product.estado || "activo").toLowerCase() !== "activo") {
          throw new AppError("El producto está inactivo. Reactivalo antes de modificar su inventario.", 409);
        }

        db.prepare("UPDATE products SET stock = stock + ? WHERE id = ?").run(cantidad, productId);
        db.prepare(`
          INSERT INTO stock_movimientos (
            product_id, cantidad, costo_unitario, cantidad_restante, descripcion,
            tipo_movimiento, usuario, motivo, reversion_version
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
        `).run(productId, cantidad, costo_unitario, cantidad, notes || 'Carga de stock', 'ingreso', usuario, 'carga_stock');
      })();

      return sendSuccess(res, null, "Stock actualizado exitosamente");
    }

    const pool = getPostgresPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const existing = await client.query(
        "SELECT id, estado FROM products WHERE id = $1 AND eliminado = 0 LIMIT 1 FOR UPDATE",
        [productId]
      );

      if (!existing.rowCount) {
        throw new AppError("Producto no encontrado", 404);
      }
      if (String(existing.rows[0]?.estado || "activo").toLowerCase() !== "activo") {
        throw new AppError("El producto está inactivo. Reactivalo antes de modificar su inventario.", 409);
      }

      await client.query("UPDATE products SET stock = stock + $1 WHERE id = $2", [cantidad, productId]);
      await client.query(
        `INSERT INTO stock_movimientos (
           product_id, cantidad, costo_unitario, cantidad_restante, descripcion,
           tipo_movimiento, usuario, motivo, reversion_version
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1)`,
        [productId, cantidad, costo_unitario, cantidad, notes || 'Carga de stock', 'ingreso', usuario, 'carga_stock']
      );

      await client.query('COMMIT');
      return sendSuccess(res, null, "Stock actualizado exitosamente");
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error: any) {
    return sendError(res, error.message || "Error al actualizar stock", error.statusCode || 400, error.errors || []);
  }
});

router.post(
  "/:id/deactivate",
  requireAuth,
  requirePermission('products', 'delete'),
  validate(lifecycleSchema),
  async (req, res) => {
    try {
      const result = await productLifecycleService.changeStatus({
        productId: Number(req.params.id),
        action: "deactivate",
        motivo: req.body.motivo,
        usuario: (req as any).user?.userName || "Sistema",
      });
      return sendSuccess(res, result, "Producto dado de baja correctamente");
    } catch (error: any) {
      return sendError(res, error.message || "No se pudo dar de baja el producto", error.statusCode || 400, error.errors || []);
    }
  }
);

router.post(
  "/:id/reactivate",
  requireAuth,
  requirePermission('products', 'delete'),
  validate(lifecycleSchema),
  async (req, res) => {
    try {
      const result = await productLifecycleService.changeStatus({
        productId: Number(req.params.id),
        action: "reactivate",
        motivo: req.body.motivo,
        usuario: (req as any).user?.userName || "Sistema",
      });
      return sendSuccess(res, result, "Producto reactivado correctamente");
    } catch (error: any) {
      return sendError(res, error.message || "No se pudo reactivar el producto", error.statusCode || 400, error.errors || []);
    }
  }
);

router.delete("/:id", requireAuth, requirePermission('products', 'delete'), async (_req, res) => {
  return sendError(
    res,
    "La eliminación física de productos está deshabilitada. Usá la opción Dar de baja.",
    405
  );
});

router.post("/:id/min-stock", requireAuth, requirePermission('products', 'edit'), validate(minStockSchema), async (req, res) => {
  const productId = Number(req.params.id);
  const { stock_minimo } = req.body;

  try {
    if (!isPostgresConfigured()) {
      const product = db.prepare("SELECT id, estado FROM products WHERE id = ? AND eliminado = 0").get(productId) as any;
      if (!product) throw new AppError("Producto no encontrado", 404);
      if (String(product.estado || "activo").toLowerCase() !== "activo") {
        throw new AppError("El producto está inactivo. Reactivalo antes de modificar su inventario.", 409);
      }

      db.prepare("UPDATE products SET stock_minimo = ? WHERE id = ?").run(stock_minimo, productId);
      return sendSuccess(res, null, "Stock mínimo actualizado exitosamente");
    }

    const pool = getPostgresPool();
    const result = await pool.query(
      `UPDATE products
       SET stock_minimo = $1
       WHERE id = $2
         AND eliminado = 0
         AND estado = 'activo'
       RETURNING id`,
      [stock_minimo, productId]
    );
    if (!result.rowCount) {
      throw new AppError("Producto no encontrado o inactivo", 409);
    }
    return sendSuccess(res, null, "Stock mínimo actualizado exitosamente");
  } catch (error: any) {
    return sendError(res, error.message || "Error al actualizar stock mínimo", error.statusCode || 400, error.errors || []);
  }
});

router.post("/:id/expire", requireAuth, requirePermission('products', 'edit'), validate(expireSchema), async (req, res) => {
  const productId = Number(req.params.id);
  const { cantidad, notes } = req.body;
  const usuario = (req as any).user?.userName || 'Sistema';

  try {
    if (!isPostgresConfigured()) {
      db.transaction(() => {
        const product = db.prepare("SELECT stock, cost, estado FROM products WHERE id = ? AND eliminado = 0").get(productId) as any;
        if (!product) {
          throw new AppError("Producto no encontrado", 404);
        }
        if (String(product.estado || "activo").toLowerCase() !== "activo") {
          throw new AppError("El producto está inactivo. Reactivalo antes de modificar su inventario.", 409);
        }

        if (Number(product.stock) < cantidad) {
          throw new AppError("Stock insuficiente para realizar la merma", 400);
        }

        db.prepare("UPDATE products SET stock = stock - ? WHERE id = ?").run(cantidad, productId);
        db.prepare(`
          INSERT INTO stock_movimientos (
            product_id, tipo_movimiento, cantidad, costo_unitario, cantidad_restante,
            descripcion, motivo, usuario, fecha_ingreso, reversion_version
          ) VALUES (?, ?, ?, ?, 0, ?, 'merma', ?, CURRENT_TIMESTAMP, 1)
        `).run(productId, 'egreso', cantidad, Number(product.cost || 0), notes || 'Merma/Vencimiento', usuario);
      })();

      return sendSuccess(res, null, "Merma registrada exitosamente");
    }

    const pool = getPostgresPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const productResult = await client.query(
        "SELECT stock, cost, estado FROM products WHERE id = $1 AND eliminado = 0 LIMIT 1 FOR UPDATE",
        [productId]
      );

      if (!productResult.rowCount) {
        throw new AppError("Producto no encontrado", 404);
      }

      if (String(productResult.rows[0]?.estado || "activo").toLowerCase() !== "activo") {
        throw new AppError("El producto está inactivo. Reactivalo antes de modificar su inventario.", 409);
      }

      const currentStock = Number(productResult.rows[0].stock || 0);
      if (currentStock < cantidad) {
        throw new AppError("Stock insuficiente para realizar la merma", 400);
      }

      await client.query("UPDATE products SET stock = stock - $1 WHERE id = $2", [cantidad, productId]);
      await client.query(
        `INSERT INTO stock_movimientos (
           product_id, tipo_movimiento, cantidad, costo_unitario, cantidad_restante,
           descripcion, motivo, usuario, reversion_version
         ) VALUES ($1, $2, $3, $4, 0, $5, 'merma', $6, 1)`,
        [productId, 'egreso', cantidad, Number(productResult.rows[0]?.cost || 0), notes || 'Merma/Vencimiento', usuario]
      );

      await client.query('COMMIT');
      return sendSuccess(res, null, "Merma registrada exitosamente");
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error: any) {
    return sendError(res, error.message || "Error al registrar la merma", error.statusCode || 400, error.errors || []);
  }
});

export default router;
