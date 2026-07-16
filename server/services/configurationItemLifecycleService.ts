import { getPostgresPool, isPostgresConfigured } from "../utils/postgres.js";
import { AppError } from "../utils/response.js";

export type ConfigurationItemType = "payment_method" | "product_category" | "product_family";
export type ConfigurationLifecycleAction = "deactivate" | "reactivate";

type TransactionClient = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

type LifecycleInput = {
  itemType: ConfigurationItemType;
  itemId: number;
  action: ConfigurationLifecycleAction;
  motivo: string;
  usuario: string;
};

const normalize = (value: unknown) => String(value ?? "").trim();
const toNumber = (value: any, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const validateInput = ({ itemId, motivo, itemType }: LifecycleInput) => {
  if (!Number.isInteger(itemId) || itemId <= 0) {
    throw new AppError("ID de configuración inválido", 400);
  }
  if (!["payment_method", "product_category", "product_family"].includes(itemType)) {
    throw new AppError("Tipo de configuración inválido", 400);
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

const isActive = (itemType: ConfigurationItemType, row: any) =>
  itemType === "payment_method"
    ? toNumber(row?.activo, 1) === 1
    : normalize(row?.estado || "activo").toLowerCase() === "activo";

const tableByType: Record<ConfigurationItemType, string> = {
  payment_method: "payment_methods",
  product_category: "product_categories",
  product_family: "product_families",
};

const labelByType: Record<ConfigurationItemType, string> = {
  payment_method: "forma de pago",
  product_category: "categoría",
  product_family: "familia",
};

const assertTransition = (itemType: ConfigurationItemType, row: any, action: ConfigurationLifecycleAction) => {
  if (!row) throw new AppError(`${labelByType[itemType]} no encontrada`, 404);
  const active = isActive(itemType, row);
  if (action === "deactivate" && !active) {
    throw new AppError(`La ${labelByType[itemType]} ya está inactiva`, 409);
  }
  if (action === "reactivate" && active) {
    throw new AppError(`La ${labelByType[itemType]} ya está activa`, 409);
  }
  return active;
};

const assertSqliteBlockers = (db: any, itemType: ConfigurationItemType, itemId: number, action: ConfigurationLifecycleAction, row: any) => {
  if (action === "reactivate" && itemType === "product_family" && row.category_id) {
    const category = db.prepare("SELECT id, estado FROM product_categories WHERE id = ? LIMIT 1").get(row.category_id) as any;
    if (!category || normalize(category.estado || "activo").toLowerCase() !== "activo") {
      throw new AppError("Primero debe reactivarse la categoría asociada a esta familia", 409);
    }
  }

  if (action !== "deactivate") return;

  if (itemType === "payment_method") {
    if (normalize(row?.name).toLowerCase() === "cta cte") {
      throw new AppError("La forma de pago Cta Cte es requerida por el sistema y no puede darse de baja", 409);
    }
    const count = db.prepare("SELECT COUNT(*) AS total FROM payment_methods WHERE id <> ? AND COALESCE(activo, 1) = 1").get(itemId) as any;
    if (toNumber(count?.total) <= 0) {
      throw new AppError("Debe quedar al menos una forma de pago activa", 409);
    }
  }

  if (itemType === "product_category") {
    const family = db.prepare("SELECT id, name FROM product_families WHERE category_id = ? AND COALESCE(estado, 'activo') = 'activo' LIMIT 1").get(itemId) as any;
    if (family) throw new AppError(`La categoría tiene la familia activa ${family.name || family.id}`, 409);

    const product = db.prepare("SELECT id, name FROM products WHERE category_id = ? AND COALESCE(eliminado, 0) = 0 AND COALESCE(active, 1) = 1 AND COALESCE(estado, 'activo') = 'activo' LIMIT 1").get(itemId) as any;
    if (product) throw new AppError(`La categoría tiene el producto activo ${product.name || product.id}`, 409);
  }

  if (itemType === "product_family") {
    const product = db.prepare("SELECT id, name FROM products WHERE family_id = ? AND COALESCE(eliminado, 0) = 0 AND COALESCE(active, 1) = 1 AND COALESCE(estado, 'activo') = 'activo' LIMIT 1").get(itemId) as any;
    if (product) throw new AppError(`La familia tiene el producto activo ${product.name || product.id}`, 409);
  }
};

const handleSqlite = async (input: LifecycleInput) => {
  const reason = validateInput(input);
  const normalizedUser = normalize(input.usuario) || "Sistema";
  const { default: db } = await import("../db.js");
  const table = tableByType[input.itemType];

  return db.transaction(() => {
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ? LIMIT 1`).get(input.itemId) as any;
    const wasActive = assertTransition(input.itemType, row, input.action);
    assertSqliteBlockers(db, input.itemType, input.itemId, input.action, row);

    const previousStatus = wasActive ? "activo" : "inactivo";
    const nextStatus = input.action === "deactivate" ? "inactivo" : "activo";
    const history = db.prepare(`
      INSERT INTO configuration_item_status_history (
        item_type, item_id, action, reason, performed_by, previous_status, new_status, snapshot
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.itemType,
      input.itemId,
      input.action,
      reason,
      normalizedUser,
      previousStatus,
      nextStatus,
      JSON.stringify({ item: row })
    );

    if (input.itemType === "payment_method") {
      if (input.action === "deactivate") {
        db.prepare(`UPDATE payment_methods SET activo = 0, deactivated_at = CURRENT_TIMESTAMP, deactivated_by = ?, deactivation_reason = ? WHERE id = ?`)
          .run(normalizedUser, reason, input.itemId);
      } else {
        db.prepare(`UPDATE payment_methods SET activo = 1, deactivated_at = NULL, deactivated_by = NULL, deactivation_reason = NULL WHERE id = ?`)
          .run(input.itemId);
      }
    } else {
      if (input.action === "deactivate") {
        db.prepare(`UPDATE ${table} SET estado = 'inactivo', deactivated_at = CURRENT_TIMESTAMP, deactivated_by = ?, deactivation_reason = ? WHERE id = ?`)
          .run(normalizedUser, reason, input.itemId);
      } else {
        db.prepare(`UPDATE ${table} SET estado = 'activo', deactivated_at = NULL, deactivated_by = NULL, deactivation_reason = NULL WHERE id = ?`)
          .run(input.itemId);
      }
    }

    return {
      item: db.prepare(`SELECT * FROM ${table} WHERE id = ? LIMIT 1`).get(input.itemId),
      historyId: Number(history.lastInsertRowid),
    };
  })();
};

const assertPostgresBlockers = async (
  client: TransactionClient,
  itemType: ConfigurationItemType,
  itemId: number,
  action: ConfigurationLifecycleAction,
  row: any
) => {
  if (action === "reactivate" && itemType === "product_family" && row.category_id) {
    const category = await client.query(
      "SELECT id, estado FROM product_categories WHERE id = $1 LIMIT 1 FOR UPDATE",
      [Number(row.category_id)]
    );
    if (!category.rowCount || normalize(category.rows[0]?.estado || "activo").toLowerCase() !== "activo") {
      throw new AppError("Primero debe reactivarse la categoría asociada a esta familia", 409);
    }
  }

  if (action !== "deactivate") return;

  if (itemType === "payment_method") {
    if (normalize(row?.name).toLowerCase() === "cta cte") {
      throw new AppError("La forma de pago Cta Cte es requerida por el sistema y no puede darse de baja", 409);
    }
    const count = await client.query(
      "SELECT COUNT(*)::int AS total FROM payment_methods WHERE id <> $1 AND COALESCE(activo, 1) = 1",
      [itemId]
    );
    if (toNumber(count.rows[0]?.total) <= 0) {
      throw new AppError("Debe quedar al menos una forma de pago activa", 409);
    }
  }

  if (itemType === "product_category") {
    const family = await client.query(
      "SELECT id, name FROM product_families WHERE category_id = $1 AND COALESCE(estado, 'activo') = 'activo' ORDER BY id ASC LIMIT 1 FOR UPDATE",
      [itemId]
    );
    if (family.rowCount) {
      throw new AppError(`La categoría tiene la familia activa ${family.rows[0]?.name || family.rows[0]?.id}`, 409);
    }

    const product = await client.query(
      "SELECT id, name FROM products WHERE category_id = $1 AND COALESCE(eliminado, 0) = 0 AND COALESCE(active, 1) = 1 AND COALESCE(estado, 'activo') = 'activo' ORDER BY id ASC LIMIT 1 FOR UPDATE",
      [itemId]
    );
    if (product.rowCount) {
      throw new AppError(`La categoría tiene el producto activo ${product.rows[0]?.name || product.rows[0]?.id}`, 409);
    }
  }

  if (itemType === "product_family") {
    const product = await client.query(
      "SELECT id, name FROM products WHERE family_id = $1 AND COALESCE(eliminado, 0) = 0 AND COALESCE(active, 1) = 1 AND COALESCE(estado, 'activo') = 'activo' ORDER BY id ASC LIMIT 1 FOR UPDATE",
      [itemId]
    );
    if (product.rowCount) {
      throw new AppError(`La familia tiene el producto activo ${product.rows[0]?.name || product.rows[0]?.id}`, 409);
    }
  }
};

const handlePostgres = async (input: LifecycleInput, executor?: TransactionClient) => {
  const reason = validateInput(input);
  const normalizedUser = normalize(input.usuario) || "Sistema";
  const table = tableByType[input.itemType];
  const ownsTransaction = !executor;
  const pool = executor ? null : getPostgresPool();
  const client = executor || (await pool!.connect());

  try {
    if (ownsTransaction) await client.query("BEGIN");

    const itemResult = await client.query(
      `SELECT * FROM ${table} WHERE id = $1 LIMIT 1 FOR UPDATE`,
      [input.itemId]
    );
    if (!itemResult.rowCount) throw new AppError(`${labelByType[input.itemType]} no encontrada`, 404);
    const row = itemResult.rows[0];
    const wasActive = assertTransition(input.itemType, row, input.action);

    await assertPostgresBlockers(client, input.itemType, input.itemId, input.action, row);

    const previousStatus = wasActive ? "activo" : "inactivo";
    const nextStatus = input.action === "deactivate" ? "inactivo" : "activo";
    const historyResult = await client.query(
      `INSERT INTO configuration_item_status_history (
         item_type, item_id, action, reason, performed_by, previous_status, new_status, snapshot
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       RETURNING id, performed_at`,
      [
        input.itemType,
        input.itemId,
        input.action,
        reason,
        normalizedUser,
        previousStatus,
        nextStatus,
        JSON.stringify({ item: row }),
      ]
    );

    const performedAt = historyResult.rows[0]?.performed_at || new Date().toISOString();
    let updateResult;

    if (input.itemType === "payment_method") {
      updateResult = input.action === "deactivate"
        ? await client.query(
            `UPDATE payment_methods
             SET activo = 0, deactivated_at = $1, deactivated_by = $2, deactivation_reason = $3
             WHERE id = $4 RETURNING *`,
            [performedAt, normalizedUser, reason, input.itemId]
          )
        : await client.query(
            `UPDATE payment_methods
             SET activo = 1, deactivated_at = NULL, deactivated_by = NULL, deactivation_reason = NULL
             WHERE id = $1 RETURNING *`,
            [input.itemId]
          );
    } else {
      updateResult = input.action === "deactivate"
        ? await client.query(
            `UPDATE ${table}
             SET estado = 'inactivo', deactivated_at = $1, deactivated_by = $2, deactivation_reason = $3
             WHERE id = $4 RETURNING *`,
            [performedAt, normalizedUser, reason, input.itemId]
          )
        : await client.query(
            `UPDATE ${table}
             SET estado = 'activo', deactivated_at = NULL, deactivated_by = NULL, deactivation_reason = NULL
             WHERE id = $1 RETURNING *`,
            [input.itemId]
          );
    }

    if (ownsTransaction) await client.query("COMMIT");

    return {
      item: updateResult.rows[0],
      historyId: toNumber(historyResult.rows[0]?.id),
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

export const configurationItemLifecycleService = {
  async changeStatus(input: LifecycleInput, executor?: TransactionClient) {
    if (!isPostgresConfigured() && !executor) return handleSqlite(input);
    return handlePostgres(input, executor);
  },
};
