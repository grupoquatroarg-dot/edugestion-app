import { Router } from "express";
import db from "../db.js";
import { requireAuth, requirePermission } from "../middleware/authMiddleware.js";
import { sendSuccess, sendError } from "../utils/response.js";

const router = Router();

router.get("/", requireAuth, requirePermission('routes', 'view'), (req, res) => {
  const routes = db.prepare("SELECT * FROM routes ORDER BY date DESC").all() as any[];
  const routesWithItems = routes.map(route => {
    const items = db.prepare(`
      SELECT ri.*, c.nombre_apellido as client_name, c.direccion, c.latitud, c.longitud
      FROM route_items ri
      JOIN clientes c ON ri.client_id = c.id
      WHERE ri.route_id = ?
    `).all(route.id);
    return { ...route, items };
  });
  return sendSuccess(res, routesWithItems);
});

router.get("/today", requireAuth, requirePermission('routes', 'view'), (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const route = db.prepare("SELECT * FROM routes WHERE date = ?").get(today) as any;
  if (!route) return sendSuccess(res, null, "No hay ruta para hoy");
  const items = db.prepare(`
    SELECT ri.*, c.nombre_apellido as client_name, c.direccion, c.latitud, c.longitud
    FROM route_items ri
    JOIN clientes c ON ri.client_id = c.id
    WHERE ri.route_id = ?
  `).all(route.id);
  return sendSuccess(res, { ...route, items });
});

router.post("/", requireAuth, requirePermission('routes', 'create'), (req, res) => {
  const { name, date, clientIds } = req.body;
  let routeId: number | bigint;
  db.transaction(() => {
    const info = db.prepare("INSERT INTO routes (name, date) VALUES (?, ?)").run(name, date);
    routeId = info.lastInsertRowid;
    const insertItem = db.prepare("INSERT INTO route_items (route_id, client_id, order_index) VALUES (?, ?, ?)");
    clientIds.forEach((clientId: number, index: number) => {
      insertItem.run(routeId, clientId, index);
    });
  })();
  return sendSuccess(res, { id: routeId! }, "Ruta creada exitosamente", 201);
});

router.patch("/items/:id", requireAuth, requirePermission('routes', 'edit'), (req, res) => {
  const { id } = req.params;
  const { visitado, venta_registrada, pedido_generado, cobranza_realizada } = req.body;
  const fields = [];
  const params = [];
  if (visitado !== undefined) { fields.push("visitado = ?"); params.push(visitado ? 1 : 0); }
  if (venta_registrada !== undefined) { fields.push("venta_registrada = ?"); params.push(venta_registrada ? 1 : 0); }
  if (pedido_generado !== undefined) { fields.push("pedido_generado = ?"); params.push(pedido_generado ? 1 : 0); }
  if (cobranza_realizada !== undefined) { fields.push("cobranza_realizada = ?"); params.push(cobranza_realizada ? 1 : 0); }
  
  if (fields.length > 0) {
    params.push(id);
    db.prepare(`UPDATE route_items SET ${fields.join(", ")} WHERE id = ?`).run(...params);
  }
  return sendSuccess(res, null, "Item de ruta actualizado");
});

export default router;
