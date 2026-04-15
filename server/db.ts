import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from 'url';
import bcrypt from "bcryptjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("database.db");
db.pragma("foreign_keys = ON");

// Initialize database schema
export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS proveedores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      cuit TEXT,
      telefono TEXT,
      email TEXT,
      direccion TEXT,
      estado TEXT DEFAULT 'activo'
    );

    CREATE TABLE IF NOT EXISTS product_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      estado TEXT DEFAULT 'activo'
    );

    CREATE TABLE IF NOT EXISTS product_families (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      category_id INTEGER,
      estado TEXT DEFAULT 'activo',
      FOREIGN KEY (category_id) REFERENCES product_categories(id)
    );

    CREATE TABLE IF NOT EXISTS payment_methods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      tipo TEXT NOT NULL DEFAULT 'Efectivo',
      activo INTEGER DEFAULT 1
    );

    INSERT OR IGNORE INTO payment_methods (name, tipo) VALUES ('Efectivo', 'Efectivo');
    INSERT OR IGNORE INTO payment_methods (name, tipo) VALUES ('Transferencia', 'Transferencia');
    INSERT OR IGNORE INTO payment_methods (name, tipo) VALUES ('Mercado Pago', 'Digital');
    INSERT OR IGNORE INTO payment_methods (name, tipo) VALUES ('Cta Cte', 'Crédito');
    INSERT OR IGNORE INTO payment_methods (name, tipo) VALUES ('Cheque', 'Digital');

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT,
      codigo_unico TEXT UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      cost REAL NOT NULL,
      sale_price REAL NOT NULL,
      stock INTEGER DEFAULT 0,
      stock_minimo INTEGER DEFAULT 0,
      company TEXT CHECK(company IN ('Edu', 'Peti')) NOT NULL,
      family_id INTEGER,
      category_id INTEGER,
      estado TEXT DEFAULT 'activo',
      eliminado INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (family_id) REFERENCES product_families(id),
      FOREIGN KEY (category_id) REFERENCES product_categories(id)
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'empleado',
      avatar TEXT,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_permissions (
      user_id INTEGER NOT NULL,
      module TEXT NOT NULL,
      can_view INTEGER DEFAULT 0,
      can_create INTEGER DEFAULT 0,
      can_edit INTEGER DEFAULT 0,
      can_delete INTEGER DEFAULT 0,
      PRIMARY KEY (user_id, module),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS clientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre_apellido TEXT NOT NULL,
      razon_social TEXT,
      cuit TEXT,
      telefono TEXT,
      email TEXT,
      direccion TEXT,
      localidad TEXT,
      provincia TEXT,
      latitud REAL,
      longitud REAL,
      observaciones TEXT,
      tipo_cliente TEXT CHECK(tipo_cliente IN ('minorista', 'mayorista')) NOT NULL,
      lista_precio TEXT DEFAULT 'lista1',
      limite_credito REAL DEFAULT 0,
      saldo_cta_cte REAL DEFAULT 0,
      fecha_alta DATETIME DEFAULT CURRENT_TIMESTAMP,
      activo INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      total REAL NOT NULL,
      cliente_id INTEGER NOT NULL,
      nombre_cliente TEXT NOT NULL,
      metodo_pago TEXT NOT NULL,
      monto_pagado REAL DEFAULT 0,
      monto_pendiente REAL DEFAULT 0,
      numero_venta INTEGER,
      costo_total REAL DEFAULT 0,
      ganancia REAL DEFAULT 0,
      estado TEXT DEFAULT 'Pagada',
      fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (cliente_id) REFERENCES clientes(id)
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      cantidad INTEGER NOT NULL,
      precio_venta REAL NOT NULL,
      costo_total_peps REAL NOT NULL,
      FOREIGN KEY (sale_id) REFERENCES sales(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS supplier_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero_pedido INTEGER,
      cliente TEXT NOT NULL,
      cliente_id INTEGER,
      sale_id INTEGER,
      fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
      estado TEXT DEFAULT 'pendiente',
      notes TEXT,
      stock_actualizado INTEGER DEFAULT 0,
      FOREIGN KEY (cliente_id) REFERENCES clientes(id),
      FOREIGN KEY (sale_id) REFERENCES sales(id)
    );

    CREATE TABLE IF NOT EXISTS supplier_order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      cantidad INTEGER NOT NULL,
      FOREIGN KEY (order_id) REFERENCES supplier_orders(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS checklist_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      type TEXT CHECK(type IN ('Apertura', 'Cierre', 'Ruta', 'General')) NOT NULL DEFAULT 'General',
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS checklist_template_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL,
      task_name TEXT NOT NULL,
      FOREIGN KEY (template_id) REFERENCES checklist_templates(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS checklists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      status TEXT DEFAULT 'pendiente',
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      FOREIGN KEY (template_id) REFERENCES checklist_templates(id)
    );

    CREATE TABLE IF NOT EXISTS checklist_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      checklist_id INTEGER NOT NULL,
      task_name TEXT NOT NULL,
      completed INTEGER DEFAULT 0,
      completed_at DATETIME,
      completed_by TEXT,
      FOREIGN KEY (checklist_id) REFERENCES checklists(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      date TEXT NOT NULL,
      status TEXT DEFAULT 'pendiente',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS route_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NOT NULL,
      client_id INTEGER NOT NULL,
      order_index INTEGER NOT NULL,
      visitado INTEGER DEFAULT 0,
      venta_registrada INTEGER DEFAULT 0,
      pedido_generado INTEGER DEFAULT 0,
      cobranza_realizada INTEGER DEFAULT 0,
      FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE CASCADE,
      FOREIGN KEY (client_id) REFERENCES clientes(id)
    );

    CREATE TABLE IF NOT EXISTS movimientos_financieros (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo TEXT NOT NULL, -- 'ingreso' or 'egreso'
      origen TEXT NOT NULL,
      descripcion TEXT,
      categoria TEXT,
      forma_pago TEXT,
      monto REAL NOT NULL,
      fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
      usuario TEXT,
      numero_pago INTEGER,
      cheque_id INTEGER,
      cliente_id INTEGER,
      venta_id INTEGER,
      FOREIGN KEY (cliente_id) REFERENCES clientes(id),
      FOREIGN KEY (venta_id) REFERENCES sales(id)
    );

    CREATE TABLE IF NOT EXISTS cheques (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero_cheque TEXT,
      banco TEXT,
      importe REAL NOT NULL,
      fecha_vencimiento TEXT,
      estado TEXT DEFAULT 'en_cartera',
      cliente_id INTEGER,
      venta_id INTEGER,
      proveedor_id INTEGER,
      fecha_entrega TEXT,
      observaciones TEXT,
      FOREIGN KEY (cliente_id) REFERENCES clientes(id),
      FOREIGN KEY (venta_id) REFERENCES sales(id),
      FOREIGN KEY (proveedor_id) REFERENCES proveedores(id)
    );

    CREATE TABLE IF NOT EXISTS stock_movimientos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      cantidad INTEGER NOT NULL,
      costo_unitario REAL,
      cantidad_restante INTEGER,
      descripcion TEXT,
      tipo_movimiento TEXT NOT NULL, -- 'ingreso' or 'egreso'
      motivo TEXT,
      usuario TEXT,
      fecha_ingreso DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS purchase_invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proveedor_id INTEGER NOT NULL,
      numero_factura TEXT,
      total REAL NOT NULL,
      fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
      metodo_pago TEXT,
      FOREIGN KEY (proveedor_id) REFERENCES proveedores(id)
    );

    CREATE TABLE IF NOT EXISTS purchase_invoice_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      cantidad INTEGER NOT NULL,
      costo_unitario REAL NOT NULL,
      cantidad_restante INTEGER NOT NULL,
      FOREIGN KEY (invoice_id) REFERENCES purchase_invoices(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS price_update_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario TEXT,
      alcance TEXT,
      tipo_cambio TEXT,
      valor REAL,
      productos_afectados INTEGER,
      fecha DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Bootstrap initial admin user
  const adminExists = db.prepare("SELECT * FROM users WHERE email = 'admin@edugestion.com'").get();
  if (!adminExists) {
    const hashedPassword = bcrypt.hashSync("admin123", 10);
    db.prepare("INSERT INTO users (name, email, password, role, avatar) VALUES (?, ?, ?, ?, ?)").run(
      "Administrador",
      "admin@edugestion.com",
      hashedPassword,
      "administrador",
      "AD"
    );
  }

  // Bootstrap initial "Consumidor Final" client
  const clientExists = db.prepare("SELECT * FROM clientes WHERE id = 1").get();
  if (!clientExists) {
    db.prepare(`
      INSERT INTO clientes (id, nombre_apellido, razon_social, localidad, tipo_cliente)
      VALUES (1, 'Consumidor Final', 'Consumidor Final', 'Local', 'minorista')
    `).run();
  }

  // Bootstrap initial "Proveedor General" provider
  const providerExists = db.prepare("SELECT * FROM proveedores WHERE id = 1").get();
  if (!providerExists) {
    db.prepare(`
      INSERT INTO proveedores (id, nombre)
      VALUES (1, 'Proveedor General')
    `).run();
  }

  // Migrations
  try { db.exec("ALTER TABLE sales ADD COLUMN costo_total REAL DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE sales ADD COLUMN ganancia REAL DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE sales ADD COLUMN estado TEXT DEFAULT 'Pagada'"); } catch (e) {}
  try { db.exec("ALTER TABLE checklist_items RENAME COLUMN user_id TO completed_by"); } catch (e) {}
  
  // Clientes migrations
  try { db.exec("ALTER TABLE clientes ADD COLUMN razon_social TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE clientes ADD COLUMN cuit TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE clientes ADD COLUMN provincia TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE clientes ADD COLUMN lista_precio TEXT DEFAULT 'lista1'"); } catch (e) {}
  try { db.exec("ALTER TABLE clientes ADD COLUMN limite_credito REAL DEFAULT 0"); } catch (e) {}
  
  // Sales migrations
  try { db.exec("ALTER TABLE sales ADD COLUMN notes TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE sales ADD COLUMN usuario TEXT"); } catch (e) {}
  
  return db;
}

export default db;
