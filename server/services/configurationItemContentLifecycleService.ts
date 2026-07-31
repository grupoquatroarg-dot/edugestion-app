import { getPostgresPool, isPostgresConfigured } from "../utils/postgres.js";
import { AppError } from "../utils/response.js";

export type ConfigurationContentItemType = "payment_method" | "product_category" | "product_family";

export type ConfigurationItemContentInput = {
  itemType: ConfigurationContentItemType;
  itemId: number;
  name: string;
  tipo?: string | null;
  description?: string | null;
  categoryId?: number | null;
  motivo: string;
  usuario: string;
  expectedContentVersion: number;
};

type TransactionClient = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

const PROTECTED_PAYMENT_NAMES = new Set(["Cta Cte", "Cheque"]);
const ALLOWED_PAYMENT_TYPES = new Set(["Efectivo", "Transferencia", "Digital", "Crédito"]);
const normalize = (value: unknown) => String(value ?? "").trim();
const toNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const tableFor = (itemType: ConfigurationContentItemType) => {
  if (itemType === "payment_method") return "payment_methods";
  if (itemType === "product_category") return "product_categories";
  return "product_families";
};

const validateInput = (input: ConfigurationItemContentInput) => {
  if (!["payment_method", "product_category", "product_family"].includes(input.itemType)) {
    throw new AppError("Tipo de configuración inválido", 400);
  }
  if (!Number.isInteger(input.itemId) || input.itemId <= 0) {
    throw new AppError("ID de configuración inválido", 400);
  }
  if (!Number.isInteger(input.expectedContentVersion) || input.expectedContentVersion < 0) {
    throw new AppError("Versión de contenido inválida", 400);
  }

  const reason = normalize(input.motivo);
  if (reason.length < 3) {
    throw new AppError("El motivo del cambio es obligatorio y debe tener al menos 3 caracteres", 400);
  }
  if (reason.length > 500) {
    throw new AppError("El motivo no puede superar los 500 caracteres", 400);
  }

  const name = normalize(input.name);
  if (name.length < 2) {
    throw new AppError("El nombre debe tener al menos 2 caracteres", 400);
  }
  if (name.length > 200) {
    throw new AppError("El nombre no puede superar los 200 caracteres", 400);
  }

  const description = normalize(input.description) || null;
  if ((description || "").length > 2000) {
    throw new AppError("La descripción no puede superar los 2000 caracteres", 400);
  }

  const tipo = normalize(input.tipo || "Efectivo");
  if (input.itemType === "payment_method" && !ALLOWED_PAYMENT_TYPES.has(tipo)) {
    throw new AppError("Tipo de forma de pago inválido", 400);
  }

  const rawCategoryId = input.categoryId;
  const categoryId =
    rawCategoryId === null || rawCategoryId === undefined
      ? null
      : Number(rawCategoryId);
  if (input.itemType === "product_family" && categoryId !== null && (!Number.isInteger(categoryId) || categoryId <= 0)) {
    throw new AppError("Categoría asociada inválida", 400);
  }

  return {
    reason,
    user: normalize(input.usuario) || "Sistema",
    name,
    description,
    tipo,
    categoryId,
  };
};

const itemSnapshot = (itemType: ConfigurationContentItemType, row: any) => ({
  item_type: itemType,
  id: toNumber(row.id),
  name: normalize(row.name),
  tipo: itemType === "payment_method" ? normalize(row.tipo || "Efectivo") : null,
  description: itemType === "product_category" ? normalize(row.description) || null : null,
  category_id:
    itemType === "product_family" && row.category_id !== null && row.category_id !== undefined
      ? toNumber(row.category_id)
      : null,
  status:
    itemType === "payment_method"
      ? (toNumber(row.activo, 1) === 1 ? "activo" : "inactivo")
      : normalize(row.estado || "activo").toLowerCase(),
  content_version: toNumber(row.content_version),
});

const assertEditable = (
  itemType: ConfigurationContentItemType,
  row: any,
  expectedContentVersion: number
) => {
  if (!row) throw new AppError("Elemento de configuración no encontrado", 404);

  const active =
    itemType === "payment_method"
      ? toNumber(row.activo, 1) === 1
      : normalize(row.estado || "activo").toLowerCase() === "activo";
  if (!active) {
    throw new AppError("El elemento está inactivo. Reactivalo antes de editarlo", 409);
  }

  if (toNumber(row.content_version) !== expectedContentVersion) {
    throw new AppError(
      "La configuración cambió mientras estaba abierta. Actualizá la pantalla e intentá nuevamente",
      409
    );
  }
};

