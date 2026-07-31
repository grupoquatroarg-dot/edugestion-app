import { Router } from "express";
import db from "../db.js";
import { requireAuth, requirePermission } from "../middleware/authMiddleware.js";
import { sendSuccess, sendError } from "../utils/response.js";
import { getBusinessDate } from "../utils/businessDate.js";
import { checklistTemplateLifecycleService } from "../services/checklistTemplateLifecycleService.js";
import { checklistTemplateContentLifecycleService } from "../services/checklistTemplateContentLifecycleService.js";
import { checklistLifecycleService } from "../services/checklistLifecycleService.js";

const router = Router();

// --- Templates ---

router.get("/checklist-templates", requireAuth, requirePermission('checklist', 'view'), (req, res) => {
  const templates = db.prepare("SELECT * FROM checklist_templates ORDER BY created_at DESC").all();
  return sendSuccess(res, templates);
});

router.get("/checklist-templates/:id", requireAuth, requirePermission('checklist', 'view'), (req, res) => {
  const template = db.prepare("SELECT * FROM checklist_templates WHERE id = ?").get(req.params.id) as any;
  if (!template) return sendError(res, "Template not found", 404);
  const items = db.prepare("SELECT * FROM checklist_template_items WHERE template_id = ?").all(req.params.id);
  return sendSuccess(res, { ...template, items });
});

router.post("/checklist-templates", requireAuth, requirePermission('checklist', 'create'), (req, res) => {
  const { name, description, type, items } = req.body;
  db.transaction(() => {
    const info = db.prepare("INSERT INTO checklist_templates (name, description, type) VALUES (?, ?, ?)").run(name, description, type);
    const templateId = info.lastInsertRowid;
    const insertItem = db.prepare("INSERT INTO checklist_template_items (template_id, task_name) VALUES (?, ?)");
    for (const taskName of items) {
      insertItem.run(templateId, taskName);
    }
  })();
  return sendSuccess(res, null, "Template creado exitosamente", 201);
});

router.put("/checklist-templates/:id", requireAuth, requirePermission('checklist', 'edit'), async (req, res) => {
  try {
    const result = await checklistTemplateContentLifecycleService.update({
      templateId: Number(req.params.id),
      name: String(req.body?.name || ""),
      description: req.body?.description ?? null,
      type: req.body?.type || "General",
      items: Array.isArray(req.body?.items) ? req.body.items : [],
      motivo: String(req.body?.motivo || ""),
      usuario: (req as any).user?.userName || "Sistema",
      expectedContentVersion: Number(req.body?.expectedContentVersion),
    });
    return sendSuccess(res, result, "Plantilla actualizada exitosamente");
  } catch (error: any) {
    return sendError(res, error?.message || "Error al actualizar plantilla", error?.statusCode || 400);
  }
});

router.post(
  "/checklist-templates/:id/deactivate",
  requireAuth,
  requirePermission('checklist', 'delete'),
  async (req, res) => {
    try {
      const result = await checklistTemplateLifecycleService.changeStatus({
        templateId: Number(req.params.id),
        action: "deactivate",
        motivo: String(req.body?.motivo || ""),
        usuario: (req as any).user?.userName || "Sistema",
      });
      return sendSuccess(res, result, "Plantilla dada de baja correctamente");
    } catch (error: any) {
      return sendError(res, error?.message || "Error al dar de baja la plantilla", error?.statusCode || 400);
    }
  }
);

router.post(
  "/checklist-templates/:id/reactivate",
  requireAuth,
  requirePermission('checklist', 'edit'),
  async (req, res) => {
    try {
      const result = await checklistTemplateLifecycleService.changeStatus({
        templateId: Number(req.params.id),
        action: "reactivate",
        motivo: String(req.body?.motivo || ""),
        usuario: (req as any).user?.userName || "Sistema",
      });
      return sendSuccess(res, result, "Plantilla reactivada correctamente");
    } catch (error: any) {
      return sendError(res, error?.message || "Error al reactivar la plantilla", error?.statusCode || 400);
    }
  }
);

router.patch("/checklist-templates/:id/status", requireAuth, (_req, res) => {
  return sendError(
    res,
    "El estado de la plantilla debe cambiarse desde Dar de baja o Reactivar para conservar la auditoría.",
    405
  );
});

router.delete("/checklist-templates/:id", requireAuth, requirePermission('checklist', 'delete'), (_req, res) => {
  return sendError(res, "La eliminación física de plantillas está deshabilitada. Usá Dar de baja.", 405);
});

