import db from "../db.js";

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
  activo?: boolean;
}

export const clientRepository = {
  findAll: () => {
    return db.prepare("SELECT * FROM clientes ORDER BY nombre_apellido ASC").all() as Client[];
  },

  findById: (id: number | string) => {
    return db.prepare("SELECT * FROM clientes WHERE id = ?").get(id) as Client | undefined;
  },

  create: (client: Client) => {
    const info = db.prepare(`
      INSERT INTO clientes (
        nombre_apellido, razon_social, cuit, telefono, email, 
        direccion, localidad, provincia, latitud, longitud, 
        observaciones, tipo_cliente, lista_precio, limite_credito
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      client.nombre_apellido,
      client.razon_social || null,
      client.cuit || null,
      client.telefono || null,
      client.email || null,
      client.direccion || null,
      client.localidad || null,
      client.provincia || null,
      client.latitud || null,
      client.longitud || null,
      client.observaciones || null,
      client.tipo_cliente,
      client.lista_precio || 'lista1',
      client.limite_credito || 0
    );
    return info.lastInsertRowid as number;
  },

  update: (id: number | string, client: Client) => {
    db.prepare(`
      UPDATE clientes 
      SET nombre_apellido = ?, razon_social = ?, cuit = ?, telefono = ?, email = ?, 
          direccion = ?, localidad = ?, provincia = ?, latitud = ?, longitud = ?,
          observaciones = ?, tipo_cliente = ?, lista_precio = ?, limite_credito = ?
      WHERE id = ?
    `).run(
      client.nombre_apellido,
      client.razon_social || null,
      client.cuit || null,
      client.telefono || null,
      client.email || null,
      client.direccion || null,
      client.localidad || null,
      client.provincia || null,
      client.latitud || null,
      client.longitud || null,
      client.observaciones || null,
      client.tipo_cliente,
      client.lista_precio || 'lista1',
      client.limite_credito || 0,
      id
    );
  },

  delete: (id: number | string) => {
    db.prepare("DELETE FROM clientes WHERE id = ?").run(id);
  },

  updateSaldo: (id: number | string, nuevoSaldo: number) => {
    db.prepare("UPDATE clientes SET saldo_cta_cte = ? WHERE id = ?").run(nuevoSaldo, id);
  }
};
