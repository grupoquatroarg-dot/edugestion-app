import express from "express";
import db from "../db.js";
import { ProductRepository } from "../repositories/productRepository.js";
import { requireAuth, requirePermission } from "../middleware/authMiddleware.js";
import { validate } from "../middleware/validate.js";
import { z } from "zod";
import { sendSuccess, sendError } from "../utils/response.js";

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

router.get("/", requireAuth, requirePermission('products', 'view'), (req, res) => {
  try {
    const products = ProductRepository.findAll();
    sendSuccess(res, products);
  } catch (error) {
    throw error;
  }
});

router.post("/", requireAuth, requirePermission('products', 'create'), validate(productSchema), (req, res) => {
  try {
    const usuario = (req as any).user?.userName || 'Sistema';
    let newProduct: any;
    
    db.transaction(() => {
      newProduct = ProductRepository.create(req.body);
      
      // If initial stock is provided, record a movement
      if (req.body.stock && req.body.stock > 0) {
        db.prepare(`
          INSERT INTO stock_movimientos (product_id, cantidad, costo_unitario, cantidad_restante, tipo_movimiento, usuario, motivo)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(newProduct.id, req.body.stock, req.body.cost, req.body.stock, 'ingreso', usuario, 'Carga inicial');
      }
    })();

    sendSuccess(res, newProduct, "Producto creado exitosamente", 201);
  } catch (error: any) {
    sendError(res, error.message || "Error al crear el producto", 400);
  }
});

router.put("/:id", requireAuth, requirePermission('products', 'edit'), validate(productSchema), (req, res) => {
  try {
    const updatedProduct = ProductRepository.update(Number(req.params.id), req.body);
    sendSuccess(res, updatedProduct, "Producto actualizado exitosamente");
  } catch (error) {
    throw error;
  }
});

router.post("/:id/stock", requireAuth, requirePermission('products', 'edit'), validate(z.object({
  body: z.object({
    cantidad: z.number().min(1, "La cantidad debe ser al menos 1"),
    costo_unitario: z.number().min(0, "El costo no puede ser negativo"),
    notes: z.string().optional(),
  })
})), (req, res) => {
  const { id } = req.params;
  const { cantidad, costo_unitario, notes } = req.body;
  const usuario = (req as any).user?.userName || 'Sistema';

  try {
    db.transaction(() => {
      db.prepare("UPDATE products SET stock = stock + ? WHERE id = ?").run(cantidad, id);
      db.prepare(`
        INSERT INTO stock_movimientos (product_id, cantidad, costo_unitario, cantidad_restante, tipo_movimiento, usuario, motivo)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, cantidad, costo_unitario, cantidad, 'ingreso', usuario, notes || 'Carga de stock');
    })();
    sendSuccess(res, null, "Stock actualizado exitosamente");
  } catch (error: any) {
    sendError(res, error.message || "Error al actualizar stock", 400);
  }
});

router.delete("/:id", requireAuth, requirePermission('products', 'delete'), (req, res) => {
  const productId = Number(req.params.id);
  try {
    const hasSales = ProductRepository.hasSales(productId);
    if (hasSales) {
      return sendError(res, "No se puede eliminar el producto porque tiene ventas asociadas. Intente marcarlo como 'Inactivo' en su lugar.", 400);
    }
    ProductRepository.softDelete(productId);
    sendSuccess(res, null, "Producto eliminado exitosamente");
  } catch (error) {
    throw error;
  }
});

router.post("/:id/min-stock", requireAuth, requirePermission('products', 'edit'), validate(z.object({
  body: z.object({
    stock_minimo: z.number().min(0, "El stock mínimo no puede ser negativo"),
  })
})), (req, res) => {
  const { id } = req.params;
  const { stock_minimo } = req.body;
  try {
    db.prepare("UPDATE products SET stock_minimo = ? WHERE id = ?").run(stock_minimo, id);
    sendSuccess(res, null, "Stock mínimo actualizado exitosamente");
  } catch (error) {
    throw error;
  }
});

router.post("/:id/expire", requireAuth, requirePermission('products', 'edit'), validate(z.object({
  body: z.object({
    cantidad: z.number().min(1, "La cantidad debe ser al menos 1"),
    notes: z.string().optional(),
  })
})), (req, res) => {
  const { id } = req.params;
  const { cantidad, notes } = req.body;
  const usuario = (req as any).user?.userName || 'Sistema';

  try {
    db.transaction(() => {
      const product = db.prepare("SELECT stock FROM products WHERE id = ?").get(id) as any;
      if (!product) {
        throw new Error("Producto no encontrado");
      }

      if (product.stock < cantidad) {
        throw new Error("Stock insuficiente para realizar la merma");
      }

      db.prepare("UPDATE products SET stock = stock - ? WHERE id = ?").run(cantidad, id);
      
      db.prepare(`
        INSERT INTO stock_movimientos (product_id, tipo_movimiento, cantidad, motivo, usuario, fecha_ingreso)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(id, 'egreso', cantidad, notes || 'Merma/Vencimiento', usuario);
    })();
    
    sendSuccess(res, null, "Merma registrada exitosamente");
  } catch (error: any) {
    sendError(res, error.message || "Error al registrar la merma", 400);
  }
});

export default router;