// --- Checklists ---

router.get("/checklists", requireAuth, requirePermission('checklist', 'view'), (req, res) => {
  const checklists = db.prepare(`
    SELECT c.*, t.name as template_name 
    FROM checklists c 
    JOIN checklist_templates t ON c.template_id = t.id 
    ORDER BY c.date DESC, c.created_at DESC
  `).all() as any[];
  
  const checklistsWithCounts = checklists.map(cl => {
    const counts = db.prepare(`
      SELECT 
        COUNT(*) as total, 
        SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) as completed 
      FROM checklist_items 
      WHERE checklist_id = ?
    `).get(cl.id) as any;
    return { 
      ...cl, 
      total_tasks: counts.total || 0, 
      completed_tasks: counts.completed || 0 
    };
  });
  
  return sendSuccess(res, checklistsWithCounts);
});

router.get("/checklists/today", requireAuth, requirePermission('checklist', 'view'), (req, res) => {
  const today = getBusinessDate();
  const checklists = db.prepare(`
    SELECT c.*, t.name as template_name 
    FROM checklists c 
    JOIN checklist_templates t ON c.template_id = t.id 
    WHERE c.date = ? AND c.status = 'pendiente'
  `).all(today) as any[];
  
  const checklistsWithItems = checklists.map(cl => {
    const items = db.prepare("SELECT * FROM checklist_items WHERE checklist_id = ?").all(cl.id);
    return { ...cl, items };
  });
  
  return sendSuccess(res, checklistsWithItems);
});

router.get("/checklists/:id", requireAuth, requirePermission('checklist', 'view'), (req, res) => {
  const checklist = db.prepare(`
    SELECT c.*, t.name as template_name 
    FROM checklists c 
    JOIN checklist_templates t ON c.template_id = t.id 
    WHERE c.id = ?
  `).get(req.params.id) as any;
  
  if (!checklist) return sendError(res, "Checklist not found", 404);
  
  const items = db.prepare("SELECT * FROM checklist_items WHERE checklist_id = ?").all(req.params.id);
  return sendSuccess(res, { ...checklist, items });
});

router.post("/checklists", requireAuth, requirePermission('checklist', 'create'), (req, res) => {
  const { template_id, date, notes } = req.body;
  let checklistId: number | bigint;
  db.transaction(() => {
    const template = db.prepare("SELECT id, active FROM checklist_templates WHERE id = ? LIMIT 1").get(template_id) as any;
    if (!template) throw new Error("Plantilla no encontrada");
    if (Number(template.active || 0) !== 1) {
      throw new Error("La plantilla está inactiva y no puede iniciar nuevos checklists.");
    }
    const info = db.prepare("INSERT INTO checklists (template_id, date, notes, status, lifecycle_version) VALUES (?, ?, ?, 'pendiente', 1)").run(template_id, date, notes);
    checklistId = info.lastInsertRowid;
    
    // Copy items from template
    const templateItems = db.prepare("SELECT task_name FROM checklist_template_items WHERE template_id = ?").all(template_id) as any[];
    const insertItem = db.prepare("INSERT INTO checklist_items (checklist_id, task_name) VALUES (?, ?)");
    for (const item of templateItems) {
      insertItem.run(checklistId, item.task_name);
    }
  })();
  return sendSuccess(res, { id: checklistId! }, "Checklist iniciado exitosamente", 201);
});

router.patch("/checklists/:id", requireAuth, requirePermission('checklist', 'edit'), (req, res) => {
  const { id } = req.params;
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'status')) {
    return sendError(res, "El estado debe cambiarse desde Finalizar, Cancelar o Reabrir", 405);
  }

  try {
    db.transaction(() => {
      const checklist = db.prepare("SELECT id, status FROM checklists WHERE id = ? LIMIT 1").get(id) as any;
      if (!checklist) throw Object.assign(new Error("Checklist no encontrado"), { statusCode: 404 });
      if (String(checklist.status || 'pendiente').toLowerCase() !== 'pendiente') {
        throw Object.assign(new Error("El checklist está cerrado. Reabrilo antes de editar sus notas."), { statusCode: 409 });
      }
      db.prepare("UPDATE checklists SET notes = COALESCE(?, notes) WHERE id = ?").run(req.body?.notes ?? null, id);
    })();
    return sendSuccess(res, null, "Checklist actualizado");
  } catch (error: any) {
    return sendError(res, error?.message || "Error al actualizar checklist", error?.statusCode || 400);
  }
});

