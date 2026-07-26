import { Router } from "express";
import db from "../db.js";
import { requireAuth, requirePermission } from "../middleware/authMiddleware.js";
import { sendSuccess, sendError } from "../utils/response.js";
import { getBusinessDate } from "../utils/businessDate.js";
import { routeLifecycleService } from "../services/routeLifecycleService.js";

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
  const today = getBusinessDate();
  const route = db.prepare("SELECT * FROM routes WHERE date = ? AND COALESCE(status, 'planificada') <> 'cancelada' ORDER BY id DESC LIMIT 1").get(today) as any;
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
    const info = db.prepare("INSERT INTO routes (name, date, status) VALUES (?, ?, 'planificada')").run(name, date);
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
  const { status, notes, visitado, venta_registrada, pedido_generado, cobranza_realizada } = req.body;

  try {
    db.transaction(() => {
      const routeItem = db.prepare(`
        SELECT ri.id, ri.route_id, r.status AS route_status
        FROM route_items ri
        JOIN routes r ON r.id = ri.route_id
        WHERE ri.id = ?
        LIMIT 1
      `).get(id) as any;

      if (!routeItem) throw new Error("El ítem de ruta no existe");
      const routeStatus = String(routeItem.route_status || "planificada").toLowerCase();
      if (["cancelada", "finalizada"].includes(routeStatus)) {
        throw new Error(`La ruta está ${routeStatus} y no admite cambios`);
      }

      const fields: string[] = [];
      const params: any[] = [];
      if (status !== undefined) { fields.push("status = ?"); params.push(status); }
      if (notes !== undefined) { fields.push("notes = ?"); params.push(notes); }
      if (visitado !== undefined) { fields.push("visitado = ?"); params.push(visitado ? 1 : 0); }
      if (venta_registrada !== undefined) { fields.push("venta_registrada = ?"); params.push(venta_registrada ? 1 : 0); }
      if (pedido_generado !== undefined) { fields.push("pedido_generado = ?"); params.push(pedido_generado ? 1 : 0); }
      if (cobranza_realizada !== undefined) { fields.push("cobranza_realizada = ?"); params.push(cobranza_realizada ? 1 : 0); }
      if (visitado !== undefined || ["visitado", "pedido tomado", "venta realizada"].includes(String(status || ""))) {
        fields.push("visited_at = CURRENT_TIMESTAMP");
      }

      if (fields.length > 0) {
        params.push(id);
        db.prepare(`UPDATE route_items SET ${fields.join(", ")} WHERE id = ?`).run(...params);
        db.prepare(`UPDATE routes SET status = 'en curso' WHERE id = ? AND status IN ('planificada', 'pendiente')`).run(routeItem.route_id);
      }
    })();
    return sendSuccess(res, null, "Item de ruta actualizado");
  } catch (error: any) {
    return sendError(res, error?.message || "No se pudo actualizar el ítem de ruta", 409);
  }
});

router.patch("/:id", requireAuth, requirePermission('routes', 'edit'), (req, res) => {
  const routeId = Number(req.params.id);
  const nextStatus = String(req.body?.status || "").trim().toLowerCase();
  if (!routeId) return sendError(res, "ID de ruta inválido", 400);
  if (!["planificada", "pendiente", "en curso", "finalizada"].includes(nextStatus)) {
    return sendError(res, "Estado de ruta inválido", 400);
  }

  try {
    db.transaction(() => {
      const route = db.prepare("SELECT id, status FROM routes WHERE id = ? LIMIT 1").get(routeId) as any;
      if (!route) throw new Error("Ruta no encontrada");
      const currentStatus = String(route.status || "planificada").toLowerCase();
      if (currentStatus === "cancelada") throw new Error("La ruta está cancelada. Debe reabrirse antes de modificarla");
      if (currentStatus === "finalizada") throw new Error("La ruta ya está finalizada");
      db.prepare("UPDATE routes SET status = ? WHERE id = ?").run(nextStatus, routeId);
    })();
    return sendSuccess(res, null, "Ruta actualizada");
  } catch (error: any) {
    return sendError(res, error?.message || "No se pudo actualizar la ruta", 409);
  }
});

router.post("/:id/cancel", requireAuth, requirePermission('routes', 'delete'), async (req: any, res) => {
  try {
    const result = await routeLifecycleService.changeStatus({
      routeId: Number(req.params.id),
      action: "cancel",
      motivo: String(req.body?.motivo || ""),
      usuario: req.user?.userName || req.user?.name || "Sistema",
    });
    return sendSuccess(res, result, "Ruta cancelada correctamente");
  } catch (error: any) {
    return sendError(res, error?.message || "No se pudo cancelar la ruta", error?.statusCode || 400);
  }
});

router.post("/:id/reopen", requireAuth, requirePermission('routes', 'edit'), async (req: any, res) => {
  try {
    const result = await routeLifecycleService.changeStatus({
      routeId: Number(req.params.id),
      action: "reopen",
      motivo: String(req.body?.motivo || ""),
      usuario: req.user?.userName || req.user?.name || "Sistema",
    });
    return sendSuccess(res, result, "Ruta reabierta correctamente");
  } catch (error: any) {
    return sendError(res, error?.message || "No se pudo reabrir la ruta", error?.statusCode || 400);
  }
});

router.delete("/:id", requireAuth, requirePermission('routes', 'delete'), (_req, res) =>
  sendError(
    res,
    "La eliminación física de rutas está deshabilitada. Usá Cancelar para conservar el historial.",
    409
  )
);

export default router;
