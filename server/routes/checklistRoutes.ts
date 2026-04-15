import { Router } from "express";
import db from "../db.js";
import { requireAuth, requirePermission } from "../middleware/authMiddleware.js";
import { sendSuccess, sendError } from "../utils/response.js";

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

router.put("/checklist-templates/:id", requireAuth, requirePermission('checklist', 'edit'), (req, res) => {
  const { id } = req.params;
  const { name, description, type, items } = req.body;
  db.transaction(() => {
    db.prepare("UPDATE checklist_templates SET name = ?, description = ?, type = ? WHERE id = ?").run(name, description, type, id);
    db.prepare("DELETE FROM checklist_template_items WHERE template_id = ?").run(id);
    const insertItem = db.prepare("INSERT INTO checklist_template_items (template_id, task_name) VALUES (?, ?)");
    for (const taskName of items) {
      insertItem.run(id, taskName);
    }
  })();
  return sendSuccess(res, null, "Template actualizado exitosamente");
});

router.patch("/checklist-templates/:id/status", requireAuth, requirePermission('checklist', 'edit'), (req, res) => {
  const { id } = req.params;
  const { active } = req.body;
  db.prepare("UPDATE checklist_templates SET active = ? WHERE id = ?").run(active, id);
  return sendSuccess(res, null, "Estado del template actualizado");
});

router.delete("/checklist-templates/:id", requireAuth, requirePermission('checklist', 'delete'), (req, res) => {
  db.prepare("DELETE FROM checklist_templates WHERE id = ?").run(req.params.id);
  return sendSuccess(res, null, "Template eliminado exitosamente");
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
  const today = new Date().toISOString().split('T')[0];
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
    const info = db.prepare("INSERT INTO checklists (template_id, date, notes) VALUES (?, ?, ?)").run(template_id, date, notes);
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
  const { status, notes } = req.body;
  const completedAt = status === 'completado' ? new Date().toISOString() : null;
  db.prepare("UPDATE checklists SET status = ?, notes = ?, completed_at = ? WHERE id = ?").run(status, notes || '', completedAt, id);
  return sendSuccess(res, null, "Checklist actualizado");
});

router.patch("/checklist-items/:id", requireAuth, requirePermission('checklist', 'edit'), (req, res) => {
  const { id } = req.params;
  const { completed, completed_by } = req.body;
  const completedAt = completed ? new Date().toISOString() : null;
  db.prepare("UPDATE checklist_items SET completed = ?, completed_at = ?, completed_by = ? WHERE id = ?").run(completed, completedAt, completed_by, id);
  return sendSuccess(res, null, "Item de checklist actualizado");
});

router.get("/checklist/summary", requireAuth, requirePermission('checklist', 'view'), (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  
  // Clients in route for today
  const routeClients = (db.prepare("SELECT COUNT(*) as count FROM route_items ri JOIN routes r ON ri.route_id = r.id WHERE r.date = ?").get(today) as any)?.count || 0;
  
  // Pending money (accounts receivable)
  const pendingMoney = (db.prepare("SELECT SUM(monto_pendiente) as total FROM sales WHERE estado != 'Pagada'").get() as any)?.total || 0;
  
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
