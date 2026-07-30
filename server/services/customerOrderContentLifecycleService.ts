import { getPostgresPool } from "../utils/postgres.js";
import { AppError } from "../utils/response.js";

export type CustomerOrderContentItemInput = {
  product_id: number;
  cantidad: number;
};

type TransactionClient = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

type ContentUpdateInput = {
  customerOrderId: number;
  items: CustomerOrderContentItemInput[];
  discountType?: "none" | "percentage" | "fixed";
  discountValue?: number;
  adminNotes?: string | null;
  motivo: string;
  usuario: string;
  expectedContentVersion: number;
  expectedApprovalVersion: number;
  expectedRejectionVersion: number;
};

const toNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalize = (value: unknown) => String(value ?? "").trim();

const validateInput = (input: ContentUpdateInput) => {
  if (!Number.isInteger(input.customerOrderId) || input.customerOrderId <= 0) {
    throw new AppError("ID de pedido inválido", 400);
  }

  const reason = normalize(input.motivo);
  if (reason.length < 3) {
    throw new AppError("El motivo del cambio es obligatorio y debe tener al menos 3 caracteres", 400);
  }
  if (reason.length > 500) {
    throw new AppError("El motivo no puede superar los 500 caracteres", 400);
  }

  if (!Number.isInteger(input.expectedContentVersion) || input.expectedContentVersion < 0) {
    throw new AppError("Versión de contenido inválida", 400);
  }
  if (!Number.isInteger(input.expectedApprovalVersion) || input.expectedApprovalVersion < 0) {
    throw new AppError("Versión de aprobación inválida", 400);
  }
  if (!Number.isInteger(input.expectedRejectionVersion) || input.expectedRejectionVersion < 0) {
    throw new AppError("Versión de rechazo inválida", 400);
  }

  const discountType = input.discountType || "none";
  if (!["none", "percentage", "fixed"].includes(discountType)) {
    throw new AppError("Tipo de descuento inválido", 400);
  }

  const discountValue = discountType === "none" ? 0 : toNumber(input.discountValue);
  if (discountValue < 0) {
    throw new AppError("El descuento no puede ser negativo", 400);
  }
  if (discountType === "percentage" && discountValue > 100) {
    throw new AppError("El descuento porcentual no puede superar el 100%", 400);
  }

  const adminNotes = input.adminNotes === null || input.adminNotes === undefined
    ? null
    : String(input.adminNotes).trim();
  if ((adminNotes || "").length > 2000) {
    throw new AppError("La observación no puede superar los 2000 caracteres", 400);
  }

  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new AppError("El pedido debe conservar al menos un producto", 400);
  }

  const seen = new Set<number>();
  const items = input.items.map((item) => {
    const productId = toNumber(item?.product_id);
    const quantity = toNumber(item?.cantidad);

    if (!Number.isInteger(productId) || productId <= 0) {
      throw new AppError("Todos los productos deben ser válidos", 400);
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new AppError("Todas las cantidades deben ser números enteros mayores a cero", 400);
    }
    if (seen.has(productId)) {
      throw new AppError("Un producto no puede repetirse dentro del pedido", 400);
    }
    seen.add(productId);

    return { product_id: productId, cantidad: quantity };
  }).sort((left, right) => left.product_id - right.product_id);

  return {
    reason,
    user: normalize(input.usuario) || "Sistema",
    discountType: discountType as "none" | "percentage" | "fixed",
    discountValue,
    adminNotes: adminNotes || null,
    items,
  };
};

const calculateDiscount = (
  subtotal: number,
  discountType: "none" | "percentage" | "fixed",
  discountValue: number
) => {
  if (discountType === "percentage") return subtotal * discountValue / 100;
  if (discountType === "fixed") return Math.min(subtotal, discountValue);
  return 0;
};

const comparableItems = (items: any[]) => items
  .map((item) => ({
    product_id: toNumber(item.product_id),
    cantidad: toNumber(item.cantidad),
    precio_unitario: Math.round(toNumber(item.precio_unitario) * 100) / 100,
  }))
  .sort((left, right) => left.product_id - right.product_id);

