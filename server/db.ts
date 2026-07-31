import { createRequire } from "node:module";
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

const require = createRequire(import.meta.url);
let sqliteDb: any = null;

const getSqliteDb = () => {
  if (sqliteDb) return sqliteDb;

  // better-sqlite3 es una dependencia nativa y solo debe cargarse cuando el
  // servidor local realmente usa SQLite. Las funciones Vercel trabajan con
  // PostgreSQL y deben poder importarse sin inicializar este binario.
  const DatabaseModule = require("better-sqlite3");
  const Database = DatabaseModule.default || DatabaseModule;
  sqliteDb = new Database(sqliteTarget);
  sqliteDb.pragma("foreign_keys = ON");
  return sqliteDb;
};

const db = new Proxy({} as any, {
  get(_target, property) {
    const instance = getSqliteDb();
    const value = instance[property];
    return typeof value === "function" ? value.bind(instance) : value;
  },
  set(_target, property, value) {
    const instance = getSqliteDb();
    instance[property] = value;
    return true;
  },
});

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
      estado TEXT DEFAULT 'activo',
      deactivated_at DATETIME,
      deactivated_by TEXT,
      deactivation_reason TEXT
    );

    CREATE TABLE IF NOT EXISTS provider_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      reason TEXT NOT NULL,
      performed_by TEXT NOT NULL,
      performed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      previous_status TEXT NOT NULL,
      new_status TEXT NOT NULL,
      snapshot TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (provider_id) REFERENCES proveedores(id)
    );

    CREATE TABLE IF NOT EXISTS product_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      estado TEXT DEFAULT 'activo',
      deactivated_at DATETIME,
      deactivated_by TEXT,
      deactivation_reason TEXT,
      content_version INTEGER NOT NULL DEFAULT 0 CHECK(content_version >= 0),
      content_changed_at DATETIME,
      content_changed_by TEXT,
      content_change_reason TEXT
    );

    CREATE TABLE IF NOT EXISTS product_families (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      category_id INTEGER,
      estado TEXT DEFAULT 'activo',
      deactivated_at DATETIME,
      deactivated_by TEXT,
      deactivation_reason TEXT,
      content_version INTEGER NOT NULL DEFAULT 0 CHECK(content_version >= 0),
      content_changed_at DATETIME,
      content_changed_by TEXT,
      content_change_reason TEXT,
      FOREIGN KEY (category_id) REFERENCES product_categories(id)
    );

    CREATE TABLE IF NOT EXISTS payment_methods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      tipo TEXT NOT NULL DEFAULT 'Efectivo',
      activo INTEGER DEFAULT 1,
      deactivated_at DATETIME,
      deactivated_by TEXT,
      deactivation_reason TEXT,
      content_version INTEGER NOT NULL DEFAULT 0 CHECK(content_version >= 0),
      content_changed_at DATETIME,
      content_changed_by TEXT,
      content_change_reason TEXT
    );

    CREATE TABLE IF NOT EXISTS configuration_item_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_type TEXT NOT NULL,
      item_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      reason TEXT NOT NULL,
      performed_by TEXT NOT NULL,
      performed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      previous_status TEXT NOT NULL,
      new_status TEXT NOT NULL,
      snapshot TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS configuration_item_content_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_type TEXT NOT NULL CHECK(item_type IN ('payment_method', 'product_category', 'product_family')),
      item_id INTEGER NOT NULL,
      version INTEGER NOT NULL CHECK(version > 0),
      reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),
      changed_by TEXT NOT NULL,
      changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      before_snapshot TEXT NOT NULL DEFAULT '{}',
      after_snapshot TEXT NOT NULL DEFAULT '{}',
      UNIQUE (item_type, item_id, version)
    );

    CREATE INDEX IF NOT EXISTS idx_configuration_item_content_history_item
      ON configuration_item_content_history (item_type, item_id, changed_at DESC);

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
      deactivated_at DATETIME,
      deactivated_by TEXT,
      deactivation_reason TEXT,
      content_version INTEGER NOT NULL DEFAULT 0 CHECK(content_version >= 0),
      content_changed_at DATETIME,
      content_changed_by TEXT,
      content_change_reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (family_id) REFERENCES product_families(id),
      FOREIGN KEY (category_id) REFERENCES product_categories(id)
    );

    CREATE TABLE IF NOT EXISTS product_content_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      version INTEGER NOT NULL CHECK(version > 0),
      reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),
      changed_by TEXT NOT NULL,
      changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      before_snapshot TEXT NOT NULL DEFAULT '{}',
      after_snapshot TEXT NOT NULL DEFAULT '{}',
      UNIQUE (product_id, version),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE INDEX IF NOT EXISTS idx_product_content_history_product
      ON product_content_history (product_id, changed_at DESC);

    CREATE TABLE IF NOT EXISTS product_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      reason TEXT NOT NULL,
      performed_by TEXT NOT NULL,
      performed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      previous_status TEXT NOT NULL,
      new_status TEXT NOT NULL,
      snapshot TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'empleado',
      avatar TEXT,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      session_version INTEGER NOT NULL DEFAULT 1,
      permissions_version INTEGER NOT NULL DEFAULT 0,
      permissions_changed_at DATETIME,
      permissions_changed_by TEXT,
      permissions_change_reason TEXT,
      deactivated_at DATETIME,
      deactivated_by TEXT,
      deactivation_reason TEXT
    );

    CREATE TABLE IF NOT EXISTS user_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      reason TEXT NOT NULL,
      performed_by_user_id INTEGER,
      performed_by TEXT NOT NULL,
      performed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      previous_status TEXT NOT NULL,
      new_status TEXT NOT NULL,
      snapshot TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (performed_by_user_id) REFERENCES users(id)
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


    CREATE TABLE IF NOT EXISTS user_permission_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      version INTEGER NOT NULL,
      reason TEXT NOT NULL,
      changed_by_user_id INTEGER,
      changed_by TEXT NOT NULL,
      changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      permissions_before_snapshot TEXT NOT NULL DEFAULT '[]',
      permissions_after_snapshot TEXT NOT NULL DEFAULT '[]',
      UNIQUE (user_id, version),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (changed_by_user_id) REFERENCES users(id)
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
      activo INTEGER DEFAULT 1,
      portal_enabled INTEGER DEFAULT 0,
      portal_username TEXT,
      portal_password_hash TEXT,
      deactivated_at DATETIME,
      deactivated_by TEXT,
      deactivation_reason TEXT,
      content_version INTEGER NOT NULL DEFAULT 0 CHECK(content_version >= 0),
      content_changed_at DATETIME,
      content_changed_by TEXT,
      content_change_reason TEXT CHECK(content_change_reason IS NULL OR length(trim(content_change_reason)) BETWEEN 3 AND 500)
    );

    CREATE TABLE IF NOT EXISTS customer_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      reason TEXT NOT NULL,
      performed_by TEXT NOT NULL,
      performed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      previous_status TEXT NOT NULL,
      new_status TEXT NOT NULL,
      snapshot TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (customer_id) REFERENCES clientes(id)
    );

    CREATE TABLE IF NOT EXISTS customer_content_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      version INTEGER NOT NULL CHECK(version > 0),
      reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),
      changed_by TEXT NOT NULL,
      changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      before_snapshot TEXT NOT NULL DEFAULT '{}',
      after_snapshot TEXT NOT NULL DEFAULT '{}',
      UNIQUE (customer_id, version),
      FOREIGN KEY (customer_id) REFERENCES clientes(id)
    );

    CREATE INDEX IF NOT EXISTS idx_customer_content_history_customer
      ON customer_content_history (customer_id, changed_at DESC);

    CREATE INDEX IF NOT EXISTS idx_clientes_content_changed_at
      ON clientes (content_changed_at DESC);

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

    CREATE TABLE IF NOT EXISTS sale_stock_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      purchase_invoice_item_id INTEGER,
      stock_movement_id INTEGER NOT NULL,
      source_type TEXT NOT NULL,
      cantidad REAL NOT NULL,
      costo_unitario REAL NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (sale_id) REFERENCES sales(id),
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (purchase_invoice_item_id) REFERENCES purchase_invoice_items(id),
      FOREIGN KEY (stock_movement_id) REFERENCES stock_movimientos(id)
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
      delivery_version INTEGER NOT NULL DEFAULT 0,
      delivered_at DATETIME,
      delivered_by TEXT,
      delivered_from_status TEXT,
      delivery_reverted_at DATETIME,
      delivery_reverted_by TEXT,
      delivery_revert_reason TEXT,
      status_version INTEGER NOT NULL DEFAULT 0,
      status_changed_at DATETIME,
      status_changed_by TEXT,
      status_changed_from TEXT,
      status_last_action TEXT,
      status_last_reason TEXT,
      content_version INTEGER NOT NULL DEFAULT 0 CHECK(content_version >= 0),
      content_changed_at DATETIME,
      content_changed_by TEXT,
      content_change_reason TEXT,
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

    CREATE TABLE IF NOT EXISTS supplier_order_deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_order_id INTEGER NOT NULL,
      delivery_mode TEXT NOT NULL CHECK(delivery_mode IN ('stock_only', 'linked_sale', 'created_sale')),
      previous_status TEXT NOT NULL,
      sale_id_before INTEGER,
      sale_id_after INTEGER,
      customer_order_id INTEGER,
      delivered_by TEXT NOT NULL,
      delivered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      reverted_at DATETIME,
      reverted_by TEXT,
      revert_reason TEXT,
      snapshot TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (supplier_order_id) REFERENCES supplier_orders(id),
      FOREIGN KEY (sale_id_before) REFERENCES sales(id),
      FOREIGN KEY (sale_id_after) REFERENCES sales(id),
      FOREIGN KEY (customer_order_id) REFERENCES customer_orders(id)
    );

    CREATE TABLE IF NOT EXISTS supplier_order_delivery_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      delivery_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity REAL NOT NULL CHECK(quantity > 0),
      unit_cost REAL NOT NULL DEFAULT 0,
      ingress_movement_id INTEGER NOT NULL UNIQUE,
      egress_movement_id INTEGER UNIQUE,
      FOREIGN KEY (delivery_id) REFERENCES supplier_order_deliveries(id),
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (ingress_movement_id) REFERENCES stock_movimientos(id),
      FOREIGN KEY (egress_movement_id) REFERENCES stock_movimientos(id)
    );

    CREATE TABLE IF NOT EXISTS supplier_order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      cantidad INTEGER NOT NULL,
      FOREIGN KEY (order_id) REFERENCES supplier_orders(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS supplier_order_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_order_id INTEGER NOT NULL,
      version INTEGER NOT NULL CHECK(version > 0),
      action TEXT NOT NULL CHECK(action IN ('advance', 'reopen')),
      from_status TEXT NOT NULL CHECK(from_status IN ('pendiente', 'pedido_realizado', 'auditar_pedido')),
      to_status TEXT NOT NULL CHECK(to_status IN ('pendiente', 'pedido_realizado', 'auditar_pedido')),
      reason TEXT,
      changed_by TEXT NOT NULL,
      changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      snapshot TEXT NOT NULL DEFAULT '{}',
      CHECK (
        (action = 'advance' AND reason IS NULL AND (
          (from_status = 'pendiente' AND to_status = 'pedido_realizado') OR
          (from_status = 'pedido_realizado' AND to_status = 'auditar_pedido')
        )) OR
        (action = 'reopen' AND reason IS NOT NULL AND length(trim(reason)) BETWEEN 3 AND 500 AND (
          (from_status = 'pedido_realizado' AND to_status = 'pendiente') OR
          (from_status = 'auditar_pedido' AND to_status = 'pedido_realizado')
        ))
      ),
      UNIQUE (supplier_order_id, version),
      FOREIGN KEY (supplier_order_id) REFERENCES supplier_orders(id)
    );

    CREATE INDEX IF NOT EXISTS idx_supplier_order_status_history_order
      ON supplier_order_status_history (supplier_order_id, changed_at DESC);

    CREATE TABLE IF NOT EXISTS supplier_order_content_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_order_id INTEGER NOT NULL,
      version INTEGER NOT NULL CHECK(version > 0),
      status_at_change TEXT NOT NULL CHECK(status_at_change = 'auditar_pedido'),
      reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),
      changed_by TEXT NOT NULL,
      changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      before_snapshot TEXT NOT NULL DEFAULT '{}',
      after_snapshot TEXT NOT NULL DEFAULT '{}',
      UNIQUE (supplier_order_id, version),
      FOREIGN KEY (supplier_order_id) REFERENCES supplier_orders(id)
    );

    CREATE INDEX IF NOT EXISTS idx_supplier_order_content_history_order
      ON supplier_order_content_history (supplier_order_id, changed_at DESC);

    CREATE TABLE IF NOT EXISTS checklist_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      type TEXT CHECK(type IN ('Apertura', 'Cierre', 'Ruta', 'General')) NOT NULL DEFAULT 'General',
      active INTEGER DEFAULT 1,
      deactivated_at DATETIME,
      deactivated_by TEXT,
      deactivation_reason TEXT,
      reactivated_at DATETIME,
      reactivated_by TEXT,
      reactivation_reason TEXT,
      content_version INTEGER NOT NULL DEFAULT 0,
      content_changed_at DATETIME,
      content_changed_by TEXT,
      content_change_reason TEXT CHECK(content_change_reason IS NULL OR length(trim(content_change_reason)) BETWEEN 3 AND 500),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS checklist_template_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('deactivate', 'reactivate')),
      reason TEXT NOT NULL,
      performed_by TEXT NOT NULL,
      performed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      previous_status TEXT NOT NULL,
      new_status TEXT NOT NULL,
      snapshot TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (template_id) REFERENCES checklist_templates(id)
    );

    CREATE TABLE IF NOT EXISTS checklist_template_content_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL,
      version INTEGER NOT NULL CHECK(version > 0),
      status_at_change TEXT NOT NULL CHECK(status_at_change = 'activa'),
      reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),
      changed_by TEXT NOT NULL,
      changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      template_before_snapshot TEXT NOT NULL DEFAULT '{}',
      items_before_snapshot TEXT NOT NULL DEFAULT '[]',
      template_after_snapshot TEXT NOT NULL DEFAULT '{}',
      items_after_snapshot TEXT NOT NULL DEFAULT '[]',
      UNIQUE (template_id, version),
      FOREIGN KEY (template_id) REFERENCES checklist_templates(id)
    );

    CREATE INDEX IF NOT EXISTS idx_checklist_template_content_history_template
      ON checklist_template_content_history (template_id, changed_at DESC);

    CREATE INDEX IF NOT EXISTS idx_checklist_templates_content_changed_at
      ON checklist_templates (content_changed_at DESC);

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
      completed_by TEXT,
      lifecycle_version INTEGER NOT NULL DEFAULT 1,
      cancelled_at DATETIME,
      cancelled_by TEXT,
      cancel_reason TEXT,
      cancelled_from_status TEXT,
      reopened_at DATETIME,
      reopened_by TEXT,
      reopen_reason TEXT,
      FOREIGN KEY (template_id) REFERENCES checklist_templates(id)
    );

    CREATE TABLE IF NOT EXISTS checklist_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      checklist_id INTEGER NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('finalize', 'cancel', 'reopen')),
      reason TEXT NOT NULL,
      performed_by TEXT NOT NULL,
      performed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      previous_status TEXT NOT NULL,
      new_status TEXT NOT NULL,
      snapshot TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (checklist_id) REFERENCES checklists(id)
    );

    CREATE INDEX IF NOT EXISTS idx_checklist_status_history_checklist
      ON checklist_status_history (checklist_id, performed_at DESC, id DESC);

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
      finalization_version INTEGER NOT NULL DEFAULT 0,
      finalized_at DATETIME,
      finalized_by TEXT,
      finalization_reason TEXT,
      finalized_from_status TEXT,
      cancelled_at DATETIME,
      cancelled_by TEXT,
      cancel_reason TEXT,
      cancelled_from_status TEXT,
      reopened_at DATETIME,
      reopened_by TEXT,
      reopen_reason TEXT,
      operational_version INTEGER NOT NULL DEFAULT 0 CHECK(operational_version >= 0),
      operational_last_action TEXT CHECK(operational_last_action IS NULL OR operational_last_action IN ('start', 'reopen')),
      operational_changed_at DATETIME,
      operational_changed_by TEXT,
      operational_reason TEXT,
      operational_from_status TEXT CHECK(operational_from_status IS NULL OR operational_from_status IN ('planificada', 'pendiente')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS route_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('finalize', 'cancel', 'reopen')),
      reason TEXT NOT NULL,
      performed_by TEXT NOT NULL,
      performed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      previous_status TEXT NOT NULL,
      new_status TEXT NOT NULL,
      snapshot TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (route_id) REFERENCES routes(id)
    );

    CREATE TABLE IF NOT EXISTS route_operational_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NOT NULL,
      version INTEGER NOT NULL CHECK(version > 0),
      action TEXT NOT NULL CHECK(action IN ('start', 'reopen')),
      reason TEXT NOT NULL,
      performed_by TEXT NOT NULL,
      performed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      previous_status TEXT NOT NULL,
      new_status TEXT NOT NULL,
      snapshot TEXT NOT NULL DEFAULT '{}',
      UNIQUE(route_id, version),
      FOREIGN KEY (route_id) REFERENCES routes(id)
    );

    CREATE INDEX IF NOT EXISTS idx_route_operational_history_route
      ON route_operational_status_history (route_id, performed_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS route_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NOT NULL,
      client_id INTEGER NOT NULL,
      order_index INTEGER NOT NULL,
      visitado INTEGER DEFAULT 0,
      venta_registrada INTEGER DEFAULT 0,
      pedido_generado INTEGER DEFAULT 0,
      cobranza_realizada INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pendiente',
      notes TEXT,
      visited_at DATETIME,
      lifecycle_version INTEGER NOT NULL DEFAULT 0 CHECK(lifecycle_version >= 0),
      status_changed_at DATETIME,
      status_changed_by TEXT,
      status_changed_from TEXT,
      status_last_action TEXT CHECK(status_last_action IS NULL OR status_last_action IN ('visit', 'omit', 'reopen')),
      status_last_reason TEXT,
      FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE CASCADE,
      FOREIGN KEY (client_id) REFERENCES clientes(id)
    );

    CREATE TABLE IF NOT EXISTS route_item_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_item_id INTEGER NOT NULL,
      route_id INTEGER NOT NULL,
      version INTEGER NOT NULL CHECK(version > 0),
      action TEXT NOT NULL CHECK(action IN ('visit', 'omit', 'reopen')),
      from_status TEXT NOT NULL,
      to_status TEXT NOT NULL,
      reason TEXT,
      changed_by TEXT NOT NULL,
      changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      snapshot TEXT NOT NULL DEFAULT '{}',
      UNIQUE(route_item_id, version),
      FOREIGN KEY (route_item_id) REFERENCES route_items(id),
      FOREIGN KEY (route_id) REFERENCES routes(id)
    );

    CREATE INDEX IF NOT EXISTS idx_route_item_status_history_item
      ON route_item_status_history (route_item_id, changed_at DESC, id DESC);

    CREATE INDEX IF NOT EXISTS idx_route_item_status_history_route
      ON route_item_status_history (route_id, changed_at DESC, id DESC);

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
      estado TEXT NOT NULL DEFAULT 'Activo',
      reversion_version INTEGER NOT NULL DEFAULT 0,
      anulada_at TEXT,
      anulada_por TEXT,
      anulacion_motivo TEXT,
      reversed_movement_id INTEGER,
      financial_movement_cancellation_id INTEGER,
      client_payment_cancellation_id INTEGER,
      supplier_payment_cancellation_id INTEGER,
      route_item_id INTEGER,
      FOREIGN KEY (cliente_id) REFERENCES clientes(id),
      FOREIGN KEY (venta_id) REFERENCES sales(id),
      FOREIGN KEY (purchase_invoice_id) REFERENCES purchase_invoices(id)
    );

    CREATE TABLE IF NOT EXISTS financial_movement_cancellations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      movimiento_financiero_id INTEGER NOT NULL UNIQUE,
      motivo TEXT NOT NULL,
      anulada_por TEXT NOT NULL,
      anulada_at TEXT DEFAULT CURRENT_TIMESTAMP,
      estado_original TEXT,
      cheque_estado_original TEXT,
      snapshot TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (movimiento_financiero_id) REFERENCES movimientos_financieros(id)
    );

    CREATE TABLE IF NOT EXISTS client_payment_cancellations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      movimiento_financiero_id INTEGER NOT NULL UNIQUE,
      reversal_movement_id INTEGER,
      cliente_id INTEGER NOT NULL,
      motivo TEXT NOT NULL,
      anulada_por TEXT NOT NULL,
      anulada_at TEXT DEFAULT CURRENT_TIMESTAMP,
      monto_original REAL NOT NULL,
      saldo_cliente_original REAL NOT NULL,
      snapshot TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (movimiento_financiero_id) REFERENCES movimientos_financieros(id),
      FOREIGN KEY (reversal_movement_id) REFERENCES movimientos_financieros(id),
      FOREIGN KEY (cliente_id) REFERENCES clientes(id)
    );

    CREATE TABLE IF NOT EXISTS sale_payment_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      movimiento_financiero_id INTEGER NOT NULL,
      monto REAL NOT NULL,
      allocation_type TEXT NOT NULL,
      estado TEXT NOT NULL DEFAULT 'Activo',
      anulada_at TEXT,
      anulada_por TEXT,
      anulacion_motivo TEXT,
      client_payment_cancellation_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (sale_id, movimiento_financiero_id),
      FOREIGN KEY (sale_id) REFERENCES sales(id),
      FOREIGN KEY (movimiento_financiero_id) REFERENCES movimientos_financieros(id),
      FOREIGN KEY (client_payment_cancellation_id) REFERENCES client_payment_cancellations(id)
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
      estado_actualizado_at TEXT,
      estado_actualizado_por TEXT,
      ultimo_cambio_estado_id INTEGER,
      financial_movement_id INTEGER,
      FOREIGN KEY (cliente_id) REFERENCES clientes(id),
      FOREIGN KEY (venta_id) REFERENCES sales(id),
      FOREIGN KEY (proveedor_id) REFERENCES proveedores(id),
      FOREIGN KEY (purchase_invoice_id) REFERENCES purchase_invoices(id),
      FOREIGN KEY (financial_movement_id) REFERENCES movimientos_financieros(id)
    );

    CREATE TABLE IF NOT EXISTS cheque_status_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cheque_id INTEGER NOT NULL,
      estado_anterior TEXT NOT NULL,
      estado_nuevo TEXT NOT NULL,
      motivo TEXT NOT NULL,
      cambiado_por TEXT NOT NULL,
      cambiado_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      origen TEXT NOT NULL DEFAULT 'manual',
      financial_movement_id INTEGER,
      revertido_at TEXT,
      revertido_por TEXT,
      reversion_motivo TEXT,
      reversal_movement_id INTEGER,
      snapshot TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (cheque_id) REFERENCES cheques(id),
      FOREIGN KEY (financial_movement_id) REFERENCES movimientos_financieros(id),
      FOREIGN KEY (reversal_movement_id) REFERENCES movimientos_financieros(id)
    );

    CREATE TABLE IF NOT EXISTS cheque_rejection_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cheque_status_change_id INTEGER NOT NULL,
      cheque_id INTEGER NOT NULL,
      sale_payment_allocation_id INTEGER NOT NULL,
      sale_id INTEGER NOT NULL,
      monto REAL NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      reverted_at TEXT,
      reverted_by TEXT,
      reversion_reason TEXT,
      UNIQUE (cheque_status_change_id, sale_payment_allocation_id),
      FOREIGN KEY (cheque_status_change_id) REFERENCES cheque_status_changes(id),
      FOREIGN KEY (cheque_id) REFERENCES cheques(id),
      FOREIGN KEY (sale_payment_allocation_id) REFERENCES sale_payment_allocations(id),
      FOREIGN KEY (sale_id) REFERENCES sales(id)
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
      sale_id INTEGER,
      purchase_invoice_id INTEGER,
      purchase_invoice_item_id INTEGER,
      supplier_order_id INTEGER,
      reversed_movement_id INTEGER,
      reversion_version INTEGER NOT NULL DEFAULT 0,
      anulada_at TEXT,
      anulada_por TEXT,
      anulacion_motivo TEXT,
      fecha_ingreso DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (sale_id) REFERENCES sales(id),
      FOREIGN KEY (purchase_invoice_id) REFERENCES purchase_invoices(id),
      FOREIGN KEY (purchase_invoice_item_id) REFERENCES purchase_invoice_items(id),
      FOREIGN KEY (supplier_order_id) REFERENCES supplier_orders(id),
      FOREIGN KEY (reversed_movement_id) REFERENCES stock_movimientos(id)
    );

    CREATE TABLE IF NOT EXISTS stock_movement_cancellations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stock_movement_id INTEGER NOT NULL UNIQUE,
      reversal_movement_id INTEGER NOT NULL UNIQUE,
      product_id INTEGER NOT NULL,
      motivo TEXT NOT NULL,
      anulada_por TEXT NOT NULL,
      anulada_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      stock_before REAL NOT NULL,
      stock_after REAL NOT NULL,
      original_type TEXT NOT NULL,
      original_reason TEXT,
      quantity REAL NOT NULL,
      snapshot TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (stock_movement_id) REFERENCES stock_movimientos(id),
      FOREIGN KEY (reversal_movement_id) REFERENCES stock_movimientos(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
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
      estado TEXT NOT NULL DEFAULT 'Activo',
      anulada_at TEXT,
      anulada_por TEXT,
      anulacion_motivo TEXT,
      supplier_payment_cancellation_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (purchase_invoice_id, movimiento_financiero_id),
      FOREIGN KEY (purchase_invoice_id) REFERENCES purchase_invoices(id) ON DELETE CASCADE,
      FOREIGN KEY (movimiento_financiero_id) REFERENCES movimientos_financieros(id),
      FOREIGN KEY (supplier_payment_cancellation_id) REFERENCES supplier_payment_cancellations(id)
    );

    CREATE TABLE IF NOT EXISTS supplier_payment_cancellations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      movimiento_financiero_id INTEGER NOT NULL UNIQUE,
      reversal_movement_id INTEGER,
      purchase_invoice_id INTEGER NOT NULL,
      motivo TEXT NOT NULL,
      anulada_por TEXT NOT NULL,
      anulada_at TEXT DEFAULT CURRENT_TIMESTAMP,
      monto_original REAL NOT NULL,
      monto_pagado_original REAL NOT NULL,
      estado_pago_original TEXT,
      cheque_id INTEGER,
      cheque_estado_original TEXT,
      snapshot TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (movimiento_financiero_id) REFERENCES movimientos_financieros(id),
      FOREIGN KEY (reversal_movement_id) REFERENCES movimientos_financieros(id),
      FOREIGN KEY (purchase_invoice_id) REFERENCES purchase_invoices(id),
      FOREIGN KEY (cheque_id) REFERENCES cheques(id)
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
      fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
      reversion_version INTEGER NOT NULL DEFAULT 0,
      reverted_at TEXT,
      reverted_by TEXT,
      revert_reason TEXT,
      reverted_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS price_update_history_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      price_update_history_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      previous_cost REAL NOT NULL,
      previous_sale_price REAL NOT NULL,
      new_cost REAL NOT NULL,
      new_sale_price REAL NOT NULL,
      reverted_at TEXT,
      UNIQUE (price_update_history_id, product_id),
      FOREIGN KEY (price_update_history_id) REFERENCES price_update_history(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE INDEX IF NOT EXISTS idx_price_update_items_history
      ON price_update_history_items (price_update_history_id, product_id);
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

  try { db.exec("ALTER TABLE price_update_history ADD COLUMN reversion_version INTEGER NOT NULL DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE price_update_history ADD COLUMN reverted_at TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE price_update_history ADD COLUMN reverted_by TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE price_update_history ADD COLUMN revert_reason TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE price_update_history ADD COLUMN reverted_count INTEGER NOT NULL DEFAULT 0"); } catch (e) {}

  try { db.exec("ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1"); } catch (e) {}
  try { db.exec("ALTER TABLE users ADD COLUMN permissions_version INTEGER NOT NULL DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE users ADD COLUMN permissions_changed_at DATETIME"); } catch (e) {}
  try { db.exec("ALTER TABLE users ADD COLUMN permissions_changed_by TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE users ADD COLUMN permissions_change_reason TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE users ADD COLUMN deactivated_at DATETIME"); } catch (e) {}
  try { db.exec("ALTER TABLE users ADD COLUMN deactivated_by TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE users ADD COLUMN deactivation_reason TEXT"); } catch (e) {}
  try { db.exec("UPDATE users SET session_version = 1 WHERE session_version IS NULL OR session_version < 1"); } catch (e) {}

  try { db.exec("ALTER TABLE payment_methods ADD COLUMN deactivated_at DATETIME"); } catch (e) {}
  try { db.exec("ALTER TABLE payment_methods ADD COLUMN deactivated_by TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE payment_methods ADD COLUMN deactivation_reason TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE payment_methods ADD COLUMN content_version INTEGER NOT NULL DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE payment_methods ADD COLUMN content_changed_at DATETIME"); } catch (e) {}
  try { db.exec("ALTER TABLE payment_methods ADD COLUMN content_changed_by TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE payment_methods ADD COLUMN content_change_reason TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE product_categories ADD COLUMN content_version INTEGER NOT NULL DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE product_categories ADD COLUMN content_changed_at DATETIME"); } catch (e) {}
  try { db.exec("ALTER TABLE product_categories ADD COLUMN content_changed_by TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE product_categories ADD COLUMN content_change_reason TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE product_families ADD COLUMN content_version INTEGER NOT NULL DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE product_families ADD COLUMN content_changed_at DATETIME"); } catch (e) {}
  try { db.exec("ALTER TABLE product_families ADD COLUMN content_changed_by TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE product_families ADD COLUMN content_change_reason TEXT"); } catch (e) {}
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS configuration_item_content_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_type TEXT NOT NULL CHECK(item_type IN ('payment_method', 'product_category', 'product_family')),
        item_id INTEGER NOT NULL,
        version INTEGER NOT NULL CHECK(version > 0),
        reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),
        changed_by TEXT NOT NULL,
        changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        before_snapshot TEXT NOT NULL DEFAULT '{}',
        after_snapshot TEXT NOT NULL DEFAULT '{}',
        UNIQUE (item_type, item_id, version)
      );
      CREATE INDEX IF NOT EXISTS idx_configuration_item_content_history_item
        ON configuration_item_content_history (item_type, item_id, changed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_payment_methods_content_changed_at
        ON payment_methods (content_changed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_product_categories_content_changed_at
        ON product_categories (content_changed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_product_families_content_changed_at
        ON product_families (content_changed_at DESC);
    `);
  } catch (e) {}
  try { db.exec("ALTER TABLE product_categories ADD COLUMN deactivated_at DATETIME"); } catch (e) {}
  try { db.exec("ALTER TABLE product_categories ADD COLUMN deactivated_by TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE product_categories ADD COLUMN deactivation_reason TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE product_families ADD COLUMN deactivated_at DATETIME"); } catch (e) {}
  try { db.exec("ALTER TABLE product_families ADD COLUMN deactivated_by TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE product_families ADD COLUMN deactivation_reason TEXT"); } catch (e) {}

  try { db.exec("ALTER TABLE proveedores ADD COLUMN deactivated_at DATETIME"); } catch (e) {}
  try { db.exec("ALTER TABLE proveedores ADD COLUMN deactivated_by TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE proveedores ADD COLUMN deactivation_reason TEXT"); } catch (e) {}

  try { db.exec("ALTER TABLE products ADD COLUMN deactivated_at DATETIME"); } catch (e) {}
  try { db.exec("ALTER TABLE products ADD COLUMN deactivated_by TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE products ADD COLUMN deactivation_reason TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE products ADD COLUMN content_version INTEGER NOT NULL DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE products ADD COLUMN content_changed_at DATETIME"); } catch (e) {}
  try { db.exec("ALTER TABLE products ADD COLUMN content_changed_by TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE products ADD COLUMN content_change_reason TEXT"); } catch (e) {}
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS product_content_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        version INTEGER NOT NULL CHECK(version > 0),
        reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),
        changed_by TEXT NOT NULL,
        changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        before_snapshot TEXT NOT NULL DEFAULT '{}',
        after_snapshot TEXT NOT NULL DEFAULT '{}',
        UNIQUE (product_id, version),
        FOREIGN KEY (product_id) REFERENCES products(id)
      );
      CREATE INDEX IF NOT EXISTS idx_product_content_history_product
        ON product_content_history (product_id, changed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_products_content_changed_at
        ON products (content_changed_at DESC);
    `);
  } catch (e) {}

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
  try { db.exec("ALTER TABLE stock_movimientos ADD COLUMN sale_id INTEGER"); } catch (e) {}
  try { db.exec("ALTER TABLE stock_movimientos ADD COLUMN purchase_invoice_id INTEGER"); } catch (e) {}
  try { db.exec("ALTER TABLE stock_movimientos ADD COLUMN purchase_invoice_item_id INTEGER"); } catch (e) {}
  try { db.exec("ALTER TABLE stock_movimientos ADD COLUMN reversed_movement_id INTEGER"); } catch (e) {}
  try { db.exec("ALTER TABLE stock_movimientos ADD COLUMN reversion_version INTEGER NOT NULL DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE stock_movimientos ADD COLUMN anulada_at TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE stock_movimientos ADD COLUMN anulada_por TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE stock_movimientos ADD COLUMN anulacion_motivo TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE movimientos_financieros ADD COLUMN purchase_invoice_id INTEGER"); } catch (e) {}
  try { db.exec("ALTER TABLE movimientos_financieros ADD COLUMN purchase_invoice_cancellation_id INTEGER"); } catch (e) {}
  try { db.exec("ALTER TABLE movimientos_financieros ADD COLUMN estado TEXT NOT NULL DEFAULT 'Activo'"); } catch (e) {}
  try { db.exec("ALTER TABLE movimientos_financieros ADD COLUMN reversion_version INTEGER NOT NULL DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE movimientos_financieros ADD COLUMN anulada_at TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE movimientos_financieros ADD COLUMN anulada_por TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE movimientos_financieros ADD COLUMN anulacion_motivo TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE movimientos_financieros ADD COLUMN reversed_movement_id INTEGER"); } catch (e) {}
  try { db.exec("ALTER TABLE movimientos_financieros ADD COLUMN financial_movement_cancellation_id INTEGER"); } catch (e) {}
  try { db.exec("ALTER TABLE movimientos_financieros ADD COLUMN client_payment_cancellation_id INTEGER"); } catch (e) {}
  try { db.exec("ALTER TABLE movimientos_financieros ADD COLUMN supplier_payment_cancellation_id INTEGER"); } catch (e) {}
  try { db.exec("ALTER TABLE movimientos_financieros ADD COLUMN route_item_id INTEGER"); } catch (e) {}
  try { db.exec("ALTER TABLE sale_payment_allocations ADD COLUMN estado TEXT NOT NULL DEFAULT 'Activo'"); } catch (e) {}
  try { db.exec("ALTER TABLE sale_payment_allocations ADD COLUMN anulada_at TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE sale_payment_allocations ADD COLUMN anulada_por TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE sale_payment_allocations ADD COLUMN anulacion_motivo TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE sale_payment_allocations ADD COLUMN client_payment_cancellation_id INTEGER"); } catch (e) {}
  try { db.exec("ALTER TABLE purchase_invoice_payment_allocations ADD COLUMN estado TEXT NOT NULL DEFAULT 'Activo'"); } catch (e) {}
  try { db.exec("ALTER TABLE purchase_invoice_payment_allocations ADD COLUMN anulada_at TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE purchase_invoice_payment_allocations ADD COLUMN anulada_por TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE purchase_invoice_payment_allocations ADD COLUMN anulacion_motivo TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE purchase_invoice_payment_allocations ADD COLUMN supplier_payment_cancellation_id INTEGER"); } catch (e) {}
  try { db.exec("ALTER TABLE cheques ADD COLUMN purchase_invoice_id INTEGER"); } catch (e) {}
  try { db.exec("ALTER TABLE cheques ADD COLUMN estado_actualizado_at TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE cheques ADD COLUMN estado_actualizado_por TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE cheques ADD COLUMN ultimo_cambio_estado_id INTEGER"); } catch (e) {}
  try { db.exec("ALTER TABLE cheques ADD COLUMN financial_movement_id INTEGER"); } catch (e) {}

  try { db.exec("ALTER TABLE supplier_orders ADD COLUMN customer_order_id INTEGER"); } catch (e) {}
  try { db.exec("ALTER TABLE supplier_orders ADD COLUMN cancelled_at DATETIME"); } catch (e) {}
  try { db.exec("ALTER TABLE supplier_orders ADD COLUMN cancelled_by TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE supplier_orders ADD COLUMN cancel_reason TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE supplier_orders ADD COLUMN cancellation_source TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE supplier_orders ADD COLUMN cancelled_from_status TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE supplier_orders ADD COLUMN delivery_version INTEGER NOT NULL DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE supplier_orders ADD COLUMN delivered_at DATETIME"); } catch (e) {}
  try { db.exec("ALTER TABLE supplier_orders ADD COLUMN delivered_by TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE supplier_orders ADD COLUMN delivered_from_status TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE supplier_orders ADD COLUMN delivery_reverted_at DATETIME"); } catch (e) {}
  try { db.exec("ALTER TABLE supplier_orders ADD COLUMN delivery_reverted_by TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE supplier_orders ADD COLUMN delivery_revert_reason TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE supplier_orders ADD COLUMN status_version INTEGER NOT NULL DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE supplier_orders ADD COLUMN status_changed_at DATETIME"); } catch (e) {}
  try { db.exec("ALTER TABLE supplier_orders ADD COLUMN status_changed_by TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE supplier_orders ADD COLUMN status_changed_from TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE supplier_orders ADD COLUMN status_last_action TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE supplier_orders ADD COLUMN status_last_reason TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE supplier_orders ADD COLUMN content_version INTEGER NOT NULL DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE supplier_orders ADD COLUMN content_changed_at DATETIME"); } catch (e) {}
  try { db.exec("ALTER TABLE supplier_orders ADD COLUMN content_changed_by TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE supplier_orders ADD COLUMN content_change_reason TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE stock_movimientos ADD COLUMN supplier_order_id INTEGER"); } catch (e) {}

  try { db.exec("ALTER TABLE sales ADD COLUMN costo_total REAL DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE sales ADD COLUMN ganancia REAL DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE sales ADD COLUMN estado TEXT DEFAULT 'Pagada'"); } catch (e) {}
  try { db.exec("ALTER TABLE checklist_items RENAME COLUMN user_id TO completed_by"); } catch (e) {}
  try { db.exec("ALTER TABLE checklists ADD COLUMN lifecycle_version INTEGER NOT NULL DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE checklists ADD COLUMN completed_by TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE checklists ADD COLUMN cancelled_at DATETIME"); } catch (e) {}
  try { db.exec("ALTER TABLE checklists ADD COLUMN cancelled_by TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE checklists ADD COLUMN cancel_reason TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE checklists ADD COLUMN cancelled_from_status TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE checklists ADD COLUMN reopened_at DATETIME"); } catch (e) {}
  try { db.exec("ALTER TABLE checklists ADD COLUMN reopened_by TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE checklists ADD COLUMN reopen_reason TEXT"); } catch (e) {}
  try { db.exec("UPDATE checklists SET lifecycle_version = 1 WHERE lower(COALESCE(status, 'pendiente')) = 'pendiente' AND lifecycle_version = 0"); } catch (e) {}
  try { db.exec("ALTER TABLE checklist_templates ADD COLUMN deactivated_at DATETIME"); } catch (e) {}
  try { db.exec("ALTER TABLE checklist_templates ADD COLUMN deactivated_by TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE checklist_templates ADD COLUMN deactivation_reason TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE checklist_templates ADD COLUMN reactivated_at DATETIME"); } catch (e) {}
  try { db.exec("ALTER TABLE checklist_templates ADD COLUMN reactivated_by TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE checklist_templates ADD COLUMN reactivation_reason TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE checklist_templates ADD COLUMN content_version INTEGER NOT NULL DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE checklist_templates ADD COLUMN content_changed_at DATETIME"); } catch (e) {}
  try { db.exec("ALTER TABLE checklist_templates ADD COLUMN content_changed_by TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE checklist_templates ADD COLUMN content_change_reason TEXT"); } catch (e) {}
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS checklist_template_content_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        template_id INTEGER NOT NULL,
        version INTEGER NOT NULL CHECK(version > 0),
        status_at_change TEXT NOT NULL CHECK(status_at_change = 'activa'),
        reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),
        changed_by TEXT NOT NULL,
        changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        template_before_snapshot TEXT NOT NULL DEFAULT '{}',
        items_before_snapshot TEXT NOT NULL DEFAULT '[]',
        template_after_snapshot TEXT NOT NULL DEFAULT '{}',
        items_after_snapshot TEXT NOT NULL DEFAULT '[]',
        UNIQUE (template_id, version),
        FOREIGN KEY (template_id) REFERENCES checklist_templates(id)
      );
      CREATE INDEX IF NOT EXISTS idx_checklist_template_content_history_template
        ON checklist_template_content_history (template_id, changed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_checklist_templates_content_changed_at
        ON checklist_templates (content_changed_at DESC);
    `);
  } catch (e) {}

  try { db.exec("ALTER TABLE routes ADD COLUMN finalization_version INTEGER NOT NULL DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE routes ADD COLUMN finalized_at DATETIME"); } catch (e) {}
  try { db.exec("ALTER TABLE routes ADD COLUMN finalized_by TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE routes ADD COLUMN finalization_reason TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE routes ADD COLUMN finalized_from_status TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE routes ADD COLUMN cancelled_at DATETIME"); } catch (e) {}
  try { db.exec("ALTER TABLE routes ADD COLUMN cancelled_by TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE routes ADD COLUMN cancel_reason TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE routes ADD COLUMN cancelled_from_status TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE routes ADD COLUMN reopened_at DATETIME"); } catch (e) {}
  try { db.exec("ALTER TABLE routes ADD COLUMN reopened_by TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE routes ADD COLUMN reopen_reason TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE routes ADD COLUMN operational_version INTEGER NOT NULL DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE routes ADD COLUMN operational_last_action TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE routes ADD COLUMN operational_changed_at DATETIME"); } catch (e) {}
  try { db.exec("ALTER TABLE routes ADD COLUMN operational_changed_by TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE routes ADD COLUMN operational_reason TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE routes ADD COLUMN operational_from_status TEXT"); } catch (e) {}
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS route_operational_status_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        route_id INTEGER NOT NULL,
        version INTEGER NOT NULL CHECK(version > 0),
        action TEXT NOT NULL CHECK(action IN ('start', 'reopen')),
        reason TEXT NOT NULL,
        performed_by TEXT NOT NULL,
        performed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        previous_status TEXT NOT NULL,
        new_status TEXT NOT NULL,
        snapshot TEXT NOT NULL DEFAULT '{}',
        UNIQUE(route_id, version),
        FOREIGN KEY (route_id) REFERENCES routes(id)
      );
      CREATE INDEX IF NOT EXISTS idx_route_operational_history_route
        ON route_operational_status_history (route_id, performed_at DESC, id DESC);
    `);
  } catch (e) {}
  try {
    const routeHistoryDefinition = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'route_status_history'").get() as any;
    const routeHistorySql = String(routeHistoryDefinition?.sql || "").toLowerCase();
    if (routeHistorySql && !routeHistorySql.includes("'finalize'")) {
      db.exec(`
        BEGIN;
        CREATE TABLE route_status_history_v2 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          route_id INTEGER NOT NULL,
          action TEXT NOT NULL CHECK(action IN ('finalize', 'cancel', 'reopen')),
          reason TEXT NOT NULL,
          performed_by TEXT NOT NULL,
          performed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          previous_status TEXT NOT NULL,
          new_status TEXT NOT NULL,
          snapshot TEXT NOT NULL DEFAULT '{}',
          FOREIGN KEY (route_id) REFERENCES routes(id)
        );
        INSERT INTO route_status_history_v2 (
          id, route_id, action, reason, performed_by, performed_at,
          previous_status, new_status, snapshot
        )
        SELECT id, route_id, action, reason, performed_by, performed_at,
               previous_status, new_status, snapshot
        FROM route_status_history;
        DROP TABLE route_status_history;
        ALTER TABLE route_status_history_v2 RENAME TO route_status_history;
        CREATE INDEX IF NOT EXISTS idx_route_status_history_route
          ON route_status_history (route_id, performed_at DESC);
        COMMIT;
      `);
    }
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch (_) {}
    throw e;
  }
  try { db.exec("ALTER TABLE route_items ADD COLUMN status TEXT DEFAULT 'pendiente'"); } catch (e) {}
  try { db.exec("ALTER TABLE route_items ADD COLUMN notes TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE route_items ADD COLUMN visited_at DATETIME"); } catch (e) {}
  try { db.exec("ALTER TABLE route_items ADD COLUMN lifecycle_version INTEGER NOT NULL DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE route_items ADD COLUMN status_changed_at DATETIME"); } catch (e) {}
  try { db.exec("ALTER TABLE route_items ADD COLUMN status_changed_by TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE route_items ADD COLUMN status_changed_from TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE route_items ADD COLUMN status_last_action TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE route_items ADD COLUMN status_last_reason TEXT"); } catch (e) {}
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS route_item_status_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        route_item_id INTEGER NOT NULL,
        route_id INTEGER NOT NULL,
        version INTEGER NOT NULL CHECK(version > 0),
        action TEXT NOT NULL CHECK(action IN ('visit', 'omit', 'reopen')),
        from_status TEXT NOT NULL,
        to_status TEXT NOT NULL,
        reason TEXT,
        changed_by TEXT NOT NULL,
        changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        snapshot TEXT NOT NULL DEFAULT '{}',
        UNIQUE(route_item_id, version),
        FOREIGN KEY (route_item_id) REFERENCES route_items(id),
        FOREIGN KEY (route_id) REFERENCES routes(id)
      );
      CREATE INDEX IF NOT EXISTS idx_route_item_status_history_item
        ON route_item_status_history (route_item_id, changed_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_route_item_status_history_route
        ON route_item_status_history (route_id, changed_at DESC, id DESC);
    `);
  } catch (e) {}

  try { db.exec("ALTER TABLE clientes ADD COLUMN razon_social TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE clientes ADD COLUMN cuit TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE clientes ADD COLUMN provincia TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE clientes ADD COLUMN codigo_postal TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE clientes ADD COLUMN lista_precio TEXT DEFAULT 'lista1'"); } catch (e) {}
  try { db.exec("ALTER TABLE clientes ADD COLUMN limite_credito REAL DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE clientes ADD COLUMN portal_enabled INTEGER DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE clientes ADD COLUMN portal_username TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE clientes ADD COLUMN portal_password_hash TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE clientes ADD COLUMN deactivated_at DATETIME"); } catch (e) {}
  try { db.exec("ALTER TABLE clientes ADD COLUMN deactivated_by TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE clientes ADD COLUMN deactivation_reason TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE clientes ADD COLUMN content_version INTEGER NOT NULL DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE clientes ADD COLUMN content_changed_at DATETIME"); } catch (e) {}
  try { db.exec("ALTER TABLE clientes ADD COLUMN content_changed_by TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE clientes ADD COLUMN content_change_reason TEXT"); } catch (e) {}
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS customer_content_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL,
        version INTEGER NOT NULL CHECK(version > 0),
        reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),
        changed_by TEXT NOT NULL,
        changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        before_snapshot TEXT NOT NULL DEFAULT '{}',
        after_snapshot TEXT NOT NULL DEFAULT '{}',
        UNIQUE (customer_id, version),
        FOREIGN KEY (customer_id) REFERENCES clientes(id)
      );
      CREATE INDEX IF NOT EXISTS idx_customer_content_history_customer
        ON customer_content_history (customer_id, changed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_clientes_content_changed_at
        ON clientes (content_changed_at DESC);
    `);
  } catch (e) {}

  try { db.exec("ALTER TABLE sales ADD COLUMN notes TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE sales ADD COLUMN usuario TEXT"); } catch (e) {}

  return db;
}

export default db;
