import { getPostgresPool, isPostgresConfigured } from "../utils/postgres.js";
import { AppError } from "../utils/response.js";

export type ChecklistLifecycleAction = "finalize" | "cancel" | "reopen";

type TransactionClient = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

type LifecycleInput = {
  checklistId: number;
  action: ChecklistLifecycleAction;
  motivo?: string;
  usuario: string;
};

const normalize = (value: unknown) => String(value ?? "").trim();
const normalizeStatus = (value: unknown) => normalize(value).toLowerCase() || "pendiente";

const validateInput = ({ checklistId, action, motivo }: LifecycleInput) => {
  if (!Number.isInteger(checklistId) || checklistId <= 0) {
    throw new AppError("ID de checklist inválido", 400);
  }

  const reason = action === "finalize" ? normalize(motivo) || "Finalización manual" : normalize(motivo);
  if (reason.length < 3) {
    throw new AppError("El motivo es obligatorio y debe tener al menos 3 caracteres", 400);
  }
  if (reason.length > 500) {
    throw new AppError("El motivo no puede superar los 500 caracteres", 400);
  }

  return reason;
};

const resolveTransition = (checklist: any, action: ChecklistLifecycleAction) => {
  if (!checklist) throw new AppError("Checklist no encontrado", 404);
  if (Number(checklist.lifecycle_version || 0) !== 1) {
    throw new AppError("Checklist histórico sin trazabilidad para cambiar su estado", 409);
  }

  const status = normalizeStatus(checklist.status);

  if (action === "finalize") {
    if (status === "completado") throw new AppError("El checklist ya está finalizado", 409);
    if (status === "cancelado") throw new AppError("El checklist está cancelado. Debe reabrirse antes de finalizarlo", 409);
    if (status !== "pendiente") throw new AppError(`Estado de checklist no finalizable: ${checklist.status}`, 409);
    return { previousStatus: status, nextStatus: "completado" };
  }

  if (action === "cancel") {
    if (status === "cancelado") throw new AppError("El checklist ya está cancelado", 409);
    if (status === "completado") throw new AppError("Un checklist finalizado debe conservarse como historial. Reabrilo antes de cancelarlo", 409);
    if (status !== "pendiente") throw new AppError(`Estado de checklist no cancelable: ${checklist.status}`, 409);
    return { previousStatus: status, nextStatus: "cancelado" };
  }

  if (!new Set(["completado", "cancelado"]).has(status)) {
    throw new AppError("Solo se puede reabrir un checklist finalizado o cancelado", 409);
  }

  return { previousStatus: status, nextStatus: "pendiente" };
};

