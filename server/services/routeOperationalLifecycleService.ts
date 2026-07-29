import { getPostgresPool, isPostgresConfigured } from "../utils/postgres.js";
import { AppError } from "../utils/response.js";

export type RouteOperationalAction = "start" | "reopen";

type TransactionClient = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

type RouteOperationalInput = {
  routeId: number;
  action: RouteOperationalAction;
  motivo?: string | null;
  usuario: string;
  expectedVersion: number;
};

const OPEN_BEFORE_START = new Set(["planificada", "pendiente"]);
const normalize = (value: unknown) => String(value ?? "").trim();
const normalizeStatus = (value: unknown) => normalize(value).toLowerCase() || "planificada";
const toNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const validateInput = (input: RouteOperationalInput) => {
  if (!Number.isInteger(input.routeId) || input.routeId <= 0) {
    throw new AppError("ID de ruta inválido", 400);
  }
  if (!["start", "reopen"].includes(input.action)) {
    throw new AppError("Acción operativa de ruta inválida", 400);
  }
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) {
    throw new AppError("La versión operativa de la ruta es inválida", 400);
  }

  const user = normalize(input.usuario) || "Sistema";
  const providedReason = normalize(input.motivo);
  if (providedReason.length > 500) {
    throw new AppError("El motivo no puede superar los 500 caracteres", 400);
  }
  if (input.action === "reopen" && providedReason.length < 3) {
    throw new AppError("El motivo para volver a planificación es obligatorio y debe tener al menos 3 caracteres", 400);
  }

  return {
    user,
    reason: input.action === "start" ? "Inicio auditado de la ruta" : providedReason,
  };
};

const hasRouteActivity = (items: any[], activeMovements: any[]) => (
  items.some((item) => (
    normalizeStatus(item.status || "pendiente") !== "pendiente"
    || toNumber(item.visitado) !== 0
    || toNumber(item.venta_registrada) !== 0
    || toNumber(item.pedido_generado) !== 0
    || toNumber(item.cobranza_realizada) !== 0
    || Boolean(item.visited_at)
    || normalize(item.notes).length > 0
  ))
  || activeMovements.length > 0
);

const resolveTransition = (
  route: any,
  items: any[],
  activeMovements: any[],
  input: RouteOperationalInput,
) => {
  if (!route) throw new AppError("Ruta no encontrada", 404);

  const currentStatus = normalizeStatus(route.status);
  const currentVersion = toNumber(route.operational_version);
  if (currentVersion !== input.expectedVersion) {
    throw new AppError("La ruta cambió mientras estaba abierta. Actualizá la pantalla e intentá nuevamente", 409);
  }

  if (input.action === "start") {
    if (currentStatus === "en curso") throw new AppError("La ruta ya está en curso", 409);
    if (["cancelada", "finalizada"].includes(currentStatus)) {
      throw new AppError(`La ruta está ${currentStatus} y debe reabrirse antes de iniciarla`, 409);
    }
    if (!OPEN_BEFORE_START.has(currentStatus)) {
      throw new AppError(`La ruta no puede iniciarse desde el estado ${route.status || "sin estado"}`, 409);
    }
    return {
      currentStatus,
      nextStatus: "en curso",
      currentVersion,
      startFromStatus: currentStatus,
    };
  }

  if (currentStatus !== "en curso") {
    throw new AppError("Solo una ruta en curso puede volver a planificación", 409);
  }
  if (
    currentVersion <= 0
    || normalize(route.operational_last_action) !== "start"
    || !OPEN_BEFORE_START.has(normalizeStatus(route.operational_from_status))
  ) {
    throw new AppError("La ruta en curso es histórica o se inició mediante actividad operativa y no puede volver a planificación", 409);
  }
  if (hasRouteActivity(items, activeMovements)) {
    throw new AppError("La ruta tiene visitas u operaciones registradas. Primero deben anularse o reabrirse desde sus módulos correspondientes", 409);
  }

  return {
    currentStatus,
    nextStatus: normalizeStatus(route.operational_from_status),
    currentVersion,
    startFromStatus: normalizeStatus(route.operational_from_status),
  };
};

const normalizeMovements = (movements: any[]) => movements.map((movement) => ({
  id: toNumber(movement.id),
  tipo: movement.tipo || null,
  origen: movement.origen || null,
  estado: movement.estado || null,
  route_item_id: movement.route_item_id === null || movement.route_item_id === undefined
    ? null
    : toNumber(movement.route_item_id),
  venta_id: movement.venta_id === null || movement.venta_id === undefined
    ? null
    : toNumber(movement.venta_id),
}));

