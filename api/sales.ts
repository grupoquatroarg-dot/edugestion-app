import { z } from "zod";
import { salesRepository } from "../server/repositories/salesRepository.js";
import { salesService } from "../server/services/salesService.js";
import { UserRepository } from "../server/repositories/userRepository.js";
import { requireBearerUser } from "../server/services/currentUserAuthService.js";
import { sendError, sendSuccess } from "../server/utils/response.js";
import { getPostgresPool } from "../server/utils/postgres.js";
import { normalizeBusinessDateForStorage } from "../server/utils/businessDate.js";
import { saleTraceService } from "../server/services/saleTraceService.js";
import type { SaleStockAllocationInput } from "../server/services/saleTraceService.js";
import { saleCancellationService } from "../server/services/saleCancellationService.js";
import { supplierOrderCancellationService } from "../server/services/supplierOrderCancellationService.js";
import { supplierOrderDeliveryReversalService } from "../server/services/supplierOrderDeliveryReversalService.js";
import { supplierOrderStatusLifecycleService } from "../server/services/supplierOrderStatusLifecycleService.js";
import { supplierOrderContentLifecycleService } from "../server/services/supplierOrderContentLifecycleService.js";
import { customerOrderCancellationService } from "../server/services/customerOrderCancellationService.js";
import { customerOrderDeliveryService } from "../server/services/customerOrderDeliveryService.js";
import { customerOrderDeliveryReversalService } from "../server/services/customerOrderDeliveryReversalService.js";
import { customerOrderRejectionLifecycleService } from "../server/services/customerOrderRejectionLifecycleService.js";
import { customerOrderApprovalService } from "../server/services/customerOrderApprovalService.js";
import { customerOrderContentLifecycleService } from "../server/services/customerOrderContentLifecycleService.js";
import { assertPaymentMethodActive } from "../server/services/paymentMethodAvailabilityService.js";
import { petiSalesReportService } from "../server/services/petiSalesReportService.js";

const saleSchema = z.object({
  cliente_id: z.number(),
  nombre_cliente: z.string().optional(),
  metodo_pago: z.string(),
  monto_pagado: z.number().nonnegative().optional(),
  notes: z.string().optional(),
  cheque_data: z.any().optional(),
  route_item_id: z.number().int().positive().optional(),
  flete_porcentaje: z.number().min(0).max(100).optional(),
  items: z.array(z.object({
    product_id: z.number(),
    cantidad: z.number().positive(),
    precio_venta: z.number().nonnegative(),
    precio_unitario_original: z.number().nonnegative().optional(),
    bonificacion_tipo: z.enum(["none", "percentage", "fixed"]).optional(),
    bonificacion_valor: z.number().nonnegative().optional(),
    precio_unitario_bonificado: z.number().nonnegative().optional(),
  })).min(1, "Debe incluir al menos un producto"),
  total: z.number().nonnegative(),
});

const saleCancellationSchema = z.object({
  motivo: z.string().trim().min(3, "El motivo de anulación es obligatorio").max(500, "El motivo es demasiado extenso"),
});

const paymentSchema = z.object({
  monto: z.number().positive("El monto debe ser mayor a cero"),
  metodo_pago: z.string().min(1, "Método de pago requerido"),
  observaciones: z.string().optional(),
  fecha: z.string().optional(),
  route_item_id: z.number().int().positive().optional(),
  cheque_data: z.object({
    numero_cheque: z.string().trim().min(1, 'Número de cheque requerido'),
    banco: z.string().trim().min(1, 'Banco requerido'),
    fecha_vencimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha de vencimiento inválida'),
    importe: z.number().positive(),
  }).optional(),
});

const supplierOrderSchema = z.object({
  cliente: z.string().optional(),
  cliente_id: z.number().optional().nullable(),
  notes: z.string().optional().nullable(),
  items: z.array(z.object({
    product_id: z.number(),
    cantidad: z.number().positive(),
  })).min(1, "Debe incluir al menos un producto"),
});

const supplierOrderStatusSchema = z.object({
  action: z.enum(["advance", "reopen"]),
  motivo: z.string().trim().max(500, "El motivo es demasiado extenso").optional(),
});

const supplierOrderItemsSchema = z.object({
  notes: z.string().max(2000, "Las observaciones son demasiado extensas").optional().nullable(),
  motivo: z.string().trim().min(3, "El motivo del cambio es obligatorio").max(500, "El motivo es demasiado extenso"),
  expected_content_version: z.number().int().nonnegative(),
  expected_status_version: z.number().int().nonnegative(),
  items: z.array(z.object({
    product_id: z.number().int().positive(),
    cantidad: z.number().int().positive(),
  })).min(1, "Debe incluir al menos un producto"),
});

const supplierOrderCompleteSchema = z.object({
  metodo_pago: z.string().optional(),
  monto_pagado: z.number().nonnegative().optional(),
});

const supplierOrderCancellationSchema = z.object({
  motivo: z.string().trim().min(3, "El motivo de anulación es obligatorio").max(500, "El motivo es demasiado extenso"),
});

const supplierOrderDeliveryReversalSchema = z.object({
  motivo: z.string().trim().min(3, "El motivo de reversión es obligatorio").max(500, "El motivo es demasiado extenso"),
});

const customerOrderApproveSchema = z.object({
  descuento_tipo: z.enum(["none", "percentage", "fixed"]).optional(),
  descuento_valor: z.number().nonnegative().optional(),
  admin_notes: z.string().max(2000, "La observación es demasiado extensa").optional().nullable(),
  expected_approval_version: z.number().int().nonnegative(),
  expected_rejection_version: z.number().int().nonnegative(),
  expected_content_version: z.number().int().nonnegative(),
});

const customerOrderRejectSchema = z.object({
  motivo: z.string().trim().min(3, "El motivo es obligatorio").max(500, "El motivo es demasiado extenso"),
  admin_notes: z.string().max(2000, "La observación es demasiado extensa").optional().nullable(),
});

const customerOrderReopenSchema = z.object({
  motivo: z.string().trim().min(3, "El motivo de reapertura es obligatorio").max(500, "El motivo es demasiado extenso"),
});

const customerOrderCancellationSchema = z.object({
  motivo: z.string().trim().min(3, "El motivo de anulación es obligatorio").max(500, "El motivo es demasiado extenso"),
});

const customerOrderDeliveryReversalSchema = z.object({
  motivo: z.string().trim().min(3, "El motivo de reversión es obligatorio").max(500, "El motivo es demasiado extenso"),
});

const customerOrderUpdateSchema = z.object({
  items: z.array(z.object({
    product_id: z.number().int().positive(),
    cantidad: z.number().int().positive(),
  })).min(1, "Debe incluir al menos un producto"),
  descuento_tipo: z.enum(["none", "percentage", "fixed"]).optional(),
  descuento_valor: z.number().nonnegative().optional(),
  admin_notes: z.string().max(2000, "La observación es demasiado extensa").optional().nullable(),
  motivo: z.string().trim().min(3, "El motivo del cambio es obligatorio").max(500, "El motivo es demasiado extenso"),
  expected_content_version: z.number().int().nonnegative(),
  expected_approval_version: z.number().int().nonnegative(),
  expected_rejection_version: z.number().int().nonnegative(),
});

