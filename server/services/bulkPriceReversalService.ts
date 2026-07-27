import { getPostgresPool, isPostgresConfigured } from "../utils/postgres.js";
import { AppError } from "../utils/response.js";

export type BulkPriceTransactionClient = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

type ReversalInput = {
  historyId: number;
  motivo: string;
  usuario: string;
};

const toNumber = (value: unknown, fallback = 0) => {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const amountsMatch = (left: number, right: number) =>
  Math.abs(roundMoney(left) - roundMoney(right)) <= 0.01;

const validateInput = ({ historyId, motivo, usuario }: ReversalInput) => {
  if (!Number.isInteger(historyId) || historyId <= 0) {
    throw new AppError("ID de cambio de precios inválido", 400);
  }

  const reason = String(motivo || "").trim();
  if (reason.length < 3) {
    throw new AppError("El motivo es obligatorio y debe tener al menos 3 caracteres", 400);
  }
  if (reason.length > 500) {
    throw new AppError("El motivo no puede superar los 500 caracteres", 400);
  }

  return {
    reason,
    performedBy: String(usuario || "Sistema").trim() || "Sistema",
  };
};

const assertHistoryCanBeReverted = (history: any) => {
  if (!history) throw new AppError("Cambio de precios no encontrado", 404);
  if (history.reverted_at) throw new AppError("Este cambio de precios ya fue revertido", 409);
  if (toNumber(history.reversion_version) !== 1) {
    throw new AppError(
      "Este cambio es anterior a la trazabilidad por producto y no puede revertirse automáticamente",
      409
    );
  }
};

const assertItemsAreConsistent = (history: any, items: any[]) => {
  const expectedCount = toNumber(history.productos_afectados);
  if (!items.length || items.length !== expectedCount) {
    throw new AppError(
      "La trazabilidad del cambio está incompleta y no puede revertirse automáticamente",
      409
    );
  }

  const changedAfterUpdate = items.filter(
    (item) =>
      !amountsMatch(toNumber(item.current_cost), toNumber(item.new_cost)) ||
      !amountsMatch(toNumber(item.current_sale_price), toNumber(item.new_sale_price))
  );

  if (changedAfterUpdate.length > 0) {
    const names = changedAfterUpdate
      .slice(0, 5)
      .map((item) => item.product_name || `Producto ${item.product_id}`)
      .join(", ");
    const suffix = changedAfterUpdate.length > 5 ? ` y ${changedAfterUpdate.length - 5} más` : "";
    throw new AppError(
      `No se puede revertir porque ${changedAfterUpdate.length} producto(s) cambiaron después de esta actualización: ${names}${suffix}`,
      409
    );
  }
};

const handleSqlite = async ({ historyId, motivo, usuario }: ReversalInput) => {
  const { reason, performedBy } = validateInput({ historyId, motivo, usuario });
  const { default: db } = await import("../db.js");

  return db.transaction(() => {
    const history = db
      .prepare("SELECT * FROM price_update_history WHERE id = ? LIMIT 1")
      .get(historyId) as any;
    assertHistoryCanBeReverted(history);

    const items = db
      .prepare(`
        SELECT
          pui.*,
          p.name AS product_name,
          p.cost AS current_cost,
          p.sale_price AS current_sale_price
        FROM price_update_history_items pui
        JOIN products p ON p.id = pui.product_id
        WHERE pui.price_update_history_id = ?
        ORDER BY pui.product_id ASC
      `)
      .all(historyId) as any[];

    assertItemsAreConsistent(history, items);

    for (const item of items) {
      db.prepare("UPDATE products SET cost = ?, sale_price = ? WHERE id = ?").run(
        roundMoney(toNumber(item.previous_cost)),
        roundMoney(toNumber(item.previous_sale_price)),
        Number(item.product_id)
      );
    }

    const revertedAt = new Date().toISOString();
    db.prepare(`
      UPDATE price_update_history_items
      SET reverted_at = ?
      WHERE price_update_history_id = ?
        AND reverted_at IS NULL
    `).run(revertedAt, historyId);

    db.prepare(`
      UPDATE price_update_history
      SET reverted_at = ?,
          reverted_by = ?,
          revert_reason = ?,
          reverted_count = ?
      WHERE id = ?
        AND reverted_at IS NULL
    `).run(revertedAt, performedBy, reason, items.length, historyId);

    return {
      historyId,
      revertedAt,
      revertedCount: items.length,
      products: items.map((item) => ({
        id: Number(item.product_id),
        cost: roundMoney(toNumber(item.previous_cost)),
        sale_price: roundMoney(toNumber(item.previous_sale_price)),
      })),
    };
  })();
};

const handlePostgres = async (
  input: ReversalInput,
  executor?: BulkPriceTransactionClient
) => {
  const { historyId } = input;
  const { reason, performedBy } = validateInput(input);
  const ownsTransaction = !executor;
  const pool = executor ? null : getPostgresPool();
  const client = executor || (await pool!.connect());

  try {
    if (ownsTransaction) await client.query("BEGIN");

    const historyResult = await client.query(
      `SELECT *
       FROM price_update_history
       WHERE id = $1
       LIMIT 1
       FOR UPDATE`,
      [historyId]
    );
    const history = historyResult.rows[0];
    assertHistoryCanBeReverted(history);

    const itemsResult = await client.query(
      `SELECT
         pui.*,
         p.name AS product_name,
         p.cost AS current_cost,
         p.sale_price AS current_sale_price
       FROM price_update_history_items pui
       JOIN products p ON p.id = pui.product_id
       WHERE pui.price_update_history_id = $1
       ORDER BY pui.product_id ASC
       FOR UPDATE OF pui, p`,
      [historyId]
    );
    const items = itemsResult.rows;
    assertItemsAreConsistent(history, items);

    const revertedAt = new Date().toISOString();
    const products: Array<{ id: number; cost: number; sale_price: number }> = [];

    for (const item of items) {
      const cost = roundMoney(toNumber(item.previous_cost));
      const salePrice = roundMoney(toNumber(item.previous_sale_price));
      const updated = await client.query(
        `UPDATE products
         SET cost = $1,
             sale_price = $2
         WHERE id = $3
         RETURNING id, cost, sale_price`,
        [cost, salePrice, Number(item.product_id)]
      );
      if (!updated.rowCount) {
        throw new AppError(`No se pudo restaurar el producto ${item.product_id}`, 409);
      }
      products.push({
        id: Number(updated.rows[0].id),
        cost: roundMoney(toNumber(updated.rows[0].cost)),
        sale_price: roundMoney(toNumber(updated.rows[0].sale_price)),
      });
    }

    await client.query(
      `UPDATE price_update_history_items
       SET reverted_at = $1
       WHERE price_update_history_id = $2
         AND reverted_at IS NULL`,
      [revertedAt, historyId]
    );

    const historyUpdate = await client.query(
      `UPDATE price_update_history
       SET reverted_at = $1,
           reverted_by = $2,
           revert_reason = $3,
           reverted_count = $4
       WHERE id = $5
         AND reverted_at IS NULL
       RETURNING id`,
      [revertedAt, performedBy, reason, items.length, historyId]
    );
    if (!historyUpdate.rowCount) {
      throw new AppError("El cambio de precios fue revertido por otra operación", 409);
    }

    if (ownsTransaction) await client.query("COMMIT");

    return {
      historyId,
      revertedAt,
      revertedCount: items.length,
      products,
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

export const bulkPriceReversalService = {
  async revert(input: ReversalInput, executor?: BulkPriceTransactionClient) {
    if (executor || isPostgresConfigured()) return handlePostgres(input, executor);
    return handleSqlite(input);
  },
};
