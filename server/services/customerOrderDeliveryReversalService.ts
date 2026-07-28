import { getPostgresPool, isPostgresConfigured } from "../utils/postgres.js";
import { AppError } from "../utils/response.js";

type TransactionClient = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

type ReversalInput = {
  customerOrderId: number;
  motivo: string;
  usuario: string;
};

const toNumber = (value: any, fallback = 0) => {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const amountsMatch = (left: any, right: any) => Math.abs(toNumber(left) - toNumber(right)) <= 0.0001;

const appendAuditNote = (current: any, note: string) => {
  const normalized = String(current || "").trim();
  return normalized ? `${normalized}\n${note}` : note;
};

export const customerOrderDeliveryReversalService = {
  async revert(
    { customerOrderId, motivo, usuario }: ReversalInput,
    executor?: TransactionClient
  ) {
    const reason = String(motivo || "").trim();
    const performedBy = String(usuario || "Sistema").trim() || "Sistema";

    if (!Number.isInteger(customerOrderId) || customerOrderId <= 0) {
      throw new AppError("ID de pedido inválido", 400);
    }
    if (reason.length < 3) {
      throw new AppError("El motivo de reversión es obligatorio y debe tener al menos 3 caracteres", 400);
    }
    if (reason.length > 500) {
      throw new AppError("El motivo de reversión no puede superar los 500 caracteres", 400);
    }
    if (!executor && !isPostgresConfigured()) {
      throw new AppError("La reversión de entregas requiere PostgreSQL", 409);
    }

    const ownsTransaction = !executor;
    const pool = executor ? null : getPostgresPool();
    const client = executor || (await pool!.connect());

    try {
      if (ownsTransaction) await client.query("BEGIN");

      const orderResult = await client.query(
        `SELECT co.*
         FROM customer_orders co
         WHERE co.id = $1
         LIMIT 1
         FOR UPDATE OF co`,
        [customerOrderId]
      );

      if (!orderResult.rowCount) throw new AppError("Pedido no encontrado", 404);
      const order = orderResult.rows[0];
      const orderNumber = order.numero_pedido || order.id;

      const saleResult = order.sale_id
        ? await client.query(
            `SELECT id, estado, numero_venta, anulada_at
             FROM sales
             WHERE id = $1
             LIMIT 1
             FOR UPDATE`,
            [order.sale_id]
          )
        : { rows: [], rowCount: 0 };
      const sale = saleResult.rows[0] || null;

      if (toNumber(order.delivery_version) !== 1) {
        throw new AppError("Esta entrega es anterior a la trazabilidad y no puede revertirse automáticamente", 409);
      }
      if (order.delivery_reverted_at) {
        throw new AppError(`La entrega del pedido #${orderNumber} ya fue revertida`, 409);
      }
      if (String(order.estado || "").toLowerCase() !== "entregado") {
        throw new AppError("Solo se puede revertir un pedido que continúa marcado como entregado", 409);
      }
      if (!order.sale_id) {
        throw new AppError("La entrega no posee una venta vinculada", 409);
      }
      if (!sale || String(sale.estado || "").toLowerCase() !== "anulada" || !sale.anulada_at) {
        throw new AppError(
          `Primero debe anularse la Venta N° ${sale?.numero_venta || order.sale_id} desde Ventas`,
          409
        );
      }
      if (order.cancelled_at || String(order.estado || "").toLowerCase() === "cancelado") {
        throw new AppError("El pedido posee una anulación independiente y no puede reabrirse como entrega", 409);
      }

      const deliveryResult = await client.query(
        `SELECT *
         FROM customer_order_deliveries
         WHERE customer_order_id = $1
           AND reverted_at IS NULL
         ORDER BY id DESC
         LIMIT 1
         FOR UPDATE`,
        [customerOrderId]
      );
      if (!deliveryResult.rowCount) {
        throw new AppError("No existe una entrega activa con trazabilidad completa", 409);
      }
      const delivery = deliveryResult.rows[0];
      if (toNumber(delivery.sale_id) !== toNumber(order.sale_id)) {
        throw new AppError("La venta vinculada no coincide con la trazabilidad de la entrega", 409);
      }

      const cancellationResult = await client.query(
        `SELECT id
         FROM sale_cancellations
         WHERE sale_id = $1
         LIMIT 1
         FOR UPDATE`,
        [order.sale_id]
      );
      if (!cancellationResult.rowCount) {
        throw new AppError("La venta figura anulada pero no posee una anulación trazable", 409);
      }

      const itemsResult = await client.query(
        `SELECT codi.*, coi.order_id, coi.product_id AS order_product_id,
                coi.cantidad AS order_quantity, si.sale_id, si.product_id AS sale_product_id,
                si.cantidad AS sale_quantity
         FROM customer_order_delivery_items codi
         JOIN customer_order_items coi ON coi.id = codi.customer_order_item_id
         JOIN sale_items si ON si.id = codi.sale_item_id
         WHERE codi.delivery_id = $1
         ORDER BY codi.id ASC
         FOR UPDATE OF codi, coi, si`,
        [delivery.id]
      );
      if (!itemsResult.rowCount) {
        throw new AppError("La entrega no contiene productos trazables", 409);
      }

      const quantityByProduct = new Map<number, number>();
      for (const item of itemsResult.rows) {
        const productId = toNumber(item.product_id);
        const quantity = toNumber(item.quantity);
        if (
          toNumber(item.order_id) !== customerOrderId ||
          toNumber(item.sale_id) !== toNumber(order.sale_id) ||
          productId !== toNumber(item.order_product_id) ||
          productId !== toNumber(item.sale_product_id) ||
          !amountsMatch(quantity, item.order_quantity) ||
          !amountsMatch(quantity, item.sale_quantity)
        ) {
          throw new AppError("La trazabilidad de productos de la entrega está incompleta", 409);
        }
        quantityByProduct.set(productId, toNumber(quantityByProduct.get(productId)) + quantity);
      }

      const allocationsResult = await client.query(
        `SELECT id, stock_movement_id, product_id, cantidad
         FROM sale_stock_allocations
         WHERE sale_id = $1
         ORDER BY id ASC
         FOR UPDATE`,
        [order.sale_id]
      );
      if (!allocationsResult.rowCount) {
        throw new AppError("La venta anulada no posee trazabilidad de stock", 409);
      }

      const allocatedByProduct = new Map<number, number>();
      const allocationByMovement = new Map<number, { productId: number; quantity: number }>();
      for (const allocation of allocationsResult.rows) {
        const movementId = toNumber(allocation.stock_movement_id);
        const productId = toNumber(allocation.product_id);
        const quantity = toNumber(allocation.cantidad);
        if (!movementId || !productId || quantity <= 0) {
          throw new AppError("La trazabilidad de stock de la venta está incompleta", 409);
        }
        allocatedByProduct.set(productId, toNumber(allocatedByProduct.get(productId)) + quantity);
        const current = allocationByMovement.get(movementId);
        if (current && current.productId !== productId) {
          throw new AppError("Un movimiento de la venta contiene productos incompatibles", 409);
        }
        allocationByMovement.set(movementId, {
          productId,
          quantity: toNumber(current?.quantity) + quantity,
        });
      }
      const movementIds = Array.from(allocationByMovement.keys()).sort((left, right) => left - right);

      for (const [productId, deliveredQuantity] of quantityByProduct.entries()) {
        if (!amountsMatch(deliveredQuantity, allocatedByProduct.get(productId))) {
          throw new AppError("La venta no descontó exactamente los productos de esta entrega", 409);
        }
      }

      const movementsResult = await client.query(
        `SELECT id, product_id, cantidad, sale_id, tipo_movimiento
         FROM stock_movimientos
         WHERE id = ANY($1::int[])
         ORDER BY id ASC
         FOR UPDATE`,
        [movementIds]
      );
      if (movementsResult.rows.length !== movementIds.length) {
        throw new AppError("Faltan movimientos originales de stock de la venta", 409);
      }

      const reversalResult = await client.query(
        `SELECT id, reversed_movement_id, product_id, cantidad
         FROM stock_movimientos
         WHERE reversed_movement_id = ANY($1::int[])
           AND sale_id = $2
           AND tipo_movimiento = 'ingreso'
         ORDER BY id ASC
         FOR UPDATE`,
        [movementIds, order.sale_id]
      );
      const reversedByMovement = new Map<number, number>();
      for (const row of reversalResult.rows) {
        const movementId = toNumber(row.reversed_movement_id);
        const allocation = allocationByMovement.get(movementId);
        if (!allocation || allocation.productId !== toNumber(row.product_id)) {
          throw new AppError("Un contramovimiento de la venta no coincide con la entrega", 409);
        }
        reversedByMovement.set(
          movementId,
          toNumber(reversedByMovement.get(movementId)) + toNumber(row.cantidad)
        );
      }

      for (const movement of movementsResult.rows) {
        const movementId = toNumber(movement.id);
        const allocation = allocationByMovement.get(movementId);
        if (
          toNumber(movement.sale_id) !== toNumber(order.sale_id) ||
          String(movement.tipo_movimiento) !== "egreso" ||
          !amountsMatch(Math.abs(toNumber(movement.cantidad)), allocation?.quantity) ||
          !amountsMatch(reversedByMovement.get(movementId), allocation?.quantity)
        ) {
          throw new AppError("La anulación de la venta todavía no restauró todo el stock de la entrega", 409);
        }
      }

      const revertedAtResult = await client.query(
        `UPDATE customer_order_deliveries
         SET reverted_at = now(), reverted_by = $1, revert_reason = $2
         WHERE id = $3 AND reverted_at IS NULL
         RETURNING reverted_at`,
        [performedBy, reason, delivery.id]
      );
      if (!revertedAtResult.rowCount) throw new AppError("La entrega ya fue revertida", 409);
      const revertedAt = revertedAtResult.rows[0]?.reverted_at || new Date().toISOString();

      const previousStatus = String(delivery.previous_status || "aprobado_pendiente_entrega");
      if (previousStatus !== "aprobado_pendiente_entrega") {
        throw new AppError(`El estado anterior de la entrega es incompatible: ${previousStatus}`, 409);
      }

      const auditNote = `Entrega del pedido revertida. Venta N° ${sale.numero_venta || order.sale_id} anulada. Motivo: ${reason}`;
      const updateResult = await client.query(
        `UPDATE customer_orders
         SET estado = $1,
             sale_id = NULL,
             entregado_at = NULL,
             delivery_reverted_at = $2,
             delivery_reverted_by = $3,
             delivery_revert_reason = $4,
             admin_notes = $5
         WHERE id = $6
           AND estado = 'entregado'
           AND sale_id = $7
         RETURNING *`,
        [
          previousStatus,
          revertedAt,
          performedBy,
          reason,
          appendAuditNote(order.admin_notes, auditNote),
          customerOrderId,
          order.sale_id,
        ]
      );
      if (!updateResult.rowCount) {
        throw new AppError("El pedido cambió durante la reversión", 409);
      }

      if (ownsTransaction) await client.query("COMMIT");

      return {
        order: updateResult.rows[0],
        delivery_id: toNumber(delivery.id),
        sale_id: toNumber(order.sale_id),
        reverted_at: revertedAt,
        restored_units: Array.from(quantityByProduct.values()).reduce((sum, value) => sum + value, 0),
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
