import { Router } from "express";
import db from "../db.js";
import { requirePermission } from "../middleware/authMiddleware.js";
import { validate } from "../middleware/validate.js";
import { z } from "zod";
import { sendSuccess } from "../utils/response.js";

const router = Router();

const stockMovementSchema = z.object({
  body: z.object({
    product_id: z.number(),
    cantidad: z.number().int(),
    costo_unitario: z.number().nonnegative(),
    descripcion: z.string().optional(),
    tipo_movimiento: z.enum(['ingreso', 'egreso']),
    motivo: z.string().optional(),
  }),
});

router.get("/movimientos", requirePermission('products', 'view'), (req, res) => {
  const movimientos = db.prepare(`
    SELECT sm.*, p.name as product_name, p.codigo_unico
    FROM stock_movimientos sm
    JOIN products p ON sm.product_id = p.id
    ORDER BY sm.fecha_ingreso DESC
  `).all();
  return sendSuccess(res, movimientos);
});

router.post("/movimientos", requirePermission('products', 'edit'), validate(stockMovementSchema), (req, res) => {
  const { product_id, cantidad, costo_unitario, descripcion, tipo_movimiento, motivo } = req.body;
  const usuario = (req as any).user?.userName || 'Sistema';
  
  db.transaction(() => {
    db.prepare(`
      INSERT INTO stock_movimientos (product_id, cantidad, costo_unitario, cantidad_restante, descripcion, tipo_movimiento, motivo, usuario)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(product_id, cantidad, costo_unitario, cantidad, descripcion, tipo_movimiento, motivo, usuario);
    
    db.prepare("UPDATE products SET stock = stock + ? WHERE id = ?").run(cantidad, product_id);
  })();
  
  return sendSuccess(res, null, "Movimiento de stock registrado", 201);
});

export default router;