const assertPaymentRename = (currentName: string, nextName: string) => {
  if (PROTECTED_PAYMENT_NAMES.has(currentName) && currentName !== nextName) {
    throw new AppError(
      `La forma de pago ${currentName} es utilizada por reglas internas y no puede cambiar de nombre.`,
      409
    );
  }
};

const hasChanges = (before: ReturnType<typeof itemSnapshot>, after: ReturnType<typeof itemSnapshot>) =>
  JSON.stringify({
    name: before.name,
    tipo: before.tipo,
    description: before.description,
    category_id: before.category_id,
  }) !== JSON.stringify({
    name: after.name,
    tipo: after.tipo,
    description: after.description,
    category_id: after.category_id,
  });

const handleSqlite = async (input: ConfigurationItemContentInput) => {
  const validated = validateInput(input);
  const { default: db } = await import("../db.js");
  const table = tableFor(input.itemType);

  return db.transaction(() => {
    const current = db.prepare(`SELECT * FROM ${table} WHERE id = ? LIMIT 1`).get(input.itemId) as any;
    assertEditable(input.itemType, current, input.expectedContentVersion);

    if (input.itemType === "payment_method") {
      assertPaymentRename(normalize(current.name), validated.name);
    }

    if (input.itemType === "product_family" && validated.categoryId !== null) {
      const category = db.prepare(
        "SELECT id, estado FROM product_categories WHERE id = ? LIMIT 1"
      ).get(validated.categoryId) as any;
      if (!category || normalize(category.estado || "activo").toLowerCase() !== "activo") {
        throw new AppError("La categoría seleccionada está inactiva o no existe", 409);
      }
    }

    const duplicate = db.prepare(
      `SELECT id FROM ${table} WHERE lower(trim(name)) = lower(trim(?)) AND id <> ? LIMIT 1`
    ).get(validated.name, input.itemId);
    if (duplicate) throw new AppError("Ya existe otro elemento con ese nombre", 409);

    const before = itemSnapshot(input.itemType, current);
    const nextVersion = input.expectedContentVersion + 1;
    const after = itemSnapshot(input.itemType, {
      ...current,
      name: validated.name,
      tipo: validated.tipo,
      description: validated.description,
      category_id: validated.categoryId,
      content_version: nextVersion,
    });
    if (!hasChanges(before, after)) {
      throw new AppError("No se detectaron cambios para guardar", 409);
    }

    const historyInfo = db.prepare(`
      INSERT INTO configuration_item_content_history (
        item_type, item_id, version, reason, changed_by,
        before_snapshot, after_snapshot
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.itemType,
      input.itemId,
      nextVersion,
      validated.reason,
      validated.user,
      JSON.stringify(before),
      JSON.stringify(after)
    );

    let updateResult: any;
    if (input.itemType === "payment_method") {
      updateResult = db.prepare(`
        UPDATE payment_methods
        SET name = ?, tipo = ?, content_version = ?,
            content_changed_at = CURRENT_TIMESTAMP,
            content_changed_by = ?, content_change_reason = ?
        WHERE id = ? AND activo = 1 AND content_version = ?
      `).run(
        validated.name,
        validated.tipo,
        nextVersion,
        validated.user,
        validated.reason,
        input.itemId,
        input.expectedContentVersion
      );
    } else if (input.itemType === "product_category") {
      updateResult = db.prepare(`
        UPDATE product_categories
        SET name = ?, description = ?, content_version = ?,
            content_changed_at = CURRENT_TIMESTAMP,
            content_changed_by = ?, content_change_reason = ?
        WHERE id = ? AND COALESCE(estado, 'activo') = 'activo' AND content_version = ?
      `).run(
        validated.name,
        validated.description,
        nextVersion,
        validated.user,
        validated.reason,
        input.itemId,
        input.expectedContentVersion
      );
    } else {
      updateResult = db.prepare(`
        UPDATE product_families
        SET name = ?, category_id = ?, content_version = ?,
            content_changed_at = CURRENT_TIMESTAMP,
            content_changed_by = ?, content_change_reason = ?
        WHERE id = ? AND COALESCE(estado, 'activo') = 'activo' AND content_version = ?
      `).run(
        validated.name,
        validated.categoryId,
        nextVersion,
        validated.user,
        validated.reason,
        input.itemId,
        input.expectedContentVersion
      );
    }

    if (Number(updateResult.changes || 0) !== 1) {
      throw new AppError(
        "La configuración cambió mientras se guardaba. Actualizá la pantalla e intentá nuevamente",
        409
      );
    }

    const updated = db.prepare(`SELECT * FROM ${table} WHERE id = ? LIMIT 1`).get(input.itemId);
    return {
      item: updated,
      history: { id: Number(historyInfo.lastInsertRowid), version: nextVersion },
      version: nextVersion,
    };
  })();
};

const handlePostgres = async (
  input: ConfigurationItemContentInput,
  executor?: TransactionClient
) => {
  const validated = validateInput(input);
  const table = tableFor(input.itemType);
  const ownsTransaction = !executor;
  const pool = executor ? null : getPostgresPool();
  const client = executor || (await pool!.connect());

  try {
    if (ownsTransaction) await client.query("BEGIN");

    const currentResult = await client.query(
      `SELECT * FROM ${table} WHERE id = $1 LIMIT 1 FOR UPDATE`,
      [input.itemId]
    );
    const current = currentResult.rows[0];
    assertEditable(input.itemType, current, input.expectedContentVersion);

    if (input.itemType === "payment_method") {
      assertPaymentRename(normalize(current.name), validated.name);
    }

    if (input.itemType === "product_family" && validated.categoryId !== null) {
      const categoryResult = await client.query(
        `SELECT id, estado
         FROM product_categories
         WHERE id = $1
         LIMIT 1
         FOR SHARE`,
        [validated.categoryId]
      );
      const category = categoryResult.rows[0];
      if (!category || normalize(category.estado || "activo").toLowerCase() !== "activo") {
        throw new AppError("La categoría seleccionada está inactiva o no existe", 409);
      }
    }

    const duplicateResult = await client.query(
      `SELECT id FROM ${table}
       WHERE lower(btrim(name)) = lower(btrim($1))
         AND id <> $2
       LIMIT 1`,
      [validated.name, input.itemId]
    );
    if (duplicateResult.rowCount) {
      throw new AppError("Ya existe otro elemento con ese nombre", 409);
    }

    const before = itemSnapshot(input.itemType, current);
    const nextVersion = input.expectedContentVersion + 1;
    const after = itemSnapshot(input.itemType, {
      ...current,
      name: validated.name,
      tipo: validated.tipo,
      description: validated.description,
      category_id: validated.categoryId,
      content_version: nextVersion,
    });
    if (!hasChanges(before, after)) {
      throw new AppError("No se detectaron cambios para guardar", 409);
    }

    const historyResult = await client.query(
      `INSERT INTO configuration_item_content_history (
         item_type, item_id, version, reason, changed_by,
         before_snapshot, after_snapshot
       )
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
       RETURNING id, changed_at`,
      [
        input.itemType,
        input.itemId,
        nextVersion,
        validated.reason,
        validated.user,
        JSON.stringify(before),
        JSON.stringify(after),
      ]
    );
    const changedAt = historyResult.rows[0]?.changed_at || new Date().toISOString();

    let updateResult;
    if (input.itemType === "payment_method") {
      updateResult = await client.query(
        `UPDATE payment_methods
         SET name = $1, tipo = $2, content_version = $3,
             content_changed_at = $4, content_changed_by = $5, content_change_reason = $6
         WHERE id = $7 AND activo = 1 AND content_version = $8
         RETURNING *`,
        [
          validated.name,
          validated.tipo,
          nextVersion,
          changedAt,
          validated.user,
          validated.reason,
          input.itemId,
          input.expectedContentVersion,
        ]
      );
    } else if (input.itemType === "product_category") {
      updateResult = await client.query(
        `UPDATE product_categories
         SET name = $1, description = $2, content_version = $3,
             content_changed_at = $4, content_changed_by = $5, content_change_reason = $6
         WHERE id = $7 AND COALESCE(estado, 'activo') = 'activo' AND content_version = $8
         RETURNING *`,
        [
          validated.name,
          validated.description,
          nextVersion,
          changedAt,
          validated.user,
          validated.reason,
          input.itemId,
          input.expectedContentVersion,
        ]
      );
    } else {
      updateResult = await client.query(
        `UPDATE product_families
         SET name = $1, category_id = $2, content_version = $3,
             content_changed_at = $4, content_changed_by = $5, content_change_reason = $6
         WHERE id = $7 AND COALESCE(estado, 'activo') = 'activo' AND content_version = $8
         RETURNING *`,
        [
          validated.name,
          validated.categoryId,
          nextVersion,
          changedAt,
          validated.user,
          validated.reason,
          input.itemId,
          input.expectedContentVersion,
        ]
      );
    }

    if (updateResult.rowCount !== 1) {
      throw new AppError(
        "La configuración cambió mientras se guardaba. Actualizá la pantalla e intentá nuevamente",
        409
      );
    }

    if (ownsTransaction) await client.query("COMMIT");
    return {
      item: updateResult.rows[0],
      history: historyResult.rows[0],
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

export const configurationItemContentLifecycleService = {
  async update(input: ConfigurationItemContentInput, executor?: TransactionClient) {
    if (executor || isPostgresConfigured()) return handlePostgres(input, executor);
    return handleSqlite(input);
  },
};