const customerOrderPaymentSchema = z.object({
  payments: z.array(z.object({
    metodo_pago: z.string().min(1, "Método de pago requerido"),
    monto: z.number().positive("El monto debe ser mayor a cero"),
  })).min(1, "Debe incluir al menos un medio de pago"),
  fecha: z.string().optional(),
  observaciones: z.string().optional().nullable(),
});

const getBody = (req: any) => {
  if (req.body && typeof req.body === "object") return req.body;

  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }

  return {};
};

const permissionKeyByAction = {
  view: "can_view",
  create: "can_create",
  edit: "can_edit",
  delete: "can_delete",
} as const;

const requirePermission = async (
  req: any,
  res: any,
  moduleName: "sales" | "current_accounts" | "suppliers",
  action: keyof typeof permissionKeyByAction
) => {
  const decoded = await requireBearerUser(req, res);
  if (!decoded) return null;

  if (decoded.role === "administrador") {
    return decoded;
  }

  const permissions = await UserRepository.getPermissions(Number(decoded.userId));
  const perm = permissions?.[moduleName];
  const permissionKey = permissionKeyByAction[action];

  if (!perm?.[permissionKey]) {
    sendError(res, `Forbidden: No permission for ${moduleName}`, 403);
    return null;
  }

  return decoded;
};

const getId = (req: any) => {
  const rawId = Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id;
  const id = Number(rawId);
  return Number.isFinite(id) && id > 0 ? id : null;
};

const getEndpoint = (req: any) => {
  const rawEndpoint = Array.isArray(req.query?.endpoint) ? req.query.endpoint[0] : req.query?.endpoint;
  return String(rawEndpoint || "");
};

