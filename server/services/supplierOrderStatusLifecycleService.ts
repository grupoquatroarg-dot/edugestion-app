import { getPostgresPool, isPostgresConfigured } from "../utils/postgres.js";
import { AppError } from "../utils/response.js";

export type SupplierOrderStatusAction = "advance" | "reopen";

type TransactionClient = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

type LifecycleInput = {
  supplierOrderId: number;
  action: SupplierOrderStatusAction;
  motivo?: string | null;
  usuario: string;
};

const nextStatusByCurrent: Record<SupplierOrderStatusAction, Record<string, string>> = {
  advance: {
    pendiente: "pedido_realizado",
    pedido_realizado: "auditar_pedido",
  },
  reopen: {
    pedido_realizado: "pendiente",
    auditar_pedido: "pedido_realizado",
  },
};

const toNumber = (value: any, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalize = (value: unknown) => String(value ?? "").trim();

const validateInput = (input: LifecycleInput) => {
  if (!Number.isInteger(input.supplierOrderId) || input.supplierOrderId <= 0) {
    throw new AppError("ID de pedido inválido", 400);
  }
  if (!Object.prototype.hasOwnProperty.call(nextStatusByCurrent, input.action)) {
    throw new AppError("Acción de estado inválida", 400);
  }

  const user = normalize(input.usuario) || "Sistema";
  const reason = normalize(input.motivo);

  if (input.action === "reopen") {
    if (reason.length < 3) {
      throw new AppError("El motivo de reapertura es obligatorio y debe tener al menos 3 caracteres", 400);
    }
    if (reason.length > 500) {
      throw new AppError("El motivo no puede superar los 500 caracteres", 400);
    }
  }

  return {
    user,
    reason: input.action === "reopen" ? reason : null,
  };
};

const assertTransition = (order: any, action: SupplierOrderStatusAction) => {
  if (!order) throw new AppError("Pedido no encontrado", 404);

  const currentStatus = normalize(order.estado || "pendiente").toLowerCase();
  if (["entregado", "cancelado"].includes(currentStatus)) {
    throw new AppError("El pedido está cerrado y no permite cambios manuales de etapa", 409);
  }
  if (toNumber(order.stock_actualizado) === 1 || order.delivered_at) {
    throw new AppError("El pedido ya actualizó stock y no permite cambios manuales de etapa", 409);
  }
  if (order.cancelled_at) {
    throw new AppError("El pedido fue anulado y debe conservarse como historial", 409);
  }
  if (order.sale_id) {
    throw new AppError("El pedido está vinculado a una venta y no permite cambios manuales de etapa", 409);
  }

  const nextStatus = nextStatusByCurrent[action][currentStatus];
  if (!nextStatus) {
    if (action === "advance") {
      throw new AppError("El pedido no se encuentra en una etapa que pueda avanzarse", 409);
    }
    throw new AppError("El pedido no se encuentra en una etapa que pueda reabrirse", 409);
  }

  return { currentStatus, nextStatus };
};

const normalizeItems = (items: any[]) => items
  .map((item) => ({
    id: toNumber(item.id),
    product_id: toNumber(item.product_id),
    cantidad: toNumber(item.cantidad),
  }))
  .sort((left, right) => left.id - right.id);

const handleSqlite = async (input: LifecycleInput) => {
  const { user, reason } = validateInput(input);
  const { default: db } = await import("../db.js");

  return db.transaction(() => {
    const order = db.prepare("SELECT * FROM supplier_orders WHERE id = ? LIMIT 1")
      .get(input.supplierOrderId) as any;
    const { currentStatus, nextStatus } = assertTransition(order, input.action);

    const items = db.prepare(`
      SELECT id, product_id, cantidad
      FROM supplier_order_items
      WHERE order_id = ?
      ORDER BY id ASC
    `).all(input.supplierOrderId) as any[];
    if (!items.length) throw new AppError("El pedido no tiene productos trazables", 409);

    const nextVersion = toNumber(order.status_version) + 1;
    const snapshot = JSON.stringify({ order, items: normalizeItems(items) });

    const history = db.prepare(`
      INSERT INTO supplier_order_status_history (
        supplier_order_id, version, action, from_status, to_status,
        reason, changed_by, snapshot
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.supplierOrderId,
      nextVersion,
      input.action,
      currentStatus,
      nextStatus,
      reason,
      user,
      snapshot
    );

    const changedAt = db.prepare("SELECT CURRENT_TIMESTAMP AS changed_at").get() as any;
    const update = db.prepare(`
      UPDATE supplier_orders
      SET estado = ?,
          status_version = ?,
          status_changed_at = ?,
          status_changed_by = ?,
          status_changed_from = ?,
          status_last_action = ?,
          status_last_reason = ?
      WHERE id = ? AND estado = ?
    `).run(
      nextStatus,
      nextVersion,
      changedAt?.changed_at || new Date().toISOString(),
      user,
      currentStatus,
      input.action,
      reason,
      input.supplierOrderId,
      currentStatus
    );

    if (Number(update.changes || 0) !== 1) {
      throw new AppError("El pedido cambió mientras se actualizaba la etapa", 409);
    }

    return {
      order: db.prepare("SELECT * FROM supplier_orders WHERE id = ? LIMIT 1").get(input.supplierOrderId),
      historyId: Number(history.lastInsertRowid),
      version: nextVersion,
      previousStatus: currentStatus,
      newStatus: nextStatus,
    };
  })();
};

const handlePostgres = async (input: LifecycleInput, executor?: TransactionClient) => {
  const { user, reason } = validateInput(input);
  const ownsTransaction = !executor;
  const pool = executor ? null : getPostgresPool();
  const client = executor || (await pool!.connect());

  try {
    if (ownsTransaction) await client.query("BEGIN");

    const orderResult = await client.query(
      `SELECT *
       FROM supplier_orders
       WHERE id = $1
       LIMIT 1
       FOR UPDATE`,
      [input.supplierOrderId]
    );
    if (!orderResult.rowCount) throw new AppError("Pedido no encontrado", 404);

    const order = orderResult.rows[0];
    const { currentStatus, nextStatus } = assertTransition(order, input.action);

    const itemsResult = await client.query(
      `SELECT id, product_id, cantidad
       FROM supplier_order_items
       WHERE order_id = $1
       ORDER BY id ASC`,
      [input.supplierOrderId]
    );
    if (!itemsResult.rowCount) throw new AppError("El pedido no tiene productos trazables", 409);

    const nextVersion = toNumber(order.status_version) + 1;
    const historyResult = await client.query(
      `INSERT INTO supplier_order_status_history (
         supplier_order_id, version, action, from_status, to_status,
         reason, changed_by, snapshot
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       RETURNING id, changed_at`,
      [
        input.supplierOrderId,
        nextVersion,
        input.action,
        currentStatus,
        nextStatus,
        reason,
        user,
        JSON.stringify({ order, items: normalizeItems(itemsResult.rows) }),
      ]
    );

    const changedAt = historyResult.rows[0]?.changed_at || new Date().toISOString();
    const updateResult = await client.query(
      `UPDATE supplier_orders
       SET estado = $1,
           status_version = $2,
           status_changed_at = $3,
           status_changed_by = $4,
           status_changed_from = $5,
           status_last_action = $6,
           status_last_reason = $7
       WHERE id = $8
         AND estado = $9
         AND COALESCE(status_version, 0) = $10
       RETURNING *`,
      [
        nextStatus,
        nextVersion,
        changedAt,
        user,
        currentStatus,
        input.action,
        reason,
        input.supplierOrderId,
        currentStatus,
        toNumber(order.status_version),
      ]
    );

    if (!updateResult.rowCount) {
      throw new AppError("El pedido cambió mientras se actualizaba la etapa", 409);
    }

    if (ownsTransaction) await client.query("COMMIT");

    return {
      order: updateResult.rows[0],
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

export const supplierOrderStatusLifecycleService = {
  async changeStatus(input: LifecycleInput, executor?: TransactionClient) {
    if (!isPostgresConfigured() && !executor) return handleSqlite(input);
    return handlePostgres(input, executor);
  },
};