const handleSqlite = async (input: RouteOperationalInput) => {
  const { user, reason } = validateInput(input);
  const { default: db } = await import("../db.js");

  return db.transaction(() => {
    const route = db.prepare("SELECT * FROM routes WHERE id = ? LIMIT 1").get(input.routeId) as any;
    const items = db.prepare("SELECT * FROM route_items WHERE route_id = ? ORDER BY order_index ASC, id ASC").all(input.routeId) as any[];
    const activeMovements = db.prepare(`
      SELECT mf.id, mf.tipo, mf.origen, mf.estado, mf.route_item_id, mf.venta_id
      FROM movimientos_financieros mf
      JOIN route_items ri ON ri.id = mf.route_item_id
      WHERE ri.route_id = ?
        AND lower(COALESCE(mf.estado, 'activo')) NOT IN ('anulado', 'anulada', 'cancelado', 'cancelada')
      ORDER BY mf.id ASC
    `).all(input.routeId) as any[];

    const transition = resolveTransition(route, items, activeMovements, input);
    const nextVersion = transition.currentVersion + 1;
    const snapshot = JSON.stringify({
      route,
      items,
      activeFinancialMovements: normalizeMovements(activeMovements),
    });

    const history = db.prepare(`
      INSERT INTO route_operational_status_history (
        route_id, version, action, reason, performed_by,
        previous_status, new_status, snapshot
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.routeId,
      nextVersion,
      input.action,
      reason,
      user,
      transition.currentStatus,
      transition.nextStatus,
      snapshot,
    );

    const changedAt = db.prepare("SELECT CURRENT_TIMESTAMP AS changed_at").get() as any;
    const update = db.prepare(`
      UPDATE routes
      SET status = ?,
          operational_version = ?,
          operational_last_action = ?,
          operational_changed_at = ?,
          operational_changed_by = ?,
          operational_reason = ?,
          operational_from_status = ?
      WHERE id = ?
        AND COALESCE(status, 'planificada') = ?
        AND COALESCE(operational_version, 0) = ?
    `).run(
      transition.nextStatus,
      nextVersion,
      input.action,
      changedAt?.changed_at || new Date().toISOString(),
      user,
      reason,
      input.action === "start" ? transition.startFromStatus : null,
      input.routeId,
      transition.currentStatus,
      transition.currentVersion,
    );

    if (Number(update.changes || 0) !== 1) {
      throw new AppError("La ruta cambió mientras se actualizaba", 409);
    }

    return {
      route: db.prepare("SELECT * FROM routes WHERE id = ? LIMIT 1").get(input.routeId),
      historyId: Number(history.lastInsertRowid),
      version: nextVersion,
      previousStatus: transition.currentStatus,
      newStatus: transition.nextStatus,
    };
  })();
};

const handlePostgres = async (input: RouteOperationalInput, executor?: TransactionClient) => {
  const { user, reason } = validateInput(input);
  const ownsTransaction = !executor;
  const pool = executor ? null : getPostgresPool();
  const client = executor || (await pool!.connect());

  try {
    if (ownsTransaction) await client.query("BEGIN");

    const routeResult = await client.query(
      `SELECT * FROM routes WHERE id = $1 LIMIT 1 FOR UPDATE`,
      [input.routeId],
    );
    if (!routeResult.rowCount) throw new AppError("Ruta no encontrada", 404);

    const itemsResult = await client.query(
      `SELECT * FROM route_items WHERE route_id = $1 ORDER BY order_index ASC, id ASC FOR UPDATE`,
      [input.routeId],
    );
    const activeMovementsResult = await client.query(
      `SELECT mf.id, mf.tipo, mf.origen, mf.estado, mf.route_item_id, mf.venta_id
       FROM movimientos_financieros mf
       JOIN route_items ri ON ri.id = mf.route_item_id
       WHERE ri.route_id = $1
         AND lower(COALESCE(mf.estado, 'activo')) NOT IN ('anulado', 'anulada', 'cancelado', 'cancelada')
       ORDER BY mf.id ASC
       FOR UPDATE OF mf`,
      [input.routeId],
    );

    const route = routeResult.rows[0];
    const items = itemsResult.rows;
    const activeMovements = activeMovementsResult.rows;
    const transition = resolveTransition(route, items, activeMovements, input);
    const nextVersion = transition.currentVersion + 1;

    const historyResult = await client.query(
      `INSERT INTO route_operational_status_history (
         route_id, version, action, reason, performed_by,
         previous_status, new_status, snapshot
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       RETURNING id, performed_at`,
      [
        input.routeId,
        nextVersion,
        input.action,
        reason,
        user,
        transition.currentStatus,
        transition.nextStatus,
        JSON.stringify({
          route,
          items,
          activeFinancialMovements: normalizeMovements(activeMovements),
        }),
      ],
    );

    const changedAt = historyResult.rows[0]?.performed_at || new Date().toISOString();
    const updateResult = await client.query(
      `UPDATE routes
       SET status = $1,
           operational_version = $2,
           operational_last_action = $3,
           operational_changed_at = $4,
           operational_changed_by = $5,
           operational_reason = $6,
           operational_from_status = $7
       WHERE id = $8
         AND COALESCE(status, 'planificada') = $9
         AND COALESCE(operational_version, 0) = $10
       RETURNING *`,
      [
        transition.nextStatus,
        nextVersion,
        input.action,
        changedAt,
        user,
        reason,
        input.action === "start" ? transition.startFromStatus : null,
        input.routeId,
        transition.currentStatus,
        transition.currentVersion,
      ],
    );

    if (!updateResult.rowCount) {
      throw new AppError("La ruta cambió mientras se actualizaba", 409);
    }

    if (ownsTransaction) await client.query("COMMIT");

    return {
      route: updateResult.rows[0],
      historyId: toNumber(historyResult.rows[0]?.id),
      version: nextVersion,
      previousStatus: transition.currentStatus,
      newStatus: transition.nextStatus,
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

export const routeOperationalLifecycleService = {
  async changeStatus(input: RouteOperationalInput, executor?: TransactionClient) {
    if (!isPostgresConfigured() && !executor) return handleSqlite(input);
    return handlePostgres(input, executor);
  },
};
