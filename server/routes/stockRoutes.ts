import { Router } from "express";
import db from "../db.js";
import { requirePermission } from "../middleware/authMiddleware.js";
import { sendSuccess, sendError } from "../utils/response.js";

const router = Router();

router.get("/movimientos", requirePermission('products', 'view'), (req, res) => {
  const movimientos = db.prepare(`
    SELECT sm.*, p.name as product_name, p.codigo_unico
    FROM stock_movimientos sm
    JOIN products p ON sm.product_id = p.id
    ORDER BY sm.fecha_ingreso DESC
  `).all();
  return sendSuccess(res, movimientos);
});

router.post("/movimientos", requirePermission('products', 'edit'), (_req, res) => {
  return sendError(
    res,
    "La carga directa de movimientos está deshabilitada. Usá Cargar stock o Registrar merma para conservar la trazabilidad.",
    405
  );
});

export default router;
