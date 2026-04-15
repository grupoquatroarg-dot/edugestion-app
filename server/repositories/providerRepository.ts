import db from "../db.js";

export interface Provider {
  id?: number;
  nombre: string;
  cuit?: string;
  telefono?: string;
  email?: string;
  direccion?: string;
  estado?: string;
}

export const providerRepository = {
  findAll: () => {
    return db.prepare("SELECT * FROM proveedores ORDER BY nombre ASC").all() as Provider[];
  },

  findById: (id: number | string) => {
    return db.prepare("SELECT * FROM proveedores WHERE id = ?").get(id) as Provider | undefined;
  },

  create: (provider: Provider) => {
    const info = db.prepare(`
      INSERT INTO proveedores (nombre, cuit, telefono, email, direccion)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      provider.nombre,
      provider.cuit || null,
      provider.telefono || null,
      provider.email || null,
      provider.direccion || null
    );
    return info.lastInsertRowid as number;
  },

  update: (id: number | string, provider: Provider) => {
    db.prepare(`
      UPDATE proveedores 
      SET nombre = ?, cuit = ?, telefono = ?, email = ?, direccion = ?
      WHERE id = ?
    `).run(
      provider.nombre,
      provider.cuit || null,
      provider.telefono || null,
      provider.email || null,
      provider.direccion || null,
      id
    );
  },

  delete: (id: number | string) => {
    db.prepare("DELETE FROM proveedores WHERE id = ?").run(id);
  }
};
