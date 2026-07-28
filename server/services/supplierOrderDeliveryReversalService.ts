import { getPostgresPool, isPostgresConfigured } from "../utils/postgres.js";
import { AppError } from "../utils/response.js";

export type SupplierDeliveryTransactionClient = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

type ReversalInput = {
  supplierOrderId: number;
  motivo: string;
  usuario: string;
};

const toNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalize = (value: unknown) => String(value ?? "").trim();
const normalizeState = (value: unknown) => normalize(value).toLowerCase();
const amountsMatch = (left: number, right: number) => Math.abs(left - right) <= 0.0001;

const validateInput = ({ supplierOrderId, motivo, usuario }: ReversalInput) => {
  if (!Number.isInteger(supplierOrderId) || supplierOrderId <= 0) {
    throw new AppError("ID de pedido a proveedor inválido", 400);
  }

  const reason = normalize(motivo);
  if (reason.length < 3) {
    throw new AppError("El motivo es obligatorio y debe tener al menos 3 caracteres", 400);
  }
  if (reason.length > 500) {
    throw new AppError("El motivo no puede superar los 500 caracteres", 400);
  }

  return {
    reason,
    performedBy: normalize(usuario) || "Sistema",
  };
};

const assertOrderCanBeReverted = (order: any) => {
  if (!order) throw new AppError("Pedido a proveedor no encontrado", 404);
  if (normalizeState(order.estado) !== "entregado" || toNumber(order.stock_actualizado) !== 1) {
    throw new AppError("Solo puede revertirse una entrega completada", 409);
  }
  if (toNumber(order.delivery_version) !== 1) {
    throw new AppError(
      "Esta entrega es anterior a la trazabilidad reversible y debe conservarse como historial",
      409
    );
  }
  if (order.delivery_reverted_at) {
    throw new AppError("Esta entrega ya fue revertida", 409);
  }

  const saleId = toNumber(order.sale_id);
  if (saleId && normalizeState(order.sale_estado) !== "anulada") {
    throw new AppError(
      `Primero debe anularse la Venta N° ${order.numero_venta || saleId} vinculada a esta entrega`,
      409
    );
  }

  if (normalizeState(order.customer_order_estado) === "entregado") {
    throw new AppError(
      "El pedido de cliente vinculado ya fue entregado. Primero debe anularse la venta correspondiente",
      409
    );
  }
};

const appendAuditNote = (current: unknown, note: string) => {
  const existing = normalize(current);
  return existing ? `${existing}\n${note}` : note;
};

