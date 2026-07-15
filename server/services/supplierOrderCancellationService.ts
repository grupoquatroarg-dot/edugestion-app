import { getPostgresPool, isPostgresConfigured } from "../utils/postgres.js";
import { AppError } from "../utils/response.js";

type TransactionClient = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

type CancellationInput = {
  supplierOrderId: number;
  motivo: string;
  usuario: string;
};

const toNumber = (value: any, fallback: number = 0) => {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const ACTIVE_STATES = ["pendiente", "pedido_realizado", "auditar_pedido"];
const CLOSED_CUSTOMER_STATES = ["cancelado", "rechazado"];

export const supplierOrderCancellationService = {
  async cancelSupplierOrder(
    { supplierOrderId, motivo, usuario }: CancellationInput,
    executor?: TransactionClient
  ) {
    const normalizedReason = String(motivo || "").trim();
    const normalizedUser = String(usuario || "Sistema").trim() || "Sistema";

    if (!Number.isInteger(supplierOrderId) || supplierOrderId <= 0) {
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
      throw new AppError(
        "La anulación de pedidos a proveedor requiere PostgreSQL",
        409
      );
    }

    const pool = executor ? null : getPostgresPool();
    const client = executor || (await pool!.connect());

    try {
      await client.query("BEGIN");

      const orderResult = await client.query(
        `SELECT
           so.*,
           s.estado AS sale_estado,
           co.estado AS customer_order_estado
         FROM supplier_orders so
         LEFT JOIN sales s ON s.id = so.sale_id
         LEFT JOIN customer_orders co ON co.id = so.customer_order_id
         WHERE so.id = $1
         LIMIT 1
         FOR UPDATE OF so`,
        [supplierOrderId]
      );

      if (!orderResult.rowCount) {
        throw new AppError("Pedido a proveedor no encontrado", 404);
      }

      const order = orderResult.rows[0];
      const orderNumber = order.numero_pedido || order.id;
      const currentState = String(order.estado || "").toLowerCase();

      if (currentState === "cancelado" || order.cancelled_at) {
        throw new AppError(`El pedido #${orderNumber} ya fue anulado`, 409);
      }

      const existingCancellation = await client.query(
        `SELECT id
         FROM supplier_order_cancellations
         WHERE supplier_order_id = $1
         LIMIT 1`,
        [supplierOrderId]
      );

      if (existingCancellation.rowCount) {
        throw new AppError(`El pedido #${orderNumber} ya posee una anulación registrada`, 409);
      }

      if (
        currentState === "entregado" ||
        toNumber(order.stock_actualizado) === 1
      ) {
        throw new AppError(
          "No se puede anular un pedido entregado o que ya actualizó stock. Debe conservarse como historial.",
          409
        );
      }

      if (!ACTIVE_STATES.includes(currentState)) {
        throw new AppError(
          `El pedido se encuentra en un estado no reversible: ${order.estado || "sin estado"}`,
          409
        );
      }

      if (order.sale_id !== null && order.sale_id !== undefined) {
        const saleState = String(order.sale_estado || "").toLowerCase();

        if (!saleState) {
          throw new AppError(
            "El pedido está vinculado a una venta inexistente o inconsistente",
            409
          );
        }

        if (saleState !== "anulada") {
          throw new AppError(
            "El pedido está vinculado a una venta activa. Primero debe anularse la venta de origen.",
            409
          );
        }
      }

      if (order.customer_order_id !== null && order.customer_order_id !== undefined) {
        const customerOrderState = String(order.customer_order_estado || "").toLowerCase();

        if (!customerOrderState) {
          throw new AppError(
            "El pedido está vinculado a un pedido de cliente inexistente o inconsistente",
            409
          );
        }

        if (!CLOSED_CUSTOMER_STATES.includes(customerOrderState)) {
          throw new AppError(
            "El pedido está vinculado a un pedido de cliente activo. Primero debe cancelarse o rechazarse el pedido de origen.",
            409
          );
        }
      }

      const itemsResult = await client.query(
        `SELECT
           soi.id,
           soi.product_id,
           soi.cantidad,
           p.name AS product_name,
           COALESCE(p.codigo_unico, p.code, '') AS product_code
         FROM supplier_order_items soi
         JOIN products p ON p.id = soi.product_id
         WHERE soi.order_id = $1
         ORDER BY soi.id ASC`,
        [supplierOrderId]
      );

      if (!itemsResult.rowCount) {
        throw new AppError(
          "El pedido no contiene productos y no puede anularse automáticamente",
          409
        );
      }

      const snapshot = {
        order,
        items: itemsResult.rows,
      };

      const cancellationResult = await client.query(
        `INSERT INTO supplier_order_cancellations (
           supplier_order_id,
           motivo,
           cancelado_por,
           estado_original,
           cancellation_source,
           snapshot
         )
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         RETURNING id, cancelado_at`,
        [
          supplierOrderId,
          normalizedReason,
          normalizedUser,
          currentState,
          "manual",
          JSON.stringify(snapshot),
        ]
      );

      const cancellationId = toNumber(cancellationResult.rows[0]?.id);
      const cancelledAt =
        cancellationResult.rows[0]?.cancelado_at || new Date().toISOString();

      await client.query(
        `UPDATE supplier_orders
         SET estado = 'cancelado',
             cancelled_at = $1,
             cancelled_by = $2,
             cancel_reason = $3,
             cancellation_source = 'manual',
             cancelled_from_status = $4
         WHERE id = $5`,
        [
          cancelledAt,
          normalizedUser,
          normalizedReason,
          currentState,
          supplierOrderId,
        ]
      );

      await client.query("COMMIT");

      return {
        order: {
          ...order,
          estado: "cancelado",
          cancelled_at: cancelledAt,
          cancelled_by: normalizedUser,
          cancel_reason: normalizedReason,
          cancellation_source: "manual",
          cancelled_from_status: currentState,
        },
        cancellation_id: cancellationId,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      if (!executor && "release" in client && typeof (client as any).release === "function") {
        (client as any).release();
      }
    }
  },
};