const toNumber = (value: any, fallback: number = 0) => {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const getAndIncrementSetting = async (client: any, key: string, defaultValue: number = 1) => {
  await client.query(
    `INSERT INTO settings (key, value)
     VALUES ($1, $2)
     ON CONFLICT (key) DO NOTHING`,
    [key, String(defaultValue)]
  );

  const currentResult = await client.query(
    `SELECT value FROM settings WHERE key = $1 LIMIT 1`,
    [key]
  );

  const currentValue = parseInt(currentResult.rows[0]?.value || String(defaultValue), 10) || defaultValue;

  await client.query(
    `UPDATE settings SET value = $2 WHERE key = $1`,
    [key, String(currentValue + 1)]
  );

  return currentValue;
};

const mapSupplierItem = (row: any) => ({
  id: toNumber(row.id),
  order_id: toNumber(row.order_id),
  product_id: toNumber(row.product_id),
  product_name: row.product_name || "",
  proveedor: row.proveedor || "",
  codigo_unico: row.codigo_unico || "",
  cantidad: toNumber(row.cantidad),
  precio_venta: toNumber(row.precio_venta),
  importe: toNumber(row.cantidad) * toNumber(row.precio_venta),
});

const mapSupplierOrder = (row: any, items: any[] = []) => {
  const productos = items.map(mapSupplierItem);
  const totalPedido = productos.reduce((sum: number, item: any) => sum + item.importe, 0);
  const saleTotal = toNumber(row.sale_total);
  const salePaid = toNumber(row.sale_monto_pagado);
  const saleMetodoPago = row.sale_metodo_pago || "";
  const ratio = saleTotal > 0 ? Math.min(1, totalPedido / saleTotal) : 1;
  const cobradoPedido = Math.min(totalPedido, salePaid * ratio);
  const ctaCtePedido = Math.max(0, totalPedido - cobradoPedido);

  return {
    id: toNumber(row.id),
    numero_pedido: toNumber(row.numero_pedido),
    cliente: row.cliente || "",
    cliente_id: row.cliente_id === null || row.cliente_id === undefined ? null : toNumber(row.cliente_id),
    sale_id: row.sale_id === null || row.sale_id === undefined ? null : toNumber(row.sale_id),
    customer_order_id: row.customer_order_id === null || row.customer_order_id === undefined ? null : toNumber(row.customer_order_id),
    fecha: row.fecha,
    estado: row.estado || "pendiente",
    notes: row.notes || "",
    stock_actualizado: toNumber(row.stock_actualizado),
    total_pedido: totalPedido,
    cobrado_pedido: cobradoPedido,
    cta_cte_pedido: ctaCtePedido,
    sale_total: saleTotal,
    sale_monto_pagado: salePaid,
    sale_monto_pendiente: toNumber(row.sale_monto_pendiente),
    sale_metodo_pago: saleMetodoPago,
    sale_estado: row.sale_estado || null,
    customer_order_estado: row.customer_order_estado || null,
    cancelled_at: row.cancelled_at || null,
    cancelled_by: row.cancelled_by || null,
    cancel_reason: row.cancel_reason || null,
    cancellation_source: row.cancellation_source || null,
    cancelled_from_status: row.cancelled_from_status || null,
    delivery_version: toNumber(row.delivery_version),
    delivered_at: row.delivered_at || null,
    delivered_by: row.delivered_by || null,
    delivered_from_status: row.delivered_from_status || null,
    delivery_reverted_at: row.delivery_reverted_at || null,
    delivery_reverted_by: row.delivery_reverted_by || null,
    delivery_revert_reason: row.delivery_revert_reason || null,
    status_version: toNumber(row.status_version),
    status_changed_at: row.status_changed_at || null,
    status_changed_by: row.status_changed_by || null,
    status_changed_from: row.status_changed_from || null,
    status_last_action: row.status_last_action || null,
    status_last_reason: row.status_last_reason || null,
    content_version: toNumber(row.content_version),
    content_changed_at: row.content_changed_at || null,
    content_changed_by: row.content_changed_by || null,
    content_change_reason: row.content_change_reason || null,
    productos,
  };
};

const fetchSupplierOrderItems = async (queryable: any, orderId: number) => {
  const itemsResult = await queryable.query(
    `
      SELECT
        soi.id,
        soi.order_id,
        soi.product_id,
        soi.cantidad,
        p.name AS product_name,
        COALESCE(p.company, '') AS proveedor,
        COALESCE(p.codigo_unico, p.code, '') AS codigo_unico,
        COALESCE(si.precio_venta, p.sale_price, 0) AS precio_venta
      FROM supplier_order_items soi
      JOIN supplier_orders so ON so.id = soi.order_id
      JOIN products p ON soi.product_id = p.id
      LEFT JOIN LATERAL (
        SELECT precio_venta
        FROM sale_items
        WHERE sale_id = so.sale_id AND product_id = soi.product_id
        ORDER BY id ASC
        LIMIT 1
      ) si ON true
      WHERE soi.order_id = $1
      ORDER BY soi.id ASC
    `,
    [orderId]
  );

  return itemsResult.rows;
};

type SupplierDeliveryTraceItem = {
  product_id: number;
  quantity: number;
  unit_cost: number;
  ingress_movement_id: number;
  egress_movement_id?: number | null;
};

const recordSupplierDelivery = async (client: any, input: {
  order: any;
  mode: "stock_only" | "linked_sale" | "created_sale";
  saleIdAfter?: number | null;
  deliveredBy: string;
  items: SupplierDeliveryTraceItem[];
}) => {
  const activeDelivery = await client.query(
    `SELECT id FROM supplier_order_deliveries
     WHERE supplier_order_id = $1 AND reverted_at IS NULL
     LIMIT 1`,
    [input.order.id]
  );
  if (activeDelivery.rowCount) {
    throw new Error("El pedido ya posee una entrega activa registrada");
  }

  const deliveryResult = await client.query(
    `INSERT INTO supplier_order_deliveries (
       supplier_order_id, delivery_mode, previous_status, sale_id_before,
       sale_id_after, customer_order_id, delivered_by, snapshot
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     RETURNING id`,
    [
      input.order.id,
      input.mode,
      String(input.order.estado || "auditar_pedido"),
      input.order.sale_id || null,
      input.saleIdAfter || null,
      input.order.customer_order_id || null,
      input.deliveredBy,
      JSON.stringify({ order: input.order, items: input.items }),
    ]
  );
  const deliveryId = toNumber(deliveryResult.rows[0]?.id);

  for (const item of input.items) {
    await client.query(
      `INSERT INTO supplier_order_delivery_items (
         delivery_id, product_id, quantity, unit_cost, ingress_movement_id, egress_movement_id
       )
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        deliveryId,
        item.product_id,
        item.quantity,
        item.unit_cost,
        item.ingress_movement_id,
        item.egress_movement_id || null,
      ]
    );
  }

  await client.query(
    `UPDATE supplier_orders
     SET estado = 'entregado',
         stock_actualizado = 1,
         sale_id = $1,
         delivery_version = 1,
         delivered_at = now(),
         delivered_by = $2,
         delivered_from_status = $3,
         delivery_reverted_at = NULL,
         delivery_reverted_by = NULL,
         delivery_revert_reason = NULL
     WHERE id = $4`,
    [
      input.saleIdAfter || null,
      input.deliveredBy,
      String(input.order.estado || "auditar_pedido"),
      input.order.id,
    ]
  );

  return deliveryId;
};

const handleSupplierOrders = async (req: any, res: any) => {
  const endpoint = getEndpoint(req);
  const id = getId(req);
  const pool = getPostgresPool();

  if (endpoint === "supplier-orders" && req.method === "GET") {
    const user = await requirePermission(req, res, "suppliers", "view");
    if (!user) return;

    try {
      const ordersResult = await pool.query(
        `
          SELECT
            so.id, so.numero_pedido, so.cliente, so.cliente_id, so.sale_id, so.customer_order_id, so.fecha, so.estado, so.notes, so.stock_actualizado,
            so.cancelled_at, so.cancelled_by, so.cancel_reason, so.cancellation_source, so.cancelled_from_status,
            so.delivery_version, so.delivered_at, so.delivered_by, so.delivered_from_status,
            so.delivery_reverted_at, so.delivery_reverted_by, so.delivery_revert_reason,
            so.status_version, so.status_changed_at, so.status_changed_by, so.status_changed_from,
            so.status_last_action, so.status_last_reason,
            so.content_version, so.content_changed_at, so.content_changed_by, so.content_change_reason,
            s.total AS sale_total,
            s.monto_pagado AS sale_monto_pagado,
            s.monto_pendiente AS sale_monto_pendiente,
            s.metodo_pago AS sale_metodo_pago,
            s.estado AS sale_estado,
            co.estado AS customer_order_estado
          FROM supplier_orders so
          LEFT JOIN sales s ON s.id = so.sale_id
          LEFT JOIN customer_orders co ON co.id = so.customer_order_id
          ORDER BY so.fecha DESC, so.id DESC
        `
      );

      const orders = [];
      for (const row of ordersResult.rows) {
        const items = await fetchSupplierOrderItems(pool, toNumber(row.id));
        orders.push(mapSupplierOrder(row, items));
      }

      return sendSuccess(res, orders);
    } catch (error: any) {
      return sendError(res, error?.message || "Error al obtener pedidos a proveedor", error?.statusCode || 400, error?.errors || []);
    }
  }

  if (endpoint === "supplier-order" && req.method === "GET") {
    const user = await requirePermission(req, res, "suppliers", "view");
    if (!user) return;
    if (!id) return sendError(res, "ID de pedido inválido", 400);

    try {
      const orderResult = await pool.query(
        `
          SELECT
            so.id, so.numero_pedido, so.cliente, so.cliente_id, so.sale_id, so.customer_order_id, so.fecha, so.estado, so.notes, so.stock_actualizado,
            so.cancelled_at, so.cancelled_by, so.cancel_reason, so.cancellation_source, so.cancelled_from_status,
            so.delivery_version, so.delivered_at, so.delivered_by, so.delivered_from_status,
            so.delivery_reverted_at, so.delivery_reverted_by, so.delivery_revert_reason,
            so.status_version, so.status_changed_at, so.status_changed_by, so.status_changed_from,
            so.status_last_action, so.status_last_reason,
            so.content_version, so.content_changed_at, so.content_changed_by, so.content_change_reason,
            s.total AS sale_total,
            s.monto_pagado AS sale_monto_pagado,
            s.monto_pendiente AS sale_monto_pendiente,
            s.metodo_pago AS sale_metodo_pago,
            s.estado AS sale_estado,
            co.estado AS customer_order_estado
          FROM supplier_orders so
          LEFT JOIN sales s ON s.id = so.sale_id
          LEFT JOIN customer_orders co ON co.id = so.customer_order_id
          WHERE so.id = $1
          LIMIT 1
        `,
        [id]
      );

      if (!orderResult.rowCount) return sendError(res, "Pedido no encontrado", 404);

      const items = await fetchSupplierOrderItems(pool, id);
      return sendSuccess(res, mapSupplierOrder(orderResult.rows[0], items));
    } catch (error: any) {
      return sendError(res, error?.message || "Error al obtener pedido", error?.statusCode || 400, error?.errors || []);
    }
  }

  if (endpoint === "supplier-orders" && req.method === "POST") {
    const user = await requirePermission(req, res, "suppliers", "create");
    if (!user) return;

    const parsed = supplierOrderSchema.safeParse(getBody(req));
    if (!parsed.success) {
      return sendError(res, "Validation failed", 400, parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })));
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const nextOrderNum = await getAndIncrementSetting(client, "next_order_number");
      const orderResult = await client.query(
        `
          INSERT INTO supplier_orders (numero_pedido, cliente, cliente_id, estado, notes)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING id
        `,
        [
          nextOrderNum,
          parsed.data.cliente || "Pedido a proveedor",
          parsed.data.cliente_id || null,
          "pendiente",
          parsed.data.notes || null,
        ]
      );

      const orderId = toNumber(orderResult.rows[0]?.id);

      for (const item of parsed.data.items) {
        await client.query(
          `INSERT INTO supplier_order_items (order_id, product_id, cantidad) VALUES ($1, $2, $3)`,
          [orderId, item.product_id, item.cantidad]
        );
      }

      await client.query("COMMIT");
      return sendSuccess(res, { orderId, numero_pedido: nextOrderNum }, "Pedido creado exitosamente", 201);
    } catch (error: any) {
      await client.query("ROLLBACK");
      return sendError(res, error?.message || "Error al crear pedido", 400);
    } finally {
      client.release();
    }
  }

  if (endpoint === "supplier-order-status" && req.method === "POST") {
    const user = await requirePermission(req, res, "suppliers", "edit");
    if (!user) return;
    if (!id) return sendError(res, "ID de pedido inválido", 400);

    const parsed = supplierOrderStatusSchema.safeParse(getBody(req));
    if (!parsed.success) {
      return sendError(res, "Validation failed", 400, parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })));
    }

    try {
      const result = await supplierOrderStatusLifecycleService.changeStatus({
        supplierOrderId: id,
        action: parsed.data.action,
        motivo: parsed.data.motivo,
        usuario: user.userName || "Sistema",
      });

      return sendSuccess(
        res,
        result,
        parsed.data.action === "advance"
          ? "Pedido avanzado correctamente"
          : "Pedido reabierto correctamente"
      );
    } catch (error: any) {
      return sendError(
        res,
        error?.message || "Error al actualizar la etapa del pedido",
        error?.statusCode || 400,
        error?.errors || []
      );
    }
  }

  if (endpoint === "supplier-order-items" && req.method === "PUT") {
    const user = await requirePermission(req, res, "suppliers", "edit");
    if (!user) return;
    if (!id) return sendError(res, "ID de pedido inválido", 400);

    const parsed = supplierOrderItemsSchema.safeParse(getBody(req));
    if (!parsed.success) {
      return sendError(res, "Validation failed", 400, parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })));
    }

    try {
      const result = await supplierOrderContentLifecycleService.update({
        supplierOrderId: id,
        items: parsed.data.items,
        notes: parsed.data.notes,
        motivo: parsed.data.motivo,
        usuario: user.userName || "Sistema",
        expectedContentVersion: parsed.data.expected_content_version,
        expectedStatusVersion: parsed.data.expected_status_version,
      });

      return sendSuccess(res, result, "Productos y observaciones actualizados con trazabilidad");
    } catch (error: any) {
      return sendError(
        res,
        error?.message || "Error al actualizar el pedido",
        error?.statusCode || 400,
        error?.errors || []
      );
    }
  }

  if (endpoint === "supplier-order" && req.method === "DELETE") {
    const user = await requirePermission(req, res, "suppliers", "delete");
    if (!user) return;

    return sendError(
      res,
      "Los pedidos ya no se eliminan. Utilice Anular pedido para conservar el historial.",
      409
    );
  }

  if (endpoint === "supplier-order-cancel" && req.method === "POST") {
    const user = await requirePermission(req, res, "suppliers", "delete");
    if (!user) return;
    if (!id) return sendError(res, "ID de pedido inválido", 400);

    const parsed = supplierOrderCancellationSchema.safeParse(getBody(req));
    if (!parsed.success) {
      return sendError(
        res,
        "Validation failed",
        400,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        }))
      );
    }

    try {
      const result = await supplierOrderCancellationService.cancelSupplierOrder({
        supplierOrderId: id,
        motivo: parsed.data.motivo,
        usuario: user.userName || "Sistema",
      });

      return sendSuccess(res, result, "Pedido anulado correctamente");
    } catch (error: any) {
      return sendError(
        res,
        error?.message || "No se pudo anular el pedido",
        error?.statusCode || 400,
        error?.errors || []
      );
    }
  }

  if (endpoint === "supplier-order-delivery-revert" && req.method === "POST") {
    const user = await requirePermission(req, res, "suppliers", "edit");
    if (!user) return;
    if (!id) return sendError(res, "ID de pedido inválido", 400);

    const parsed = supplierOrderDeliveryReversalSchema.safeParse(getBody(req));
    if (!parsed.success) {
      return sendError(res, "Validation failed", 400, parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })));
    }

    try {
      const result = await supplierOrderDeliveryReversalService.revert({
        supplierOrderId: id,
        motivo: parsed.data.motivo,
        usuario: user.userName || "Sistema",
      });
      return sendSuccess(res, result, "Entrega revertida correctamente");
    } catch (error: any) {
      return sendError(
        res,
        error?.message || "No se pudo revertir la entrega",
        error?.statusCode || 400,
        error?.errors || []
      );
    }
  }

  if (endpoint === "supplier-order-complete" && req.method === "POST") {
    const user = await requirePermission(req, res, "suppliers", "edit");
    if (!user) return;
    if (!id) return sendError(res, "ID de pedido inválido", 400);

    const parsed = supplierOrderCompleteSchema.safeParse(getBody(req));
    if (!parsed.success) {
      return sendError(res, "Validation failed", 400, parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })));
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const orderResult = await client.query(
        `
          SELECT id, numero_pedido, cliente, cliente_id, sale_id, customer_order_id, estado, notes
          FROM supplier_orders
          WHERE id = $1
          LIMIT 1
          FOR UPDATE
        `,
        [id]
      );

      if (!orderResult.rowCount) {
        await client.query("ROLLBACK");
        return sendError(res, "Pedido no encontrado", 404);
      }

      const order = orderResult.rows[0];

      if (order.estado !== "auditar_pedido") {
        await client.query("ROLLBACK");
        return sendError(res, "El pedido debe estar en estado Auditar Pedido para completar la entrega", 400);
      }

      const itemResult = await client.query(
        `
          SELECT
            soi.product_id,
            soi.cantidad,
            p.name,
            COALESCE(p.sale_price, 0) AS sale_price,
            COALESCE(p.cost, 0) AS cost
          FROM supplier_order_items soi
          JOIN products p ON soi.product_id = p.id
          WHERE soi.order_id = $1
          ORDER BY soi.id ASC
        `,
        [id]
      );

      if (!itemResult.rowCount) {
        await client.query("ROLLBACK");
        return sendError(res, "El pedido no tiene productos", 400);
      }

      const deliveryTraceItems: SupplierDeliveryTraceItem[] = [];

      if (order.customer_order_id && !order.sale_id) {
        for (const item of itemResult.rows) {
          const productId = toNumber(item.product_id);
          const cantidad = toNumber(item.cantidad);
          const costoUnitario = toNumber(item.cost);

          await client.query(
            `UPDATE products
             SET stock = COALESCE(stock, 0) + $1
             WHERE id = $2`,
            [cantidad, productId]
          );

          const ingressResult = await client.query(
            `INSERT INTO stock_movimientos (
               product_id, cantidad, costo_unitario, cantidad_restante, descripcion,
               tipo_movimiento, motivo, usuario, supplier_order_id, reversion_version
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1)
             RETURNING id`,
            [
              productId,
              cantidad,
              costoUnitario,
              cantidad,
              `Ingreso desde Pedido Proveedor #${order.numero_pedido || order.id} para Pedido Cliente #${order.customer_order_id}`,
              "ingreso",
              "pedido_proveedor",
              user.userName || "Sistema",
              id,
            ]
          );

          deliveryTraceItems.push({
            product_id: productId,
            quantity: cantidad,
            unit_cost: costoUnitario,
            ingress_movement_id: toNumber(ingressResult.rows[0]?.id),
            egress_movement_id: null,
          });
        }

        await recordSupplierDelivery(client, {
          order,
          mode: "stock_only",
          saleIdAfter: null,
          deliveredBy: user.userName || "Sistema",
          items: deliveryTraceItems,
        });

        await client.query(
          `UPDATE customer_orders
           SET admin_notes = COALESCE(admin_notes, '') || CASE WHEN COALESCE(admin_notes, '') = '' THEN '' ELSE E'\n' END || $1
           WHERE id = $2`,
          [`Pedido proveedor #${order.numero_pedido || order.id} completado. Stock disponible para entregar.`, order.customer_order_id]
        );

        await client.query("COMMIT");
        return sendSuccess(
          res,
          { success: true, customerOrderId: toNumber(order.customer_order_id), supplierOrderId: id },
          "Pedido a proveedor completado. Stock cargado para entregar el pedido del cliente."
        );
      }

      let totalVenta = 0;
      let totalCosto = 0;
      const saleItems: Array<{
        product_id: number;
        cantidad: number;
        precio_venta: number;
        costo_total_peps: number;
        precio_unitario_original?: number;
        bonificacion_tipo?: string;
        bonificacion_valor?: number;
        precio_unitario_bonificado?: number;
      }> = [];
      const supplierDeliveryAllocations: SaleStockAllocationInput[] = [];

      for (const item of itemResult.rows) {
        const productId = toNumber(item.product_id);
        const cantidad = toNumber(item.cantidad);
        const precioVenta = toNumber(item.sale_price);
        const costoUnitario = toNumber(item.cost);
        const costoTotalItem = cantidad * costoUnitario;

        totalVenta += cantidad * precioVenta;
        totalCosto += costoTotalItem;

        saleItems.push({
          product_id: productId,
          cantidad,
          precio_venta: precioVenta,
          costo_total_peps: costoTotalItem,
          precio_unitario_original: precioVenta,
          bonificacion_tipo: "none",
          bonificacion_valor: 0,
          precio_unitario_bonificado: precioVenta,
        });

        const ingressResult = await client.query(
          `
            INSERT INTO stock_movimientos (
              product_id,
              cantidad,
              costo_unitario,
              cantidad_restante,
              descripcion,
              tipo_movimiento,
              motivo,
              usuario,
              supplier_order_id,
              reversion_version
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1)
            RETURNING id
          `,
          [
            productId,
            cantidad,
            costoUnitario,
            cantidad,
            `Ingreso desde Pedido #${order.numero_pedido || order.id}`,
            "ingreso",
            "pedido_proveedor",
            user.userName || "Sistema",
            id,
          ]
        );

        const saleStockMovementResult = await client.query(
          `
            INSERT INTO stock_movimientos (
              product_id,
              cantidad,
              costo_unitario,
              cantidad_restante,
              descripcion,
              tipo_movimiento,
              motivo,
              usuario,
              sale_id,
              supplier_order_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING id
          `,
          [
            productId,
            -cantidad,
            costoUnitario,
            0,
            `Entrega pendiente desde Pedido #${order.numero_pedido || order.id}`,
            "egreso",
            "venta",
            user.userName || "Sistema",
            order.sale_id || null,
            id,
          ]
        );

        supplierDeliveryAllocations.push({
          product_id: productId,
          cantidad,
          costo_unitario: costoUnitario,
          source_type: "supplier_delivery",
          purchase_invoice_item_id: null,
          stock_movement_id: toNumber(saleStockMovementResult.rows[0]?.id),
        });

        deliveryTraceItems.push({
          product_id: productId,
          quantity: cantidad,
          unit_cost: costoUnitario,
          ingress_movement_id: toNumber(ingressResult.rows[0]?.id),
          egress_movement_id: toNumber(saleStockMovementResult.rows[0]?.id),
        });

        if (order.sale_id) {
          await client.query(
            `
              UPDATE sale_items
              SET costo_total_peps = COALESCE(costo_total_peps, 0) + $1
              WHERE id = (
                SELECT id
                FROM sale_items
                WHERE sale_id = $2 AND product_id = $3
                ORDER BY id ASC
                LIMIT 1
              )
            `,
            [costoTotalItem, order.sale_id, productId]
          );
        }
      }

      if (order.sale_id) {
        await saleTraceService.recordStockAllocations(
          client,
          toNumber(order.sale_id),
          supplierDeliveryAllocations
        );

        await client.query(
          `
            UPDATE sales
            SET costo_total = COALESCE(costo_total, 0) + $1,
                ganancia = COALESCE(total, 0) - (COALESCE(costo_total, 0) + $1)
            WHERE id = $2
          `,
          [totalCosto, order.sale_id]
        );

        await recordSupplierDelivery(client, {
          order,
          mode: "linked_sale",
          saleIdAfter: toNumber(order.sale_id),
          deliveredBy: user.userName || "Sistema",
          items: deliveryTraceItems,
        });

        await client.query("COMMIT");
        return sendSuccess(
          res,
          { success: true, saleId: toNumber(order.sale_id), linkedSale: true },
          "Pedido entregado y costo actualizado en la venta original"
        );
      }

      const metodoPago = parsed.data.metodo_pago || "efectivo";
      await assertPaymentMethodActive(metodoPago, client);
      const montoPagado = parsed.data.monto_pagado === undefined ? totalVenta : toNumber(parsed.data.monto_pagado);
      const montoPendiente = Math.max(0, totalVenta - montoPagado);
      const nextSaleNum = await getAndIncrementSetting(client, "next_sale_number");

      const saleId = await salesRepository.create(
        {
          numero_venta: String(nextSaleNum),
          total: totalVenta,
          costo_total: totalCosto,
          ganancia: totalVenta - totalCosto,
          cliente_id: order.cliente_id || null,
          nombre_cliente: order.cliente,
          metodo_pago: metodoPago,
          monto_pagado: montoPagado,
          monto_pendiente: montoPendiente,
          notes: `Pedido #${order.numero_pedido || order.id}`,
          usuario: user.userName || "Sistema",
          estado: montoPendiente > 0 ? "Pendiente" : "Pagada",
        },
        saleItems,
        client
      );

      for (const allocation of supplierDeliveryAllocations) {
        if (allocation.stock_movement_id) {
          await client.query(
            `UPDATE stock_movimientos
             SET sale_id = $1
             WHERE id = $2`,
            [saleId, allocation.stock_movement_id]
          );
        }
      }

      await saleTraceService.recordStockAllocations(
        client,
        saleId,
        supplierDeliveryAllocations
      );

      if (montoPagado > 0) {
        const nextPaymentNum = await getAndIncrementSetting(client, "next_payment_number");
        const movementResult = await client.query(
          `
            INSERT INTO movimientos_financieros (tipo, origen, descripcion, categoria, forma_pago, monto, cliente_id, venta_id, usuario, numero_pago)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING id
          `,
          [
            "ingreso",
            "venta",
            `Venta N° ${nextSaleNum} (Pedido #${order.numero_pedido || order.id})`,
            "Ventas",
            metodoPago,
            montoPagado,
            order.cliente_id || null,
            saleId,
            user.userName || "Sistema",
            nextPaymentNum,
          ]
        );

        await saleTraceService.recordPaymentAllocations(
          client,
          toNumber(movementResult.rows[0]?.id),
          [{ sale_id: saleId, monto: montoPagado, allocation_type: "initial_payment" }]
        );
      }

      if (order.cliente_id && montoPendiente > 0) {
        await client.query(
          `
            UPDATE clientes
            SET saldo_cta_cte = COALESCE(saldo_cta_cte, 0) + $1
            WHERE id = $2
          `,
          [montoPendiente, order.cliente_id]
        );
      }

      await recordSupplierDelivery(client, {
        order,
        mode: "created_sale",
        saleIdAfter: saleId,
        deliveredBy: user.userName || "Sistema",
        items: deliveryTraceItems,
      });

      await client.query("COMMIT");

      return sendSuccess(res, { success: true, saleId, saleNumber: nextSaleNum }, "Venta completada");
    } catch (error: any) {
      await client.query("ROLLBACK");
      return sendError(res, error?.message || "Error al completar venta", error?.statusCode || 400, error?.errors || []);
    } finally {
      client.release();
    }
  }

  return sendError(res, "Endpoint de pedidos a proveedor no encontrado", 404);
};


