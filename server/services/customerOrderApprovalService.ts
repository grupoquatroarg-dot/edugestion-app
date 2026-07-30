import { getPostgresPool } from "../utils/postgres.js";
import { AppError } from "../utils/response.js";

type TransactionClient = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

type ApprovalInput = {
  customerOrderId: number;
  discountType?: "none" | "percentage" | "fixed";
  discountValue?: number;
  adminNotes?: string | null;
  usuario: string;
  expectedApprovalVersion: number;
  expectedRejectionVersion: number;
  expectedContentVersion: number;
};

const toNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalize = (value: unknown) => String(value ?? "").trim();

const validateInput = (input: ApprovalInput) => {
  if (!Number.isInteger(input.customerOrderId) || input.customerOrderId <= 0) {
    throw new AppError("ID de pedido inválido", 400);
  }

  if (!Number.isInteger(input.expectedApprovalVersion) || input.expectedApprovalVersion < 0) {
    throw new AppError("Versión de aprobación inválida", 400);
  }
  if (!Number.isInteger(input.expectedRejectionVersion) || input.expectedRejectionVersion < 0) {
    throw new AppError("Versión de rechazo inválida", 400);
  }
  if (!Number.isInteger(input.expectedContentVersion) || input.expectedContentVersion < 0) {
    throw new AppError("Versión de contenido inválida", 400);
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

  return {
    discountType,
    discountValue,
    adminNotes: adminNotes || null,
    user: normalize(input.usuario) || "Sistema",
  };
};

const getAndIncrementSetting = async (
  client: TransactionClient,
  key: string,
  defaultValue = 1
) => {
  await client.query(
    `INSERT INTO settings (key, value)
     VALUES ($1, $2)
     ON CONFLICT (key) DO NOTHING`,
    [key, String(defaultValue)]
  );

  const currentResult = await client.query(
    `SELECT value
     FROM settings
     WHERE key = $1
     LIMIT 1
     FOR UPDATE`,
    [key]
  );
  const currentValue = parseInt(currentResult.rows[0]?.value || String(defaultValue), 10) || defaultValue;

  await client.query(
    `UPDATE settings
     SET value = $2
     WHERE key = $1`,
    [key, String(currentValue + 1)]
  );

  return currentValue;
};

const calculateDiscount = (
  subtotal: number,
  discountType: "none" | "percentage" | "fixed",
  discountValue: number
) => {
  if (discountType === "percentage") return subtotal * discountValue / 100;
  if (discountType === "fixed") return discountValue;
  return 0;
};

export const customerOrderApprovalService = {
  async approve(input: ApprovalInput, executor?: TransactionClient) {
    const validated = validateInput(input);
    const ownsTransaction = !executor;
    const pool = executor ? null : getPostgresPool();
    const client = executor || (await pool!.connect());

    try {
      if (ownsTransaction) await client.query("BEGIN");

      const orderResult = await client.query(
        `SELECT co.*, c.nombre_apellido AS cliente, c.telefono AS cliente_telefono
         FROM customer_orders co
         JOIN clientes c ON c.id = co.cliente_id
         WHERE co.id = $1
         LIMIT 1
         FOR UPDATE OF co`,
        [input.customerOrderId]
      );
      if (!orderResult.rowCount) throw new AppError("Pedido no encontrado", 404);

      const order = orderResult.rows[0];
      const currentStatus = String(order.estado || "pendiente_aprobacion");
      if (currentStatus !== "pendiente_aprobacion") {
        if (currentStatus === "aprobado_pendiente_entrega") {
          throw new AppError("El pedido ya está aprobado", 409);
        }
        throw new AppError("Solo se pueden aprobar pedidos pendientes", 409);
      }
      if (order.sale_id || order.cancelled_at || order.entregado_at || order.rejected_at) {
        throw new AppError("El pedido tiene vínculos incompatibles con la aprobación", 409);
      }
      if (toNumber(order.approval_version) !== input.expectedApprovalVersion) {
        throw new AppError("La aprobación del pedido cambió mientras la pantalla estaba abierta", 409);
      }
      if (toNumber(order.rejection_version) !== input.expectedRejectionVersion) {
        throw new AppError("El ciclo de rechazo del pedido cambió mientras la pantalla estaba abierta", 409);
      }
      if (toNumber(order.content_version) !== input.expectedContentVersion) {
        throw new AppError("El contenido del pedido cambió mientras la pantalla estaba abierta", 409);
      }

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
        throw new AppError("Existe un rechazo activo incompatible con la aprobación", 409);
      }

      const existingSupplierOrders = await client.query(
        `SELECT id, numero_pedido, estado, cancelled_at, delivered_at, stock_actualizado
         FROM supplier_orders
         WHERE customer_order_id = $1
           AND estado <> 'cancelado'
         ORDER BY id ASC
         FOR UPDATE`,
        [input.customerOrderId]
      );
      if (existingSupplierOrders.rowCount) {
        throw new AppError(
          "El pedido ya tiene un pedido a proveedor activo. Revisalo antes de aprobar nuevamente",
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
           COALESCE(p.codigo_unico, p.code, '') AS product_code,
           COALESCE(p.stock, 0) AS stock_actual,
           COALESCE(p.eliminado, 0) AS eliminado,
           COALESCE(p.estado, 'activo') AS product_status
         FROM customer_order_items coi
         JOIN products p ON p.id = coi.product_id
         WHERE coi.order_id = $1
         ORDER BY coi.id ASC
         FOR UPDATE OF coi, p`,
        [input.customerOrderId]
      );
      if (!itemsResult.rowCount) {
        throw new AppError("El pedido no tiene productos trazables", 409);
      }

      const normalizedItems = itemsResult.rows.map((item: any) => {
        const quantity = toNumber(item.cantidad);
        const unitPrice = toNumber(item.precio_unitario);

        if (!Number.isInteger(quantity) || quantity <= 0) {
          throw new AppError("Las cantidades del pedido deben ser enteras y mayores a cero", 409);
        }
        if (unitPrice < 0) {
          throw new AppError("El pedido contiene un precio inválido", 409);
        }
        if (toNumber(item.eliminado) !== 0 || String(item.product_status).toLowerCase() !== "activo") {
          throw new AppError(`El producto ${item.product_name || item.product_id} está dado de baja`, 409);
        }

        return {
          id: toNumber(item.id),
          product_id: toNumber(item.product_id),
          product_name: item.product_name || "Producto",
          product_code: item.product_code || "",
          cantidad: quantity,
          precio_unitario: unitPrice,
          stock_actual: Math.max(0, toNumber(item.stock_actual)),
          importe: quantity * unitPrice,
        };
      });

      const subtotal = normalizedItems.reduce((sum, item) => sum + item.importe, 0);
      const discountAmount = calculateDiscount(
        subtotal,
        validated.discountType as "none" | "percentage" | "fixed",
        validated.discountValue
      );
      const totalFinal = Math.max(0, subtotal - discountAmount);

      const groupedRequirements = new Map<number, any>();
      for (const item of normalizedItems) {
        const current = groupedRequirements.get(item.product_id) || {
          product_id: item.product_id,
          product_name: item.product_name,
          product_code: item.product_code,
          required_quantity: 0,
          stock_actual: item.stock_actual,
        };
        current.required_quantity += item.cantidad;
        current.stock_actual = item.stock_actual;
        groupedRequirements.set(item.product_id, current);
      }

      const shortages = Array.from(groupedRequirements.values())
        .map((item: any) => ({
          product_id: item.product_id,
          product_name: item.product_name,
          product_code: item.product_code,
          cantidad: Math.max(0, item.required_quantity - item.stock_actual),
          stock_actual: item.stock_actual,
          cantidad_requerida: item.required_quantity,
        }))
        .filter((item: any) => item.cantidad > 0)
        .sort((left: any, right: any) => left.product_id - right.product_id);

      let supplierOrderId: number | null = null;
      let supplierOrderNumber: number | null = null;

      if (shortages.length > 0) {
        supplierOrderNumber = await getAndIncrementSetting(client, "next_order_number");
        const supplierOrderResult = await client.query(
          `INSERT INTO supplier_orders (
             numero_pedido, cliente, cliente_id, customer_order_id, estado, notes,
             status_version, content_version
           ) VALUES ($1, $2, $3, $4, 'pendiente', $5, 0, 0)
           RETURNING id`,
          [
            supplierOrderNumber,
            order.cliente || "Pedido cliente",
            order.cliente_id || null,
            input.customerOrderId,
            `Faltante generado al aprobar Pedido Cliente #${order.numero_pedido || order.id}`,
          ]
        );
        supplierOrderId = toNumber(supplierOrderResult.rows[0]?.id);

        for (const shortage of shortages) {
          await client.query(
            `INSERT INTO supplier_order_items (order_id, product_id, cantidad)
             VALUES ($1, $2, $3)`,
            [supplierOrderId, shortage.product_id, shortage.cantidad]
          );
        }
      }

      const nextVersion = toNumber(order.approval_version) + 1;
      const approvalResult = await client.query(
        `INSERT INTO customer_order_approvals (
           customer_order_id, version, previous_status,
           subtotal, discount_type, discount_value, discount_amount, total_final,
           approved_by, supplier_order_id,
           order_snapshot, items_snapshot, shortages_snapshot
         ) VALUES (
           $1, $2, $3,
           $4, $5, $6, $7, $8,
           $9, $10,
           $11::jsonb, $12::jsonb, $13::jsonb
         )
         RETURNING id, approved_at`,
        [
          input.customerOrderId,
          nextVersion,
          currentStatus,
          subtotal,
          validated.discountType,
          validated.discountValue,
          discountAmount,
          totalFinal,
          validated.user,
          supplierOrderId,
          JSON.stringify(order),
          JSON.stringify(normalizedItems),
          JSON.stringify(shortages),
        ]
      );
      const approvedAt = approvalResult.rows[0]?.approved_at || new Date().toISOString();

      const updateResult = await client.query(
        `UPDATE customer_orders
         SET estado = 'aprobado_pendiente_entrega',
             subtotal = $1,
             descuento_tipo = $2,
             descuento_valor = $3,
             descuento_monto = $4,
             total_final = $5,
             admin_notes = $6,
             aprobado_at = $7,
             approved_by = $8,
             approved_from_status = $9,
             approval_version = $10
         WHERE id = $11
           AND estado = 'pendiente_aprobacion'
           AND COALESCE(approval_version, 0) = $12
           AND COALESCE(rejection_version, 0) = $13
           AND COALESCE(content_version, 0) = $14
         RETURNING *`,
        [
          subtotal,
          validated.discountType,
          validated.discountValue,
          discountAmount,
          totalFinal,
          validated.adminNotes,
          approvedAt,
          validated.user,
          currentStatus,
          nextVersion,
          input.customerOrderId,
          input.expectedApprovalVersion,
          input.expectedRejectionVersion,
          input.expectedContentVersion,
        ]
      );
      if (!updateResult.rowCount) {
        throw new AppError("El pedido cambió mientras se completaba la aprobación", 409);
      }

      if (ownsTransaction) await client.query("COMMIT");

      return {
        order: updateResult.rows[0],
        approval_id: toNumber(approvalResult.rows[0]?.id),
        approval_version: nextVersion,
        approved_at: approvedAt,
        supplierOrderGenerated: Boolean(supplierOrderId),
        supplierOrderId,
        supplierOrderNumber,
        shortageItems: shortages,
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
