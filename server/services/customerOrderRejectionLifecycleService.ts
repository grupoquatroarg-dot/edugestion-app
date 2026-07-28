import { getPostgresPool, isPostgresConfigured } from "../utils/postgres.js";
import { AppError } from "../utils/response.js";

type TransactionClient = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

type RejectInput = {
  customerOrderId: number;
  motivo: string;
  adminNotes?: string | null;
  usuario: string;
};

type ReopenInput = {
  customerOrderId: number;
  motivo: string;
  usuario: string;
};

const toNumber = (value: any, fallback = 0) => {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const parseSnapshot = (value: any) => {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
};

const normalizeItems = (items: any[]) => items
  .map((item) => ({
    id: toNumber(item.id),
    product_id: toNumber(item.product_id),
    cantidad: toNumber(item.cantidad),
    precio_unitario: toNumber(item.precio_unitario),
  }))
  .sort((left, right) => left.id - right.id);

const validateCommon = (customerOrderId: number, motivo: string, usuario: string) => {
  const reason = String(motivo || "").trim();
  const performedBy = String(usuario || "Sistema").trim() || "Sistema";

  if (!Number.isInteger(customerOrderId) || customerOrderId <= 0) {
    throw new AppError("ID de pedido inválido", 400);
  }
  if (reason.length < 3) {
    throw new AppError("El motivo es obligatorio y debe tener al menos 3 caracteres", 400);
  }
  if (reason.length > 500) {
    throw new AppError("El motivo no puede superar los 500 caracteres", 400);
  }

  return { reason, performedBy };
};

const getClient = async (executor?: TransactionClient) => {
  if (!executor && !isPostgresConfigured()) {
    throw new AppError("El ciclo de rechazo de pedidos requiere PostgreSQL", 409);
  }

  const ownsTransaction = !executor;
  const pool = executor ? null : getPostgresPool();
  const client = executor || (await pool!.connect());
  return { client, ownsTransaction };
};

export const customerOrderRejectionLifecycleService = {
  async reject(
    { customerOrderId, motivo, adminNotes, usuario }: RejectInput,
    executor?: TransactionClient
  ) {
    const { reason, performedBy } = validateCommon(customerOrderId, motivo, usuario);
    const notesAfter = String(adminNotes ?? reason).trim() || reason;
    const { client, ownsTransaction } = await getClient(executor);

    try {
      if (ownsTransaction) await client.query("BEGIN");

      const orderResult = await client.query(
        `SELECT co.*
         FROM customer_orders co
         WHERE co.id = $1
         LIMIT 1
         FOR UPDATE`,
        [customerOrderId]
      );
      if (!orderResult.rowCount) throw new AppError("Pedido no encontrado", 404);

      const order = orderResult.rows[0];
      const currentStatus = String(order.estado || "pendiente_aprobacion");
      if (currentStatus === "rechazado") {
        if (toNumber(order.rejection_version) <= 0) {
          throw new AppError("El pedido rechazado es histórico y no tiene trazabilidad para repetirse o reabrirse", 409);
        }
        throw new AppError("El pedido ya está rechazado", 409);
      }
      if (currentStatus !== "pendiente_aprobacion") {
        throw new AppError("Solo se pueden rechazar pedidos pendientes de aprobación", 409);
      }
      if (order.sale_id || order.cancelled_at || order.entregado_at) {
        throw new AppError("El pedido tiene vínculos incompatibles con el rechazo", 409);
      }

      const activeTraceResult = await client.query(
        `SELECT id
         FROM customer_order_rejections
         WHERE customer_order_id = $1
           AND reopened_at IS NULL
         LIMIT 1
         FOR UPDATE`,
        [customerOrderId]
      );
      if (activeTraceResult.rowCount) {
        throw new AppError("Existe un rechazo activo incompatible con el estado actual del pedido", 409);
      }

      const itemsResult = await client.query(
        `SELECT id, product_id, cantidad, precio_unitario
         FROM customer_order_items
         WHERE order_id = $1
         ORDER BY id ASC`,
        [customerOrderId]
      );
      if (!itemsResult.rowCount) {
        throw new AppError("El pedido no tiene productos trazables", 409);
      }

      const nextVersion = toNumber(order.rejection_version) + 1;
      const snapshot = {
        order,
        items: normalizeItems(itemsResult.rows),
      };

      const traceResult = await client.query(
        `INSERT INTO customer_order_rejections (
           customer_order_id, version, estado_anterior, motivo,
           admin_notes_before, admin_notes_after, rejected_by, snapshot
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
         RETURNING id, rejected_at`,
        [
          customerOrderId,
          nextVersion,
          currentStatus,
          reason,
          order.admin_notes || null,
          notesAfter,
          performedBy,
          JSON.stringify(snapshot),
        ]
      );
      const rejectedAt = traceResult.rows[0]?.rejected_at || new Date().toISOString();

      const updateResult = await client.query(
        `UPDATE customer_orders
         SET estado = 'rechazado',
             rejection_reason = $1,
             admin_notes = $2,
             rejected_at = $3,
             rejected_by = $4,
             rejected_from_status = $5,
             rejection_version = $6,
             reopened_at = NULL,
             reopened_by = NULL,
             reopen_reason = NULL
         WHERE id = $7
           AND estado = 'pendiente_aprobacion'
         RETURNING *`,
        [reason, notesAfter, rejectedAt, performedBy, currentStatus, nextVersion, customerOrderId]
      );
      if (!updateResult.rowCount) {
        throw new AppError("El pedido cambió durante el rechazo", 409);
      }

      if (ownsTransaction) await client.query("COMMIT");

      return {
        order: updateResult.rows[0],
        rejection_id: toNumber(traceResult.rows[0]?.id),
        rejection_version: nextVersion,
        rejected_at: rejectedAt,
      };
    } catch (error) {
      if (ownsTransaction) await client.query("ROLLBACK");
      throw error;
    } finally {
      if (ownsTransaction && "release" in client && typeof (client as any).release === "function") {
        (client as any).release();
      }
    }
  },

  async reopen(
    { customerOrderId, motivo, usuario }: ReopenInput,
    executor?: TransactionClient
  ) {
    const { reason, performedBy } = validateCommon(customerOrderId, motivo, usuario);
    const { client, ownsTransaction } = await getClient(executor);

    try {
      if (ownsTransaction) await client.query("BEGIN");

      const orderResult = await client.query(
        `SELECT co.*
         FROM customer_orders co
         WHERE co.id = $1
         LIMIT 1
         FOR UPDATE`,
        [customerOrderId]
      );
      if (!orderResult.rowCount) throw new AppError("Pedido no encontrado", 404);

      const order = orderResult.rows[0];
      const currentStatus = String(order.estado || "pendiente_aprobacion");
      if (currentStatus !== "rechazado") {
        if (currentStatus === "pendiente_aprobacion" && order.reopened_at) {
          throw new AppError("El pedido ya fue reabierto", 409);
        }
        throw new AppError("Solo se pueden reabrir pedidos rechazados", 409);
      }

      const version = toNumber(order.rejection_version);
      if (version <= 0) {
        throw new AppError("El pedido rechazado es anterior a la trazabilidad y no puede reabrirse automáticamente", 409);
      }
      if (!order.rejected_at || !String(order.rejection_reason || "").trim()) {
        throw new AppError("El rechazo no tiene trazabilidad completa", 409);
      }
      if (order.sale_id || order.cancelled_at || order.entregado_at) {
        throw new AppError("El pedido tiene vínculos incompatibles con la reapertura", 409);
      }

      const traceResult = await client.query(
        `SELECT *
         FROM customer_order_rejections
         WHERE customer_order_id = $1
           AND version = $2
           AND reopened_at IS NULL
         LIMIT 1
         FOR UPDATE`,
        [customerOrderId, version]
      );
      if (!traceResult.rowCount) {
        throw new AppError("No existe un rechazo activo y trazable para reabrir", 409);
      }

      const trace = traceResult.rows[0];
      if (String(trace.estado_anterior) !== "pendiente_aprobacion") {
        throw new AppError("El estado anterior del rechazo es incompatible con la reapertura", 409);
      }
      if (String(trace.motivo || "").trim() !== String(order.rejection_reason || "").trim()) {
        throw new AppError("El motivo actual no coincide con la trazabilidad del rechazo", 409);
      }

      const linkedSupplierOrders = await client.query(
        `SELECT id, estado
         FROM supplier_orders
         WHERE customer_order_id = $1
           AND estado <> 'cancelado'
         ORDER BY id ASC
         FOR UPDATE`,
        [customerOrderId]
      );
      if (linkedSupplierOrders.rowCount) {
        throw new AppError("El pedido tiene pedidos a proveedor activos y no puede reabrirse", 409);
      }

      const currentItemsResult = await client.query(
        `SELECT id, product_id, cantidad, precio_unitario
         FROM customer_order_items
         WHERE order_id = $1
         ORDER BY id ASC`,
        [customerOrderId]
      );
      const snapshot = parseSnapshot(trace.snapshot);
      const snapshotItems = normalizeItems(Array.isArray(snapshot.items) ? snapshot.items : []);
      const currentItems = normalizeItems(currentItemsResult.rows);
      if (!snapshotItems.length || JSON.stringify(snapshotItems) !== JSON.stringify(currentItems)) {
        throw new AppError("El contenido del pedido cambió después del rechazo y no puede restaurarse automáticamente", 409);
      }

      const reopenTraceResult = await client.query(
        `UPDATE customer_order_rejections
         SET reopened_at = now(), reopened_by = $1, reopen_reason = $2
         WHERE id = $3
           AND reopened_at IS NULL
         RETURNING reopened_at`,
        [performedBy, reason, trace.id]
      );
      if (!reopenTraceResult.rowCount) throw new AppError("El pedido ya fue reabierto", 409);
      const reopenedAt = reopenTraceResult.rows[0]?.reopened_at || new Date().toISOString();
      const previousNotes = snapshot?.order?.admin_notes ?? trace.admin_notes_before ?? null;

      const updateResult = await client.query(
        `UPDATE customer_orders
         SET estado = 'pendiente_aprobacion',
             rejection_reason = NULL,
             rejected_at = NULL,
             rejected_by = NULL,
             rejected_from_status = NULL,
             admin_notes = $1,
             reopened_at = $2,
             reopened_by = $3,
             reopen_reason = $4
         WHERE id = $5
           AND estado = 'rechazado'
           AND rejection_version = $6
         RETURNING *`,
        [previousNotes, reopenedAt, performedBy, reason, customerOrderId, version]
      );
      if (!updateResult.rowCount) {
        throw new AppError("El pedido cambió durante la reapertura", 409);
      }

      if (ownsTransaction) await client.query("COMMIT");

      return {
        order: updateResult.rows[0],
        rejection_id: toNumber(trace.id),
        rejection_version: version,
        reopened_at: reopenedAt,
      };
    } catch (error) {
      if (ownsTransaction) await client.query("ROLLBACK");
      throw error;
    } finally {
      if (ownsTransaction && "release" in client && typeof (client as any).release === "function") {
        (client as any).release();
      }
    }
  },
};