const mapCustomerOrderAdmin = (row: any, items: any[] = []) => {
  const estado = row.estado || "pendiente_aprobacion";
  const hasShortage = items.some((item: any) => toNumber(item.faltante) > 0);
  const stockStatus =
    estado === "aprobado_pendiente_entrega"
      ? (hasShortage ? "esperando_stock" : "listo_entrega")
      : null;

  return {
    id: toNumber(row.id),
    numero_pedido: toNumber(row.numero_pedido),
    cliente_id: toNumber(row.cliente_id),
    cliente: row.cliente || "",
    cliente_telefono: row.cliente_telefono || row.telefono || "",
    fecha: row.fecha,
    estado,
    stock_status: stockStatus,
    subtotal: toNumber(row.subtotal),
    descuento_tipo: row.descuento_tipo || "none",
    descuento_valor: toNumber(row.descuento_valor),
    descuento_monto: toNumber(row.descuento_monto),
    total_final: toNumber(row.total_final),
    sale_id: row.sale_id === null || row.sale_id === undefined ? null : toNumber(row.sale_id),
    numero_venta: row.numero_venta || null,
    sale_total: toNumber(row.sale_total),
    sale_monto_pagado: toNumber(row.sale_monto_pagado),
    sale_monto_pendiente: toNumber(row.sale_monto_pendiente),
    sale_estado: row.sale_estado || null,
    admin_notes: row.admin_notes || "",
    rejection_reason: row.rejection_reason || "",
    cancel_reason: row.cancel_reason || "",
    aprobado_at: row.aprobado_at || null,
    approved_by: row.approved_by || "",
    approved_from_status: row.approved_from_status || "",
    approval_version: toNumber(row.approval_version),
    content_version: toNumber(row.content_version),
    content_changed_at: row.content_changed_at || null,
    content_changed_by: row.content_changed_by || "",
    content_change_reason: row.content_change_reason || "",
    entregado_at: row.entregado_at || null,
    rejected_at: row.rejected_at || null,
    rejected_by: row.rejected_by || "",
    rejected_from_status: row.rejected_from_status || "",
    rejection_version: toNumber(row.rejection_version),
    reopened_at: row.reopened_at || null,
    reopened_by: row.reopened_by || "",
    reopen_reason: row.reopen_reason || "",
    cancelled_at: row.cancelled_at || null,
    cancelled_by: row.cancelled_by || "",
    cancellation_source: row.cancellation_source || "",
    cancelled_from_status: row.cancelled_from_status || "",
    delivery_version: toNumber(row.delivery_version),
    delivered_by: row.delivered_by || "",
    delivered_from_status: row.delivered_from_status || "",
    delivery_reverted_at: row.delivery_reverted_at || null,
    delivery_reverted_by: row.delivery_reverted_by || "",
    delivery_revert_reason: row.delivery_revert_reason || "",
    items,
  };
};

