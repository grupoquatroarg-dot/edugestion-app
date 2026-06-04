import { z } from "zod";
import { salesRepository } from "../server/repositories/salesRepository.js";
import { salesService } from "../server/services/salesService.js";
import { UserRepository } from "../server/repositories/userRepository.js";
import { verifyToken } from "../server/utils/jwt.js";
import { sendError, sendSuccess } from "../server/utils/response.js";
import { getPostgresPool } from "../server/utils/postgres.js";

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
  metodo_pago: z.string().min(1, "Metodo de pago requerido"),
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
  const ratio = saleTotal > 0 ? Math.min(1, totalPedido / saleTotal) : 1;
  const cobradoPedido = Math.min(totalPedido, salePaid * ratio);
  const ctaCtePedido = Math.max(0, totalPedido - cobradoPedido);

  return {
    id: toNumber(row.id),
    numero_pedido: toNumber(row.numero_pedido),
    cliente: row.cliente || "",
    cliente_id: row.cliente_id === null || row.cliente_id === undefined ? null : toNumber(row.cliente_id),
    sale_id: row.sale_id === null || row.sale_id === undefined ? null : toNumber(row.sale_id),
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
            so.id, so.numero_pedido, so.cliente, so.cliente_id, so.sale_id, so.fecha, so.estado, so.notes, so.stock_actualizado,
            s.total AS sale_total,
            s.monto_pagado AS sale_monto_pagado,
            s.monto_pendiente AS sale_monto_pendiente
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
    if (!id) return sendError(res, "ID de pedido invalido", 400);

    try {
      const orderResult = await pool.query(
        `
          SELECT
            so.id, so.numero_pedido, so.cliente, so.cliente_id, so.sale_id, so.fecha, so.estado, so.notes, so.stock_actualizado,
            s.total AS sale_total,
            s.monto_pagado AS sale_monto_pagado,
            s.monto_pendiente AS sale_monto_pendiente
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
    if (!id) return sendError(res, "ID de pedido invalido", 400);

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
    if (!id) return sendError(res, "ID de pedido invalido", 400);

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
    if (!id) return sendError(res, "ID de pedido invalido", 400);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM supplier_order_items WHERE order_id = $1`, [id]);
      const result = await client.query(`DELETE FROM supplier_orders WHERE id = $1`, [id]);
      await client.query("COMMIT");

      if (!result.rowCount) return sendError(res, "Pedido no encontrado", 404);

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
    if (!id) return sendError(res, "ID de pedido invalido", 400);

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
          SELECT id, numero_pedido, cliente, cliente_id, sale_id, estado, notes
          FROM supplier_orders
          WHERE id = $1
          LIMIT 1
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

        await client.query(
          `
            INSERT INTO stock_movimientos (product_id, cantidad, costo_unitario, cantidad_restante, descripcion, tipo_movimiento, motivo, usuario)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
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
          ]
        );

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

      if (montoPagado > 0) {
        const nextPaymentNum = await getAndIncrementSetting(client, "next_payment_number");
        await client.query(
          `
            INSERT INTO movimientos_financieros (tipo, origen, descripcion, categoria, forma_pago, monto, cliente_id, venta_id, usuario, numero_pago)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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

export default async function handler(req: any, res: any) {
  const id = getId(req);
  const endpoint = getEndpoint(req);

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
      return sendError(res, "ID de cliente invalido", 400);
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
