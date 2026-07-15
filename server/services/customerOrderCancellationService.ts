import { getPostgresPool, isPostgresConfigured } from "../utils/postgres.js";
import { AppError } from "../utils/response.js";
import { supplierOrderCancellationService } from "./supplierOrderCancellationService.js";

type TransactionClient = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

type CancellationSource = "manual" | "customer_portal" | "sale_cancellation";

type CancellationInput = {
  customerOrderId: number;
  motivo: string;
  usuario: string;
  source?: CancellationSource;
  customerId?: number | null;
};

const MANUAL_REVERSIBLE_STATES = ["pendiente_aprobacion", "aprobado_pendiente_entrega"];

const toNumber = (value: any, fallback = 0) => {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const appendAuditNote = (current: any, note: string) => {
  const normalizedCurrent = String(current || "").trim();
  if (!normalizedCurrent) return note;
  if (normalizedCurrent.includes(note)) return normalizedCurrent;
  return `${normalizedCurrent}\n${note}`;
};

export const customerOrderCancellationService = {
  async cancelCustomerOrder(
    {
      customerOrderId,
      motivo,
      usuario,
      source = "manual",
      customerId = null,
    }: CancellationInput,
    executor?: TransactionClient
  ) {
    const normalizedReason = String(motivo || "").trim();
    const normalizedUser = String(usuario || "Sistema").trim() || "Sistema";

    if (!Number.isInteger(customerOrderId) || customerOrderId <= 0) {
      throw new AppError("ID de pedido inválido", 400);
    }

    if (normalizedReason.length < 3) {
      throw new AppError(
        "El motivo de anulación es obligatorio y debe tener al menos 3 caracteres",
        400
      );
    }

    if (normalizedReason.length > 500) {
      throw new AppError("El motivo de anulación no puede superar los 500 caracteres", 400);
    }

    if (!executor && !isPostgresConfigured()) {
      throw new AppError("La anulación de pedidos de clientes requiere PostgreSQL", 409);
    }

    const ownsTransaction = !executor;
    const pool = executor ? null : getPostgresPool();
    const client = executor || (await pool!.connect());

    try {
      if (ownsTransaction) await client.query("BEGIN");

      const orderResult = await client.query(
        `SELECT
           co.*,
           s.estado AS sale_estado,
           s.numero_venta
         FROM customer_orders co
         LEFT JOIN sales s ON s.id = co.sale_id
         WHERE co.id = $1
         LIMIT 1
         FOR UPDATE OF co`,
        [customerOrderId]
      );

      if (!orderResult.rowCount) {
        throw new AppError("Pedido de cliente no encontrado", 404);
      }

      const order = orderResult.rows[0];
      const orderNumber = order.numero_pedido || order.id;
      const currentState = String(order.estado || "").toLowerCase();

      if (customerId !== null && toNumber(order.cliente_id) !== toNumber(customerId)) {
        throw new AppError("No tenés permiso para cancelar este pedido", 403);
      }

      if (currentState === "cancelado" || order.cancelled_at) {
        throw new AppError(`El pedido #${orderNumber} ya fue cancelado`, 409);
      }

      const existingCancellation = await client.query(
        `SELECT id
         FROM customer_order_cancellations
         WHERE customer_order_id = $1
         LIMIT 1`,
        [customerOrderId]
      );

      if (existingCancellation.rowCount) {
        throw new AppError(`El pedido #${orderNumber} ya posee una anulación registrada`, 409);
      }

      if (currentState === "rechazado") {
        throw new AppError("El pedido ya fue rechazado y debe conservarse como historial", 409);
      }

      if (source === "customer_portal" && currentState !== "pendiente_aprobacion") {
        throw new AppError(
          "Solo podés cancelar pedidos pendientes de aprobación desde el portal",
          409
        );
      }

      if (currentState === "entregado") {
        if (!order.sale_id) {
          throw new AppError(
            "El pedido figura entregado pero no posee una venta vinculada. Debe revisarse antes de anularlo.",
            409
          );
        }

        if (String(order.sale_estado || "").toLowerCase() !== "anulada") {
          throw new AppError(
            `El pedido ya fue entregado y está vinculado a la Venta N° ${order.numero_venta || order.sale_id}. Primero debe anularse esa venta.`,
            409
          );
        }
      } else if (!MANUAL_REVERSIBLE_STATES.includes(currentState)) {
        throw new AppError(
          `El pedido se encuentra en un estado no reversible: ${order.estado || "sin estado"}`,
          409
        );
      }

      const itemsResult = await client.query(
        `SELECT
           coi.id,
           coi.product_id,
           coi.cantidad,
           coi.precio_unitario,
           p.name AS product_name,
           COALESCE(p.codigo_unico, p.code, '') AS product_code
         FROM customer_order_items coi
         JOIN products p ON p.id = coi.product_id
         WHERE coi.order_id = $1
         ORDER BY coi.id ASC`,
        [customerOrderId]
      );

      if (!itemsResult.rowCount) {
        throw new AppError(
          "El pedido no contiene productos y no puede anularse automáticamente",
          409
        );
      }

      const supplierOrdersResult = await client.query(
        `SELECT id, numero_pedido, estado, stock_actualizado, notes
         FROM supplier_orders
         WHERE customer_order_id = $1
         ORDER BY id ASC
         FOR UPDATE`,
        [customerOrderId]
      );

      const snapshot = {
        order,
        items: itemsResult.rows,
        supplier_orders: supplierOrdersResult.rows,
      };

      const cancellationResult = await client.query(
        `INSERT INTO customer_order_cancellations (
           customer_order_id,
           motivo,
           cancelado_por,
           estado_original,
           cancellation_source,
           snapshot
         )
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         RETURNING id, cancelado_at`,
        [
          customerOrderId,
          normalizedReason,
          normalizedUser,
          currentState,
          source,
          JSON.stringify(snapshot),
        ]
      );

      const cancellationId = toNumber(cancellationResult.rows[0]?.id);
      const cancelledAt =
        cancellationResult.rows[0]?.cancelado_at || new Date().toISOString();
      const auditNote = `Pedido cancelado. Motivo: ${normalizedReason}`;

      await client.query(
        `UPDATE customer_orders
         SET estado = 'cancelado',
             cancelled_at = $1,
             cancelled_by = $2,
             cancel_reason = $3,
             cancellation_source = $4,
             cancelled_from_status = $5,
             admin_notes = $6
         WHERE id = $7`,
        [
          cancelledAt,
          normalizedUser,
          normalizedReason,
          source,
          currentState,
          appendAuditNote(order.admin_notes, auditNote),
          customerOrderId,
        ]
      );

      const cancelledSupplierOrderIds: number[] = [];
      const supplierReason = `Cancelado por anulación del Pedido de Cliente #${orderNumber}. Motivo: ${normalizedReason}`;

      for (const supplierOrder of supplierOrdersResult.rows) {
        const supplierState = String(supplierOrder.estado || "").toLowerCase();
        if (!["pendiente", "pedido_realizado", "auditar_pedido"].includes(supplierState)) {
          continue;
        }

        const result = await supplierOrderCancellationService.cancelSupplierOrder(
          {
            supplierOrderId: toNumber(supplierOrder.id),
            motivo: supplierReason,
            usuario: normalizedUser,
            source: "customer_order_cancellation",
          },
          client
        );

        cancelledSupplierOrderIds.push(toNumber(result.order.id));
      }

      if (ownsTransaction) await client.query("COMMIT");

      return {
        order: {
          ...order,
          estado: "cancelado",
          cancelled_at: cancelledAt,
          cancelled_by: normalizedUser,
          cancel_reason: normalizedReason,
          cancellation_source: source,
          cancelled_from_status: currentState,
        },
        cancellation_id: cancellationId,
        cancelled_supplier_order_ids: cancelledSupplierOrderIds,
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