const fetchCustomerOrderItems = async (queryable: any, orderIds: number[]) => {
  if (!orderIds.length) return new Map<number, any[]>();

  const result = await queryable.query(
    `
      SELECT
        coi.id,
        coi.order_id,
        coi.product_id,
        coi.cantidad,
        coi.precio_unitario,
        (coi.cantidad * coi.precio_unitario) AS importe,
        p.name AS product_name,
        p.code,
        p.codigo_unico,
        COALESCE(p.stock, 0) AS stock_actual
      FROM customer_order_items coi
      JOIN products p ON p.id = coi.product_id
      WHERE coi.order_id = ANY($1::int[])
      ORDER BY coi.id ASC
    `,
    [orderIds]
  );

  const grouped = new Map<number, any[]>();
  for (const row of result.rows) {
    const orderId = toNumber(row.order_id);
    if (!grouped.has(orderId)) grouped.set(orderId, []);
    grouped.get(orderId)!.push({
      id: toNumber(row.id),
      order_id: orderId,
      product_id: toNumber(row.product_id),
      product_name: row.product_name,
      code: row.codigo_unico || row.code || "",
      cantidad: toNumber(row.cantidad),
      precio_unitario: toNumber(row.precio_unitario),
      importe: toNumber(row.importe),
      stock_actual: toNumber(row.stock_actual),
      faltante: Math.max(0, toNumber(row.cantidad) - toNumber(row.stock_actual)),
    });
  }

  return grouped;
};

