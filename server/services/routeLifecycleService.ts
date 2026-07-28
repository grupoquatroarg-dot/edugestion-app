import { getPostgresPool, isPostgresConfigured } from "../utils/postgres.js";
import { AppError } from "../utils/response.js";

export type RouteLifecycleAction = "finalize" | "cancel" | "reopen";

type TransactionClient = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

type RouteLifecycleInput = {
  routeId: number;
  action: RouteLifecycleAction;
  motivo: string;
  usuario: string;
};

const OPEN_STATUSES = new Set(["planificada", "pendiente", "en curso"]);
const normalize = (value: unknown) => String(value ?? "").trim();
const normalizeStatus = (value: unknown) => normalize(value).toLowerCase() || "planificada";

const validateInput = ({ routeId, motivo }: RouteLifecycleInput) => {
  if (!Number.isInteger(routeId) || routeId <= 0) {
    throw new AppError("ID de ruta inválido", 400);
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

const resolveTransition = (route: any, action: RouteLifecycleAction) => {
  if (!route) throw new AppError("Ruta no encontrada", 404);

  const currentStatus = normalizeStatus(route.status);

  if (action === "finalize") {
    if (currentStatus === "finalizada") throw new AppError("La ruta ya está finalizada", 409);
    if (currentStatus === "cancelada") {
      throw new AppError("La ruta está cancelada. Debe reabrirse antes de finalizarla", 409);
    }
    if (!OPEN_STATUSES.has(currentStatus)) {
      throw new AppError(`La ruta está en un estado no finalizable: ${route.status || "sin estado"}`, 409);
    }
    return { previousStatus: currentStatus, nextStatus: "finalizada" };
  }

  if (action === "cancel") {
    if (currentStatus === "cancelada") throw new AppError("La ruta ya está cancelada", 409);
    if (currentStatus === "finalizada") {
      throw new AppError("Una ruta finalizada debe reabrirse antes de poder cancelarse", 409);
    }
    if (!OPEN_STATUSES.has(currentStatus)) {
      throw new AppError(`La ruta está en un estado no cancelable: ${route.status || "sin estado"}`, 409);
    }
    return { previousStatus: currentStatus, nextStatus: "cancelada" };
  }

  if (currentStatus === "cancelada") {
    const previousStatus = normalizeStatus(route.cancelled_from_status);
    return {
      previousStatus: currentStatus,
      nextStatus: OPEN_STATUSES.has(previousStatus) ? previousStatus : "planificada",
    };
  }

  if (currentStatus === "finalizada") {
    if (Number(route.finalization_version || 0) !== 1) {
      throw new AppError("La ruta finalizada es histórica y no tiene trazabilidad suficiente para reabrirse", 409);
    }
    const previousStatus = normalizeStatus(route.finalized_from_status);
    return {
      previousStatus: currentStatus,
      nextStatus: OPEN_STATUSES.has(previousStatus) ? previousStatus : "en curso",
    };
  }

  throw new AppError("Solo se puede reabrir una ruta cancelada o finalizada", 409);
};

const handleSqlite = async ({ routeId, action, motivo, usuario }: RouteLifecycleInput) => {
  const reason = validateInput({ routeId, action, motivo, usuario });
  const performedBy = normalize(usuario) || "Sistema";
  const { default: db } = await import("../db.js");

  return db.transaction(() => {
    const route = db.prepare("SELECT * FROM routes WHERE id = ? LIMIT 1").get(routeId) as any;
    const transition = resolveTransition(route, action);
    const items = db.prepare("SELECT * FROM route_items WHERE route_id = ? ORDER BY order_index ASC, id ASC").all(routeId);
    const snapshot = JSON.stringify({ route, items });

    const historyInfo = db.prepare(`
      INSERT INTO route_status_history (
        route_id, action, reason, performed_by, previous_status, new_status, snapshot
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(routeId, action, reason, performedBy, transition.previousStatus, transition.nextStatus, snapshot);

    if (action === "finalize") {
      db.prepare(`
        UPDATE routes
        SET status = 'finalizada',
            finalization_version = 1,
            finalized_at = CURRENT_TIMESTAMP,
            finalized_by = ?,
            finalization_reason = ?,
            finalized_from_status = ?,
            reopened_at = NULL,
            reopened_by = NULL,
            reopen_reason = NULL
        WHERE id = ?
      `).run(performedBy, reason, transition.previousStatus, routeId);
    } else if (action === "cancel") {
      db.prepare(`
        UPDATE routes
        SET status = 'cancelada',
            cancelled_at = CURRENT_TIMESTAMP,
            cancelled_by = ?,
            cancel_reason = ?,
            cancelled_from_status = ?,
            reopened_at = NULL,
            reopened_by = NULL,
            reopen_reason = NULL
        WHERE id = ?
      `).run(performedBy, reason, transition.previousStatus, routeId);
    } else {
      db.prepare(`
        UPDATE routes
        SET status = ?,
            reopened_at = CURRENT_TIMESTAMP,
            reopened_by = ?,
            reopen_reason = ?
        WHERE id = ?
      `).run(transition.nextStatus, performedBy, reason, routeId);
    }

    return {
      route: db.prepare("SELECT * FROM routes WHERE id = ? LIMIT 1").get(routeId),
      history: db.prepare("SELECT * FROM route_status_history WHERE id = ?").get(Number(historyInfo.lastInsertRowid)),
    };
  })();
};

const handlePostgres = async (
  { routeId, action, motivo, usuario }: RouteLifecycleInput,
  executor?: TransactionClient
) => {
  const reason = validateInput({ routeId, action, motivo, usuario });
  const performedBy = normalize(usuario) || "Sistema";
  const ownsTransaction = !executor;
  const pool = executor ? null : getPostgresPool();
  const client = executor || (await pool!.connect());

  try {
    if (ownsTransaction) await client.query("BEGIN");

    const routeResult = await client.query(
      `SELECT * FROM routes WHERE id = $1 LIMIT 1 FOR UPDATE`,
      [routeId]
    );
    if (!routeResult.rowCount) throw new AppError("Ruta no encontrada", 404);

    const route = routeResult.rows[0];
    const transition = resolveTransition(route, action);
    const itemsResult = await client.query(
      `SELECT * FROM route_items WHERE route_id = $1 ORDER BY order_index ASC, id ASC FOR UPDATE`,
      [routeId]
    );
    const snapshot = JSON.stringify({ route, items: itemsResult.rows });

    const historyResult = await client.query(
      `INSERT INTO route_status_history (
         route_id, action, reason, performed_by, previous_status, new_status, snapshot
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       RETURNING id, performed_at`,
      [routeId, action, reason, performedBy, transition.previousStatus, transition.nextStatus, snapshot]
    );

    const performedAt = historyResult.rows[0]?.performed_at || new Date().toISOString();
    let updateResult;

    if (action === "finalize") {
      updateResult = await client.query(
        `UPDATE routes
         SET status = 'finalizada',
             finalization_version = 1,
             finalized_at = $1,
             finalized_by = $2,
             finalization_reason = $3,
             finalized_from_status = $4,
             reopened_at = NULL,
             reopened_by = NULL,
             reopen_reason = NULL
         WHERE id = $5
         RETURNING *`,
        [performedAt, performedBy, reason, transition.previousStatus, routeId]
      );
    } else if (action === "cancel") {
      updateResult = await client.query(
        `UPDATE routes
         SET status = 'cancelada',
             cancelled_at = $1,
             cancelled_by = $2,
             cancel_reason = $3,
             cancelled_from_status = $4,
             reopened_at = NULL,
             reopened_by = NULL,
             reopen_reason = NULL
         WHERE id = $5
         RETURNING *`,
        [performedAt, performedBy, reason, transition.previousStatus, routeId]
      );
    } else {
      updateResult = await client.query(
        `UPDATE routes
         SET status = $1,
             reopened_at = $2,
             reopened_by = $3,
             reopen_reason = $4
         WHERE id = $5
         RETURNING *`,
        [transition.nextStatus, performedAt, performedBy, reason, routeId]
      );
    }

    if (ownsTransaction) await client.query("COMMIT");

    return { route: updateResult.rows[0], history: historyResult.rows[0] };
  } catch (error) {
    if (ownsTransaction) await client.query("ROLLBACK");
    throw error;
  } finally {
    if (ownsTransaction && "release" in client && typeof (client as any).release === "function") {
      (client as any).release();
    }
  }
};

export const routeLifecycleService = {
  async changeStatus(input: RouteLifecycleInput, executor?: TransactionClient) {
    if (executor || isPostgresConfigured()) return handlePostgres(input, executor);
    return handleSqlite(input);
  },
};
