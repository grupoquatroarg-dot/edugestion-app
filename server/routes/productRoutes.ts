import express from "express";
import db from "../db.js";
import { ProductRepository } from "../repositories/productRepository.js";
import { requireAuth, requirePermission } from "../middleware/authMiddleware.js";
import { validate } from "../middleware/validate.js";
import { z } from "zod";
import { sendSuccess, sendError, AppError } from "../utils/response.js";
import { getPostgresPool, isPostgresConfigured } from "../utils/postgres.js";

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

router.get("/", requireAuth, requirePermission('products', 'view'), async (req, res) => {
  const products = await ProductRepository.findAll();
  return sendSuccess(res, products);
});

router.post("/", requireAuth, requirePermission('products', 'create'), validate(productSchema), async (req, res) => {
  const usuario = (req as any).user?.userName || 'Sistema';

  try {
    if (!isPostgresConfigured()) {
      let newProduct: any;

      db.transaction(() => {
        newProduct = ProductRepository.create(req.body) as any;

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
      const newProduct = await ProductRepository.create(req.body, client);

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

router.put("/:id", requireAuth, requirePermission('products', 'edit'), validate(productSchema), async (req, res) => {
  try {
    const updatedProduct = await ProductRepository.update(Number(req.params.id), req.body);
    return sendSuccess(res, updatedProduct, "Producto actualizado exitosamente");
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
        db.prepare("UPDATE products SET stock = stock + ? WHERE id = ?").run(cantidad, productId);
        db.prepare(`
          INSERT INTO stock_movimientos (product_id, cantidad, costo_unitario, cantidad_restante, tipo_movimiento, usuario, motivo)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(productId, cantidad, costo_unitario, cantidad, 'ingreso', usuario, notes || 'Carga de stock');
      })();

      return sendSuccess(res, null, "Stock actualizado exitosamente");
    }

    const pool = getPostgresPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const existing = await client.query(
        "SELECT id FROM products WHERE id = $1 AND eliminado = 0 LIMIT 1",
        [productId]
      );

      if (!existing.rowCount) {
        throw new AppError("Producto no encontrado", 404);
      }

      await client.query("UPDATE products SET stock = stock + $1 WHERE id = $2", [cantidad, productId]);
      await client.query(
        `INSERT INTO stock_movimientos (product_id, cantidad, costo_unitario, cantidad_restante, tipo_movimiento, usuario, motivo)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [productId, cantidad, costo_unitario, cantidad, 'ingreso', usuario, notes || 'Carga de stock']
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

router.delete("/:id", requireAuth, requirePermission('products', 'delete'), async (req, res) => {
  const productId = Number(req.params.id);

  try {
    const hasSales = await ProductRepository.hasSales(productId);
    if (hasSales) {
      return sendError(res, "No se puede eliminar el producto porque tiene ventas asociadas. Intente marcarlo como 'Inactivo' en su lugar.", 400);
    }

    await ProductRepository.softDelete(productId);
    return sendSuccess(res, null, "Producto eliminado exitosamente");
  } catch (error: any) {
    return sendError(res, error.message || "Error al eliminar el producto", error.statusCode || 400, error.errors || []);
  }
});

router.post("/:id/min-stock", requireAuth, requirePermission('products', 'edit'), validate(minStockSchema), async (req, res) => {
  const productId = Number(req.params.id);
  const { stock_minimo } = req.body;

  try {
    if (!isPostgresConfigured()) {
      db.prepare("UPDATE products SET stock_minimo = ? WHERE id = ?").run(stock_minimo, productId);
      return sendSuccess(res, null, "Stock mínimo actualizado exitosamente");
    }

    const pool = getPostgresPool();
    await pool.query("UPDATE products SET stock_minimo = $1 WHERE id = $2", [stock_minimo, productId]);
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
        const product = db.prepare("SELECT stock FROM products WHERE id = ?").get(productId) as any;
        if (!product) {
          throw new AppError("Producto no encontrado", 404);
        }

        if (Number(product.stock) < cantidad) {
          throw new AppError("Stock insuficiente para realizar la merma", 400);
        }

        db.prepare("UPDATE products SET stock = stock - ? WHERE id = ?").run(cantidad, productId);
        db.prepare(`
          INSERT INTO stock_movimientos (product_id, tipo_movimiento, cantidad, motivo, usuario, fecha_ingreso)
          VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `).run(productId, 'egreso', cantidad, notes || 'Merma/Vencimiento', usuario);
      })();

      return sendSuccess(res, null, "Merma registrada exitosamente");
    }

    const pool = getPostgresPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const productResult = await client.query(
        "SELECT stock FROM products WHERE id = $1 AND eliminado = 0 LIMIT 1",
        [productId]
      );

      if (!productResult.rowCount) {
        throw new AppError("Producto no encontrado", 404);
      }

      const currentStock = Number(productResult.rows[0].stock || 0);
      if (currentStock < cantidad) {
        throw new AppError("Stock insuficiente para realizar la merma", 400);
      }

      await client.query("UPDATE products SET stock = stock - $1 WHERE id = $2", [cantidad, productId]);
      await client.query(
        `INSERT INTO stock_movimientos (product_id, tipo_movimiento, cantidad, motivo, usuario)
         VALUES ($1, $2, $3, $4, $5)`,
        [productId, 'egreso', cantidad, notes || 'Merma/Vencimiento', usuario]
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
