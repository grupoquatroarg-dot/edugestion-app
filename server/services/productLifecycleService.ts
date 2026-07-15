import { getPostgresPool, isPostgresConfigured } from "../utils/postgres.js";
import { AppError } from "../utils/response.js";

export type ProductLifecycleAction = "deactivate" | "reactivate";

type TransactionClient = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

type LifecycleInput = {
  productId: number;
  action: ProductLifecycleAction;
  motivo: string;
  usuario: string;
};

const ACTIVE_SUPPLIER_STATES = ["pendiente", "pedido_realizado", "auditar_pedido"];
const ACTIVE_CUSTOMER_STATES = ["pendiente_aprobacion", "aprobado_pendiente_entrega"];

const normalize = (value: unknown) => String(value ?? "").trim();

const validateInput = ({ productId, motivo }: LifecycleInput) => {
  if (!Number.isInteger(productId) || productId <= 0) {
    throw new AppError("ID de producto inválido", 400);
  }

  const reason = normalize(motivo);
  if (reason.length < 3) {
    throw new AppError("El motivo es obligatorio y debe tener al menos 3 caracteres", 400);
  }
  if (reason.length > 500) {
    throw new AppError("El motivo no puede superar los 500 caracteres", 400);
  }

  return reason;
};

const assertStatusTransition = (product: any, action: ProductLifecycleAction) => {
  if (!product || Number(product.eliminado || 0) === 1) {
    throw new AppError("Producto no encontrado o eliminado en una versión anterior", 404);
  }

  const currentStatus = normalize(product.estado).toLowerCase() || "activo";

  if (action === "deactivate" && currentStatus === "inactivo") {
    throw new AppError("El producto ya está dado de baja", 409);
  }

  if (action === "reactivate" && currentStatus === "activo") {
    throw new AppError("El producto ya está activo", 409);
  }

  if (!["activo", "inactivo"].includes(currentStatus)) {
    throw new AppError(`El producto tiene un estado inconsistente: ${product.estado || "sin estado"}`, 409);
  }

  return currentStatus;
};