const revertPostgres = async (input: ReversalInput, executor?: SupplierDeliveryTransactionClient) => {
  const { reason, performedBy } = validateInput(input);
  const ownsTransaction = !executor;
  const pool = executor ? null : getPostgresPool();
  const client = executor || (await pool!.connect());

  try {
    if (ownsTransaction) await client.query("BEGIN");

    const orderResult = await client.query(
      `SELECT
         so.*,
         s.estado AS sale_estado,
         s.numero_venta,
         co.estado AS customer_order_estado,
         co.admin_notes AS customer_order_notes
       FROM supplier_orders so
       LEFT JOIN sales s ON s.id = so.sale_id
       LEFT JOIN customer_orders co ON co.id = so.customer_order_id
       WHERE so.id = $1
       LIMIT 1
       FOR UPDATE OF so`,
      [input.supplierOrderId]
    );
    const order = orderResult.rows[0];
    assertOrderCanBeReverted(order);

    const deliveryResult = await client.query(
      `SELECT *
       FROM supplier_order_deliveries
       WHERE supplier_order_id = $1
         AND reverted_at IS NULL
       ORDER BY id DESC
       LIMIT 1
       FOR UPDATE`,
      [input.supplierOrderId]
    );
    const delivery = deliveryResult.rows[0];
    if (!delivery) {
      throw new AppError("No existe una entrega activa con trazabilidad completa", 409);
    }

    if (toNumber(delivery.sale_id_after) !== toNumber(order.sale_id)) {
      throw new AppError("La venta vinculada no coincide con la trazabilidad de la entrega", 409);
    }

    const itemResult = await client.query(
      `SELECT
         sodi.*,
         sm.product_id AS movement_product_id,
         sm.cantidad AS movement_quantity,
         sm.costo_unitario AS movement_cost,
         sm.tipo_movimiento,
         sm.motivo AS movement_reason,
         sm.supplier_order_id AS movement_supplier_order_id,
         sm.reversion_version AS movement_reversion_version,
         sm.anulada_at AS movement_cancelled_at,
         sm.reversed_movement_id,
         sm.cantidad_restante
       FROM supplier_order_delivery_items sodi
       JOIN stock_movimientos sm ON sm.id = sodi.ingress_movement_id
       WHERE sodi.delivery_id = $1
       ORDER BY sodi.id ASC
       FOR UPDATE OF sodi, sm`,
      [delivery.id]
    );
    if (!itemResult.rowCount) {
      throw new AppError("La entrega no contiene productos trazables", 409);
    }

    const productQuantity = new Map<number, number>();
    const productIds = new Set<number>();
    const egressMovementIds: number[] = [];

    for (const item of itemResult.rows) {
      const productId = toNumber(item.product_id);
      const quantity = toNumber(item.quantity);
      const movementQuantity = toNumber(item.movement_quantity);
      const ingressMovementId = toNumber(item.ingress_movement_id);

      if (!productId || !ingressMovementId || quantity <= 0) {
        throw new AppError("La trazabilidad de productos de la entrega está incompleta", 409);
      }
      if (
        toNumber(item.movement_product_id) !== productId ||
        toNumber(item.movement_supplier_order_id) !== input.supplierOrderId ||
        normalizeState(item.tipo_movimiento) !== "ingreso" ||
        normalizeState(item.movement_reason) !== "pedido_proveedor" ||
        toNumber(item.movement_reversion_version) !== 1 ||
        item.movement_cancelled_at ||
        item.reversed_movement_id ||
        !amountsMatch(Math.abs(movementQuantity), quantity)
      ) {
        throw new AppError("Un movimiento de ingreso no coincide con la entrega original", 409);
      }

      productIds.add(productId);
      productQuantity.set(productId, toNumber(productQuantity.get(productId)) + quantity);
      if (toNumber(item.egress_movement_id)) egressMovementIds.push(toNumber(item.egress_movement_id));
    }

    if (toNumber(delivery.sale_id_after)) {
      if (egressMovementIds.length !== itemResult.rows.length) {
        throw new AppError("La entrega vinculada a venta no posee todos sus movimientos de egreso", 409);
      }

      const saleReversalResult = await client.query(
        `SELECT reversed_movement_id
         FROM stock_movimientos
         WHERE reversed_movement_id = ANY($1::int[])`,
        [egressMovementIds]
      );
      const reversedIds = new Set(saleReversalResult.rows.map((row: any) => toNumber(row.reversed_movement_id)));
      if (reversedIds.size !== new Set(egressMovementIds).size) {
        throw new AppError(
          "La venta figura anulada pero todavía no restauró todos los movimientos de stock",
          409
        );
      }
    }

    const sortedProductIds = Array.from(productIds).sort((a, b) => a - b);
    const productsResult = await client.query(
      `SELECT id, name, stock, cost
       FROM products
       WHERE id = ANY($1::int[])
       ORDER BY id ASC
       FOR UPDATE`,
      [sortedProductIds]
    );
    if (productsResult.rows.length !== sortedProductIds.length) {
      throw new AppError("No se pudieron bloquear todos los productos de la entrega", 409);
    }

    const productMap = new Map<number, any>(productsResult.rows.map((row: any) => [toNumber(row.id), row]));
    for (const [productId, quantity] of productQuantity.entries()) {
      const product = productMap.get(productId);
      if (toNumber(product?.stock) + 0.0001 < quantity) {
        throw new AppError(
          `El stock actual de ${product?.name || `producto ${productId}`} es insuficiente para revertir la entrega`,
          409
        );
      }
    }

    const reversalMovementIds: number[] = [];
    const revertedAt = new Date().toISOString();

    for (const item of itemResult.rows) {
      const productId = toNumber(item.product_id);
      const quantity = toNumber(item.quantity);
      const unitCost = toNumber(item.unit_cost, toNumber(item.movement_cost));
      const ingressMovementId = toNumber(item.ingress_movement_id);
      const stockBefore = toNumber(productMap.get(productId)?.stock);
      const alreadyProcessed = itemResult.rows
        .filter((candidate: any) => toNumber(candidate.product_id) === productId && toNumber(candidate.id) < toNumber(item.id))
        .reduce((sum: number, candidate: any) => sum + toNumber(candidate.quantity), 0);
      const stockBeforeLine = stockBefore - alreadyProcessed;
      const stockAfterLine = stockBeforeLine - quantity;

      await client.query(
        `UPDATE products
         SET stock = COALESCE(stock, 0) - $1
         WHERE id = $2`,
        [quantity, productId]
      );

      const reversalResult = await client.query(
        `INSERT INTO stock_movimientos (
           product_id, cantidad, costo_unitario, cantidad_restante, descripcion,
           tipo_movimiento, motivo, usuario, supplier_order_id,
           reversed_movement_id, reversion_version
         )
         VALUES ($1, $2, $3, 0, $4, 'egreso', 'reversion_entrega_proveedor', $5, $6, $7, 0)
         RETURNING id`,
        [
          productId,
          -quantity,
          unitCost,
          `Reversión de entrega Pedido Proveedor #${order.numero_pedido || order.id}: ${reason}`,
          performedBy,
          input.supplierOrderId,
          ingressMovementId,
        ]
      );
      const reversalMovementId = toNumber(reversalResult.rows[0]?.id);
      reversalMovementIds.push(reversalMovementId);

      const updateMovement = await client.query(
        `UPDATE stock_movimientos
         SET anulada_at = now(),
             anulada_por = $1,
             anulacion_motivo = $2,
             cantidad_restante = 0
         WHERE id = $3
           AND anulada_at IS NULL
         RETURNING anulada_at`,
        [performedBy, reason, ingressMovementId]
      );
      if (!updateMovement.rowCount) {
        throw new AppError("La entrega fue revertida por otra operación", 409);
      }

      await client.query(
        `INSERT INTO stock_movement_cancellations (
           stock_movement_id, reversal_movement_id, product_id, motivo,
           anulada_por, anulada_at, stock_before, stock_after,
           original_type, original_reason, quantity, snapshot
         )
         VALUES ($1, $2, $3, $4, $5, now(), $6, $7, $8, $9, $10, $11::jsonb)`,
        [
          ingressMovementId,
          reversalMovementId,
          productId,
          reason,
          performedBy,
          stockBeforeLine,
          stockAfterLine,
          item.tipo_movimiento,
          item.movement_reason,
          quantity,
          JSON.stringify({ order, delivery, item }),
        ]
      );
    }

    const deliveryUpdate = await client.query(
      `UPDATE supplier_order_deliveries
       SET reverted_at = now(), reverted_by = $1, revert_reason = $2
       WHERE id = $3 AND reverted_at IS NULL
       RETURNING reverted_at`,
      [performedBy, reason, delivery.id]
    );
    if (!deliveryUpdate.rowCount) throw new AppError("La entrega ya fue revertida", 409);

    const previousStatus = normalize(delivery.previous_status) || "auditar_pedido";
    await client.query(
      `UPDATE supplier_orders
       SET estado = $1,
           stock_actualizado = 0,
           sale_id = NULL,
           delivery_reverted_at = now(),
           delivery_reverted_by = $2,
           delivery_revert_reason = $3
       WHERE id = $4`,
      [previousStatus, performedBy, reason, input.supplierOrderId]
    );

    if (toNumber(order.customer_order_id)) {
      const auditNote = `Entrega del pedido proveedor #${order.numero_pedido || order.id} revertida: ${reason}`;
      await client.query(
        `UPDATE customer_orders
         SET admin_notes = $1
         WHERE id = $2`,
        [appendAuditNote(order.customer_order_notes, auditNote), order.customer_order_id]
      );
    }

    if (ownsTransaction) await client.query("COMMIT");

    return {
      success: true,
      supplierOrderId: input.supplierOrderId,
      previousStatus,
      revertedAt,
      restoredUnits: Array.from(productQuantity.values()).reduce((sum, value) => sum + value, 0),
      reversalMovementIds,
      detachedSaleId: toNumber(order.sale_id) || null,
    };
  } catch (error) {
    if (ownsTransaction) await client.query("ROLLBACK");
    throw error;
  } finally {
    if (!executor && "release" in client && typeof (client as any).release === "function") {
      (client as any).release();
    }
  }
};