const handleCustomerOrders = async (req: any, res: any) => {
  const endpoint = getEndpoint(req);
  const permissionAction = endpoint === "customer-orders"
    ? "view"
    : endpoint === "customer-order-cancel"
      ? "delete"
      : "edit";
  const user = await requirePermission(req, res, "sales", permissionAction);
  if (!user) return;

  const pool = getPostgresPool();
  const id = getId(req);

  if (endpoint === "customer-orders" && req.method === "GET") {
    const status = Array.isArray(req.query?.status) ? req.query.status[0] : req.query?.status;
    const params: any[] = [];
    let where = "WHERE 1 = 1";
    if (status) {
      params.push(status);
      where += ` AND co.estado = $${params.length}`;
    }

    const ordersResult = await pool.query(
      `
        SELECT
          co.*,
          c.nombre_apellido AS cliente,
          c.telefono AS cliente_telefono,
          s.numero_venta,
          s.total AS sale_total,
          s.monto_pagado AS sale_monto_pagado,
          s.monto_pendiente AS sale_monto_pendiente,
          s.estado AS sale_estado
        FROM customer_orders co
        JOIN clientes c ON c.id = co.cliente_id
        LEFT JOIN sales s ON s.id = co.sale_id
        ${where}
        ORDER BY
          CASE co.estado
            WHEN 'pendiente_aprobacion' THEN 1
            WHEN 'aprobado_pendiente_entrega' THEN 2
            ELSE 3
          END,
          co.fecha DESC,
          co.id DESC
      `,
      params
    );

    const orderIds = ordersResult.rows.map((row: any) => toNumber(row.id));
    const itemsByOrder = await fetchCustomerOrderItems(pool, orderIds);
    return sendSuccess(res, ordersResult.rows.map((row: any) => mapCustomerOrderAdmin(row, itemsByOrder.get(toNumber(row.id)) || [])));
  }


  if (endpoint === "customer-order-cancel" && req.method === "POST") {
    if (!id) return sendError(res, "ID de pedido inválido", 400);
    const parsed = customerOrderCancellationSchema.safeParse(getBody(req));
    if (!parsed.success) {
      return sendError(
        res,
        "Validation failed",
        400,
        parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }))
      );
    }

    try {
      const result = await customerOrderCancellationService.cancelCustomerOrder({
        customerOrderId: id,
        motivo: parsed.data.motivo,
        usuario: user.userName || "Sistema",
        source: "manual",
      });
      return sendSuccess(res, result, "Pedido de cliente anulado correctamente");
    } catch (error: any) {
      return sendError(
        res,
        error?.message || "No se pudo anular el pedido de cliente",
        error?.statusCode || 400,
        error?.errors || []
      );
    }
  }

  if (endpoint === "customer-order-reject" && req.method === "POST") {
    if (!id) return sendError(res, "ID de pedido inválido", 400);
    const parsed = customerOrderRejectSchema.safeParse(getBody(req));
    if (!parsed.success) {
      return sendError(res, "Validation failed", 400, parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })));
    }

    try {
      const result = await customerOrderRejectionLifecycleService.reject({
        customerOrderId: id,
        motivo: parsed.data.motivo,
        adminNotes: parsed.data.admin_notes,
        usuario: user.userName || "Sistema",
      });
      return sendSuccess(res, result, "Pedido rechazado con trazabilidad");
    } catch (error: any) {
      return sendError(
        res,
        error?.message || "No se pudo rechazar el pedido",
        error?.statusCode || 400
      );
    }
  }

  if (endpoint === "customer-order-reopen" && req.method === "POST") {
    if (!id) return sendError(res, "ID de pedido inválido", 400);
    const parsed = customerOrderReopenSchema.safeParse(getBody(req));
    if (!parsed.success) {
      return sendError(res, "Validation failed", 400, parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })));
    }

    try {
      const result = await customerOrderRejectionLifecycleService.reopen({
        customerOrderId: id,
        motivo: parsed.data.motivo,
        usuario: user.userName || "Sistema",
      });
      return sendSuccess(res, result, "Pedido reabierto correctamente");
    } catch (error: any) {
      return sendError(
        res,
        error?.message || "No se pudo reabrir el pedido",
        error?.statusCode || 400
      );
    }
  }

  if (endpoint === "customer-order-update" && ["POST", "PUT"].includes(req.method)) {
    if (!id) return sendError(res, "ID de pedido inválido", 400);
    const parsed = customerOrderUpdateSchema.safeParse(getBody(req));
    if (!parsed.success) {
      return sendError(res, "Validation failed", 400, parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })));
    }

    try {
      const result = await customerOrderContentLifecycleService.update({
        customerOrderId: id,
        items: parsed.data.items,
        discountType: parsed.data.descuento_tipo || "none",
        discountValue: parsed.data.descuento_valor || 0,
        adminNotes: parsed.data.admin_notes,
        motivo: parsed.data.motivo,
        usuario: user.userName || "Sistema",
        expectedContentVersion: parsed.data.expected_content_version,
        expectedApprovalVersion: parsed.data.expected_approval_version,
        expectedRejectionVersion: parsed.data.expected_rejection_version,
      });
      return sendSuccess(res, result, "Pedido actualizado con trazabilidad");
    } catch (error: any) {
      return sendError(
        res,
        error?.message || "Error al editar pedido",
        error?.statusCode || 400,
        error?.errors || []
      );
    }
  }

  if (endpoint === "customer-order-approve" && req.method === "POST") {
    if (!id) return sendError(res, "ID de pedido inválido", 400);
    const parsed = customerOrderApproveSchema.safeParse(getBody(req));
    if (!parsed.success) {
      return sendError(res, "Validation failed", 400, parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })));
    }

    try {
      const result = await customerOrderApprovalService.approve({
        customerOrderId: id,
        discountType: parsed.data.descuento_tipo || "none",
        discountValue: parsed.data.descuento_valor || 0,
        adminNotes: parsed.data.admin_notes,
        usuario: user.userName || "Sistema",
        expectedApprovalVersion: parsed.data.expected_approval_version,
        expectedRejectionVersion: parsed.data.expected_rejection_version,
        expectedContentVersion: parsed.data.expected_content_version,
      });

      return sendSuccess(
        res,
        result,
        result.shortageItems.length > 0
          ? "Pedido aprobado. Hay faltantes y se generó un pedido a proveedor trazable."
          : "Pedido aprobado con trazabilidad"
      );
    } catch (error: any) {
      return sendError(
        res,
        error?.message || "Error al aprobar pedido",
        error?.statusCode || 400,
        error?.errors || []
      );
    }
  }

  if (endpoint === "customer-order-deliver" && req.method === "POST") {
    if (!id) return sendError(res, "ID de pedido inválido", 400);

    try {
      const result = await customerOrderDeliveryService.deliver({
        customerOrderId: id,
        usuario: user.userName || "Sistema",
      });
      return sendSuccess(res, result, "Pedido entregado y agregado a cuenta corriente");
    } catch (error: any) {
      return sendError(
        res,
        error?.message || "No se pudo entregar el pedido",
        error?.statusCode || 400,
        error?.errors || []
      );
    }
  }

  if (endpoint === "customer-order-delivery-revert" && req.method === "POST") {
    if (!id) return sendError(res, "ID de pedido inválido", 400);

    const parsed = customerOrderDeliveryReversalSchema.safeParse(getBody(req));
    if (!parsed.success) {
      return sendError(
        res,
        "Validation failed",
        400,
        parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }))
      );
    }

    try {
      const result = await customerOrderDeliveryReversalService.revert({
        customerOrderId: id,
        motivo: parsed.data.motivo,
        usuario: user.userName || "Sistema",
      });
      return sendSuccess(res, result, "Entrega del pedido revertida correctamente");
    } catch (error: any) {
      return sendError(
        res,
        error?.message || "No se pudo revertir la entrega del pedido",
        error?.statusCode || 400,
        error?.errors || []
      );
    }
  }

  if (endpoint === "customer-order-payment" && req.method === "POST") {
    if (!id) return sendError(res, "ID de pedido inválido", 400);

    const parsed = customerOrderPaymentSchema.safeParse(getBody(req));
    if (!parsed.success) {
      return sendError(
        res,
        "Validation failed",
        400,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        }))
      );
    }

    const payments = parsed.data.payments
      .map((payment) => ({
        metodo_pago: String(payment.metodo_pago || "").trim(),
        monto: Math.round(toNumber(payment.monto) * 100) / 100,
      }))
      .filter((payment) => payment.metodo_pago && payment.monto > 0);

    const totalPayment = Math.round(
      payments.reduce((sum, payment) => sum + payment.monto, 0) * 100
    ) / 100;

    if (!payments.length || totalPayment <= 0) {
      return sendError(res, "Ingresá al menos un pago válido", 400);
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const payment of payments) {
        await assertPaymentMethodActive(payment.metodo_pago, client);
      }

      const orderResult = await client.query(
        `SELECT
           co.*,
           c.nombre_apellido AS cliente,
           COALESCE(c.saldo_cta_cte, 0) AS saldo_cliente
         FROM customer_orders co
         JOIN clientes c ON c.id = co.cliente_id
         WHERE co.id = $1
         FOR UPDATE OF co, c`,
        [id]
      );

      if (!orderResult.rowCount) {
        throw new Error("Pedido no encontrado");
      }

      const order = orderResult.rows[0];

      if (order.estado !== "entregado" || !order.sale_id) {
        throw new Error("Solo se pueden cobrar pedidos entregados");
      }

      const saleResult = await client.query(
        `SELECT id, numero_venta, total, monto_pagado, monto_pendiente, estado
         FROM sales
         WHERE id = $1
         FOR UPDATE`,
        [order.sale_id]
      );

      if (!saleResult.rowCount) {
        throw new Error("La venta asociada al pedido no existe");
      }

      const sale = saleResult.rows[0];

      if (String(sale.estado || '').toLowerCase() === 'anulada') {
        throw new Error("La venta asociada al pedido fue anulada");
      }

      const pendingAmount = Math.round(toNumber(sale.monto_pendiente) * 100) / 100;
      const customerBalance = Math.round(toNumber(order.saldo_cliente) * 100) / 100;

      if (pendingAmount <= 0) {
        throw new Error("Este pedido ya está completamente pagado");
      }

      if (totalPayment > pendingAmount + 0.001) {
        throw new Error("El cobro supera el saldo pendiente del pedido");
      }

      if (totalPayment > customerBalance + 0.001) {
        throw new Error("El cobro supera el saldo pendiente del cliente");
      }

      const newPaid = Math.round((toNumber(sale.monto_pagado) + totalPayment) * 100) / 100;
      const newPending = Math.max(0, Math.round((pendingAmount - totalPayment) * 100) / 100);
      const newStatus = newPending <= 0 ? "Pagada" : "Pendiente";
      const paymentDate = normalizeBusinessDateForStorage(parsed.data.fecha);
      const observations = String(parsed.data.observaciones || "").trim();

      await client.query(
        `UPDATE sales
         SET monto_pagado = $1,
             monto_pendiente = $2,
             estado = $3
         WHERE id = $4`,
        [newPaid, newPending, newStatus, sale.id]
      );

      await client.query(
        `UPDATE clientes
         SET saldo_cta_cte = GREATEST(0, COALESCE(saldo_cta_cte, 0) - $1)
         WHERE id = $2`,
        [totalPayment, order.cliente_id]
      );

      const movementIds: number[] = [];

      for (const payment of payments) {
        const nextPaymentNum = await getAndIncrementSetting(client, "next_payment_number");
        const movementResult = await client.query(
          `INSERT INTO movimientos_financieros
             (tipo, origen, descripcion, categoria, forma_pago, monto, fecha, usuario, numero_pago, cliente_id, venta_id, estado, reversion_version)
           VALUES
             ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           RETURNING id`,
          [
            "ingreso",
            "cobranza",
            `Cobranza Pedido Cliente #${order.numero_pedido} / Venta N° ${sale.numero_venta}${observations ? ` - ${observations}` : ""}`,
            "Cobranzas",
            payment.metodo_pago,
            payment.monto,
            paymentDate,
            user.userName || "Sistema",
            nextPaymentNum,
            order.cliente_id,
            sale.id,
            'Activo',
            1,
          ]
        );

        movementIds.push(toNumber(movementResult.rows[0]?.id));

        await saleTraceService.recordPaymentAllocations(
          client,
          toNumber(movementResult.rows[0]?.id),
          [{
            sale_id: toNumber(sale.id),
            monto: payment.monto,
            allocation_type: "customer_order_payment",
          }]
        );
      }

      await client.query("COMMIT");

      return sendSuccess(
        res,
        {
          order_id: id,
          sale_id: toNumber(sale.id),
          numero_venta: sale.numero_venta,
          total_cobrado: totalPayment,
          monto_pagado: newPaid,
          monto_pendiente: newPending,
          estado: newStatus,
          payments,
          movement_ids: movementIds,
        },
        newPending <= 0
          ? "Pedido cobrado completamente"
          : "Pago parcial registrado correctamente"
      );
    } catch (error: any) {
      await client.query("ROLLBACK");
      return sendError(res, error?.message || "No se pudo registrar el cobro", 400);
    } finally {
      client.release();
    }
  }

  return sendError(res, "Endpoint de pedidos de clientes no encontrado", 404);
};

