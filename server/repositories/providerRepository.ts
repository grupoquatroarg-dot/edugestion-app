import db from "../db.js";
import { getPostgresPool, isPostgresConfigured } from "../utils/postgres.js";
import { AppError } from "../utils/response.js";

export interface Provider {
  id?: number;
  nombre: string;
  cuit?: string;
  telefono?: string;
  email?: string;
  direccion?: string;
  estado?: string;
  deactivated_at?: string | null;
  deactivated_by?: string | null;
  deactivation_reason?: string | null;
  content_version?: number;
  content_changed_at?: string | null;
  content_changed_by?: string | null;
  content_change_reason?: string | null;
}

type FindAllOptions = {
  activeOnly?: boolean;
};

const toNumber = (value: any, fallback: number = 0) => {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const toNullableText = (value: any) => {
  if (value === undefined || value === null || value === "") return null;
  return String(value);
};

const mapProvider = (row: any): Provider | undefined => {
  if (!row) return undefined;

  return {
    id: toNumber(row.id),
    nombre: row.nombre,
    cuit: row.cuit ?? undefined,
    telefono: row.telefono ?? undefined,
    email: row.email ?? undefined,
    direccion: row.direccion ?? undefined,
    estado: row.estado ?? "activo",
    deactivated_at: row.deactivated_at ?? null,
    deactivated_by: row.deactivated_by ?? null,
    deactivation_reason: row.deactivation_reason ?? null,
    content_version: toNumber(row.content_version),
    content_changed_at: row.content_changed_at ?? null,
    content_changed_by: row.content_changed_by ?? null,
    content_change_reason: row.content_change_reason ?? null,
  };
};

const normalizeProvider = (provider: Provider) => ({
  nombre: String(provider.nombre || "").trim(),
  cuit: toNullableText(provider.cuit),
  telefono: toNullableText(provider.telefono),
  email: toNullableText(provider.email),
  direccion: toNullableText(provider.direccion),
});

export const providerRepository = {
  async findAll(options: FindAllOptions = {}): Promise<Provider[]> {
    if (!isPostgresConfigured()) {
      const sql = options.activeOnly
        ? "SELECT * FROM proveedores WHERE LOWER(COALESCE(estado, 'activo')) = 'activo' ORDER BY nombre ASC"
        : "SELECT * FROM proveedores ORDER BY nombre ASC";
      return (db.prepare(sql).all() as any[]).map((row) => mapProvider(row)!).filter(Boolean);
    }

    const pool = getPostgresPool();
    const result = options.activeOnly
      ? await pool.query(
          "SELECT * FROM proveedores WHERE LOWER(COALESCE(estado, 'activo')) = 'activo' ORDER BY nombre ASC"
        )
      : await pool.query("SELECT * FROM proveedores ORDER BY nombre ASC");
    return result.rows.map((row) => mapProvider(row)!).filter(Boolean);
  },

  async findById(id: number | string): Promise<Provider | undefined> {
    if (!isPostgresConfigured()) {
      return mapProvider(db.prepare("SELECT * FROM proveedores WHERE id = ?").get(id));
    }

    const pool = getPostgresPool();
    const result = await pool.query("SELECT * FROM proveedores WHERE id = $1 LIMIT 1", [Number(id)]);
    return mapProvider(result.rows[0]);
  },

  async create(provider: Provider): Promise<number> {
    const normalized = normalizeProvider(provider);
    if (normalized.nombre.length < 2) {
      throw new AppError("El nombre debe tener al menos 2 caracteres", 400);
    }

    if (!isPostgresConfigured()) {
      const info = db.prepare(`
        INSERT INTO proveedores (nombre, cuit, telefono, email, direccion, estado)
        VALUES (?, ?, ?, ?, ?, 'activo')
      `).run(
        normalized.nombre,
        normalized.cuit,
        normalized.telefono,
        normalized.email,
        normalized.direccion,
      );

      return Number(info.lastInsertRowid);
    }

    const pool = getPostgresPool();
    const result = await pool.query(
      `INSERT INTO proveedores (nombre, cuit, telefono, email, direccion, estado)
       VALUES ($1, $2, $3, $4, $5, 'activo')
       RETURNING id`,
      [
        normalized.nombre,
        normalized.cuit,
        normalized.telefono,
        normalized.email,
        normalized.direccion,
      ],
    );

    return toNumber(result.rows[0]?.id);
  },

  async update(_id: number | string, _provider: Provider): Promise<void> {
    throw new AppError(
      "La actualización directa de proveedores está deshabilitada. Usá el servicio auditado de edición.",
      409
    );
  },

  async delete(_id: number | string): Promise<void> {
    throw new AppError(
      "La eliminación física de proveedores está deshabilitada. Usá Dar de baja para conservar el historial.",
      409
    );
  },
};