const assertOrderCanBeEdited = (order: any, input: ContentUpdateInput) => {
  if (!order) throw new AppError("Pedido no encontrado", 404);

  const status = String(order.estado || "pendiente_aprobacion");
  if (status !== "pendiente_aprobacion") {
    throw new AppError("Solo se pueden editar pedidos pendientes de aprobación", 409);
  }
  if (order.sale_id || order.cancelled_at || order.entregado_at || order.rejected_at || order.aprobado_at) {
    throw new AppError("El pedido tiene vínculos incompatibles con la edición", 409);
  }
  if (toNumber(order.content_version) !== input.expectedContentVersion) {
    throw new AppError("El contenido del pedido cambió mientras estaba abierto. Actualizá la pantalla e intentá nuevamente", 409);
  }
  if (toNumber(order.approval_version) !== input.expectedApprovalVersion) {
    throw new AppError("La aprobación del pedido cambió mientras estaba abierto. Actualizá la pantalla e intentá nuevamente", 409);
  }
  if (toNumber(order.rejection_version) !== input.expectedRejectionVersion) {
    throw new AppError("El ciclo de rechazo cambió mientras el pedido estaba abierto. Actualizá la pantalla e intentá nuevamente", 409);
  }

  return status;
};

export const customerOrderContentLifecycleService = {
  async update(input: ContentUpdateInput, executor?: TransactionClient) {
    const validated = validateInput(input);
    const ownsTransaction = !executor;
    const pool = executor ? null : getPostgresPool();
    const client = executor || (await pool!.connect());

    try {
      if (ownsTransaction) await client.query("BEGIN");

      const orderResult = await client.query(
        `SELECT *
         FROM customer_orders
         WHERE id = $1
         LIMIT 1
         FOR UPDATE`,
        [input.customerOrderId]
      );
      const order = orderResult.rows[0];
      const status = assertOrderCanBeEdited(order, input);

      const activeRejectionResult = await client.query(
        `SELECT id
         FROM customer_order_rejections
         WHERE customer_order_id = $1
           AND reopened_at IS NULL
         LIMIT 1
         FOR UPDATE`,
        [input.customerOrderId]
      );
      if (activeRejectionResult.rowCount) {
        throw new AppError("Existe un rechazo activo incompatible con la edición", 409);
      }

      const supplierOrderResult = await client.query(
        `SELECT id
         FROM supplier_orders
         WHERE customer_order_id = $1
           AND estado <> 'cancelado'
         LIMIT 1
         FOR UPDATE`,
        [input.customerOrderId]
      );
      if (supplierOrderResult.rowCount) {
        throw new AppError("El pedido ya tiene un pedido a proveedor activo y no permite editar sus productos", 409);
      }

      const beforeItemsResult = await client.query(
        `SELECT
           coi.id,
           coi.order_id,
           coi.product_id,
           coi.cantidad,
           coi.precio_unitario,
           (coi.cantidad * coi.precio_unitario) AS importe,
           p.name AS product_name,
           COALESCE(p.codigo_unico, p.code, '') AS product_code
         FROM customer_order_items coi
         JOIN products p ON p.id = coi.product_id
         WHERE coi.order_id = $1
         ORDER BY coi.id ASC
         FOR UPDATE OF coi, p`,
        [input.customerOrderId]
      );
      if (!beforeItemsResult.rowCount) {
        throw new AppError("El pedido no tiene productos trazables", 409);
      }
      const beforeItems = beforeItemsResult.rows;

      const productIds = validated.items.map((item) => item.product_id);
      const productsResult = await client.query(
        `SELECT
           id,
           name,
           COALESCE(codigo_unico, code, '') AS product_code,
           sale_price,
           COALESCE(eliminado, 0) AS eliminado,
           COALESCE(estado, 'activo') AS product_status
         FROM products
         WHERE id = ANY($1::int[])
         ORDER BY id ASC
         FOR UPDATE`,
        [productIds]
      );

      const productMap = new Map<number, any>();
      for (const product of productsResult.rows) {
        if (toNumber(product.eliminado) !== 0 || String(product.product_status).toLowerCase() !== "activo") {
          throw new AppError(`El producto ${product.name || product.id} está dado de baja`, 409);
        }
        productMap.set(toNumber(product.id), product);
      }
      if (productMap.size !== validated.items.length) {
        throw new AppError("Uno o más productos no existen o están dados de baja", 409);
      }

      const afterItems = validated.items.map((item) => {
        const product = productMap.get(item.product_id);
        const unitPrice = Math.round(toNumber(product?.sale_price) * 100) / 100;
        if (unitPrice < 0) {
          throw new AppError(`El producto ${product?.name || item.product_id} tiene un precio inválido`, 409);
        }
        return {
          product_id: item.product_id,
          cantidad: item.cantidad,
          precio_unitario: unitPrice,
          importe: Math.round(item.cantidad * unitPrice * 100) / 100,
          product_name: product?.name || "Producto",
          product_code: product?.product_code || "",
        };
      });

      const subtotal = Math.round(afterItems.reduce((sum, item) => sum + item.importe, 0) * 100) / 100;
      const discountAmount = Math.round(
        calculateDiscount(subtotal, validated.discountType, validated.discountValue) * 100
      ) / 100;
      const totalFinal = Math.max(0, Math.round((subtotal - discountAmount) * 100) / 100);

      const beforeOrderComparable = {
        subtotal: Math.round(toNumber(order.subtotal) * 100) / 100,
        descuento_tipo: order.descuento_tipo || "none",
        descuento_valor: Math.round(toNumber(order.descuento_valor) * 100) / 100,
        descuento_monto: Math.round(toNumber(order.descuento_monto) * 100) / 100,
        total_final: Math.round(toNumber(order.total_final) * 100) / 100,
        admin_notes: normalize(order.admin_notes),
      };
      const afterOrderComparable = {
        subtotal,
        descuento_tipo: validated.discountType,
        descuento_valor: validated.discountValue,
        descuento_monto: discountAmount,
        total_final: totalFinal,
        admin_notes: normalize(validated.adminNotes),
      };

      const hasChanges = (
        JSON.stringify(comparableItems(beforeItems)) !== JSON.stringify(comparableItems(afterItems))
        || JSON.stringify(beforeOrderComparable) !== JSON.stringify(afterOrderComparable)
      );
      if (!hasChanges) {
        throw new AppError("No se detectaron cambios en productos, importes ni observaciones", 409);
      }

      const nextVersion = toNumber(order.content_version) + 1;
      const orderAfterSnapshot = {
        ...order,
        ...afterOrderComparable,
        content_version: nextVersion,
        content_changed_by: validated.user,
        content_change_reason: validated.reason,
      };

      const historyResult = await client.query(
        `INSERT INTO customer_order_content_history (
           customer_order_id, version, status_at_change, reason, changed_by,
           order_before_snapshot, items_before_snapshot,
           order_after_snapshot, items_after_snapshot
         ) VALUES (
           $1, $2, $3, $4, $5,
           $6::jsonb, $7::jsonb,
           $8::jsonb, $9::jsonb
         )
         RETURNING id, changed_at`,
        [
          input.customerOrderId,
          nextVersion,
          status,
          validated.reason,
          validated.user,
          JSON.stringify(order),
          JSON.stringify(beforeItems),
          JSON.stringify(orderAfterSnapshot),
          JSON.stringify(afterItems),
        ]
      );
      const changedAt = historyResult.rows[0]?.changed_at || new Date().toISOString();

      const updateResult = await client.query(
        `UPDATE customer_orders
         SET subtotal = $1,
             descuento_tipo = $2,
             descuento_valor = $3,
             descuento_monto = $4,
             total_final = $5,
             admin_notes = $6,
             content_version = $7,
             content_changed_at = $8,
             content_changed_by = $9,
             content_change_reason = $10
         WHERE id = $11
           AND estado = 'pendiente_aprobacion'
           AND COALESCE(content_version, 0) = $12
           AND COALESCE(approval_version, 0) = $13
           AND COALESCE(rejection_version, 0) = $14
         RETURNING *`,
        [
          subtotal,
          validated.discountType,
          validated.discountValue,
          discountAmount,
          totalFinal,
          validated.adminNotes,
          nextVersion,
          changedAt,
          validated.user,
          validated.reason,
          input.customerOrderId,
          input.expectedContentVersion,
          input.expectedApprovalVersion,
          input.expectedRejectionVersion,
        ]
      );
      if (!updateResult.rowCount) {
        throw new AppError("El pedido cambió mientras se guardaba la edición", 409);
      }

      await client.query("DELETE FROM customer_order_items WHERE order_id = $1", [input.customerOrderId]);
      for (const item of afterItems) {
        await client.query(
          `INSERT INTO customer_order_items (order_id, product_id, cantidad, precio_unitario)
           VALUES ($1, $2, $3, $4)`,
          [input.customerOrderId, item.product_id, item.cantidad, item.precio_unitario]
        );
      }

      const savedItemsResult = await client.query(
        `SELECT
           coi.id,
           coi.order_id,
           coi.product_id,
           coi.cantidad,
           coi.precio_unitario,
           (coi.cantidad * coi.precio_unitario) AS importe,
           p.name AS product_name,
           COALESCE(p.codigo_unico, p.code, '') AS product_code
         FROM customer_order_items coi
         JOIN products p ON p.id = coi.product_id
         WHERE coi.order_id = $1
         ORDER BY coi.id ASC`,
        [input.customerOrderId]
      );

      if (ownsTransaction) await client.query("COMMIT");

      return {
        order: updateResult.rows[0],
        items: savedItemsResult.rows,
        historyId: toNumber(historyResult.rows[0]?.id),
        version: nextVersion,
        changedAt,
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
