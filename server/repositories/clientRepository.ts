import db from "../db.js";
import { getPostgresPool, isPostgresConfigured } from "../utils/postgres.js";
import { AppError } from "../utils/response.js";

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
          observaciones, tipo_cliente, lista_precio, limite_credito
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      );

      return Number(info.lastInsertRowid);
    }

    const pool = getPostgresPool();
    const result = await pool.query(
      `INSERT INTO clientes (
        nombre_apellido, razon_social, cuit, telefono, email,
        direccion, localidad, provincia, latitud, longitud,
        observaciones, tipo_cliente, lista_precio, limite_credito
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
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
      ],
    );

    return toNumber(result.rows[0]?.id);
  },

  async update(id: number | string, client: Client): Promise<void> {
    const normalized = normalizeClient(client);

    if (!isPostgresConfigured()) {
      db.prepare(`
        UPDATE clientes
        SET nombre_apellido = ?, razon_social = ?, cuit = ?, telefono = ?, email = ?,
            direccion = ?, localidad = ?, provincia = ?, latitud = ?, longitud = ?,
            observaciones = ?, tipo_cliente = ?, lista_precio = ?, limite_credito = ?
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
        id,
      );
      return;
    }

    const pool = getPostgresPool();
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
           limite_credito = $14
       WHERE id = $15`,
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
