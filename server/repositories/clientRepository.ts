import db from "../db.js";
import { getPostgresPool, isPostgresConfigured } from "../utils/postgres.js";
import { AppError } from "../utils/response.js";
import bcrypt from "bcryptjs";

export interface Client {
  id?: number;
  nombre_apellido: string;
  razon_social?: string;
  cuit?: string;
  telefono?: string;
  email?: string;
  direccion?: string;
  localidad?: string;
  provincia?: string;
  latitud?: number;
  longitud?: number;
  observaciones?: string;
  tipo_cliente: 'minorista' | 'mayorista';
  lista_precio?: string;
  limite_credito?: number;
  saldo_cta_cte?: number;
  activo?: boolean | number;
  fecha_alta?: string;
  portal_enabled?: boolean | number;
  portal_username?: string | null;
  portal_password?: string | null;
  portal_password_hash?: string | null;
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

const mapClient = (row: any): Client | undefined => {
  if (!row) return undefined;

  return {
    id: toNumber(row.id),
    nombre_apellido: row.nombre_apellido,
    razon_social: row.razon_social ?? undefined,
    cuit: row.cuit ?? undefined,
    telefono: row.telefono ?? undefined,
    email: row.email ?? undefined,
    direccion: row.direccion ?? undefined,
    localidad: row.localidad ?? undefined,
    provincia: row.provincia ?? undefined,
    latitud: row.latitud === null || row.latitud === undefined ? undefined : Number(row.latitud),
    longitud: row.longitud === null || row.longitud === undefined ? undefined : Number(row.longitud),
    observaciones: row.observaciones ?? undefined,
    tipo_cliente: row.tipo_cliente,
    lista_precio: row.lista_precio ?? 'lista1',
    limite_credito: toNumber(row.limite_credito),
    saldo_cta_cte: toNumber(row.saldo_cta_cte),
    fecha_alta: row.fecha_alta,
    activo: toNumber(row.activo, 1),
    portal_enabled: toNumber(row.portal_enabled, 0),
    portal_username: row.portal_username ?? null,
  };
};

const normalizeClient = (client: Client) => ({
  nombre_apellido: client.nombre_apellido,
  razon_social: toNullableText(client.razon_social),
  cuit: toNullableText(client.cuit),
  telefono: toNullableText(client.telefono),
  email: toNullableText(client.email),
  direccion: toNullableText(client.direccion),
  localidad: toNullableText(client.localidad),
  provincia: toNullableText(client.provincia),
  latitud: client.latitud === undefined || client.latitud === null ? null : Number(client.latitud),
  longitud: client.longitud === undefined || client.longitud === null ? null : Number(client.longitud),
  observaciones: toNullableText(client.observaciones),
  tipo_cliente: client.tipo_cliente,
  lista_precio: client.lista_precio || 'lista1',
  limite_credito: toNumber(client.limite_credito),
  portal_enabled: client.portal_enabled === true || client.portal_enabled === 1 || String(client.portal_enabled) === '1' ? 1 : 0,
  portal_username: toNullableText(client.portal_username),
  portal_password: toNullableText(client.portal_password),
});

export const clientRepository = {
  async findAll(): Promise<Client[]> {
    if (!isPostgresConfigured()) {
      return db.prepare("SELECT * FROM clientes ORDER BY nombre_apellido ASC").all() as Client[];
    }

    const pool = getPostgresPool();
    const result = await pool.query("SELECT * FROM clientes ORDER BY nombre_apellido ASC");
    return result.rows.map((row) => mapClient(row)!).filter(Boolean);
  },

  async findById(id: number | string): Promise<Client | undefined> {
    if (!isPostgresConfigured()) {
      return db.prepare("SELECT * FROM clientes WHERE id = ?").get(id) as Client | undefined;
    }

    const pool = getPostgresPool();
    const result = await pool.query("SELECT * FROM clientes WHERE id = $1 LIMIT 1", [Number(id)]);
    return mapClient(result.rows[0]);
  },

  async create(client: Client): Promise<number> {
    const normalized = normalizeClient(client);

    if (!isPostgresConfigured()) {
      const info = db.prepare(`
        INSERT INTO clientes (
          nombre_apellido, razon_social, cuit, telefono, email,
          direccion, localidad, provincia, latitud, longitud,
          observaciones, tipo_cliente, lista_precio, limite_credito, portal_enabled, portal_username, portal_password_hash
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        normalized.nombre_apellido,
        normalized.razon_social,
        normalized.cuit,
        normalized.telefono,
        normalized.email,
        normalized.direccion,
        normalized.localidad,
        normalized.provincia,
        normalized.latitud,
        normalized.longitud,
        normalized.observaciones,
        normalized.tipo_cliente,
        normalized.lista_precio,
        normalized.limite_credito,
        normalized.portal_enabled,
        normalized.portal_username,
        normalized.portal_password ? bcrypt.hashSync(normalized.portal_password, 10) : null,
      );

      return Number(info.lastInsertRowid);
    }

    const pool = getPostgresPool();
    const result = await pool.query(
      `INSERT INTO clientes (
        nombre_apellido, razon_social, cuit, telefono, email,
        direccion, localidad, provincia, latitud, longitud,
        observaciones, tipo_cliente, lista_precio, limite_credito, portal_enabled, portal_username, portal_password_hash
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      RETURNING id`,
      [
        normalized.nombre_apellido,
        normalized.razon_social,
        normalized.cuit,
        normalized.telefono,
        normalized.email,
        normalized.direccion,
        normalized.localidad,
        normalized.provincia,
        normalized.latitud,
        normalized.longitud,
        normalized.observaciones,
        normalized.tipo_cliente,
        normalized.lista_precio,
        normalized.limite_credito,
        normalized.portal_enabled,
        normalized.portal_username,
        normalized.portal_password ? bcrypt.hashSync(normalized.portal_password, 10) : null,
      ],
    );

    return toNumber(result.rows[0]?.id);
  },

  async update(id: number | string, client: Client): Promise<void> {
    const normalized = normalizeClient(client);

    if (!isPostgresConfigured()) {
      if (normalized.portal_password) {
        db.prepare(`
          UPDATE clientes
          SET nombre_apellido = ?, razon_social = ?, cuit = ?, telefono = ?, email = ?,
              direccion = ?, localidad = ?, provincia = ?, latitud = ?, longitud = ?,
              observaciones = ?, tipo_cliente = ?, lista_precio = ?, limite_credito = ?,
              portal_enabled = ?, portal_username = ?, portal_password_hash = ?
          WHERE id = ?
        `).run(
          normalized.nombre_apellido,
          normalized.razon_social,
          normalized.cuit,
          normalized.telefono,
          normalized.email,
          normalized.direccion,
          normalized.localidad,
          normalized.provincia,
          normalized.latitud,
          normalized.longitud,
          normalized.observaciones,
          normalized.tipo_cliente,
          normalized.lista_precio,
          normalized.limite_credito,
          normalized.portal_enabled,
          normalized.portal_username,
          bcrypt.hashSync(normalized.portal_password, 10),
          id,
        );
      } else {
        db.prepare(`
          UPDATE clientes
          SET nombre_apellido = ?, razon_social = ?, cuit = ?, telefono = ?, email = ?,
              direccion = ?, localidad = ?, provincia = ?, latitud = ?, longitud = ?,
              observaciones = ?, tipo_cliente = ?, lista_precio = ?, limite_credito = ?,
              portal_enabled = ?, portal_username = ?
          WHERE id = ?
        `).run(
          normalized.nombre_apellido,
          normalized.razon_social,
          normalized.cuit,
          normalized.telefono,
          normalized.email,
          normalized.direccion,
          normalized.localidad,
          normalized.provincia,
          normalized.latitud,
          normalized.longitud,
          normalized.observaciones,
          normalized.tipo_cliente,
          normalized.lista_precio,
          normalized.limite_credito,
          normalized.portal_enabled,
          normalized.portal_username,
          id,
        );
      }
      return;
    }

    const pool = getPostgresPool();

    if (normalized.portal_password) {
      await pool.query(
        `UPDATE clientes
         SET nombre_apellido = $1,
             razon_social = $2,
             cuit = $3,
             telefono = $4,
             email = $5,
             direccion = $6,
             localidad = $7,
             provincia = $8,
             latitud = $9,
             longitud = $10,
             observaciones = $11,
             tipo_cliente = $12,
             lista_precio = $13,
             limite_credito = $14,
             portal_enabled = $15,
             portal_username = $16,
             portal_password_hash = $17
         WHERE id = $18`,
        [
          normalized.nombre_apellido,
          normalized.razon_social,
          normalized.cuit,
          normalized.telefono,
          normalized.email,
          normalized.direccion,
          normalized.localidad,
          normalized.provincia,
          normalized.latitud,
          normalized.longitud,
          normalized.observaciones,
          normalized.tipo_cliente,
          normalized.lista_precio,
          normalized.limite_credito,
          normalized.portal_enabled,
          normalized.portal_username,
          bcrypt.hashSync(normalized.portal_password, 10),
          Number(id),
        ],
      );
      return;
    }

    await pool.query(
      `UPDATE clientes
       SET nombre_apellido = $1,
           razon_social = $2,
           cuit = $3,
           telefono = $4,
           email = $5,
           direccion = $6,
           localidad = $7,
           provincia = $8,
           latitud = $9,
           longitud = $10,
           observaciones = $11,
           tipo_cliente = $12,
           lista_precio = $13,
           limite_credito = $14,
           portal_enabled = $15,
           portal_username = $16
       WHERE id = $17`,
      [
        normalized.nombre_apellido,
        normalized.razon_social,
        normalized.cuit,
        normalized.telefono,
        normalized.email,
        normalized.direccion,
        normalized.localidad,
        normalized.provincia,
        normalized.latitud,
        normalized.longitud,
        normalized.observaciones,
        normalized.tipo_cliente,
        normalized.lista_precio,
        normalized.limite_credito,
        normalized.portal_enabled,
        normalized.portal_username,
        Number(id),
      ],
    );
  },

  async delete(id: number | string): Promise<void> {
    if (!isPostgresConfigured()) {
      db.prepare("DELETE FROM clientes WHERE id = ?").run(id);
      return;
    }

    const pool = getPostgresPool();

    try {
      await pool.query("DELETE FROM clientes WHERE id = $1", [Number(id)]);
    } catch (error: any) {
      if (error?.code === '23503') {
        throw new AppError("No se puede eliminar el cliente porque tiene movimientos relacionados.", 400);
      }
      throw error;
    }
  },

  async updateSaldo(id: number | string, nuevoSaldo: number): Promise<void> {
    if (!isPostgresConfigured()) {
      db.prepare("UPDATE clientes SET saldo_cta_cte = ? WHERE id = ?").run(nuevoSaldo, id);
      return;
    }

    const pool = getPostgresPool();
    await pool.query("UPDATE clientes SET saldo_cta_cte = $1 WHERE id = $2", [toNumber(nuevoSaldo), Number(id)]);
  },
};
