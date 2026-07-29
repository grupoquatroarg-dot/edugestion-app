import { getPostgresPool, isPostgresConfigured } from "../utils/postgres.js";
import { AppError } from "../utils/response.js";

export type SupplierOrderContentItemInput = {
  product_id: number;
  cantidad: number;
};

type TransactionClient = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

type ContentUpdateInput = {
  supplierOrderId: number;
  items: SupplierOrderContentItemInput[];
  notes?: string | null;
  motivo: string;
  usuario: string;
  expectedContentVersion: number;
  expectedStatusVersion: number;
};

const toNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalize = (value: unknown) => String(value ?? "").trim();
const normalizeState = (value: unknown) => normalize(value).toLowerCase();

const validateInput = (input: ContentUpdateInput) => {
  if (!Number.isInteger(input.supplierOrderId) || input.supplierOrderId <= 0) {
    throw new AppError("ID de pedido inválido", 400);
  }

  const reason = normalize(input.motivo);
  if (reason.length < 3) {
    throw new AppError("El motivo del cambio es obligatorio y debe tener al menos 3 caracteres", 400);
  }
  if (reason.length > 500) {
    throw new AppError("El motivo no puede superar los 500 caracteres", 400);
  }

  const notesValue = input.notes === null || input.notes === undefined
    ? null
    : String(input.notes).trim();
  if ((notesValue || "").length > 2000) {
    throw new AppError("Las observaciones no pueden superar los 2000 caracteres", 400);
  }

  if (!Number.isInteger(input.expectedContentVersion) || input.expectedContentVersion < 0) {
    throw new AppError("Versión de contenido inválida", 400);
  }
  if (!Number.isInteger(input.expectedStatusVersion) || input.expectedStatusVersion < 0) {
    throw new AppError("Versión de etapa inválida", 400);
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
    notes: notesValue || null,
    items,
  };
};

const assertOrderCanBeEdited = (order: any, input: ContentUpdateInput) => {
  if (!order) throw new AppError("Pedido no encontrado", 404);

  const status = normalizeState(order.estado || "pendiente");
  if (status !== "auditar_pedido") {
    throw new AppError("Solo se pueden modificar productos durante la etapa Auditar pedido", 409);
  }
  if (toNumber(order.stock_actualizado) === 1) {
    throw new AppError("El pedido ya actualizó stock y no permite modificar sus productos", 409);
  }
  if (order.sale_id) {
    throw new AppError("El pedido está vinculado a una venta y no permite modificar sus productos", 409);
  }
  if (order.cancelled_at) {
    throw new AppError("El pedido fue anulado y debe conservarse como historial", 409);
  }
  if (order.delivered_at && !order.delivery_reverted_at) {
    throw new AppError("El pedido tiene una entrega activa y no permite modificar sus productos", 409);
  }

  if (toNumber(order.content_version) !== input.expectedContentVersion) {
    throw new AppError("El contenido del pedido cambió mientras estaba abierto. Actualizá la pantalla e intentá nuevamente", 409);
  }
  if (toNumber(order.status_version) !== input.expectedStatusVersion) {
    throw new AppError("La etapa del pedido cambió mientras estaba abierto. Actualizá la pantalla e intentá nuevamente", 409);
  }

  return status;
};

const comparableItems = (items: any[]) => items
  .map((item) => ({
    product_id: toNumber(item.product_id),
    cantidad: toNumber(item.cantidad),
  }))
  .sort((left, right) => left.product_id - right.product_id);

const sameContent = (beforeItems: any[], afterItems: any[], beforeNotes: unknown, afterNotes: unknown) => (
  JSON.stringify(comparableItems(beforeItems)) === JSON.stringify(comparableItems(afterItems))
  && normalize(beforeNotes) === normalize(afterNotes)
);

