import { getPostgresPool, isPostgresConfigured } from "../utils/postgres.js";
import { AppError } from "../utils/response.js";

export type ProviderContentInput = {
  providerId: number;
  nombre: string;
  cuit?: string | null;
  telefono?: string | null;
  email?: string | null;
  direccion?: string | null;
  motivo: string;
  usuario: string;
  expectedContentVersion: number;
};

type TransactionClient = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

const normalize = (value: unknown) => String(value ?? "").trim();
const nullableText = (value: unknown) => normalize(value) || null;
const normalizeEmail = (value: unknown) => nullableText(value)?.toLowerCase() || null;
const toNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const validateInput = (input: ProviderContentInput) => {
  if (!Number.isInteger(input.providerId) || input.providerId <= 0) {
    throw new AppError("ID de proveedor inválido", 400);
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

  const nombre = normalize(input.nombre);
  const cuit = nullableText(input.cuit);
  const telefono = nullableText(input.telefono);
  const email = normalizeEmail(input.email);
  const direccion = nullableText(input.direccion);

  if (nombre.length < 2) throw new AppError("El nombre debe tener al menos 2 caracteres", 400);
  if (nombre.length > 250) throw new AppError("El nombre no puede superar los 250 caracteres", 400);
  if ((cuit || "").length > 30) throw new AppError("El CUIT no puede superar los 30 caracteres", 400);
  if ((telefono || "").length > 40) throw new AppError("El teléfono no puede superar los 40 caracteres", 400);
  if ((email || "").length > 250) throw new AppError("El email no puede superar los 250 caracteres", 400);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError("Email inválido", 400);
  if ((direccion || "").length > 500) throw new AppError("La dirección no puede superar los 500 caracteres", 400);

  return {
    reason,
    user: normalize(input.usuario) || "Sistema",
    nombre,
    cuit,
    telefono,
    email,
    direccion,
  };
};

const snapshot = (row: any) => ({
  id: toNumber(row.id),
  nombre: normalize(row.nombre),
  cuit: nullableText(row.cuit),
  telefono: nullableText(row.telefono),
  email: normalizeEmail(row.email),
  direccion: nullableText(row.direccion),
  estado: normalize(row.estado || "activo").toLowerCase(),
  deactivated_at: row.deactivated_at ?? null,
  deactivated_by: nullableText(row.deactivated_by),
  deactivation_reason: nullableText(row.deactivation_reason),
  content_version: Math.trunc(toNumber(row.content_version)),
});

const editableSnapshot = (row: ReturnType<typeof snapshot>) => ({
  nombre: row.nombre,
  cuit: row.cuit,
  telefono: row.telefono,
  email: row.email,
  direccion: row.direccion,
});

const assertEditable = (row: any, expectedContentVersion: number) => {
  if (!row) throw new AppError("Proveedor no encontrado", 404);
  if (normalize(row.estado || "activo").toLowerCase() !== "activo") {
    throw new AppError("El proveedor está inactivo. Reactivalo antes de editarlo", 409);
  }
  if (Math.trunc(toNumber(row.content_version)) !== expectedContentVersion) {
    throw new AppError(
      "El proveedor cambió mientras estaba abierto. Actualizá la pantalla e intentá nuevamente",
      409
    );
  }
};

const handleSqlite = async (input: ProviderContentInput) => {
  const validated = validateInput(input);
  const { default: db } = await import("../db.js");

  return db.transaction(() => {
    const current = db.prepare("SELECT * FROM proveedores WHERE id = ? LIMIT 1").get(input.providerId) as any;
    assertEditable(current, input.expectedContentVersion);

    const before = snapshot(current);
    const nextVersion = input.expectedContentVersion + 1;
    const after = snapshot({
      ...current,
      nombre: validated.nombre,
      cuit: validated.cuit,
      telefono: validated.telefono,
      email: validated.email,
      direccion: validated.direccion,
      content_version: nextVersion,
    });

    if (JSON.stringify(editableSnapshot(before)) === JSON.stringify(editableSnapshot(after))) {
      throw new AppError("No se detectaron cambios para guardar", 409);
    }

    db.prepare(`
      INSERT INTO provider_content_history (
        provider_id, version, reason, changed_by, before_snapshot, after_snapshot
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      input.providerId,
      nextVersion,
      validated.reason,
      validated.user,
      JSON.stringify(before),
      JSON.stringify(after)
    );

    const result = db.prepare(`
      UPDATE proveedores
      SET nombre = ?, cuit = ?, telefono = ?, email = ?, direccion = ?,
          content_version = ?, content_changed_at = CURRENT_TIMESTAMP,
          content_changed_by = ?, content_change_reason = ?
      WHERE id = ? AND estado = 'activo' AND content_version = ?
    `).run(
      validated.nombre,
      validated.cuit,
      validated.telefono,
      validated.email,
      validated.direccion,
      nextVersion,
      validated.user,
      validated.reason,
      input.providerId,
      input.expectedContentVersion
    );

    if (toNumber(result.changes) !== 1) {
      throw new AppError("El proveedor cambió mientras estaba abierto. Actualizá la pantalla e intentá nuevamente", 409);
    }

    return db.prepare("SELECT * FROM proveedores WHERE id = ? LIMIT 1").get(input.providerId);
  })();
};

const handlePostgres = async (input: ProviderContentInput) => {
  const validated = validateInput(input);
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const currentResult = await client.query(
      "SELECT * FROM proveedores WHERE id = $1 LIMIT 1 FOR UPDATE",
      [input.providerId]
    );
    const current = currentResult.rows[0];
    assertEditable(current, input.expectedContentVersion);

    const before = snapshot(current);
    const nextVersion = input.expectedContentVersion + 1;
    const after = snapshot({
      ...current,
      nombre: validated.nombre,
      cuit: validated.cuit,
      telefono: validated.telefono,
      email: validated.email,
      direccion: validated.direccion,
      content_version: nextVersion,
    });

    if (JSON.stringify(editableSnapshot(before)) === JSON.stringify(editableSnapshot(after))) {
      throw new AppError("No se detectaron cambios para guardar", 409);
    }

    await client.query(
      `INSERT INTO provider_content_history (
         provider_id, version, reason, changed_by, before_snapshot, after_snapshot
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
      [
        input.providerId,
        nextVersion,
        validated.reason,
        validated.user,
        JSON.stringify(before),
        JSON.stringify(after),
      ]
    );

    const updated = await client.query(
      `UPDATE proveedores
       SET nombre = $1, cuit = $2, telefono = $3, email = $4, direccion = $5,
           content_version = $6, content_changed_at = now(), content_changed_by = $7,
           content_change_reason = $8
       WHERE id = $9 AND estado = 'activo' AND content_version = $10
       RETURNING *`,
      [
        validated.nombre,
        validated.cuit,
        validated.telefono,
        validated.email,
        validated.direccion,
        nextVersion,
        validated.user,
        validated.reason,
        input.providerId,
        input.expectedContentVersion,
      ]
    );

    if (!updated.rowCount) {
      throw new AppError("El proveedor cambió mientras estaba abierto. Actualizá la pantalla e intentá nuevamente", 409);
    }

    await client.query("COMMIT");
    return updated.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export const providerContentLifecycleService = {
  update(input: ProviderContentInput) {
    return isPostgresConfigured() ? handlePostgres(input) : handleSqlite(input);
  },
};