export default async function handler(req: any, res: any) {
  const id = getId(req);
  const endpoint = getEndpoint(req);

  if (["customer-orders", "customer-order-approve", "customer-order-deliver", "customer-order-reject", "customer-order-reopen", "customer-order-update", "customer-order-payment", "customer-order-cancel", "customer-order-delivery-revert"].includes(endpoint)) {
    return handleCustomerOrders(req, res);
  }

  if (
    [
      "supplier-orders",
      "supplier-order",
      "supplier-order-status",
      "supplier-order-items",
      "supplier-order-complete",
      "supplier-order-cancel",
      "supplier-order-delivery-revert",
    ].includes(endpoint)
  ) {
    return handleSupplierOrders(req, res);
  }

  if (req.method === "POST" && endpoint === "sale-cancel") {
    const user = await requirePermission(req, res, "sales", "delete");
    if (!user) return;

    if (!id) {
      return sendError(res, "ID de venta inválido", 400);
    }

    const parsed = saleCancellationSchema.safeParse(getBody(req));
    if (!parsed.success) {
      return sendError(
        res,
        "Validation failed",
        400,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        }))
      );
    }

    try {
      const result = await saleCancellationService.cancelSale({
        saleId: id,
        motivo: parsed.data.motivo,
        usuario: user.userName || "Sistema",
      });

      return sendSuccess(res, result, "Venta anulada correctamente");
    } catch (error: any) {
      return sendError(
        res,
        error?.message || "No se pudo anular la venta",
        error?.statusCode || 400,
        error?.errors || []
      );
    }
  }

  if (req.method === "GET" && endpoint === "peti-customer-report") {
    const user = await requirePermission(req, res, "sales", "view");
    if (!user) return;

    const from = Array.isArray(req.query?.from) ? req.query.from[0] : req.query?.from;
    const to = Array.isArray(req.query?.to) ? req.query.to[0] : req.query?.to;

    try {
      const report = await petiSalesReportService.getReport({
        from: typeof from === "string" ? from : null,
        to: typeof to === "string" ? to : null,
      });
      return sendSuccess(res, report);
    } catch (error: any) {
      return sendError(
        res,
        error?.message || "No se pudo generar el reporte de ventas Peti",
        error?.statusCode || 400,
        error?.errors || []
      );
    }
  }

  if (req.method === "POST" && endpoint === "client-payment") {
    const user = await requirePermission(req, res, "current_accounts", "create");
    if (!user) return;

    const clienteId = id;

    if (!clienteId) {
      return sendError(res, "ID de cliente inválido", 400);
    }

    const parsed = paymentSchema.safeParse(getBody(req));

    if (!parsed.success) {
      return sendError(
        res,
        "Validation failed",
        400,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        }))
      );
    }

    try {
      const result = await salesService.registerClientPayment({
        cliente_id: clienteId,
        ...parsed.data,
        usuario: user.userName || "Sistema",
      });

      return sendSuccess(res, result, "Pago registrado exitosamente", 201);
    } catch (error: any) {
      return sendError(res, error?.message || "Error al registrar pago", error?.statusCode || 400, error?.errors || []);
    }
  }

  if (req.method === "GET") {
    const user = await requirePermission(req, res, "sales", "view");
    if (!user) return;

    try {
      if (id) {
        const sale = await salesRepository.getById(id);

        if (!sale) {
          return sendError(res, "Venta no encontrada", 404);
        }

        return sendSuccess(res, sale);
      }

      const sales = await salesRepository.getAll();
      return sendSuccess(res, sales);
    } catch (error: any) {
      return sendError(res, error?.message || "Error al obtener ventas", error?.statusCode || 400, error?.errors || []);
    }
  }

  if (req.method === "POST") {
    const user = await requirePermission(req, res, "sales", "create");
    if (!user) return;

    const parsed = saleSchema.safeParse(getBody(req));

    if (!parsed.success) {
      return sendError(
        res,
        "Validation failed",
        400,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        }))
      );
    }

    try {
      const result = await salesService.createSale({
        ...parsed.data,
        usuario: user.userName || "Sistema",
        actor_role: user.role,
      });

      return sendSuccess(res, result, "Venta registrada exitosamente", 201);
    } catch (error: any) {
      return sendError(res, error?.message || "Error al procesar la venta", error?.statusCode || 400, error?.errors || []);
    }
  }

  return sendError(res, "Method not allowed", 405);
}