const handleSqlite = async (input: ContentUpdateInput) => {
  const validated = validateInput(input);
  const { default: db } = await import("../db.js");

  return db.transaction(() => {
    const order = db.prepare("SELECT * FROM supplier_orders WHERE id = ? LIMIT 1")
      .get(input.supplierOrderId) as any;
    const status = assertOrderCanBeEdited(order, input);

    const beforeItems = db.prepare(`
      SELECT soi.id, soi.product_id, soi.cantidad,
             p.name AS product_name, COALESCE(p.codigo_unico, p.code, '') AS product_code
      FROM supplier_order_items soi
      JOIN products p ON p.id = soi.product_id
      WHERE soi.order_id = ?
      ORDER BY soi.id ASC
    `).all(input.supplierOrderId) as any[];
    if (!beforeItems.length) throw new AppError("El pedido no tiene productos trazables", 409);

    const placeholders = validated.items.map(() => "?").join(", ");
    const products = db.prepare(`
      SELECT id, name, COALESCE(codigo_unico, code, '') AS product_code
      FROM products
      WHERE id IN (${placeholders}) AND COALESCE(eliminado, 0) = 0
      ORDER BY id ASC
    `).all(...validated.items.map((item) => item.product_id)) as any[];
    if (products.length !== validated.items.length) {
      throw new AppError("Uno o más productos no existen o están dados de baja", 409);
    }

    const productMap = new Map<number, any>(products.map((product) => [toNumber(product.id), product]));
    const afterItems = validated.items.map((item) => ({
      ...item,
      product_name: productMap.get(item.product_id)?.name || "",
      product_code: productMap.get(item.product_id)?.product_code || "",
    }));

    if (sameContent(beforeItems, afterItems, order.notes, validated.notes)) {
      throw new AppError("No se detectaron cambios en productos ni observaciones", 409);
    }

    const nextVersion = toNumber(order.content_version) + 1;
    const beforeSnapshot = JSON.stringify({ order, items: beforeItems });
    const afterSnapshot = JSON.stringify({
      order_id: input.supplierOrderId,
      status,
      notes: validated.notes,
      items: afterItems,
    });

    const history = db.prepare(`
      INSERT INTO supplier_order_content_history (
        supplier_order_id, version, status_at_change, reason, changed_by,
        before_snapshot, after_snapshot
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.supplierOrderId,
      nextVersion,
      status,
      validated.reason,
      validated.user,
      beforeSnapshot,
      afterSnapshot
    );

    const changedAt = db.prepare("SELECT CURRENT_TIMESTAMP AS changed_at").get() as any;
    const update = db.prepare(`
      UPDATE supplier_orders
      SET notes = ?,
          content_version = ?,
          content_changed_at = ?,
          content_changed_by = ?,
          content_change_reason = ?
      WHERE id = ?
        AND estado = 'auditar_pedido'
        AND COALESCE(content_version, 0) = ?
        AND COALESCE(status_version, 0) = ?
    `).run(
      validated.notes,
      nextVersion,
      changedAt?.changed_at || new Date().toISOString(),
      validated.user,
      validated.reason,
      input.supplierOrderId,
      input.expectedContentVersion,
      input.expectedStatusVersion
    );
    if (Number(update.changes || 0) !== 1) {
      throw new AppError("El pedido cambió mientras se guardaban los productos", 409);
    }

    db.prepare("DELETE FROM supplier_order_items WHERE order_id = ?").run(input.supplierOrderId);
    const insertItem = db.prepare(`
      INSERT INTO supplier_order_items (order_id, product_id, cantidad)
      VALUES (?, ?, ?)
    `);
    for (const item of validated.items) {
      insertItem.run(input.supplierOrderId, item.product_id, item.cantidad);
    }

    return {
      order: db.prepare("SELECT * FROM supplier_orders WHERE id = ? LIMIT 1").get(input.supplierOrderId),
      items: db.prepare(`
        SELECT soi.id, soi.order_id, soi.product_id, soi.cantidad,
               p.name AS product_name, COALESCE(p.codigo_unico, p.code, '') AS product_code
        FROM supplier_order_items soi
        JOIN products p ON p.id = soi.product_id
        WHERE soi.order_id = ?
        ORDER BY soi.id ASC
      `).all(input.supplierOrderId),
      historyId: Number(history.lastInsertRowid),
      version: nextVersion,
    };
  })();
};

const handlePostgres = async (input: ContentUpdateInput, executor?: TransactionClient) => {
  const validated = validateInput(input);
  const ownsTransaction = !executor;
  const pool = executor ? null : getPostgresPool();
  const client = executor || (await pool!.connect());

  try {
    if (ownsTransaction) await client.query("BEGIN");

    const orderResult = await client.query(
      `SELECT *
       FROM supplier_orders
       WHERE id = $1
       LIMIT 1
       FOR UPDATE`,
      [input.supplierOrderId]
    );
    const order = orderResult.rows[0];
    const status = assertOrderCanBeEdited(order, input);

    const beforeItemsResult = await client.query(
      `SELECT soi.id, soi.product_id, soi.cantidad,
              p.name AS product_name, COALESCE(p.codigo_unico, p.code, '') AS product_code
       FROM supplier_order_items soi
       JOIN products p ON p.id = soi.product_id
       WHERE soi.order_id = $1
       ORDER BY soi.id ASC
       FOR UPDATE OF soi`,
      [input.supplierOrderId]
    );
    if (!beforeItemsResult.rowCount) throw new AppError("El pedido no tiene productos trazables", 409);

    const productIds = validated.items.map((item) => item.product_id);
    const productsResult = await client.query(
      `SELECT id, name, COALESCE(codigo_unico, code, '') AS product_code
       FROM products
       WHERE id = ANY($1::int[])
         AND COALESCE(eliminado, 0) = 0
       ORDER BY id ASC`,
      [productIds]
    );
    if (productsResult.rowCount !== productIds.length) {
      throw new AppError("Uno o más productos no existen o están dados de baja", 409);
    }

    const productMap = new Map<number, any>(productsResult.rows.map((product: any) => [toNumber(product.id), product]));
    const afterItems = validated.items.map((item) => ({
      ...item,
      product_name: productMap.get(item.product_id)?.name || "",
      product_code: productMap.get(item.product_id)?.product_code || "",
    }));

    if (sameContent(beforeItemsResult.rows, afterItems, order.notes, validated.notes)) {
      throw new AppError("No se detectaron cambios en productos ni observaciones", 409);
    }

    const nextVersion = toNumber(order.content_version) + 1;
    const historyResult = await client.query(
      `INSERT INTO supplier_order_content_history (
         supplier_order_id, version, status_at_change, reason, changed_by,
         before_snapshot, after_snapshot
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
       RETURNING id, changed_at`,
      [
        input.supplierOrderId,
        nextVersion,
        status,
        validated.reason,
        validated.user,
        JSON.stringify({ order, items: beforeItemsResult.rows }),
        JSON.stringify({
          order_id: input.supplierOrderId,
          status,
          notes: validated.notes,
          items: afterItems,
        }),
      ]
    );

    const updateResult = await client.query(
      `UPDATE supplier_orders
       SET notes = $1,
           content_version = $2,
           content_changed_at = $3,
           content_changed_by = $4,
           content_change_reason = $5
       WHERE id = $6
         AND estado = 'auditar_pedido'
         AND COALESCE(content_version, 0) = $7
         AND COALESCE(status_version, 0) = $8
       RETURNING *`,
      [
        validated.notes,
        nextVersion,
        historyResult.rows[0]?.changed_at || new Date().toISOString(),
        validated.user,
        validated.reason,
        input.supplierOrderId,
        input.expectedContentVersion,
        input.expectedStatusVersion,
      ]
    );
    if (!updateResult.rowCount) {
      throw new AppError("El pedido cambió mientras se guardaban los productos", 409);
    }

    await client.query("DELETE FROM supplier_order_items WHERE order_id = $1", [input.supplierOrderId]);
    for (const item of validated.items) {
      await client.query(
        `INSERT INTO supplier_order_items (order_id, product_id, cantidad)
         VALUES ($1, $2, $3)`,
        [input.supplierOrderId, item.product_id, item.cantidad]
      );
    }

    const itemsResult = await client.query(
      `SELECT soi.id, soi.order_id, soi.product_id, soi.cantidad,
              p.name AS product_name, COALESCE(p.codigo_unico, p.code, '') AS product_code
       FROM supplier_order_items soi
       JOIN products p ON p.id = soi.product_id
       WHERE soi.order_id = $1
       ORDER BY soi.id ASC`,
      [input.supplierOrderId]
    );

    if (ownsTransaction) await client.query("COMMIT");

    return {
      order: updateResult.rows[0],
      items: itemsResult.rows,
      historyId: toNumber(historyResult.rows[0]?.id),
      version: nextVersion,
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

export const supplierOrderContentLifecycleService = {
  async update(input: ContentUpdateInput, executor?: TransactionClient) {
    if (!isPostgresConfigured() && !executor) return handleSqlite(input);
    return handlePostgres(input, executor);
  },
};
