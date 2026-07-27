import { getPostgresPool, isPostgresConfigured } from "../utils/postgres.js";
import { AppError } from "../utils/response.js";

export type InventoryMovementTransactionClient = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

type CancellationInput = {
  productId: number;
  movementId: number;
  motivo: string;
  usuario: string;
};

const MANUAL_REASONS = new Set(["carga_stock", "merma"]);

const toNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalize = (value: unknown) => String(value ?? "").trim();
const normalizeReason = (value: unknown) => normalize(value).toLowerCase();

const validateInput = ({ productId, movementId, motivo, usuario }: CancellationInput) => {
  if (!Number.isInteger(productId) || productId <= 0) {
    throw new AppError("ID de producto inválido", 400);
  }
  if (!Number.isInteger(movementId) || movementId <= 0) {
    throw new AppError("ID de movimiento inválido", 400);
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

const assertMovementCanBeCancelled = (movement: any, productId: number) => {
  if (!movement) throw new AppError("Movimiento de inventario no encontrado", 404);
  if (toNumber(movement.product_id) !== productId) {
    throw new AppError("El movimiento no pertenece al producto indicado", 409);
  }
  if (movement.anulada_at) throw new AppError("Este movimiento ya fue anulado", 409);
  if (toNumber(movement.reversion_version) !== 1) {
    throw new AppError(
      "Este movimiento es anterior a la trazabilidad reversible y no puede anularse automáticamente",
      409
    );
  }
  if (movement.reversed_movement_id) {
    throw new AppError("Un contramovimiento no puede anularse nuevamente", 409);
  }
  if (movement.sale_id || movement.purchase_invoice_id || movement.purchase_invoice_item_id) {
    throw new AppError("Este movimiento pertenece a otra operación y debe anularse desde su módulo de origen", 409);
  }

  const movementReason = normalizeReason(movement.motivo);
  if (!MANUAL_REASONS.has(movementReason)) {
    throw new AppError("Solo pueden anularse cargas de stock y mermas manuales nuevas", 409);
  }

  const quantity = Math.abs(toNumber(movement.cantidad));
  if (!quantity) throw new AppError("El movimiento tiene una cantidad inválida", 409);

  if (movementReason === "carga_stock") {
    const remaining = toNumber(movement.cantidad_restante, quantity);
    if (remaining !== quantity) {
      throw new AppError("La carga ya fue consumida total o parcialmente y no puede anularse de forma segura", 409);
    }
  }

  return { movementReason, quantity };
};

const mapMovement = (row: any) => {
  const reason = normalizeReason(row.motivo);
  const reversibleManual = MANUAL_REASONS.has(reason) && toNumber(row.reversion_version) === 1;
  const isCounterMovement = Boolean(row.reversed_movement_id);

  let protectionReason = "";
  if (row.anulada_at) protectionReason = "Movimiento ya anulado";
  else if (isCounterMovement) protectionReason = "Contramovimiento de auditoría";
  else if (!reversibleManual) protectionReason = "Movimiento histórico o generado por otra operación";
  else if (reason === "carga_stock" && toNumber(row.cantidad_restante, toNumber(row.cantidad)) !== Math.abs(toNumber(row.cantidad))) {
    protectionReason = "La carga fue consumida total o parcialmente";
  }

  return {
    ...row,
    cantidad: toNumber(row.cantidad),
    costo_unitario: toNumber(row.costo_unitario),
    cantidad_restante: toNumber(row.cantidad_restante),
    reversion_version: toNumber(row.reversion_version),
    can_revert: !protectionReason,
    protection_reason: protectionReason,
  };
};

const listSqlite = async (productId: number) => {
  const { default: db } = await import("../db.js");
  const product = db.prepare("SELECT id, name, stock, estado FROM products WHERE id = ? LIMIT 1").get(productId) as any;
  if (!product) throw new AppError("Producto no encontrado", 404);

  const rows = db.prepare(`
    SELECT sm.*, smc.id AS cancellation_id, smc.reversal_movement_id AS cancellation_reversal_id
    FROM stock_movimientos sm
    LEFT JOIN stock_movement_cancellations smc ON smc.stock_movement_id = sm.id
    WHERE sm.product_id = ?
    ORDER BY sm.fecha_ingreso DESC, sm.id DESC
    LIMIT 100
  `).all(productId) as any[];

  return { product, movements: rows.map(mapMovement) };
};

const listPostgres = async (productId: number, executor?: InventoryMovementTransactionClient) => {
  const pool = executor ? null : getPostgresPool();
  const client = executor || (await pool!.connect());
  try {
    const productResult = await client.query(
      "SELECT id, name, stock, estado FROM products WHERE id = $1 LIMIT 1",
      [productId]
    );
    if (!productResult.rowCount) throw new AppError("Producto no encontrado", 404);

    const movementResult = await client.query(
      `SELECT sm.*, smc.id AS cancellation_id, smc.reversal_movement_id AS cancellation_reversal_id
       FROM stock_movimientos sm
       LEFT JOIN stock_movement_cancellations smc ON smc.stock_movement_id = sm.id
       WHERE sm.product_id = $1
       ORDER BY sm.fecha_ingreso DESC, sm.id DESC
       LIMIT 100`,
      [productId]
    );

    return { product: productResult.rows[0], movements: movementResult.rows.map(mapMovement) };
  } finally {
    if (!executor && "release" in client && typeof (client as any).release === "function") {
      (client as any).release();
    }
  }
};

const cancelSqlite = async (input: CancellationInput) => {
  const { reason, performedBy } = validateInput(input);
  const { default: db } = await import("../db.js");

  return db.transaction(() => {
    const movement = db.prepare("SELECT * FROM stock_movimientos WHERE id = ? LIMIT 1").get(input.movementId) as any;
    const { movementReason, quantity } = assertMovementCanBeCancelled(movement, input.productId);
    const product = db.prepare("SELECT * FROM products WHERE id = ? LIMIT 1").get(input.productId) as any;
    if (!product) throw new AppError("Producto no encontrado", 404);

    const stockBefore = toNumber(product.stock);
    if (movementReason === "carga_stock" && stockBefore < quantity) {
      throw new AppError("El stock actual es insuficiente para anular esta carga", 409);
    }

    const stockAfter = movementReason === "carga_stock" ? stockBefore - quantity : stockBefore + quantity;
    const counterType = movementReason === "carga_stock" ? "egreso" : "ingreso";
    const counterQuantity = movementReason === "carga_stock" ? -quantity : quantity;
    const counterRemaining = movementReason === "merma" ? quantity : 0;
    const counterReason = movementReason === "carga_stock" ? "anulacion_carga_stock" : "anulacion_merma";
    const cost = toNumber(movement.costo_unitario, toNumber(product.cost));
    const cancelledAt = new Date().toISOString();

    db.prepare("UPDATE products SET stock = ? WHERE id = ?").run(stockAfter, input.productId);
    const reversal = db.prepare(`
      INSERT INTO stock_movimientos (
        product_id, cantidad, costo_unitario, cantidad_restante, descripcion,
        tipo_movimiento, motivo, usuario, reversed_movement_id, reversion_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(
      input.productId,
      counterQuantity,
      cost,
      counterRemaining,
      `Anulación de ${movementReason === "carga_stock" ? "carga de stock" : "merma"}: ${reason}`,
      counterType,
      counterReason,
      performedBy,
      input.movementId
    );

    const reversalMovementId = Number(reversal.lastInsertRowid);
    const update = db.prepare(`
      UPDATE stock_movimientos
      SET anulada_at = ?, anulada_por = ?, anulacion_motivo = ?,
          cantidad_restante = CASE WHEN motivo = 'carga_stock' THEN 0 ELSE cantidad_restante END
      WHERE id = ? AND anulada_at IS NULL
    `).run(cancelledAt, performedBy, reason, input.movementId);
    if (update.changes !== 1) throw new AppError("El movimiento fue anulado por otra operación", 409);

    db.prepare(`
      INSERT INTO stock_movement_cancellations (
        stock_movement_id, reversal_movement_id, product_id, motivo, anulada_por,
        anulada_at, stock_before, stock_after, original_type, original_reason, quantity, snapshot
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.movementId,
      reversalMovementId,
      input.productId,
      reason,
      performedBy,
      cancelledAt,
      stockBefore,
      stockAfter,
      movement.tipo_movimiento,
      movement.motivo,
      quantity,
      JSON.stringify({ movement, product })
    );

    return { movementId: input.movementId, reversalMovementId, stockBefore, stockAfter, cancelledAt };
  })();
};

const cancelPostgres = async (input: CancellationInput, executor?: InventoryMovementTransactionClient) => {
  const { reason, performedBy } = validateInput(input);
  const ownsTransaction = !executor;
  const pool = executor ? null : getPostgresPool();
  const client = executor || (await pool!.connect());

  try {
    if (ownsTransaction) await client.query("BEGIN");

    const movementResult = await client.query(
      "SELECT * FROM stock_movimientos WHERE id = $1 LIMIT 1 FOR UPDATE",
      [input.movementId]
    );
    const movement = movementResult.rows[0];
    const { movementReason, quantity } = assertMovementCanBeCancelled(movement, input.productId);

    const productResult = await client.query(
      "SELECT * FROM products WHERE id = $1 LIMIT 1 FOR UPDATE",
      [input.productId]
    );
    const product = productResult.rows[0];
    if (!product) throw new AppError("Producto no encontrado", 404);

    const stockBefore = toNumber(product.stock);
    if (movementReason === "carga_stock" && stockBefore < quantity) {
      throw new AppError("El stock actual es insuficiente para anular esta carga", 409);
    }

    const stockAfter = movementReason === "carga_stock" ? stockBefore - quantity : stockBefore + quantity;
    const counterType = movementReason === "carga_stock" ? "egreso" : "ingreso";
    const counterQuantity = movementReason === "carga_stock" ? -quantity : quantity;
    const counterRemaining = movementReason === "merma" ? quantity : 0;
    const counterReason = movementReason === "carga_stock" ? "anulacion_carga_stock" : "anulacion_merma";
    const cost = toNumber(movement.costo_unitario, toNumber(product.cost));

    await client.query("UPDATE products SET stock = $1 WHERE id = $2", [stockAfter, input.productId]);

    const reversalResult = await client.query(
      `INSERT INTO stock_movimientos (
         product_id, cantidad, costo_unitario, cantidad_restante, descripcion,
         tipo_movimiento, motivo, usuario, reversed_movement_id, reversion_version
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0)
       RETURNING id, fecha_ingreso`,
      [
        input.productId,
        counterQuantity,
        cost,
        counterRemaining,
        `Anulación de ${movementReason === "carga_stock" ? "carga de stock" : "merma"}: ${reason}`,
        counterType,
        counterReason,
        performedBy,
        input.movementId,
      ]
    );

    const reversalMovementId = toNumber(reversalResult.rows[0]?.id);
    const movementUpdate = await client.query(
      `UPDATE stock_movimientos
       SET anulada_at = now(),
           anulada_por = $1,
           anulacion_motivo = $2,
           cantidad_restante = CASE WHEN motivo = 'carga_stock' THEN 0 ELSE cantidad_restante END
       WHERE id = $3 AND anulada_at IS NULL
       RETURNING anulada_at`,
      [performedBy, reason, input.movementId]
    );
    if (!movementUpdate.rowCount) throw new AppError("El movimiento fue anulado por otra operación", 409);

    const cancellationResult = await client.query(
      `INSERT INTO stock_movement_cancellations (
         stock_movement_id, reversal_movement_id, product_id, motivo, anulada_por,
         stock_before, stock_after, original_type, original_reason, quantity, snapshot
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
       RETURNING id, anulada_at`,
      [
        input.movementId,
        reversalMovementId,
        input.productId,
        reason,
        performedBy,
        stockBefore,
        stockAfter,
        movement.tipo_movimiento,
        movement.motivo,
        quantity,
        JSON.stringify({ movement, product }),
      ]
    );

    if (ownsTransaction) await client.query("COMMIT");

    return {
      movementId: input.movementId,
      reversalMovementId,
      cancellationId: toNumber(cancellationResult.rows[0]?.id),
      stockBefore,
      stockAfter,
      cancelledAt: movementUpdate.rows[0]?.anulada_at,
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

export const inventoryMovementCancellationService = {
  async list(productId: number, executor?: InventoryMovementTransactionClient) {
    if (!Number.isInteger(productId) || productId <= 0) throw new AppError("ID de producto inválido", 400);
    if (executor || isPostgresConfigured()) return listPostgres(productId, executor);
    return listSqlite(productId);
  },

  async cancel(input: CancellationInput, executor?: InventoryMovementTransactionClient) {
    if (executor || isPostgresConfigured()) return cancelPostgres(input, executor);
    return cancelSqlite(input);
  },
};
