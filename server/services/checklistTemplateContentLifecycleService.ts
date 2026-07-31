import { getPostgresPool, isPostgresConfigured } from "../utils/postgres.js";
import { AppError } from "../utils/response.js";

export type ChecklistTemplateContentInput = {
  templateId: number;
  name: string;
  description?: string | null;
  type?: "Apertura" | "Cierre" | "Ruta" | "General";
  items: string[];
  motivo: string;
  usuario: string;
  expectedContentVersion: number;
};

type TransactionClient = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

const ALLOWED_TYPES = new Set(["Apertura", "Cierre", "Ruta", "General"]);
const normalize = (value: unknown) => String(value ?? "").trim();
const toNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const validateInput = (input: ChecklistTemplateContentInput) => {
  if (!Number.isInteger(input.templateId) || input.templateId <= 0) {
    throw new AppError("ID de plantilla inválido", 400);
  }

  if (!Number.isInteger(input.expectedContentVersion) || input.expectedContentVersion < 0) {
    throw new AppError("Versión de contenido inválida", 400);
  }

  const reason = normalize(input.motivo);
  if (reason.length < 3) {
    throw new AppError("El motivo del cambio es obligatorio y debe tener al menos 3 caracteres", 400);
  }
  if (reason.length > 500) {
    throw new AppError("El motivo no puede superar los 500 caracteres", 400);
  }

  const name = normalize(input.name);
  if (name.length < 2) {
    throw new AppError("El nombre de la plantilla debe tener al menos 2 caracteres", 400);
  }
  if (name.length > 200) {
    throw new AppError("El nombre de la plantilla no puede superar los 200 caracteres", 400);
  }

  const description = normalize(input.description) || null;
  if ((description || "").length > 2000) {
    throw new AppError("La descripción no puede superar los 2000 caracteres", 400);
  }

  const type = normalize(input.type || "General");
  if (!ALLOWED_TYPES.has(type)) {
    throw new AppError("Tipo de plantilla inválido", 400);
  }

  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new AppError("La plantilla debe conservar al menos una tarea", 400);
  }
  if (input.items.length > 200) {
    throw new AppError("La plantilla no puede superar las 200 tareas", 400);
  }

  const seen = new Set<string>();
  const items = input.items.map((value, index) => {
    const taskName = normalize(value);
    if (!taskName) {
      throw new AppError(`La tarea ${index + 1} no puede estar vacía`, 400);
    }
    if (taskName.length > 500) {
      throw new AppError(`La tarea ${index + 1} no puede superar los 500 caracteres`, 400);
    }
    const key = taskName.toLocaleLowerCase("es-AR");
    if (seen.has(key)) {
      throw new AppError("Una tarea no puede repetirse dentro de la plantilla", 400);
    }
    seen.add(key);
    return taskName;
  });

  return {
    reason,
    user: normalize(input.usuario) || "Sistema",
    name,
    description,
    type: type as "Apertura" | "Cierre" | "Ruta" | "General",
    items,
  };
};

const templateSnapshot = (template: any) => ({
  id: toNumber(template.id),
  name: normalize(template.name),
  description: normalize(template.description) || null,
  type: normalize(template.type || "General"),
  active: toNumber(template.active, 1),
  content_version: toNumber(template.content_version),
});

const itemSnapshot = (items: any[]) => items.map((item, index) => ({
  id: item.id === undefined || item.id === null ? null : toNumber(item.id),
  position: index + 1,
  task_name: normalize(item.task_name),
}));

const assertEditable = (template: any, expectedContentVersion: number) => {
  if (!template) throw new AppError("Plantilla no encontrada", 404);
  if (toNumber(template.active) !== 1) {
    throw new AppError("La plantilla está inactiva. Reactivala antes de editarla", 409);
  }
  if (toNumber(template.content_version) !== expectedContentVersion) {
    throw new AppError(
      "La plantilla cambió mientras estaba abierta. Actualizá la pantalla e intentá nuevamente",
      409
    );
  }
};

