import { getPostgresPool, isPostgresConfigured } from "../utils/postgres.js";
import { AppError } from "../utils/response.js";
import {
  getProductMeasurementUnit,
  getProductPriceReferenceQuantity,
  getProductQuantityMode,
  normalizeProductMeasurementUnit,
  normalizeProductQuantityMode,
  roundMeasurementQuantity,
} from "../../shared/productMeasurement.js";

export type ProductContentInput = {
  productId: number;
  code: string;
  name: string;
  description?: string | null;
  cost: number;
  salePrice: number;
  quantityMode?: "unit" | "measure";
  measurementUnit?: "unidad" | "kg" | "g" | "l" | "ml" | "m";
  priceReferenceQuantity?: number;
  stockMinimum?: number;
  company: "Edu" | "Peti";
  familyId?: number | null;
  categoryId?: number | null;
  motivo: string;
  usuario: string;
  expectedContentVersion: number;
};

type TransactionClient = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

const normalize = (value: unknown) => String(value ?? "").trim();
const toNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const nullableId = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};
const money = (value: unknown) => Math.round(toNumber(value) * 100) / 100;
const parseOptionalId = (value: unknown, label: string) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AppError(`${label} inválida`, 400);
  }
  return parsed;
};

const validateInput = (input: ProductContentInput) => {
  if (!Number.isInteger(input.productId) || input.productId <= 0) {
    throw new AppError("ID de producto inválido", 400);
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

  const code = normalize(input.code);
  const name = normalize(input.name);
  const description = normalize(input.description) || null;
  const company = normalize(input.company);
  const cost = money(input.cost);
  const salePrice = money(input.salePrice);
  const stockMinimum = roundMeasurementQuantity(input.stockMinimum);
  const quantityMode = normalizeProductQuantityMode(input.quantityMode);
  const measurementUnit = quantityMode === "measure"
    ? normalizeProductMeasurementUnit(input.measurementUnit)
    : "unidad";
  const priceReferenceQuantity = quantityMode === "measure"
    ? roundMeasurementQuantity(input.priceReferenceQuantity ?? 1)
    : 1;
  const familyId = parseOptionalId(input.familyId, "Familia");
  const categoryId = parseOptionalId(input.categoryId, "Categoría");

  if (!code) throw new AppError("El código es obligatorio", 400);
  if (code.length > 100) throw new AppError("El código no puede superar los 100 caracteres", 400);
  if (name.length < 2) throw new AppError("El nombre debe tener al menos 2 caracteres", 400);
  if (name.length > 250) throw new AppError("El nombre no puede superar los 250 caracteres", 400);
  if ((description || "").length > 2000) throw new AppError("La descripción no puede superar los 2000 caracteres", 400);
  if (!Number.isFinite(cost) || cost < 0) throw new AppError("El costo no puede ser negativo", 400);
  if (!Number.isFinite(salePrice) || salePrice < 0) throw new AppError("El precio de venta no puede ser negativo", 400);
  if (!Number.isFinite(stockMinimum) || stockMinimum < 0) throw new AppError("El stock mínimo no puede ser negativo", 400);
  if (quantityMode === "unit" && !Number.isInteger(stockMinimum)) {
    throw new AppError("Los productos por unidad solo admiten stock mínimo entero", 400);
  }
  if (quantityMode === "measure" && measurementUnit === "unidad") {
    throw new AppError("Seleccioná una unidad de medida para el producto fraccionable", 400);
  }
  if (!Number.isFinite(priceReferenceQuantity) || priceReferenceQuantity <= 0) {
    throw new AppError("La cantidad de referencia del precio debe ser mayor a cero", 400);
  }
  if (company !== "Edu" && company !== "Peti") throw new AppError("Empresa inválida", 400);

  return {
    reason,
    user: normalize(input.usuario) || "Sistema",
    code,
    name,
    description,
    company: company as "Edu" | "Peti",
    cost,
    salePrice,
    quantityMode,
    measurementUnit,
    priceReferenceQuantity,
    stockMinimum,
    familyId,
    categoryId,
    uniqueCode: `${company}-${code}`,
  };
};

const snapshot = (row: any) => ({
  id: toNumber(row.id),
  code: normalize(row.code),
  codigo_unico: normalize(row.codigo_unico),
  name: normalize(row.name),
  description: normalize(row.description) || null,
  cost: money(row.cost),
  sale_price: money(row.sale_price),
  quantity_mode: getProductQuantityMode(row),
  measurement_unit: getProductMeasurementUnit(row),
  price_reference_quantity: getProductPriceReferenceQuantity(row),
  stock_minimo: roundMeasurementQuantity(row.stock_minimo),
  company: normalize(row.company),
  family_id: nullableId(row.family_id),
  category_id: nullableId(row.category_id),
  estado: normalize(row.estado || "activo").toLowerCase(),
  eliminado: toNumber(row.eliminado),
  content_version: Math.trunc(toNumber(row.content_version)),
});

const editableSnapshot = (row: ReturnType<typeof snapshot>) => ({
  code: row.code,
  codigo_unico: row.codigo_unico,
  name: row.name,
  description: row.description,
  cost: row.cost,
  sale_price: row.sale_price,
  quantity_mode: row.quantity_mode,
  measurement_unit: row.measurement_unit,
  price_reference_quantity: row.price_reference_quantity,
  stock_minimo: row.stock_minimo,
  company: row.company,
  family_id: row.family_id,
  category_id: row.category_id,
});

const assertEditable = (row: any, expectedContentVersion: number) => {
  if (!row) throw new AppError("Producto no encontrado", 404);
  if (toNumber(row.eliminado) !== 0) throw new AppError("Producto no encontrado", 404);
  if (normalize(row.estado || "activo").toLowerCase() !== "activo") {
    throw new AppError("El producto está inactivo. Reactivalo antes de editarlo", 409);
  }
  if (Math.trunc(toNumber(row.content_version)) !== expectedContentVersion) {
    throw new AppError(
      "El producto cambió mientras estaba abierto. Actualizá la pantalla e intentá nuevamente",
      409
    );
  }
};

const assertClassificationsSqlite = (
  db: any,
  familyId: number | null,
  categoryId: number | null,
  current: any
) => {
  if (familyId !== null) {
    const family = db.prepare("SELECT id, estado FROM product_families WHERE id = ? LIMIT 1").get(familyId) as any;
    const unchanged = nullableId(current.family_id) === familyId;
    if (!family || (normalize(family.estado || "activo").toLowerCase() !== "activo" && !unchanged)) {
      throw new AppError("La familia seleccionada está inactiva o no existe", 409);
    }
  }
  if (categoryId !== null) {
    const category = db.prepare("SELECT id, estado FROM product_categories WHERE id = ? LIMIT 1").get(categoryId) as any;
    const unchanged = nullableId(current.category_id) === categoryId;
    if (!category || (normalize(category.estado || "activo").toLowerCase() !== "activo" && !unchanged)) {
      throw new AppError("La categoría seleccionada está inactiva o no existe", 409);
    }
  }
};

const assertClassificationsPostgres = async (
  client: TransactionClient,
  familyId: number | null,
  categoryId: number | null,
  current: any
) => {
  if (familyId !== null) {
    const family = await client.query("SELECT id, estado FROM product_families WHERE id = $1 LIMIT 1", [familyId]);
    const unchanged = nullableId(current.family_id) === familyId;
    if (!family.rowCount || (normalize(family.rows[0]?.estado || "activo").toLowerCase() !== "activo" && !unchanged)) {
      throw new AppError("La familia seleccionada está inactiva o no existe", 409);
    }
  }
  if (categoryId !== null) {
    const category = await client.query("SELECT id, estado FROM product_categories WHERE id = $1 LIMIT 1", [categoryId]);
    const unchanged = nullableId(current.category_id) === categoryId;
    if (!category.rowCount || (normalize(category.rows[0]?.estado || "activo").toLowerCase() !== "activo" && !unchanged)) {
      throw new AppError("La categoría seleccionada está inactiva o no existe", 409);
    }
  }
};

const handleSqlite = async (input: ProductContentInput) => {
  const validated = validateInput(input);
  const { default: db } = await import("../db.js");

  return db.transaction(() => {
    const current = db.prepare("SELECT * FROM products WHERE id = ? LIMIT 1").get(input.productId) as any;
    assertEditable(current, input.expectedContentVersion);
    assertClassificationsSqlite(db, validated.familyId, validated.categoryId, current);

    const duplicate = db.prepare(
      "SELECT id, eliminado FROM products WHERE codigo_unico = ? AND id <> ? LIMIT 1"
    ).get(validated.uniqueCode, input.productId) as any;
    if (duplicate) {
      throw new AppError(
        toNumber(duplicate.eliminado) === 1
          ? `El código ${validated.uniqueCode} ya existe en un producto eliminado.`
          : `El código ${validated.uniqueCode} ya está en uso por otro producto.`,
        409
      );
    }

    const before = snapshot(current);
    const nextVersion = input.expectedContentVersion + 1;
    const after = snapshot({
      ...current,
      code: validated.code,
      codigo_unico: validated.uniqueCode,
      name: validated.name,
      description: validated.description,
      cost: validated.cost,
      sale_price: validated.salePrice,
      quantity_mode: validated.quantityMode,
      measurement_unit: validated.measurementUnit,
      price_reference_quantity: validated.priceReferenceQuantity,
      stock_minimo: validated.stockMinimum,
      company: validated.company,
      family_id: validated.familyId,
      category_id: validated.categoryId,
      content_version: nextVersion,
    });

    if (JSON.stringify(editableSnapshot(before)) === JSON.stringify(editableSnapshot(after))) {
      throw new AppError("No se detectaron cambios para guardar", 409);
    }

    db.prepare(`
      INSERT INTO product_content_history (
        product_id, version, reason, changed_by, before_snapshot, after_snapshot
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      input.productId,
      nextVersion,
      validated.reason,
      validated.user,
      JSON.stringify(before),
      JSON.stringify(after)
    );

    const result = db.prepare(`
      UPDATE products
      SET code = ?, codigo_unico = ?, name = ?, description = ?, cost = ?, sale_price = ?,
          quantity_mode = ?, measurement_unit = ?, price_reference_quantity = ?,
          stock_minimo = ?, company = ?, family_id = ?, category_id = ?, content_version = ?,
          content_changed_at = CURRENT_TIMESTAMP, content_changed_by = ?, content_change_reason = ?
      WHERE id = ? AND eliminado = 0 AND estado = 'activo' AND content_version = ?
    `).run(
      validated.code,
      validated.uniqueCode,
      validated.name,
      validated.description,
      validated.cost,
      validated.salePrice,
      validated.quantityMode,
      validated.measurementUnit,
      validated.priceReferenceQuantity,
      validated.stockMinimum,
      validated.company,
      validated.familyId,
      validated.categoryId,
      nextVersion,
      validated.user,
      validated.reason,
      input.productId,
      input.expectedContentVersion
    );

    if (toNumber(result.changes) !== 1) {
      throw new AppError("El producto cambió mientras estaba abierto. Actualizá la pantalla e intentá nuevamente", 409);
    }

    return db.prepare(`
      SELECT p.*, f.name AS family_name, c.name AS category_name
      FROM products p
      LEFT JOIN product_families f ON p.family_id = f.id
      LEFT JOIN product_categories c ON p.category_id = c.id
      WHERE p.id = ? LIMIT 1
    `).get(input.productId);
  })();
};

const handlePostgres = async (input: ProductContentInput) => {
  const validated = validateInput(input);
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const currentResult = await client.query(
      "SELECT * FROM products WHERE id = $1 LIMIT 1 FOR UPDATE",
      [input.productId]
    );
    const current = currentResult.rows[0];
    assertEditable(current, input.expectedContentVersion);
    await assertClassificationsPostgres(client, validated.familyId, validated.categoryId, current);

    const duplicate = await client.query(
      "SELECT id, eliminado FROM products WHERE codigo_unico = $1 AND id <> $2 LIMIT 1",
      [validated.uniqueCode, input.productId]
    );
    if (duplicate.rowCount) {
      throw new AppError(
        toNumber(duplicate.rows[0]?.eliminado) === 1
          ? `El código ${validated.uniqueCode} ya existe en un producto eliminado.`
          : `El código ${validated.uniqueCode} ya está en uso por otro producto.`,
        409
      );
    }

    const before = snapshot(current);
    const nextVersion = input.expectedContentVersion + 1;
    const after = snapshot({
      ...current,
      code: validated.code,
      codigo_unico: validated.uniqueCode,
      name: validated.name,
      description: validated.description,
      cost: validated.cost,
      sale_price: validated.salePrice,
      quantity_mode: validated.quantityMode,
      measurement_unit: validated.measurementUnit,
      price_reference_quantity: validated.priceReferenceQuantity,
      stock_minimo: validated.stockMinimum,
      company: validated.company,
      family_id: validated.familyId,
      category_id: validated.categoryId,
      content_version: nextVersion,
    });

    if (JSON.stringify(editableSnapshot(before)) === JSON.stringify(editableSnapshot(after))) {
      throw new AppError("No se detectaron cambios para guardar", 409);
    }

    await client.query(
      `INSERT INTO product_content_history (
         product_id, version, reason, changed_by, before_snapshot, after_snapshot
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
      [
        input.productId,
        nextVersion,
        validated.reason,
        validated.user,
        JSON.stringify(before),
        JSON.stringify(after),
      ]
    );

    const updated = await client.query(
      `UPDATE products
       SET code = $1, codigo_unico = $2, name = $3, description = $4, cost = $5,
           sale_price = $6, quantity_mode = $7, measurement_unit = $8,
           price_reference_quantity = $9, stock_minimo = $10, company = $11,
           family_id = $12, category_id = $13, content_version = $14, content_changed_at = now(),
           content_changed_by = $15, content_change_reason = $16
       WHERE id = $17 AND eliminado = 0 AND estado = 'activo' AND content_version = $18
       RETURNING *`,
      [
        validated.code,
        validated.uniqueCode,
        validated.name,
        validated.description,
        validated.cost,
        validated.salePrice,
        validated.quantityMode,
        validated.measurementUnit,
        validated.priceReferenceQuantity,
        validated.stockMinimum,
        validated.company,
        validated.familyId,
        validated.categoryId,
        nextVersion,
        validated.user,
        validated.reason,
        input.productId,
        input.expectedContentVersion,
      ]
    );

    if (!updated.rowCount) {
      throw new AppError("El producto cambió mientras estaba abierto. Actualizá la pantalla e intentá nuevamente", 409);
    }

    const result = await client.query(
      `SELECT p.*, f.name AS family_name, c.name AS category_name
       FROM products p
       LEFT JOIN product_families f ON p.family_id = f.id
       LEFT JOIN product_categories c ON p.category_id = c.id
       WHERE p.id = $1 LIMIT 1`,
      [input.productId]
    );

    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export const productContentLifecycleService = {
  update(input: ProductContentInput) {
    return isPostgresConfigured() ? handlePostgres(input) : handleSqlite(input);
  },
};