const handleSqlite = async ({ checklistId, action, motivo, usuario }: LifecycleInput) => {
  const reason = validateInput({ checklistId, action, motivo, usuario });
  const performedBy = normalize(usuario) || "Sistema";
  const { default: db } = await import("../db.js");

  return db.transaction(() => {
    const checklist = db.prepare("SELECT * FROM checklists WHERE id = ? LIMIT 1").get(checklistId) as any;
    const transition = resolveTransition(checklist, action);
    const items = db.prepare("SELECT * FROM checklist_items WHERE checklist_id = ? ORDER BY id ASC").all(checklistId);
    const snapshot = JSON.stringify({ checklist, items });

    const historyInfo = db.prepare(`
      INSERT INTO checklist_status_history (
        checklist_id, action, reason, performed_by, previous_status, new_status, snapshot
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(checklistId, action, reason, performedBy, transition.previousStatus, transition.nextStatus, snapshot);

    if (action === "finalize") {
      db.prepare(`
        UPDATE checklists
        SET status = 'completado', completed_at = CURRENT_TIMESTAMP, completed_by = ?,
            cancelled_at = NULL, cancelled_by = NULL, cancel_reason = NULL
        WHERE id = ?
      `).run(performedBy, checklistId);
    } else if (action === "cancel") {
      db.prepare(`
        UPDATE checklists
        SET status = 'cancelado', cancelled_at = CURRENT_TIMESTAMP, cancelled_by = ?, cancel_reason = ?,
            cancelled_from_status = ?, completed_at = NULL, completed_by = NULL
        WHERE id = ?
      `).run(performedBy, reason, transition.previousStatus, checklistId);
    } else {
      db.prepare(`
        UPDATE checklists
        SET status = 'pendiente', completed_at = NULL, completed_by = NULL,
            reopened_at = CURRENT_TIMESTAMP, reopened_by = ?, reopen_reason = ?
        WHERE id = ?
      `).run(performedBy, reason, checklistId);
    }

    return {
      checklist: db.prepare("SELECT * FROM checklists WHERE id = ? LIMIT 1").get(checklistId),
      history: db.prepare("SELECT * FROM checklist_status_history WHERE id = ?").get(Number(historyInfo.lastInsertRowid)),
    };
  })();
};

const handlePostgres = async (
  { checklistId, action, motivo, usuario }: LifecycleInput,
  executor?: TransactionClient
) => {
  const reason = validateInput({ checklistId, action, motivo, usuario });
  const performedBy = normalize(usuario) || "Sistema";
  const ownsTransaction = !executor;
  const pool = executor ? null : getPostgresPool();
  const client = executor || (await pool!.connect());

  try {
    if (ownsTransaction) await client.query("BEGIN");

    const checklistResult = await client.query(
      `SELECT * FROM checklists WHERE id = $1 LIMIT 1 FOR UPDATE`,
      [checklistId]
    );
    if (!checklistResult.rowCount) throw new AppError("Checklist no encontrado", 404);

    const checklist = checklistResult.rows[0];
    const transition = resolveTransition(checklist, action);
    const itemsResult = await client.query(
      `SELECT * FROM checklist_items WHERE checklist_id = $1 ORDER BY id ASC FOR UPDATE`,
      [checklistId]
    );
    const snapshot = JSON.stringify({ checklist, items: itemsResult.rows });

    const historyResult = await client.query(
      `INSERT INTO checklist_status_history (
         checklist_id, action, reason, performed_by, previous_status, new_status, snapshot
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       RETURNING id, performed_at`,
      [checklistId, action, reason, performedBy, transition.previousStatus, transition.nextStatus, snapshot]
    );

    const performedAt = historyResult.rows[0]?.performed_at || new Date().toISOString();
    let updateResult;

    if (action === "finalize") {
      updateResult = await client.query(
        `UPDATE checklists
         SET status = 'completado', completed_at = $1, completed_by = $2,
             cancelled_at = NULL, cancelled_by = NULL, cancel_reason = NULL
         WHERE id = $3 RETURNING *`,
        [performedAt, performedBy, checklistId]
      );
    } else if (action === "cancel") {
      updateResult = await client.query(
        `UPDATE checklists
         SET status = 'cancelado', cancelled_at = $1, cancelled_by = $2, cancel_reason = $3,
             cancelled_from_status = $4, completed_at = NULL, completed_by = NULL
         WHERE id = $5 RETURNING *`,
        [performedAt, performedBy, reason, transition.previousStatus, checklistId]
      );
    } else {
      updateResult = await client.query(
        `UPDATE checklists
         SET status = 'pendiente', completed_at = NULL, completed_by = NULL,
             reopened_at = $1, reopened_by = $2, reopen_reason = $3
         WHERE id = $4 RETURNING *`,
        [performedAt, performedBy, reason, checklistId]
      );
    }

    if (ownsTransaction) await client.query("COMMIT");
    return { checklist: updateResult.rows[0], history: historyResult.rows[0] };
  } catch (error) {
    if (ownsTransaction) await client.query("ROLLBACK");
    throw error;
  } finally {
    if (ownsTransaction && "release" in client && typeof (client as any).release === "function") {
      (client as any).release();
    }
  }
};

export const checklistLifecycleService = {
  async changeStatus(input: LifecycleInput, executor?: TransactionClient) {
    if (executor || isPostgresConfigured()) return handlePostgres(input, executor);
    return handleSqlite(input);
  },
};