const hasChanges = (
  beforeTemplate: ReturnType<typeof templateSnapshot>,
  beforeItems: ReturnType<typeof itemSnapshot>,
  afterTemplate: ReturnType<typeof templateSnapshot>,
  afterItems: ReturnType<typeof itemSnapshot>
) => JSON.stringify({
  name: beforeTemplate.name,
  description: beforeTemplate.description,
  type: beforeTemplate.type,
  items: beforeItems.map((item) => item.task_name),
}) !== JSON.stringify({
  name: afterTemplate.name,
  description: afterTemplate.description,
  type: afterTemplate.type,
  items: afterItems.map((item) => item.task_name),
});

const handleSqlite = async (input: ChecklistTemplateContentInput) => {
  const validated = validateInput(input);
  const { default: db } = await import("../db.js");

  return db.transaction(() => {
    const template = db.prepare(
      "SELECT * FROM checklist_templates WHERE id = ? LIMIT 1"
    ).get(input.templateId) as any;
    assertEditable(template, input.expectedContentVersion);

    const beforeItemsRaw = db.prepare(
      "SELECT id, template_id, task_name FROM checklist_template_items WHERE template_id = ? ORDER BY id ASC"
    ).all(input.templateId) as any[];
    if (!beforeItemsRaw.length) {
      throw new AppError("La plantilla no tiene tareas trazables", 409);
    }

    const beforeTemplate = templateSnapshot(template);
    const beforeItems = itemSnapshot(beforeItemsRaw);
    const nextVersion = input.expectedContentVersion + 1;
    const afterTemplate = templateSnapshot({
      ...template,
      name: validated.name,
      description: validated.description,
      type: validated.type,
      content_version: nextVersion,
    });
    const afterItems = itemSnapshot(validated.items.map((taskName) => ({ task_name: taskName })));

    if (!hasChanges(beforeTemplate, beforeItems, afterTemplate, afterItems)) {
      throw new AppError("No se detectaron cambios para guardar", 409);
    }

    const historyInfo = db.prepare(`
      INSERT INTO checklist_template_content_history (
        template_id, version, status_at_change, reason, changed_by,
        template_before_snapshot, items_before_snapshot,
        template_after_snapshot, items_after_snapshot
      ) VALUES (?, ?, 'activa', ?, ?, ?, ?, ?, ?)
    `).run(
      input.templateId,
      nextVersion,
      validated.reason,
      validated.user,
      JSON.stringify(beforeTemplate),
      JSON.stringify(beforeItems),
      JSON.stringify(afterTemplate),
      JSON.stringify(afterItems)
    );

    const updateResult = db.prepare(`
      UPDATE checklist_templates
      SET name = ?,
          description = ?,
          type = ?,
          content_version = ?,
          content_changed_at = CURRENT_TIMESTAMP,
          content_changed_by = ?,
          content_change_reason = ?
      WHERE id = ?
        AND active = 1
        AND content_version = ?
    `).run(
      validated.name,
      validated.description,
      validated.type,
      nextVersion,
      validated.user,
      validated.reason,
      input.templateId,
      input.expectedContentVersion
    );
    if (Number(updateResult.changes || 0) !== 1) {
      throw new AppError(
        "La plantilla cambió mientras se guardaba. Actualizá la pantalla e intentá nuevamente",
        409
      );
    }

    db.prepare("DELETE FROM checklist_template_items WHERE template_id = ?").run(input.templateId);
    const insertItem = db.prepare(
      "INSERT INTO checklist_template_items (template_id, task_name) VALUES (?, ?)"
    );
    for (const taskName of validated.items) insertItem.run(input.templateId, taskName);

    const updatedTemplate = db.prepare(
      "SELECT * FROM checklist_templates WHERE id = ? LIMIT 1"
    ).get(input.templateId) as any;
    const updatedItems = db.prepare(
      "SELECT id, template_id, task_name FROM checklist_template_items WHERE template_id = ? ORDER BY id ASC"
    ).all(input.templateId);

    return {
      template: updatedTemplate,
      items: updatedItems,
      history: {
        id: Number(historyInfo.lastInsertRowid),
        version: nextVersion,
      },
      version: nextVersion,
    };
  })();
};

