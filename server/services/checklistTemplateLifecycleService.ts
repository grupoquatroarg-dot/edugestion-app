import { getPostgresPool, isPostgresConfigured } from "../utils/postgres.js";
import { AppError } from "../utils/response.js";

export type ChecklistTemplateLifecycleAction = "deactivate" | "reactivate";

type TransactionClient = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

type LifecycleInput = {
  templateId: number;
  action: ChecklistTemplateLifecycleAction;
  motivo: string;
  usuario: string;
};

const normalize = (value: unknown) => String(value ?? "").trim();

const validateInput = ({ templateId, motivo }: LifecycleInput) => {
  if (!Number.isInteger(templateId) || templateId <= 0) {
    throw new AppError("ID de plantilla inválido", 400);
  }

  const reason = normalize(motivo);
  if (reason.length < 3) {
    throw new AppError("El motivo es obligatorio y debe tener al menos 3 caracteres", 400);
  }
  if (reason.length > 500) {
    throw new AppError("El motivo no puede superar los 500 caracteres", 400);
  }

  return reason;
};

const assertTransition = (template: any, action: ChecklistTemplateLifecycleAction) => {
  if (!template) throw new AppError("Plantilla no encontrada", 404);
  const active = Number(template.active ?? 0) === 1;

  if (action === "deactivate" && !active) {
    throw new AppError("La plantilla ya está dada de baja", 409);
  }
  if (action === "reactivate" && active) {
    throw new AppError("La plantilla ya está activa", 409);
  }

  return active ? "activa" : "inactiva";
};

const handleSqlite = async ({ templateId, action, motivo, usuario }: LifecycleInput) => {
  const reason = validateInput({ templateId, action, motivo, usuario });
  const performedBy = normalize(usuario) || "Sistema";
  const { default: db } = await import("../db.js");

  return db.transaction(() => {
    const template = db.prepare("SELECT * FROM checklist_templates WHERE id = ? LIMIT 1").get(templateId) as any;
    const previousStatus = assertTransition(template, action);
    const items = db.prepare(
      "SELECT id, template_id, task_name FROM checklist_template_items WHERE template_id = ? ORDER BY id ASC"
    ).all(templateId);
    const usage = db.prepare("SELECT COUNT(*) AS total FROM checklists WHERE template_id = ?").get(templateId) as any;
    const nextStatus = action === "deactivate" ? "inactiva" : "activa";
    const snapshot = JSON.stringify({ template, items, checklists_count: Number(usage?.total || 0) });

    db.prepare(`
      INSERT INTO checklist_template_status_history (
        template_id, action, reason, performed_by, previous_status, new_status, snapshot
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(templateId, action, reason, performedBy, previousStatus, nextStatus, snapshot);

    if (action === "deactivate") {
      db.prepare(`
        UPDATE checklist_templates
        SET active = 0,
            deactivated_at = CURRENT_TIMESTAMP,
            deactivated_by = ?,
            deactivation_reason = ?,
            reactivated_at = NULL,
            reactivated_by = NULL,
            reactivation_reason = NULL
        WHERE id = ?
      `).run(performedBy, reason, templateId);
    } else {
      db.prepare(`
        UPDATE checklist_templates
        SET active = 1,
            deactivated_at = NULL,
            deactivated_by = NULL,
            deactivation_reason = NULL,
            reactivated_at = CURRENT_TIMESTAMP,
            reactivated_by = ?,
            reactivation_reason = ?
        WHERE id = ?
      `).run(performedBy, reason, templateId);
    }

    return db.prepare("SELECT * FROM checklist_templates WHERE id = ? LIMIT 1").get(templateId);
  })();
};

const handlePostgres = async (
  { templateId, action, motivo, usuario }: LifecycleInput,
  executor?: TransactionClient
) => {
  const reason = validateInput({ templateId, action, motivo, usuario });
  const performedBy = normalize(usuario) || "Sistema";
  const ownsTransaction = !executor;
  const pool = executor ? null : getPostgresPool();
  const client = executor || (await pool!.connect());

  try {
    if (ownsTransaction) await client.query("BEGIN");

    const templateResult = await client.query(
      `SELECT *
       FROM checklist_templates
       WHERE id = $1
       LIMIT 1
       FOR UPDATE`,
      [templateId]
    );
    if (!templateResult.rowCount) throw new AppError("Plantilla no encontrada", 404);

    const template = templateResult.rows[0];
    const previousStatus = assertTransition(template, action);
    const itemsResult = await client.query(
      `SELECT id, template_id, task_name
       FROM checklist_template_items
       WHERE template_id = $1
       ORDER BY id ASC`,
      [templateId]
    );
    const usageResult = await client.query(
      `SELECT COUNT(*)::int AS total
       FROM checklists
       WHERE template_id = $1`,
      [templateId]
    );
    const nextStatus = action === "deactivate" ? "inactiva" : "activa";
    const snapshot = JSON.stringify({
      template,
      items: itemsResult.rows,
      checklists_count: Number(usageResult.rows[0]?.total || 0),
    });

    const historyResult = await client.query(
      `INSERT INTO checklist_template_status_history (
         template_id, action, reason, performed_by, previous_status, new_status, snapshot
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       RETURNING id, performed_at`,
      [templateId, action, reason, performedBy, previousStatus, nextStatus, snapshot]
    );

    const performedAt = historyResult.rows[0]?.performed_at || new Date().toISOString();
    const updateResult = action === "deactivate"
      ? await client.query(
          `UPDATE checklist_templates
           SET active = 0,
               deactivated_at = $1,
               deactivated_by = $2,
               deactivation_reason = $3,
               reactivated_at = NULL,
               reactivated_by = NULL,
               reactivation_reason = NULL
           WHERE id = $4
           RETURNING *`,
          [performedAt, performedBy, reason, templateId]
        )
      : await client.query(
          `UPDATE checklist_templates
           SET active = 1,
               deactivated_at = NULL,
               deactivated_by = NULL,
               deactivation_reason = NULL,
               reactivated_at = $1,
               reactivated_by = $2,
               reactivation_reason = $3
           WHERE id = $4
           RETURNING *`,
          [performedAt, performedBy, reason, templateId]
        );

    if (ownsTransaction) await client.query("COMMIT");
    return {
      template: updateResult.rows[0],
      history: historyResult.rows[0],
    };
  } catch (error) {
    if (ownsTransaction) await client.query("ROLLBACK");
    throw error;
  } finally {
    if (ownsTransaction && "release" in client && typeof (client as any).release === "function") {
      (client as any).release();
    }
  }
};

export const checklistTemplateLifecycleService = {
  async changeStatus(input: LifecycleInput, executor?: TransactionClient) {
    if (executor || isPostgresConfigured()) return handlePostgres(input, executor);
    const template = await handleSqlite(input);
    return { template, history: null };
  },
};
