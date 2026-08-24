import { getPostgresPool, isPostgresConfigured } from "../utils/postgres.js";
import { AppError } from "../utils/response.js";
import { salesService } from "./salesService.js";

type TransactionClient = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

type DeliveryInput = {
  customerOrderId: number;
  usuario: string;
};

const toNumber = (value: any, fallback = 0) => {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const amountsMatch = (left: any, right: any) => Math.abs(toNumber(left) - toNumber(right)) <= 0.0001;

export const customerOrderDeliveryService = {
  async deliver(
    { customerOrderId, usuario }: DeliveryInput,
    executor?: TransactionClient
  ) {
    const performedBy = String(usuario || "Sistema").trim() || "Sistema";

    if (!Number.isInteger(customerOrderId) || customerOrderId <= 0) {
      throw new AppError("ID de pedido inválido", 400);
    }

    if (!executor && !isPostgresConfigured()) {
      throw new AppError("La entrega auditada de pedidos requiere PostgreSQL", 409);
    }

    const ownsTransaction = !executor;
    const pool = executor ? null : getPostgresPool();
    const client = executor || (await pool!.connect());

    try {
      if (ownsTransaction) await client.query("BEGIN");

      const orderResult = await client.query(
        `SELECT co.*, c.nombre_apellido AS cliente, c.telefono AS cliente_telefono, c.activo AS cliente_activo
         FROM customer_orders co
         JOIN clientes c ON c.id = co.cliente_id
         WHERE co.id = $1
         LIMIT 1
         FOR UPDATE OF co, c`,
        [customerOrderId]
      );

      if (!orderResult.rowCount) throw new AppError("Pedido no encontrado", 404);
      const order = orderResult.rows[0];
      const orderNumber = order.numero_pedido || order.id;
      const previousStatus = String(order.estado || "").toLowerCase();

      if (previousStatus !== "aprobado_pendiente_entrega") {
        throw new AppError("Solo se pueden entregar pedidos aprobados y pendientes de entrega", 409);
      }
      if (Number(order.cliente_activo ?? 1) === 0) {
        throw new AppError("El cliente está inactivo. Reactivalo antes de entregar el pedido.", 409);
      }
      if (order.sale_id) {
        throw new AppError("El pedido ya posee una venta vinculada", 409);
      }

      const activeDelivery = await client.query(
        `SELECT id
         FROM customer_order_deliveries
         WHERE customer_order_id = $1
           AND reverted_at IS NULL
         LIMIT 1
         FOR UPDATE`,
        [customerOrderId]
      );
      if (activeDelivery.rowCount) {
        throw new AppError("El pedido ya posee una entrega activa registrada", 409);
      }

      const itemsResult = await client.query(
        `SELECT coi.id, coi.product_id, coi.cantidad, coi.precio_unitario, p.name AS product_name
         FROM customer_order_items coi
         JOIN products p ON p.id = coi.product_id
         WHERE coi.order_id = $1
         ORDER BY coi.id ASC
         FOR UPDATE OF coi`,
        [customerOrderId]
      );

      if (!itemsResult.rowCount) throw new AppError("El pedido no tiene productos", 409);
      const items = itemsResult.rows;

      const subtotal = toNumber(order.subtotal);
      const discountAmount = toNumber(order.descuento_monto);
      const equivalentDiscountPct = subtotal > 0
        ? Math.min(100, (discountAmount / subtotal) * 100)
        : 0;

      const saleResult = await salesService.createSale(
        {
          cliente_id: toNumber(order.cliente_id),
          nombre_cliente: order.cliente,
          metodo_pago: "Cta Cte",
          monto_pagado: 0,
          notes: `Pedido cliente #${orderNumber}`,
          usuario: performedBy,
          allow_shortage: false,
          use_supplied_prices: true,
          items: items.map((item: any) => ({
            product_id: toNumber(item.product_id),
            cantidad: toNumber(item.cantidad),
            precio_venta: toNumber(item.precio_unitario),
            precio_unitario_original: toNumber(item.precio_unitario),
            bonificacion_tipo: equivalentDiscountPct > 0 ? "percentage" : "none",
            bonificacion_valor: equivalentDiscountPct,
          })),
        },
        client
      );

      const saleId = toNumber(saleResult.saleId);
      const saleItemsResult = await client.query(
        `SELECT id, product_id, cantidad, precio_venta
         FROM sale_items
         WHERE sale_id = $1
         ORDER BY id ASC
         FOR UPDATE`,
        [saleId]
      );

      if (saleItemsResult.rows.length !== items.length) {
        throw new AppError("La venta generada no coincide con los productos del pedido", 409);
      }

      for (let index = 0; index < items.length; index += 1) {
        const orderItem = items[index];
        const saleItem = saleItemsResult.rows[index];
        if (
          toNumber(orderItem.product_id) !== toNumber(saleItem.product_id) ||
          !amountsMatch(orderItem.cantidad, saleItem.cantidad)
        ) {
          throw new AppError("La trazabilidad de productos de la entrega es inconsistente", 409);
        }
      }

      const deliveryResult = await client.query(
        `INSERT INTO customer_order_deliveries (
           customer_order_id, sale_id, previous_status, delivered_by, snapshot
         )
         VALUES ($1, $2, $3, $4, $5::jsonb)
         RETURNING id, delivered_at`,
        [
          customerOrderId,
          saleId,
          previousStatus,
          performedBy,
          JSON.stringify({ order, items, sale: saleResult }),
        ]
      );

      const deliveryId = toNumber(deliveryResult.rows[0]?.id);
      const deliveredAt = deliveryResult.rows[0]?.delivered_at || new Date().toISOString();

      for (let index = 0; index < items.length; index += 1) {
        const orderItem = items[index];
        const saleItem = saleItemsResult.rows[index];
        await client.query(
          `INSERT INTO customer_order_delivery_items (
             delivery_id, customer_order_item_id, product_id, quantity, sale_item_id
           )
           VALUES ($1, $2, $3, $4, $5)`,
          [
            deliveryId,
            toNumber(orderItem.id),
            toNumber(orderItem.product_id),
            toNumber(orderItem.cantidad),
            toNumber(saleItem.id),
          ]
        );
      }

      const updateResult = await client.query(
        `UPDATE customer_orders
         SET estado = 'entregado',
             sale_id = $1,
             entregado_at = $2,
             delivery_version = 1,
             delivered_by = $3,
             delivered_from_status = $4,
             delivery_reverted_at = NULL,
             delivery_reverted_by = NULL,
             delivery_revert_reason = NULL
         WHERE id = $5
           AND estado = 'aprobado_pendiente_entrega'
           AND sale_id IS NULL
         RETURNING *`,
        [saleId, deliveredAt, performedBy, previousStatus, customerOrderId]
      );

      if (!updateResult.rowCount) {
        throw new AppError("El pedido cambió de estado durante la entrega", 409);
      }

      if (ownsTransaction) await client.query("COMMIT");

      return {
        ...saleResult,
        orderId: customerOrderId,
        deliveryId,
        deliveredAt,
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