const handleSqlite = async ({ productId, action, motivo, usuario }: LifecycleInput) => {
  const reason = validateInput({ productId, action, motivo, usuario });
  const normalizedUser = normalize(usuario) || "Sistema";
  const { default: db } = await import("../db.js");

  return db.transaction(() => {
    const product = db.prepare("SELECT * FROM products WHERE id = ? LIMIT 1").get(productId) as any;
    const currentStatus = assertStatusTransition(product, action);

    if (action === "deactivate") {
      const supplierOrder = db.prepare(`
        SELECT so.id, so.numero_pedido
        FROM supplier_order_items soi
        JOIN supplier_orders so ON so.id = soi.order_id
        WHERE soi.product_id = ?
          AND LOWER(COALESCE(so.estado, '')) IN ('pendiente', 'pedido_realizado', 'auditar_pedido')
        LIMIT 1
      `).get(productId) as any;

      if (supplierOrder) {
        throw new AppError(
          `El producto está incluido en el pedido a proveedor #${supplierOrder.numero_pedido || supplierOrder.id}. Cerrá ese pedido antes de darlo de baja.`,
          409
        );
      }

      const customerOrder = db.prepare(`
        SELECT co.id, co.numero_pedido
        FROM customer_order_items coi
        JOIN customer_orders co ON co.id = coi.order_id
        WHERE coi.product_id = ?
          AND LOWER(COALESCE(co.estado, '')) IN ('pendiente_aprobacion', 'aprobado_pendiente_entrega')
        LIMIT 1
      `).get(productId) as any;

      if (customerOrder) {
        throw new AppError(
          `El producto está incluido en el pedido de cliente #${customerOrder.numero_pedido || customerOrder.id}. Cerrá ese pedido antes de darlo de baja.`,
          409
        );
      }
    }

    const nextStatus = action === "deactivate" ? "inactivo" : "activo";
    const snapshot = JSON.stringify({ product });

    db.prepare(`
      INSERT INTO product_status_history (
        product_id, action, reason, performed_by, previous_status, new_status, snapshot
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(productId, action, reason, normalizedUser, currentStatus, nextStatus, snapshot);

    if (action === "deactivate") {
      db.prepare(`
        UPDATE products
        SET estado = 'inactivo',
            active = 0,
            eliminado = 0,
            deactivated_at = CURRENT_TIMESTAMP,
            deactivated_by = ?,
            deactivation_reason = ?
        WHERE id = ?
      `).run(normalizedUser, reason, productId);
    } else {
      db.prepare(`
        UPDATE products
        SET estado = 'activo',
            active = 1,
            eliminado = 0,
            deactivated_at = NULL,
            deactivated_by = NULL,
            deactivation_reason = NULL
        WHERE id = ?
      `).run(productId);
    }

    return db.prepare("SELECT * FROM products WHERE id = ? LIMIT 1").get(productId);
  })();
};

const handlePostgres = async (
  { productId, action, motivo, usuario }: LifecycleInput,
  executor?: TransactionClient
) => {
  const reason = validateInput({ productId, action, motivo, usuario });
  const normalizedUser = normalize(usuario) || "Sistema";
  const ownsTransaction = !executor;
  const pool = executor ? null : getPostgresPool();
  const client = executor || (await pool!.connect());

  try {
    if (ownsTransaction) await client.query("BEGIN");

    const productResult = await client.query(
      `SELECT *
       FROM products
       WHERE id = $1
       LIMIT 1
       FOR UPDATE`,
      [productId]
    );

    if (!productResult.rowCount) {
      throw new AppError("Producto no encontrado", 404);
    }

    const product = productResult.rows[0];
    const currentStatus = assertStatusTransition(product, action);

    if (action === "deactivate") {
      const supplierOrderResult = await client.query(
        `SELECT so.id, so.numero_pedido
         FROM supplier_order_items soi
         JOIN supplier_orders so ON so.id = soi.order_id
         WHERE soi.product_id = $1
           AND LOWER(COALESCE(so.estado, '')) = ANY($2::text[])
         ORDER BY so.id ASC
         LIMIT 1
         FOR UPDATE OF so`,
        [productId, ACTIVE_SUPPLIER_STATES]
      );

      if (supplierOrderResult.rowCount) {
        const order = supplierOrderResult.rows[0];
        throw new AppError(
          `El producto está incluido en el pedido a proveedor #${order.numero_pedido || order.id}. Cerrá ese pedido antes de darlo de baja.`,
          409
        );
      }

      const customerOrderResult = await client.query(
        `SELECT co.id, co.numero_pedido
         FROM customer_order_items coi
         JOIN customer_orders co ON co.id = coi.order_id
         WHERE coi.product_id = $1
           AND LOWER(COALESCE(co.estado, '')) = ANY($2::text[])
         ORDER BY co.id ASC
         LIMIT 1
         FOR UPDATE OF co`,
        [productId, ACTIVE_CUSTOMER_STATES]
      );

      if (customerOrderResult.rowCount) {
        const order = customerOrderResult.rows[0];
        throw new AppError(
          `El producto está incluido en el pedido de cliente #${order.numero_pedido || order.id}. Cerrá ese pedido antes de darlo de baja.`,
          409
        );
      }
    }

    const nextStatus = action === "deactivate" ? "inactivo" : "activo";
    const historyResult = await client.query(
      `INSERT INTO product_status_history (
         product_id,
         action,
         reason,
         performed_by,
         previous_status,
         new_status,
         snapshot
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       RETURNING id, performed_at`,
      [
        productId,
        action,
        reason,
        normalizedUser,
        currentStatus,
        nextStatus,
        JSON.stringify({ product }),
      ]
    );

    const updateResult = action === "deactivate"
      ? await client.query(
          `UPDATE products
           SET estado = 'inactivo',
               active = 0,
               eliminado = 0,
               deactivated_at = $1,
               deactivated_by = $2,
               deactivation_reason = $3
           WHERE id = $4
           RETURNING *`,
          [historyResult.rows[0]?.performed_at || new Date().toISOString(), normalizedUser, reason, productId]
        )
      : await client.query(
          `UPDATE products
           SET estado = 'activo',
               active = 1,
               eliminado = 0,
               deactivated_at = NULL,
               deactivated_by = NULL,
               deactivation_reason = NULL
           WHERE id = $1
           RETURNING *`,
          [productId]
        );

    if (ownsTransaction) await client.query("COMMIT");

    return {
      product: updateResult.rows[0],
      history_id: historyResult.rows[0]?.id,
      action,
    };
  } catch (error) {
    if (ownsTransaction) await client.query("ROLLBACK");
    throw error;
  } finally {
    if (ownsTransaction && "release" in client && typeof (client as any).release === "function") {
      (client as any).release();
    }
  }
};

export const productLifecycleService = {
  async changeStatus(input: LifecycleInput, executor?: TransactionClient) {
    if (!isPostgresConfigured() && !executor) {
      return handleSqlite(input);
    }
    return handlePostgres(input, executor);
  },
};