const revertSqlite = async (input: ReversalInput) => {
  const { reason, performedBy } = validateInput(input);
  const { default: db } = await import("../db.js");

  return db.transaction(() => {
    const order = db.prepare(`
      SELECT so.*, s.estado AS sale_estado, s.numero_venta,
             co.estado AS customer_order_estado, co.admin_notes AS customer_order_notes
      FROM supplier_orders so
      LEFT JOIN sales s ON s.id = so.sale_id
      LEFT JOIN customer_orders co ON co.id = so.customer_order_id
      WHERE so.id = ?
      LIMIT 1
    `).get(input.supplierOrderId) as any;
    assertOrderCanBeReverted(order);

    const delivery = db.prepare(`
      SELECT * FROM supplier_order_deliveries
      WHERE supplier_order_id = ? AND reverted_at IS NULL
      ORDER BY id DESC LIMIT 1
    `).get(input.supplierOrderId) as any;
    if (!delivery) throw new AppError("No existe una entrega activa con trazabilidad completa", 409);

    const items = db.prepare(`
      SELECT sodi.*, sm.product_id AS movement_product_id,
             sm.cantidad AS movement_quantity, sm.costo_unitario AS movement_cost,
             sm.tipo_movimiento, sm.motivo AS movement_reason,
             sm.supplier_order_id AS movement_supplier_order_id,
             sm.reversion_version AS movement_reversion_version,
             sm.anulada_at AS movement_cancelled_at, sm.reversed_movement_id,
             sm.cantidad_restante
      FROM supplier_order_delivery_items sodi
      JOIN stock_movimientos sm ON sm.id = sodi.ingress_movement_id
      WHERE sodi.delivery_id = ?
      ORDER BY sodi.id ASC
    `).all(delivery.id) as any[];
    if (!items.length) throw new AppError("La entrega no contiene productos trazables", 409);

    if (toNumber(delivery.sale_id_after)) {
      for (const item of items) {
        if (!toNumber(item.egress_movement_id)) {
          throw new AppError("La entrega vinculada a venta no posee todos sus egresos", 409);
        }
        const reversal = db.prepare(
          "SELECT id FROM stock_movimientos WHERE reversed_movement_id = ? LIMIT 1"
        ).get(item.egress_movement_id);
        if (!reversal) {
          throw new AppError("La venta anulada todavía no restauró todos los movimientos de stock", 409);
        }
      }
    }

    const productQuantity = new Map<number, number>();
    for (const item of items) {
      const productId = toNumber(item.product_id);
      const quantity = toNumber(item.quantity);
      if (
        !productId || quantity <= 0 ||
        toNumber(item.movement_product_id) !== productId ||
        toNumber(item.movement_supplier_order_id) !== input.supplierOrderId ||
        normalizeState(item.tipo_movimiento) !== "ingreso" ||
        normalizeState(item.movement_reason) !== "pedido_proveedor" ||
        toNumber(item.movement_reversion_version) !== 1 ||
        item.movement_cancelled_at || item.reversed_movement_id ||
        !amountsMatch(Math.abs(toNumber(item.movement_quantity)), quantity)
      ) {
        throw new AppError("Un movimiento de ingreso no coincide con la entrega original", 409);
      }
      productQuantity.set(productId, toNumber(productQuantity.get(productId)) + quantity);
    }

    for (const [productId, quantity] of productQuantity.entries()) {
      const product = db.prepare("SELECT id, name, stock, cost FROM products WHERE id = ? LIMIT 1").get(productId) as any;
      if (!product) throw new AppError("Producto no encontrado", 404);
      if (toNumber(product.stock) + 0.0001 < quantity) {
        throw new AppError(`El stock actual de ${product.name || productId} es insuficiente`, 409);
      }
    }

    const reversalMovementIds: number[] = [];
    const cancelledAt = new Date().toISOString();
    for (const item of items) {
      const productId = toNumber(item.product_id);
      const quantity = toNumber(item.quantity);
      const product = db.prepare("SELECT * FROM products WHERE id = ? LIMIT 1").get(productId) as any;
      const stockBefore = toNumber(product.stock);
      const stockAfter = stockBefore - quantity;
      db.prepare("UPDATE products SET stock = ? WHERE id = ?").run(stockAfter, productId);

      const reversal = db.prepare(`
        INSERT INTO stock_movimientos (
          product_id, cantidad, costo_unitario, cantidad_restante, descripcion,
          tipo_movimiento, motivo, usuario, supplier_order_id,
          reversed_movement_id, reversion_version
        ) VALUES (?, ?, ?, 0, ?, 'egreso', 'reversion_entrega_proveedor', ?, ?, ?, 0)
      `).run(
        productId,
        -quantity,
        toNumber(item.unit_cost, toNumber(item.movement_cost)),
        `Reversión de entrega Pedido Proveedor #${order.numero_pedido || order.id}: ${reason}`,
        performedBy,
        input.supplierOrderId,
        item.ingress_movement_id
      );
      const reversalMovementId = Number(reversal.lastInsertRowid);
      reversalMovementIds.push(reversalMovementId);

      const movementUpdate = db.prepare(`
        UPDATE stock_movimientos
        SET anulada_at = ?, anulada_por = ?, anulacion_motivo = ?, cantidad_restante = 0
        WHERE id = ? AND anulada_at IS NULL
      `).run(cancelledAt, performedBy, reason, item.ingress_movement_id);
      if (movementUpdate.changes !== 1) throw new AppError("La entrega ya fue revertida", 409);

      db.prepare(`
        INSERT INTO stock_movement_cancellations (
          stock_movement_id, reversal_movement_id, product_id, motivo,
          anulada_por, anulada_at, stock_before, stock_after,
          original_type, original_reason, quantity, snapshot
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        item.ingress_movement_id,
        reversalMovementId,
        productId,
        reason,
        performedBy,
        cancelledAt,
        stockBefore,
        stockAfter,
        item.tipo_movimiento,
        item.movement_reason,
        quantity,
        JSON.stringify({ order, delivery, item })
      );
    }

    db.prepare(`
      UPDATE supplier_order_deliveries
      SET reverted_at = ?, reverted_by = ?, revert_reason = ?
      WHERE id = ? AND reverted_at IS NULL
    `).run(cancelledAt, performedBy, reason, delivery.id);

    const previousStatus = normalize(delivery.previous_status) || "auditar_pedido";
    db.prepare(`
      UPDATE supplier_orders
      SET estado = ?, stock_actualizado = 0, sale_id = NULL,
          delivery_reverted_at = ?, delivery_reverted_by = ?, delivery_revert_reason = ?
      WHERE id = ?
    `).run(previousStatus, cancelledAt, performedBy, reason, input.supplierOrderId);

    if (toNumber(order.customer_order_id)) {
      const note = `Entrega del pedido proveedor #${order.numero_pedido || order.id} revertida: ${reason}`;
      db.prepare("UPDATE customer_orders SET admin_notes = ? WHERE id = ?")
        .run(appendAuditNote(order.customer_order_notes, note), order.customer_order_id);
    }

    return {
      success: true,
      supplierOrderId: input.supplierOrderId,
      previousStatus,
      revertedAt: cancelledAt,
      restoredUnits: Array.from(productQuantity.values()).reduce((sum, value) => sum + value, 0),
      reversalMovementIds,
      detachedSaleId: toNumber(order.sale_id) || null,
    };
  })();
};

export const supplierOrderDeliveryReversalService = {
  revert: async (input: ReversalInput, executor?: SupplierDeliveryTransactionClient) => {
    if (executor || isPostgresConfigured()) return revertPostgres(input, executor);
    return revertSqlite(input);
  },
};