const requireChecklistLifecyclePermission = (req: any, res: any, next: any) => {
  const action = String(req.body?.action || '');
  if (!['finalize', 'cancel', 'reopen'].includes(action)) {
    return sendError(res, "Acción de checklist inválida", 400);
  }
  return requirePermission('checklist', action === 'cancel' ? 'delete' : 'edit')(req, res, next);
};

router.post("/checklists/:id/lifecycle", requireChecklistLifecyclePermission, async (req, res) => {
  const action = String(req.body?.action || '') as 'finalize' | 'cancel' | 'reopen';
  try {
    const result = await checklistLifecycleService.changeStatus({
      checklistId: Number(req.params.id),
      action,
      motivo: String(req.body?.motivo || ''),
      usuario: (req as any).user?.userName || 'Sistema',
    });
    return sendSuccess(res, result, action === 'finalize' ? 'Checklist finalizado correctamente' : action === 'cancel' ? 'Checklist cancelado correctamente' : 'Checklist reabierto correctamente');
  } catch (error: any) {
    return sendError(res, error?.message || 'Error al cambiar el estado del checklist', error?.statusCode || 400);
  }
});

router.patch("/checklist-items/:id", requireAuth, requirePermission('checklist', 'edit'), (req, res) => {
  const { id } = req.params;
  const { completed, completed_by } = req.body;

  try {
    const result = db.transaction(() => {
      const current = db.prepare(`
        SELECT ci.id, ci.checklist_id, c.status
        FROM checklist_items ci
        JOIN checklists c ON c.id = ci.checklist_id
        WHERE ci.id = ?
        LIMIT 1
      `).get(id) as any;
      if (!current) throw Object.assign(new Error("Tarea de checklist no encontrada"), { statusCode: 404 });
      if (String(current.status || 'pendiente').toLowerCase() !== 'pendiente') {
        throw Object.assign(new Error("El checklist está cerrado. Reabrilo antes de modificar sus tareas."), { statusCode: 409 });
      }

      const completedFlag = completed ? 1 : 0;
      const completedAt = completedFlag ? new Date().toISOString() : null;
      db.prepare("UPDATE checklist_items SET completed = ?, completed_at = ?, completed_by = ? WHERE id = ?")
        .run(completedFlag, completedAt, completed_by || null, id);
      const item = db.prepare("SELECT * FROM checklist_items WHERE id = ?").get(id) as any;
      const counts = db.prepare(`
        SELECT COUNT(*) AS total_tasks,
               SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) AS completed_tasks
        FROM checklist_items WHERE checklist_id = ?
      `).get(current.checklist_id) as any;
      return { item, checklist: { id: Number(current.checklist_id), status: 'pendiente', completed_at: null, total_tasks: Number(counts?.total_tasks || 0), completed_tasks: Number(counts?.completed_tasks || 0) } };
    })();
    return sendSuccess(res, result, completed ? "Tarea marcada como completada" : "Tarea marcada como pendiente");
  } catch (error: any) {
    return sendError(res, error?.message || "Error al actualizar tarea", error?.statusCode || 400);
  }
});

router.get("/checklist/summary", requireAuth, requirePermission('checklist', 'view'), (req, res) => {
  const today = getBusinessDate();
  
  // Clients in route for today
  const routeClients = (db.prepare("SELECT COUNT(*) as count FROM route_items ri JOIN routes r ON ri.route_id = r.id WHERE r.date = ?").get(today) as any)?.count || 0;
  
  // Pending money (accounts receivable)
  const pendingMoney = (db.prepare("SELECT SUM(monto_pendiente) as total FROM sales WHERE monto_pendiente > 0 AND COALESCE(estado, '') <> 'Anulada'").get() as any)?.total || 0;
  
  // Critical stock
  const criticalStock = (db.prepare("SELECT COUNT(*) as count FROM products WHERE stock <= stock_minimo AND active = 1").get() as any)?.count || 0;
  
  // Pending supplier orders
  const pendingSupplierOrders = (db.prepare("SELECT COUNT(*) as count FROM supplier_orders WHERE estado = 'pendiente'").get() as any)?.count || 0;
  
  return sendSuccess(res, {
    routeClients,
    pendingMoney,
    criticalStock,
    pendingSupplierOrders
  });
});

export default router;
