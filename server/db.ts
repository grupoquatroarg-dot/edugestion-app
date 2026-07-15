import Database from "better-sqlite3";
import path from "path";
import bcrypt from "bcryptjs";

const isServerlessRuntime = Boolean(
  process.env.VERCEL ||
  process.env.AWS_LAMBDA_FUNCTION_NAME ||
  process.env.LAMBDA_TASK_ROOT
);

const sqliteTarget = isServerlessRuntime
  ? ":memory:"
  : path.resolve(process.cwd(), "database.db");

const db = new Database(sqliteTarget);
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
      codigo_postal TEXT,
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
      customer_order_id INTEGER,
      cancelled_at DATETIME,
      cancelled_by TEXT,
      cancel_reason TEXT,
      cancellation_source TEXT,
      cancelled_from_status TEXT,
      FOREIGN KEY (cliente_id) REFERENCES clientes(id),
      FOREIGN KEY (sale_id) REFERENCES sales(id)
    );

    CREATE TABLE IF NOT EXISTS supplier_order_cancellations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_order_id INTEGER NOT NULL UNIQUE,
      motivo TEXT NOT NULL,
      cancelado_por TEXT NOT NULL,
      cancelado_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      estado_original TEXT NOT NULL,
      cancellation_source TEXT NOT NULL DEFAULT 'manual',
      snapshot TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (supplier_order_id) REFERENCES supplier_orders(id)
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
      tipo TEXT NOT NULL,
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
      purchase_invoice_id INTEGER,
      purchase_invoice_cancellation_id INTEGER,
      FOREIGN KEY (cliente_id) REFERENCES clientes(id),
      FOREIGN KEY (venta_id) REFERENCES sales(id),
      FOREIGN KEY (purchase_invoice_id) REFERENCES purchase_invoices(id)
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
      purchase_invoice_id INTEGER,
      fecha_entrega TEXT,
      observaciones TEXT,
      FOREIGN KEY (cliente_id) REFERENCES clientes(id),
      FOREIGN KEY (venta_id) REFERENCES sales(id),
      FOREIGN KEY (proveedor_id) REFERENCES proveedores(id),
      FOREIGN KEY (purchase_invoice_id) REFERENCES purchase_invoices(id)
    );

    CREATE TABLE IF NOT EXISTS stock_movimientos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      cantidad INTEGER NOT NULL,
      costo_unitario REAL,
      cantidad_restante INTEGER,
      descripcion TEXT,
      tipo_movimiento TEXT NOT NULL,
      motivo TEXT,
      usuario TEXT,
      purchase_invoice_id INTEGER,
      purchase_invoice_item_id INTEGER,
      fecha_ingreso DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (purchase_invoice_id) REFERENCES purchase_invoices(id),
      FOREIGN KEY (purchase_invoice_item_id) REFERENCES purchase_invoice_items(id)
    );

    CREATE TABLE IF NOT EXISTS purchase_invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proveedor_id INTEGER NOT NULL,
      numero_factura TEXT,
      total REAL NOT NULL,
      fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
      metodo_pago TEXT,
      estado_pago TEXT,
      monto_pagado REAL DEFAULT 0,
      fecha_pago DATETIME,
      metodo_pago_real TEXT,
      estado TEXT NOT NULL DEFAULT 'Activa',
      reversion_version INTEGER NOT NULL DEFAULT 0,
      anulada_at DATETIME,
      anulada_por TEXT,
      anulacion_motivo TEXT,
      FOREIGN KEY (proveedor_id) REFERENCES proveedores(id)
    );

    CREATE TABLE IF NOT EXISTS purchase_invoice_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      cantidad INTEGER NOT NULL,
      costo_unitario REAL NOT NULL,
      cantidad_restante INTEGER NOT NULL,
      previous_product_cost REAL,
      product_was_created INTEGER NOT NULL DEFAULT 0,
      stock_movement_id INTEGER,
      FOREIGN KEY (invoice_id) REFERENCES purchase_invoices(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (stock_movement_id) REFERENCES stock_movimientos(id)
    );

    CREATE TABLE IF NOT EXISTS purchase_invoice_payment_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_invoice_id INTEGER NOT NULL,
      movimiento_financiero_id INTEGER NOT NULL,
      monto REAL NOT NULL,
      allocation_type TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (purchase_invoice_id, movimiento_financiero_id),
      FOREIGN KEY (purchase_invoice_id) REFERENCES purchase_invoices(id) ON DELETE CASCADE,
      FOREIGN KEY (movimiento_financiero_id) REFERENCES movimientos_financieros(id)
    );

    CREATE TABLE IF NOT EXISTS purchase_invoice_cancellations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_invoice_id INTEGER NOT NULL UNIQUE,
      motivo TEXT NOT NULL,
      anulada_por TEXT NOT NULL,
      anulada_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      estado_original TEXT,
      estado_pago_original TEXT,
      total_original REAL NOT NULL,
      monto_pagado_original REAL NOT NULL,
      snapshot TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (purchase_invoice_id) REFERENCES purchase_invoices(id)
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

  const clientExists = db.prepare("SELECT * FROM clientes WHERE id = 1").get();
  if (!clientExists) {
    db.prepare(`
      INSERT INTO clientes (id, nombre_apellido, razon_social, localidad, tipo_cliente)
      VALUES (1, 'Consumidor Final', 'Consumidor Final', 'Local', 'minorista')
    `).run();
  }

  const providerExists = db.prepare("SELECT * FROM proveedores WHERE id = 1").get();
  if (!providerExists) {
    db.prepare(`
      INSERT INTO proveedores (id, nombre)
      VALUES (1, 'Proveedor General')
    `).run();
  }

  try { db.exec("ALTER TABLE purchase_invoices ADD COLUMN estado_pago TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE purchase_invoices ADD COLUMN monto_pagado REAL DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE purchase_invoices ADD COLUMN fecha_pago DATETIME"); } catch (e) {}
  try { db.exec("ALTER TABLE purchase_invoices ADD COLUMN metodo_pago_real TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE purchase_invoices ADD COLUMN estado TEXT NOT NULL DEFAULT 'Activa'"); } catch (e) {}
  try { db.exec("ALTER TABLE purchase_invoices ADD COLUMN reversion_version INTEGER NOT NULL DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE purchase_invoices ADD COLUMN anulada_at DATETIME"); } catch (e) {}
  try { db.exec("ALTER TABLE purchase_invoices ADD COLUMN anulada_por TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE purchase_invoices ADD COLUMN anulacion_motivo TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE purchase_invoice_items ADD COLUMN previous_product_cost REAL"); } catch (e) {}
  try { db.exec("ALTER TABLE purchase_invoice_items ADD COLUMN product_was_created INTEGER NOT NULL DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE purchase_invoice_items ADD COLUMN stock_movement_id INTEGER"); } catch (e) {}
  try { db.exec("ALTER TABLE stock_movimientos ADD COLUMN purchase_invoice_id INTEGER"); } catch (e) {}
  try { db.exec("ALTER TABLE stock_movimientos ADD COLUMN purchase_invoice_item_id INTEGER"); } catch (e) {}
  try { db.exec("ALTER TABLE movimientos_financieros ADD COLUMN purchase_invoice_id INTEGER"); } catch (e) {}
  try { db.exec("ALTER TABLE movimientos_financieros ADD COLUMN purchase_invoice_cancellation_id INTEGER"); } catch (e) {}
  try { db.exec("ALTER TABLE cheques ADD COLUMN purchase_invoice_id INTEGER"); } catch (e) {}

  try { db.exec("ALTER TABLE supplier_orders ADD COLUMN customer_order_id INTEGER"); } catch (e) {}
  try { db.exec("ALTER TABLE supplier_orders ADD COLUMN cancelled_at DATETIME"); } catch (e) {}
  try { db.exec("ALTER TABLE supplier_orders ADD COLUMN cancelled_by TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE supplier_orders ADD COLUMN cancel_reason TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE supplier_orders ADD COLUMN cancellation_source TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE supplier_orders ADD COLUMN cancelled_from_status TEXT"); } catch (e) {}

  try { db.exec("ALTER TABLE sales ADD COLUMN costo_total REAL DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE sales ADD COLUMN ganancia REAL DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE sales ADD COLUMN estado TEXT DEFAULT 'Pagada'"); } catch (e) {}
  try { db.exec("ALTER TABLE checklist_items RENAME COLUMN user_id TO completed_by"); } catch (e) {}

  try { db.exec("ALTER TABLE clientes ADD COLUMN razon_social TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE clientes ADD COLUMN cuit TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE clientes ADD COLUMN provincia TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE clientes ADD COLUMN codigo_postal TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE clientes ADD COLUMN lista_precio TEXT DEFAULT 'lista1'"); } catch (e) {}
  try { db.exec("ALTER TABLE clientes ADD COLUMN limite_credito REAL DEFAULT 0"); } catch (e) {}

  try { db.exec("ALTER TABLE sales ADD COLUMN notes TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE sales ADD COLUMN usuario TEXT"); } catch (e) {}

  return db;
}

export default db;
