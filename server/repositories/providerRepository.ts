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
}

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
    estado: row.estado ?? 'activo',
  };
};

const normalizeProvider = (provider: Provider) => ({
  nombre: provider.nombre,
  cuit: toNullableText(provider.cuit),
  telefono: toNullableText(provider.telefono),
  email: toNullableText(provider.email),
  direccion: toNullableText(provider.direccion),
  estado: provider.estado || 'activo',
});

export const providerRepository = {
  async findAll(): Promise<Provider[]> {
    if (!isPostgresConfigured()) {
      return db.prepare("SELECT * FROM proveedores ORDER BY nombre ASC").all() as Provider[];
    }

    const pool = getPostgresPool();
    const result = await pool.query("SELECT * FROM proveedores ORDER BY nombre ASC");
    return result.rows.map((row) => mapProvider(row)!).filter(Boolean);
  },

  async findById(id: number | string): Promise<Provider | undefined> {
    if (!isPostgresConfigured()) {
      return db.prepare("SELECT * FROM proveedores WHERE id = ?").get(id) as Provider | undefined;
    }

    const pool = getPostgresPool();
    const result = await pool.query("SELECT * FROM proveedores WHERE id = $1 LIMIT 1", [Number(id)]);
    return mapProvider(result.rows[0]);
  },

  async create(provider: Provider): Promise<number> {
    const normalized = normalizeProvider(provider);

    if (!isPostgresConfigured()) {
      const info = db.prepare(`
        INSERT INTO proveedores (nombre, cuit, telefono, email, direccion, estado)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        normalized.nombre,
        normalized.cuit,
        normalized.telefono,
        normalized.email,
        normalized.direccion,
        normalized.estado,
      );

      return Number(info.lastInsertRowid);
    }

    const pool = getPostgresPool();
    const result = await pool.query(
      `INSERT INTO proveedores (nombre, cuit, telefono, email, direccion, estado)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        normalized.nombre,
        normalized.cuit,
        normalized.telefono,
        normalized.email,
        normalized.direccion,
        normalized.estado,
      ],
    );

    return toNumber(result.rows[0]?.id);
  },

  async update(id: number | string, provider: Provider): Promise<void> {
    const normalized = normalizeProvider(provider);

    if (!isPostgresConfigured()) {
      db.prepare(`
        UPDATE proveedores
        SET nombre = ?, cuit = ?, telefono = ?, email = ?, direccion = ?, estado = ?
        WHERE id = ?
      `).run(
        normalized.nombre,
        normalized.cuit,
        normalized.telefono,
        normalized.email,
        normalized.direccion,
        normalized.estado,
        id,
      );
      return;
    }

    const pool = getPostgresPool();
    await pool.query(
      `UPDATE proveedores
       SET nombre = $1,
           cuit = $2,
           telefono = $3,
           email = $4,
           direccion = $5,
           estado = $6
       WHERE id = $7`,
      [
        normalized.nombre,
        normalized.cuit,
        normalized.telefono,
        normalized.email,
        normalized.direccion,
        normalized.estado,
        Number(id),
      ],
    );
  },

  async delete(id: number | string): Promise<void> {
    if (!isPostgresConfigured()) {
      db.prepare("DELETE FROM proveedores WHERE id = ?").run(id);
      return;
    }

    const pool = getPostgresPool();

    try {
      await pool.query("DELETE FROM proveedores WHERE id = $1", [Number(id)]);
    } catch (error: any) {
      if (error?.code === '23503') {
        throw new AppError("No se puede eliminar el proveedor porque tiene movimientos relacionados.", 400);
      }
      throw error;
    }
  },
};
