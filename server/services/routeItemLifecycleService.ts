import { getPostgresPool, isPostgresConfigured } from "../utils/postgres.js";
import { AppError } from "../utils/response.js";

export type RouteItemLifecycleAction = "visit" | "omit" | "reopen";

type TransactionClient = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

type LifecycleInput = {
  routeItemId: number;
  action: RouteItemLifecycleAction;
  motivo?: string | null;
  notes?: string | null;
  usuario: string;
};

const toNumber = (value: any, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalize = (value: unknown) => String(value ?? "").trim();

const validateInput = (input: LifecycleInput) => {
  if (!Number.isInteger(input.routeItemId) || input.routeItemId <= 0) {
    throw new AppError("ID de visita inválido", 400);
  }
  if (!["visit", "omit", "reopen"].includes(input.action)) {
    throw new AppError("Acción de visita inválida", 400);
  }

  const user = normalize(input.usuario) || "Sistema";
  const reason = normalize(input.motivo);
  const notes = input.notes === null || input.notes === undefined ? null : String(input.notes).trim();

  if (reason.length > 500) {
    throw new AppError("El motivo no puede superar los 500 caracteres", 400);
  }
  if (notes !== null && notes.length > 2000) {
    throw new AppError("Las observaciones no pueden superar los 2000 caracteres", 400);
  }
  if (input.action === "reopen" && reason.length < 3) {
    throw new AppError("El motivo de reapertura es obligatorio y debe tener al menos 3 caracteres", 400);
  }

  return {
    user,
    reason: input.action === "reopen" ? reason : null,
    notes,
  };
};

const assertRouteOpen = (item: any) => {
  if (!item) throw new AppError("La visita no existe", 404);
  const routeStatus = normalize(item.route_status || "planificada").toLowerCase();
  if (["cancelada", "finalizada"].includes(routeStatus)) {
    throw new AppError(`La ruta está ${routeStatus} y no admite cambios`, 409);
  }
};

const hasLinkedActivity = (item: any, activeMovements: any[]) => (
  toNumber(item.venta_registrada) !== 0
  || toNumber(item.pedido_generado) !== 0
  || toNumber(item.cobranza_realizada) !== 0
  || activeMovements.length > 0
);

const assertTransition = (
  item: any,
  action: RouteItemLifecycleAction,
  activeMovements: any[],
) => {
  assertRouteOpen(item);
  const currentStatus = normalize(item.status || "pendiente").toLowerCase();
  const version = toNumber(item.lifecycle_version);

  if (action === "visit" || action === "omit") {
    if (currentStatus !== "pendiente") {
      throw new AppError("La visita ya fue procesada y no puede marcarse nuevamente", 409);
    }
    if (hasLinkedActivity(item, activeMovements)) {
      throw new AppError("La visita tiene una operación vinculada y no puede modificarse manualmente", 409);
    }
    return {
      currentStatus,
      nextStatus: action === "visit" ? "visitado" : "omitido",
      version,
    };
  }

  if (!["visitado", "omitido"].includes(currentStatus)) {
    if (["pedido tomado", "venta realizada"].includes(currentStatus) || hasLinkedActivity(item, activeMovements)) {
      throw new AppError("Primero debe anularse o revertirse la operación vinculada desde su módulo correspondiente", 409);
    }
    throw new AppError("La visita no se encuentra en un estado que pueda reabrirse", 409);
  }
  if (version <= 0 || !["visit", "omit"].includes(normalize(item.status_last_action))) {
    throw new AppError("La visita es histórica y no tiene trazabilidad suficiente para reabrirse", 409);
  }
  if (hasLinkedActivity(item, activeMovements)) {
    throw new AppError("Primero debe anularse o revertirse la operación vinculada desde su módulo correspondiente", 409);
  }

  return { currentStatus, nextStatus: "pendiente", version };
};

const normalizeMovements = (movements: any[]) => movements.map((movement) => ({
  id: toNumber(movement.id),
  tipo: movement.tipo || null,
  origen: movement.origen || null,
  estado: movement.estado || null,
  venta_id: movement.venta_id === null || movement.venta_id === undefined ? null : toNumber(movement.venta_id),
  cheque_id: movement.cheque_id === null || movement.cheque_id === undefined ? null : toNumber(movement.cheque_id),
}));

const handleSqlite = async (input: LifecycleInput) => {
  const { user, reason, notes } = validateInput(input);
  const { default: db } = await import("../db.js");

  return db.transaction(() => {
    const item = db.prepare(`
      SELECT ri.*, r.status AS route_status
      FROM route_items ri
      JOIN routes r ON r.id = ri.route_id
      WHERE ri.id = ?
      LIMIT 1
    `).get(input.routeItemId) as any;

    const activeMovements = db.prepare(`
      SELECT id, tipo, origen, estado, venta_id, cheque_id
      FROM movimientos_financieros
      WHERE route_item_id = ?
        AND lower(COALESCE(estado, 'activo')) NOT IN ('anulado', 'anulada', 'cancelado', 'cancelada')
      ORDER BY id ASC
    `).all(input.routeItemId) as any[];

    const { currentStatus, nextStatus, version } = assertTransition(item, input.action, activeMovements);
    const nextVersion = version + 1;
    const snapshot = JSON.stringify({
      routeItem: item,
      activeFinancialMovements: normalizeMovements(activeMovements),
    });

    const history = db.prepare(`
      INSERT INTO route_item_status_history (
        route_item_id, route_id, version, action, from_status, to_status,
        reason, changed_by, snapshot
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.routeItemId,
      toNumber(item.route_id),
      nextVersion,
      input.action,
      currentStatus,
      nextStatus,
      reason,
      user,
      snapshot,
    );

    const changedAt = db.prepare("SELECT CURRENT_TIMESTAMP AS changed_at").get() as any;
    const nextVisited = input.action === "visit" ? 1 : 0;
    const nextVisitedAt = input.action === "visit" ? (changedAt?.changed_at || new Date().toISOString()) : null;
    const update = db.prepare(`
      UPDATE route_items
      SET status = ?,
          visitado = ?,
          visited_at = ?,
          notes = CASE WHEN ? IS NULL THEN notes ELSE ? END,
          lifecycle_version = ?,
          status_changed_at = ?,
          status_changed_by = ?,
          status_changed_from = ?,
          status_last_action = ?,
          status_last_reason = ?
      WHERE id = ?
        AND COALESCE(status, 'pendiente') = ?
        AND COALESCE(lifecycle_version, 0) = ?
    `).run(
      nextStatus,
      nextVisited,
      nextVisitedAt,
      notes,
      notes,
      nextVersion,
      changedAt?.changed_at || new Date().toISOString(),
      user,
      currentStatus,
      input.action,
      reason,
      input.routeItemId,
      currentStatus,
      version,
    );

    if (Number(update.changes || 0) !== 1) {
      throw new AppError("La visita cambió mientras se actualizaba", 409);
    }

    if (input.action !== "reopen") {
      db.prepare(`
        UPDATE routes
        SET status = 'en curso'
        WHERE id = ? AND status IN ('planificada', 'pendiente')
      `).run(toNumber(item.route_id));
    }

    return {
      item: db.prepare("SELECT * FROM route_items WHERE id = ? LIMIT 1").get(input.routeItemId),
      historyId: Number(history.lastInsertRowid),
      version: nextVersion,
      previousStatus: currentStatus,
      newStatus: nextStatus,
    };
  })();
};

const handlePostgres = async (input: LifecycleInput, executor?: TransactionClient) => {
  const { user, reason, notes } = validateInput(input);
  const ownsTransaction = !executor;
  const pool = executor ? null : getPostgresPool();
  const client = executor || (await pool!.connect());

  try {
    if (ownsTransaction) await client.query("BEGIN");

    const itemResult = await client.query(
      `SELECT ri.*, r.status AS route_status
       FROM route_items ri
       JOIN routes r ON r.id = ri.route_id
       WHERE ri.id = $1
       LIMIT 1
       FOR UPDATE OF r, ri`,
      [input.routeItemId],
    );
    if (!itemResult.rowCount) throw new AppError("La visita no existe", 404);

    const activeMovementsResult = await client.query(
      `SELECT id, tipo, origen, estado, venta_id, cheque_id
       FROM movimientos_financieros
       WHERE route_item_id = $1
         AND lower(COALESCE(estado, 'activo')) NOT IN ('anulado', 'anulada', 'cancelado', 'cancelada')
       ORDER BY id ASC
       FOR UPDATE`,
      [input.routeItemId],
    );

    const item = itemResult.rows[0];
    const activeMovements = activeMovementsResult.rows;
    const { currentStatus, nextStatus, version } = assertTransition(item, input.action, activeMovements);
    const nextVersion = version + 1;

    const historyResult = await client.query(
      `INSERT INTO route_item_status_history (
         route_item_id, route_id, version, action, from_status, to_status,
         reason, changed_by, snapshot
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
       RETURNING id, changed_at`,
      [
        input.routeItemId,
        toNumber(item.route_id),
        nextVersion,
        input.action,
        currentStatus,
        nextStatus,
        reason,
        user,
        JSON.stringify({
          routeItem: item,
          activeFinancialMovements: normalizeMovements(activeMovements),
        }),
      ],
    );

    const changedAt = historyResult.rows[0]?.changed_at || new Date().toISOString();
    const nextVisited = input.action === "visit" ? 1 : 0;
    const nextVisitedAt = input.action === "visit" ? changedAt : null;
    const updateResult = await client.query(
      `UPDATE route_items
       SET status = $1,
           visitado = $2,
           visited_at = $3,
           notes = CASE WHEN $4::text IS NULL THEN notes ELSE $4 END,
           lifecycle_version = $5,
           status_changed_at = $6,
           status_changed_by = $7,
           status_changed_from = $8,
           status_last_action = $9,
           status_last_reason = $10
       WHERE id = $11
         AND COALESCE(status, 'pendiente') = $12
         AND COALESCE(lifecycle_version, 0) = $13
       RETURNING *`,
      [
        nextStatus,
        nextVisited,
        nextVisitedAt,
        notes,
        nextVersion,
        changedAt,
        user,
        currentStatus,
        input.action,
        reason,
        input.routeItemId,
        currentStatus,
        version,
      ],
    );

    if (!updateResult.rowCount) {
      throw new AppError("La visita cambió mientras se actualizaba", 409);
    }

    if (input.action !== "reopen") {
      await client.query(
        `UPDATE routes
         SET status = 'en curso'
         WHERE id = $1 AND status IN ('planificada', 'pendiente')`,
        [toNumber(item.route_id)],
      );
    }

    if (ownsTransaction) await client.query("COMMIT");

    return {
      item: updateResult.rows[0],
      historyId: toNumber(historyResult.rows[0]?.id),
      version: nextVersion,
      previousStatus: currentStatus,
      newStatus: nextStatus,
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

export const routeItemLifecycleService = {
  async changeStatus(input: LifecycleInput, executor?: TransactionClient) {
    if (!isPostgresConfigured() && !executor) return handleSqlite(input);
    return handlePostgres(input, executor);
  },
};
