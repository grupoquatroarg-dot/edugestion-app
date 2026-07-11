import { z } from "zod";
import { salesRepository } from "../server/repositories/salesRepository.js";
import { salesService } from "../server/services/salesService.js";
import { UserRepository } from "../server/repositories/userRepository.js";
import { verifyToken } from "../server/utils/jwt.js";
import { sendError, sendSuccess } from "../server/utils/response.js";
import { getPostgresPool } from "../server/utils/postgres.js";
import { normalizeBusinessDateForStorage } from "../server/utils/businessDate.js";
import { saleTraceService } from "../server/services/saleTraceService.js";
import type { SaleStockAllocationInput } from "../server/services/saleTraceService.js";

const saleSchema = z.object({
  cliente_id: z.number(),
  nombre_cliente: z.string().optional(),
  metodo_pago: z.string(),
  monto_pagado: z.number().nonnegative().optional(),
  notes: z.string().optional(),
  cheque_data: z.any().optional(),
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

const paymentSchema = z.object({
  monto: z.number().positive("El monto debe ser mayor a cero"),
  metodo_pago: z.string().min(1, "Método de pago requerido"),
  observaciones: z.string().optional(),
  fecha: z.string().optional(),
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
  estado: z.enum(["pendiente", "pedido_realizado", "auditar_pedido", "entregado"]),
});

const supplierOrderItemsSchema = z.object({
  notes: z.string().optional().nullable(),
  items: z.array(z.object({
    product_id: z.number(),
    cantidad: z.number().positive(),
  })).min(1, "Debe incluir al menos un producto"),
});

const supplierOrderCompleteSchema = z.object({
  metodo_pago: z.string().optional(),
  monto_pagado: z.number().nonnegative().optional(),
});

const customerOrderApproveSchema = z.object({
  descuento_tipo: z.enum(["none", "percentage", "fixed"]).optional(),
  descuento_valor: z.number().nonnegative().optional(),
  admin_notes: z.string().optional().nullable(),
});

const customerOrderRejectSchema = z.object({
  motivo: z.string().min(3, "El motivo es obligatorio"),
  admin_notes: z.string().optional().nullable(),
});

const customerOrderUpdateSchema = z.object({
  items: z.array(z.object({
    product_id: z.number(),
    cantidad: z.number().positive(),
  })).min(1, "Debe incluir al menos un producto"),
  descuento_tipo: z.enum(["none", "percentage", "fixed"]).optional(),
  descuento_valor: z.number().nonnegative().optional(),
  admin_notes: z.string().optional().nullable(),
});

const customerOrderPaymentSchema = z.object({
  payments: z.array(z.object({
    metodo_pago: z.string().min(1, "Método de pago requerido"),
    monto: z.number().positive("El monto debe ser mayor a cero"),
  })).min(1, "Debe incluir al menos un medio de pago"),
  fecha: z.string().optional(),
  observaciones: z.string().optional().nullable(),
});

const calculateCustomerOrderDiscount = (subtotal: number, discountType: string, discountValue: number) => {
  if (discountType === "percentage") {
    return subtotal * Math.min(discountValue, 100) / 100;
  }

  if (discountType === "fixed") {
    return Math.min(subtotal, discountValue);
  }

  return 0;
};

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

const getBearerToken = (req: any) => {
  const authHeader = req.headers?.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  return authHeader.slice(7);
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
  const token = getBearerToken(req);

  if (!token) {
    sendError(res, "Unauthorized: Login required", 401);
    return null;
  }

  const decoded = verifyToken(token);

  if (!decoded?.userId) {
    sendError(res, "Unauthorized: Login required", 401);
    return null;
  }

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
            s.total AS sale_total,
            s.monto_pagado AS sale_monto_pagado,
            s.monto_pendiente AS sale_monto_pendiente,
            s.metodo_pago AS sale_metodo_pago
          FROM supplier_orders so
          LEFT JOIN sales s ON s.id = so.sale_id
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
            s.total AS sale_total,
            s.monto_pagado AS sale_monto_pagado,
            s.monto_pendiente AS sale_monto_pendiente,
            s.metodo_pago AS sale_metodo_pago
          FROM supplier_orders so
          LEFT JOIN sales s ON s.id = so.sale_id
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

    if (parsed.data.estado === "entregado") {
      return sendError(res, "No se puede marcar entregado manualmente. Use Completar Entrega.", 400);
    }

    try {
      const result = await pool.query(
        `
          UPDATE supplier_orders
          SET estado = $1
          WHERE id = $2 AND estado <> 'entregado'
        `,
        [parsed.data.estado, id]
      );

      if (!result.rowCount) return sendError(res, "Pedido no encontrado o ya entregado", 404);

      return sendSuccess(res, null, "Estado actualizado");
    } catch (error: any) {
      return sendError(res, error?.message || "Error al actualizar estado", 400);
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

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const orderResult = await client.query(
        `SELECT id, estado FROM supplier_orders WHERE id = $1 LIMIT 1`,
        [id]
      );

      if (!orderResult.rowCount) {
        await client.query("ROLLBACK");
        return sendError(res, "Pedido no encontrado", 404);
      }

      if (orderResult.rows[0]?.estado === "entregado") {
        await client.query("ROLLBACK");
        return sendError(res, "No se puede editar un pedido entregado", 400);
      }

      await client.query(`DELETE FROM supplier_order_items WHERE order_id = $1`, [id]);

      for (const item of parsed.data.items) {
        await client.query(
          `INSERT INTO supplier_order_items (order_id, product_id, cantidad) VALUES ($1, $2, $3)`,
          [id, item.product_id, item.cantidad]
        );
      }

      await client.query(
        `UPDATE supplier_orders SET notes = $1 WHERE id = $2`,
        [parsed.data.notes || null, id]
      );

      await client.query("COMMIT");
      return sendSuccess(res, null, "Pedido actualizado");
    } catch (error: any) {
      await client.query("ROLLBACK");
      return sendError(res, error?.message || "Error al actualizar pedido", 400);
    } finally {
      client.release();
    }
  }

  if (endpoint === "supplier-order" && req.method === "DELETE") {
    const user = await requirePermission(req, res, "suppliers", "delete");
    if (!user) return;
    if (!id) return sendError(res, "ID de pedido inválido", 400);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const orderResult = await client.query(
        `SELECT id, estado, sale_id, customer_order_id, stock_actualizado
         FROM supplier_orders
         WHERE id = $1
         LIMIT 1
         FOR UPDATE`,
        [id]
      );

      if (!orderResult.rowCount) {
        await client.query("ROLLBACK");
        return sendError(res, "Pedido no encontrado", 404);
      }

      const order = orderResult.rows[0];
      const stockUpdated = toNumber(order.stock_actualizado) === 1;

      if (order.estado === "entregado" || stockUpdated) {
        await client.query("ROLLBACK");
        return sendError(
          res,
          "No se puede eliminar un pedido entregado porque ya actualizó stock, venta o movimientos relacionados.",
          409
        );
      }

      if (order.sale_id !== null && order.sale_id !== undefined) {
        await client.query("ROLLBACK");
        return sendError(
          res,
          "No se puede eliminar este pedido porque está vinculado a una venta. Primero deberá anularse la operación de origen.",
          409
        );
      }

      if (order.customer_order_id !== null && order.customer_order_id !== undefined) {
        await client.query("ROLLBACK");
        return sendError(
          res,
          "No se puede eliminar este pedido porque está vinculado a un pedido de cliente.",
          409
        );
      }

      await client.query(`DELETE FROM supplier_order_items WHERE order_id = $1`, [id]);
      await client.query(`DELETE FROM supplier_orders WHERE id = $1`, [id]);
      await client.query("COMMIT");

      return sendSuccess(res, null, "Pedido eliminado");
    } catch (error: any) {
      await client.query("ROLLBACK");
      return sendError(res, error?.message || "Error al eliminar pedido", 400);
    } finally {
      client.release();
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

          await client.query(
            `INSERT INTO stock_movimientos (product_id, cantidad, costo_unitario, cantidad_restante, descripcion, tipo_movimiento, motivo, usuario)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              productId,
              cantidad,
              costoUnitario,
              cantidad,
              `Ingreso desde Pedido Proveedor #${order.numero_pedido || order.id} para Pedido Cliente #${order.customer_order_id}`,
              "ingreso",
              "pedido_proveedor",
              user.userName || "Sistema",
            ]
          );
        }

        await client.query(
          `UPDATE supplier_orders
           SET estado = $1,
               stock_actualizado = 1
           WHERE id = $2`,
          ["entregado", id]
        );

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
              sale_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
          ]
        );

        await client.query(
          `
            INSERT INTO stock_movimientos (product_id, cantidad, costo_unitario, cantidad_restante, descripcion, tipo_movimiento, motivo, usuario)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
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

        await client.query(
          `
            UPDATE supplier_orders
            SET estado = $1,
                stock_actualizado = 1
            WHERE id = $2
          `,
          ["entregado", id]
        );

        await client.query("COMMIT");
        return sendSuccess(
          res,
          { success: true, saleId: toNumber(order.sale_id), linkedSale: true },
          "Pedido entregado y costo actualizado en la venta original"
        );
      }

      const metodoPago = parsed.data.metodo_pago || "efectivo";
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

      await client.query(
        `
          UPDATE supplier_orders
          SET estado = $1,
              sale_id = $2,
              stock_actualizado = 1
          WHERE id = $3
        `,
        ["entregado", saleId, id]
      );

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
    entregado_at: row.entregado_at || null,
    rejected_at: row.rejected_at || null,
    cancelled_at: row.cancelled_at || null,
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

const ensureSupplierOrderForCustomerOrder = async (client: any, customerOrder: any, shortageItems: any[], userName: string) => {
  const validShortages = shortageItems.filter((item: any) => toNumber(item.cantidad) > 0);

  if (!validShortages.length) {
    return null;
  }

  const existingResult = await client.query(
    `SELECT id, numero_pedido
     FROM supplier_orders
     WHERE customer_order_id = $1 AND estado <> 'entregado'
     ORDER BY id DESC
     LIMIT 1`,
    [toNumber(customerOrder.id)]
  );

  let supplierOrderId: number;
  let supplierOrderNumber: number;

  if (existingResult.rowCount) {
    supplierOrderId = toNumber(existingResult.rows[0]?.id);
    supplierOrderNumber = toNumber(existingResult.rows[0]?.numero_pedido);

    await client.query(`DELETE FROM supplier_order_items WHERE order_id = $1`, [supplierOrderId]);
    await client.query(
      `UPDATE supplier_orders
       SET cliente = $1,
           cliente_id = $2,
           notes = $3,
           estado = CASE WHEN estado = 'entregado' THEN estado ELSE 'pendiente' END
       WHERE id = $4`,
      [
        customerOrder.cliente || customerOrder.nombre_apellido || 'Pedido cliente',
        customerOrder.cliente_id || null,
        `Faltante generado por Pedido Cliente #${customerOrder.numero_pedido || customerOrder.id}`,
        supplierOrderId,
      ]
    );
  } else {
    supplierOrderNumber = await getAndIncrementSetting(client, "next_order_number");
    const orderResult = await client.query(
      `INSERT INTO supplier_orders (numero_pedido, cliente, cliente_id, customer_order_id, estado, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        supplierOrderNumber,
        customerOrder.cliente || customerOrder.nombre_apellido || 'Pedido cliente',
        customerOrder.cliente_id || null,
        toNumber(customerOrder.id),
        'pendiente',
        `Faltante generado por Pedido Cliente #${customerOrder.numero_pedido || customerOrder.id}`,
      ]
    );
    supplierOrderId = toNumber(orderResult.rows[0]?.id);
  }

  for (const item of validShortages) {
    await client.query(
      `INSERT INTO supplier_order_items (order_id, product_id, cantidad)
       VALUES ($1, $2, $3)`,
      [supplierOrderId, toNumber(item.product_id), toNumber(item.cantidad)]
    );
  }

  return { supplierOrderId, supplierOrderNumber };
};