const handlePostgres = async (
  input: ChecklistTemplateContentInput,
  executor?: TransactionClient
) => {
  const validated = validateInput(input);
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
      [input.templateId]
    );
    const template = templateResult.rows[0];
    assertEditable(template, input.expectedContentVersion);

    const beforeItemsResult = await client.query(
      `SELECT id, template_id, task_name
       FROM checklist_template_items
       WHERE template_id = $1
       ORDER BY id ASC
       FOR UPDATE`,
      [input.templateId]
    );
    if (!beforeItemsResult.rowCount) {
      throw new AppError("La plantilla no tiene tareas trazables", 409);
    }

    const beforeTemplate = templateSnapshot(template);
    const beforeItems = itemSnapshot(beforeItemsResult.rows);
    const nextVersion = input.expectedContentVersion + 1;
    const afterTemplate = templateSnapshot({
      ...template,
      name: validated.name,
      description: validated.description,
      type: validated.type,
      content_version: nextVersion,
    });
    const afterItems = itemSnapshot(validated.items.map((taskName) => ({ task_name: taskName })));

    if (!hasChanges(beforeTemplate, beforeItems, afterTemplate, afterItems)) {
      throw new AppError("No se detectaron cambios para guardar", 409);
    }

    const historyResult = await client.query(
      `INSERT INTO checklist_template_content_history (
         template_id, version, status_at_change, reason, changed_by,
         template_before_snapshot, items_before_snapshot,
         template_after_snapshot, items_after_snapshot
       )
       VALUES ($1, $2, 'activa', $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb)
       RETURNING id, changed_at`,
      [
        input.templateId,
        nextVersion,
        validated.reason,
        validated.user,
        JSON.stringify(beforeTemplate),
        JSON.stringify(beforeItems),
        JSON.stringify(afterTemplate),
        JSON.stringify(afterItems),
      ]
    );
    const changedAt = historyResult.rows[0]?.changed_at || new Date().toISOString();

    const updateResult = await client.query(
      `UPDATE checklist_templates
       SET name = $1,
           description = $2,
           type = $3,
           content_version = $4,
           content_changed_at = $5,
           content_changed_by = $6,
           content_change_reason = $7
       WHERE id = $8
         AND active = 1
         AND content_version = $9
       RETURNING *`,
      [
        validated.name,
        validated.description,
        validated.type,
        nextVersion,
        changedAt,
        validated.user,
        validated.reason,
        input.templateId,
        input.expectedContentVersion,
      ]
    );
    if (updateResult.rowCount !== 1) {
      throw new AppError(
        "La plantilla cambió mientras se guardaba. Actualizá la pantalla e intentá nuevamente",
        409
      );
    }

    await client.query(
      "DELETE FROM checklist_template_items WHERE template_id = $1",
      [input.templateId]
    );
    for (const taskName of validated.items) {
      await client.query(
        "INSERT INTO checklist_template_items (template_id, task_name) VALUES ($1, $2)",
        [input.templateId, taskName]
      );
    }

    const updatedItemsResult = await client.query(
      `SELECT id, template_id, task_name
       FROM checklist_template_items
       WHERE template_id = $1
       ORDER BY id ASC`,
      [input.templateId]
    );

    if (ownsTransaction) await client.query("COMMIT");
    return {
      template: updateResult.rows[0],
      items: updatedItemsResult.rows,
      history: historyResult.rows[0],
      version: nextVersion,
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

export const checklistTemplateContentLifecycleService = {
  async update(input: ChecklistTemplateContentInput, executor?: TransactionClient) {
    if (executor || isPostgresConfigured()) return handlePostgres(input, executor);
    return handleSqlite(input);
  },
};