const getCustomerOrderShortages = async (queryable: any, orderId: number) => {
  const result = await queryable.query(
    `SELECT
       coi.product_id,
       p.name AS product_name,
       SUM(COALESCE(coi.cantidad, 0)) AS cantidad,
       COALESCE(p.stock, 0) AS stock_actual
     FROM customer_order_items coi
     JOIN products p ON p.id = coi.product_id
     WHERE coi.order_id = $1
     GROUP BY coi.product_id, p.name, p.stock
     ORDER BY p.name ASC`,
    [orderId]
  );

  return result.rows
    .map((row: any) => {
      const cantidad = toNumber(row.cantidad);
      const stockActual = Math.max(0, toNumber(row.stock_actual));
      return {
        product_id: toNumber(row.product_id),
        product_name: row.product_name || 'Producto',
        cantidad: Math.max(0, cantidad - stockActual),
        solicitado: cantidad,
        stock_actual: stockActual,
      };
    })
    .filter((item: any) => item.cantidad > 0);
};

const handleCustomerOrders = async (req: any, res: any) => {
  const endpoint = getEndpoint(req);
  const user = await requirePermission(req, res, "sales", endpoint === "customer-orders" ? "view" : "edit");
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

  if (endpoint === "customer-order-reject" && req.method === "POST") {
    if (!id) return sendError(res, "ID de pedido inválido", 400);
    const parsed = customerOrderRejectSchema.safeParse(getBody(req));
    if (!parsed.success) {
      return sendError(res, "Validation failed", 400, parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })));
    }

    const result = await pool.query(
      `UPDATE customer_orders
       SET estado = 'rechazado',
           rejection_reason = $1,
           admin_notes = $2,
           rejected_at = now()
       WHERE id = $3
         AND estado = 'pendiente_aprobacion'
       RETURNING *`,
      [parsed.data.motivo, parsed.data.admin_notes || parsed.data.motivo, id]
    );

    if (!result.rowCount) {
      return sendError(res, "Solo se pueden rechazar pedidos pendientes", 400);
    }

    return sendSuccess(res, result.rows[0], "Pedido rechazado");
  }

  if (endpoint === "customer-order-update" && ["POST", "PUT"].includes(req.method)) {
    if (!id) return sendError(res, "ID de pedido inválido", 400);
    const parsed = customerOrderUpdateSchema.safeParse(getBody(req));
    if (!parsed.success) {
      return sendError(res, "Validation failed", 400, parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })));
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const orderResult = await client.query(
        `SELECT * FROM customer_orders WHERE id = $1 FOR UPDATE`,
        [id]
      );

      if (!orderResult.rowCount) {
        await client.query("ROLLBACK");
        return sendError(res, "Pedido no encontrado", 404);
      }

      const order = orderResult.rows[0];
      if (order.estado !== "pendiente_aprobacion") {
        await client.query("ROLLBACK");
        return sendError(res, "Solo se pueden editar pedidos pendientes de aprobación", 400);
      }

      const productIds = parsed.data.items.map((item) => item.product_id);
      const productResult = await client.query(
        `SELECT id, name, sale_price FROM products WHERE id = ANY($1::int[]) AND COALESCE(eliminado, 0) = 0`,
        [productIds]
      );
      const productMap = new Map<number, any>(productResult.rows.map((row: any) => [toNumber(row.id), row]));

      let subtotal = 0;
      for (const item of parsed.data.items) {
        const product = productMap.get(item.product_id);
        if (!product) throw new Error(`Producto inválido: ${item.product_id}`);
        subtotal += toNumber(item.cantidad) * toNumber(product.sale_price);
      }

      const discountType = parsed.data.descuento_tipo || "none";
      const discountValue = toNumber(parsed.data.descuento_valor);
      const discountAmount = calculateCustomerOrderDiscount(subtotal, discountType, discountValue);
      const totalFinal = Math.max(0, subtotal - discountAmount);

      await client.query(`DELETE FROM customer_order_items WHERE order_id = $1`, [id]);
      for (const item of parsed.data.items) {
        const product = productMap.get(item.product_id);
        await client.query(
          `INSERT INTO customer_order_items (order_id, product_id, cantidad, precio_unitario)
           VALUES ($1, $2, $3, $4)`,
          [id, item.product_id, item.cantidad, toNumber(product.sale_price)]
        );
      }

      const updateResult = await client.query(
        `UPDATE customer_orders
         SET subtotal = $1,
             descuento_tipo = $2,
             descuento_valor = $3,
             descuento_monto = $4,
             total_final = $5,
             admin_notes = $6
         WHERE id = $7
         RETURNING *`,
        [subtotal, discountType, discountValue, discountAmount, totalFinal, parsed.data.admin_notes || null, id]
      );

      await client.query("COMMIT");
      return sendSuccess(res, updateResult.rows[0], "Pedido actualizado");
    } catch (error: any) {
      await client.query("ROLLBACK");
      return sendError(res, error?.message || "Error al editar pedido", error?.statusCode || 400, error?.errors || []);
    } finally {
      client.release();
    }
  }

  if (endpoint === "customer-order-approve" && req.method === "POST") {
    if (!id) return sendError(res, "ID de pedido inválido", 400);
    const parsed = customerOrderApproveSchema.safeParse(getBody(req));
    if (!parsed.success) {
      return sendError(res, "Validation failed", 400, parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })));
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const orderResult = await client.query(
        `SELECT co.*, c.nombre_apellido AS cliente, c.telefono AS cliente_telefono
         FROM customer_orders co
         JOIN clientes c ON c.id = co.cliente_id
         WHERE co.id = $1
         LIMIT 1`,
        [id]
      );

      if (!orderResult.rowCount) {
        await client.query("ROLLBACK");
        return sendError(res, "Pedido no encontrado", 404);
      }

      const order = orderResult.rows[0];
      if (order.estado !== "pendiente_aprobacion") {
        await client.query("ROLLBACK");
        return sendError(res, "Solo se pueden aprobar pedidos pendientes", 400);
      }

      const subtotal = toNumber(order.subtotal);
      const discountType = parsed.data.descuento_tipo || "none";
      const discountValue = toNumber(parsed.data.descuento_valor);
      const discountAmount = calculateCustomerOrderDiscount(subtotal, discountType, discountValue);
      const totalFinal = Math.max(0, subtotal - discountAmount);
      const shortageItems = await getCustomerOrderShortages(client, id);
      const supplierOrder = await ensureSupplierOrderForCustomerOrder(
        client,
        order,
        shortageItems,
        user.userName || "Sistema"
      );

      const result = await client.query(
        `UPDATE customer_orders
         SET estado = 'aprobado_pendiente_entrega',
             descuento_tipo = $1,
             descuento_valor = $2,
             descuento_monto = $3,
             total_final = $4,
             admin_notes = $5,
             aprobado_at = now()
         WHERE id = $6
         RETURNING *`,
        [discountType, discountValue, discountAmount, totalFinal, parsed.data.admin_notes || null, id]
      );

      await client.query("COMMIT");

      return sendSuccess(
        res,
        {
          ...result.rows[0],
          supplierOrderGenerated: Boolean(supplierOrder),
          supplierOrderId: supplierOrder?.supplierOrderId || null,
          supplierOrderNumber: supplierOrder?.supplierOrderNumber || null,
          shortageItems,
        },
        shortageItems.length > 0
          ? "Pedido aprobado. Hay faltantes y se generó/actualizó un pedido a proveedor."
          : "Pedido aprobado"
      );
    } catch (error: any) {
      await client.query("ROLLBACK");
      return sendError(res, error?.message || "Error al aprobar pedido", error?.statusCode || 400, error?.errors || []);
    } finally {
      client.release();
    }
  }

  if (endpoint === "customer-order-deliver" && req.method === "POST") {
    if (!id) return sendError(res, "ID de pedido inválido", 400);

    const orderResult = await pool.query(
      `SELECT co.*, c.nombre_apellido AS cliente, c.telefono AS cliente_telefono
       FROM customer_orders co
       JOIN clientes c ON c.id = co.cliente_id
       WHERE co.id = $1
       LIMIT 1`,
      [id]
    );

    if (!orderResult.rowCount) return sendError(res, "Pedido no encontrado", 404);
    const order = orderResult.rows[0];

    if (order.estado !== "aprobado_pendiente_entrega") {
      return sendError(res, "Solo se pueden entregar pedidos aprobados", 400);
    }

    const itemsByOrder = await fetchCustomerOrderItems(pool, [id]);
    const items = itemsByOrder.get(id) || [];
    if (!items.length) return sendError(res, "El pedido no tiene productos", 400);

    const shortageItems = await getCustomerOrderShortages(pool, id);
    if (shortageItems.length > 0) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const supplierOrder = await ensureSupplierOrderForCustomerOrder(client, order, shortageItems, user.userName || "Sistema");
        await client.query("COMMIT");
        return sendError(
          res,
          `No se puede entregar el pedido porque hay productos sin stock. Se generó/actualizó el pedido a proveedor #${supplierOrder?.supplierOrderNumber || ''}.`,
          400,
          shortageItems
        );
      } catch (error: any) {
        await client.query("ROLLBACK");
        return sendError(res, error?.message || "Error al verificar stock del pedido", error?.statusCode || 400, error?.errors || []);
      } finally {
        client.release();
      }
    }

    const subtotal = toNumber(order.subtotal);
    const discountAmount = toNumber(order.descuento_monto);
    const equivalentDiscountPct = subtotal > 0 ? Math.min(100, (discountAmount / subtotal) * 100) : 0;

    const saleResult = await salesService.createSale({
      cliente_id: toNumber(order.cliente_id),
      nombre_cliente: order.cliente,
      metodo_pago: "Cta Cte",
      monto_pagado: 0,
      notes: `Pedido cliente #${order.numero_pedido}`,
      usuario: user.userName || "Sistema",
      items: items.map((item: any) => ({
        product_id: toNumber(item.product_id),
        cantidad: toNumber(item.cantidad),
        precio_venta: toNumber(item.precio_unitario),
        precio_unitario_original: toNumber(item.precio_unitario),
        bonificacion_tipo: equivalentDiscountPct > 0 ? "percentage" : "none",
        bonificacion_valor: equivalentDiscountPct,
      })),
    });

    await pool.query(
      `UPDATE customer_orders
       SET estado = 'entregado',
           sale_id = $1,
           entregado_at = now()
       WHERE id = $2`,
      [saleResult.saleId, id]
    );

    return sendSuccess(res, { ...saleResult, orderId: id }, "Pedido entregado y agregado a cuenta corriente");
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
             (tipo, origen, descripcion, categoria, forma_pago, monto, fecha, usuario, numero_pago, cliente_id, venta_id)
           VALUES
             ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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

  if (["customer-orders", "customer-order-approve", "customer-order-deliver", "customer-order-reject", "customer-order-update", "customer-order-payment"].includes(endpoint)) {
    return handleCustomerOrders(req, res);
  }

  if (
    [
      "supplier-orders",
      "supplier-order",
      "supplier-order-status",
      "supplier-order-items",
      "supplier-order-complete",
    ].includes(endpoint)
  ) {
    return handleSupplierOrders(req, res);
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
      });

      return sendSuccess(res, result, "Venta registrada exitosamente", 201);
    } catch (error: any) {
      return sendError(res, error?.message || "Error al procesar la venta", error?.statusCode || 400, error?.errors || []);
    }
  }

  return sendError(res, "Method not allowed", 405);
}
