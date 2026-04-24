import { z } from "zod";
import db from "../db.js";
import { getPostgresPool, isPostgresConfigured } from "../utils/postgres.js";
import { AppError } from "../utils/response.js";

type Queryable = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

export const purchaseInvoiceBodySchema = z.object({
  proveedor_id: z.number(),
  numero_factura: z.string().min(1, "NÃºmero de factura requerido"),
  total: z.number().positive(),
  fecha: z.string().optional(),
  metodo_pago: z.string(),
  items: z
    .array(
      z.object({
        product_id: z.union([z.number(), z.string()]),
        cantidad: z.number().positive(),
        costo_unitario: z.number().nonnegative(),
      })
    )
    .min(1, "Debe incluir al menos un producto"),
});

const toNumber = (value: any, fallback: number = 0) => {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const getExecutor = (executor?: Queryable) => executor || getPostgresPool();

const sanitizeBaseCode = (name: string) => {
  const cleaned = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();

  return (cleaned || "PROD").slice(0, 5).padEnd(5, "X");
};

const buildProductCode = (name: string, attempt: number) => {
  const base = sanitizeBaseCode(name);
  const suffix = String(100 + attempt).slice(-3);
  const code = `${base}${suffix}`;
  return {
    code,
    codigo_unico: `Edu-${code}`,
  };
};

const mapInvoice = (row: any) => ({
  id: toNumber(row.id),
  proveedor_id: toNumber(row.proveedor_id),
  proveedor: row.proveedor ?? row.proveedor_nombre ?? "",
  numero_factura: row.numero_factura || "",
  total: toNumber(row.total),
  fecha_compra: row.fecha_compra || row.fecha || "",
  metodo_pago: row.metodo_pago || "",
});

const mapInvoiceItem = (row: any) => ({
  id: toNumber(row.id),
  invoice_id: toNumber(row.invoice_id),
  product_id: toNumber(row.product_id),
  cantidad: toNumber(row.cantidad),
  costo_unitario: toNumber(row.costo_unitario),
  cantidad_restante: toNumber(row.cantidad_restante),
  product_name: row.product_name || "",
  codigo_unico: row.codigo_unico || "",
});

const getNextPaymentNumberSqlite = () => {
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('next_payment_number', '1')").run();
  const current = db.prepare("SELECT value FROM settings WHERE key = 'next_payment_number'").get() as any;
  const nextPaymentNum = parseInt(current?.value || "1", 10) || 1;
  db.prepare("UPDATE settings SET value = ? WHERE key = 'next_payment_number'").run(String(nextPaymentNum + 1));
  return nextPaymentNum;
};

const getNextPaymentNumberPg = async (client: Queryable) => {
  await client.query(
    `INSERT INTO settings (key, value)
     VALUES ($1, $2)
     ON CONFLICT (key) DO NOTHING`,
    ["next_payment_number", "1"]
  );

  const current = await client.query(
    `SELECT value
     FROM settings
     WHERE key = $1
     LIMIT 1`,
    ["next_payment_number"]
  );

  const nextPaymentNum = parseInt(current.rows[0]?.value || "1", 10) || 1;

  await client.query(
    `UPDATE settings
     SET value = $2
     WHERE key = $1`,
    ["next_payment_number", String(nextPaymentNum + 1)]
  );

  return nextPaymentNum;
};

const createProductInSqlite = (productName: string, cost: number) => {
  for (let attempt = 1; attempt <= 50; attempt += 1) {
    const { code, codigo_unico } = buildProductCode(productName, attempt);
    const existing = db.prepare("SELECT id FROM products WHERE codigo_unico = ? LIMIT 1").get(codigo_unico) as any;

    if (!existing) {
      const info = db
        .prepare(
          `
            INSERT INTO products (code, codigo_unico, name, description, cost, sale_price, stock, stock_minimo, company, family_id, category_id, estado)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
        )
        .run(
          code,
          codigo_unico,
          productName,
          null,
          cost,
          cost * 1.3,
          0,
          0,
          "Edu",
          null,
          null,
          "activo"
        );

      return Number(info.lastInsertRowid);
    }
  }

  throw new AppError("No se pudo generar un cÃ³digo Ãºnico para el producto nuevo.", 400);
};

const createProductInPg = async (client: Queryable, productName: string, cost: number) => {
  for (let attempt = 1; attempt <= 50; attempt += 1) {
    const { code, codigo_unico } = buildProductCode(productName, attempt);

    try {
      const result = await client.query(
        `
          INSERT INTO products (code, codigo_unico, name, description, cost, sale_price, stock, stock_minimo, company, family_id, category_id, estado)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          RETURNING id
        `,
        [
          code,
          codigo_unico,
          productName,
          null,
          cost,
          cost * 1.3,
          0,
          0,
          "Edu",
          null,
          null,
          "activo",
        ]
      );

      return toNumber(result.rows[0]?.id);
    } catch (error: any) {
      if (error?.code === "23505") continue;
      throw error;
    }
  }

  throw new AppError("No se pudo generar un cÃ³digo Ãºnico para el producto nuevo.", 400);
};

export const listPurchaseInvoices = async (executor?: Queryable) => {
  if (!isPostgresConfigured()) {
    const rows = db
      .prepare(
        `
          SELECT pi.id, pi.proveedor_id, pi.numero_factura, pi.total, pi.fecha AS fecha_compra, pi.metodo_pago, p.nombre AS proveedor
          FROM purchase_invoices pi
          JOIN proveedores p ON pi.proveedor_id = p.id
          ORDER BY pi.fecha DESC, pi.id DESC
        `
      )
      .all();

    return rows.map(mapInvoice);
  }

  const queryable = getExecutor(executor);
  const result = await queryable.query(
    `
      SELECT pi.id, pi.proveedor_id, pi.numero_factura, pi.total, pi.fecha AS fecha_compra, pi.metodo_pago, p.nombre AS proveedor
      FROM purchase_invoices pi
      JOIN proveedores p ON pi.proveedor_id = p.id
      ORDER BY pi.fecha DESC, pi.id DESC
    `
  );

  return result.rows.map(mapInvoice);
};

export const getPurchaseInvoiceById = async (id: number, executor?: Queryable) => {
  if (!isPostgresConfigured()) {
    const invoiceRow = db
      .prepare(
        `
          SELECT pi.id, pi.proveedor_id, pi.numero_factura, pi.total, pi.fecha AS fecha_compra, pi.metodo_pago, p.nombre AS proveedor
          FROM purchase_invoices pi
          JOIN proveedores p ON pi.proveedor_id = p.id
          WHERE pi.id = ?
        `
      )
      .get(id) as any;

    if (!invoiceRow) return null;

    const itemRows = db
      .prepare(
        `
          SELECT pii.id, pii.invoice_id, pii.product_id, pii.cantidad, pii.costo_unitario, pii.cantidad_restante, p.name AS product_name, p.codigo_unico
          FROM purchase_invoice_items pii
          JOIN products p ON pii.product_id = p.id
          WHERE pii.invoice_id = ?
          ORDER BY pii.id ASC
        `
      )
      .all(id);

    return {
      ...mapInvoice(invoiceRow),
      items: itemRows.map(mapInvoiceItem),
    };
  }

  const queryable = getExecutor(executor);
  const invoiceResult = await queryable.query(
    `
      SELECT pi.id, pi.proveedor_id, pi.numero_factura, pi.total, pi.fecha AS fecha_compra, pi.metodo_pago, p.nombre AS proveedor
      FROM purchase_invoices pi
      JOIN proveedores p ON pi.proveedor_id = p.id
      WHERE pi.id = $1
      LIMIT 1
    `,
    [id]
  );

  const invoiceRow = invoiceResult.rows[0];
  if (!invoiceRow) return null;

  const itemResult = await queryable.query(
    `
      SELECT pii.id, pii.invoice_id, pii.product_id, pii.cantidad, pii.costo_unitario, pii.cantidad_restante, p.name AS product_name, p.codigo_unico
      FROM purchase_invoice_items pii
      JOIN products p ON pii.product_id = p.id
      WHERE pii.invoice_id = $1
      ORDER BY pii.id ASC
    `,
    [id]
  );

  return {
    ...mapInvoice(invoiceRow),
    items: itemResult.rows.map(mapInvoiceItem),
  };
};

export const createPurchaseInvoice = async (payload: z.infer<typeof purchaseInvoiceBodySchema>, userName: string) => {
  const invoiceDate = payload.fecha || new Date().toISOString();

  if (!isPostgresConfigured()) {
    const runTransaction = db.transaction(() => {
      const info = db
        .prepare(
          `
            INSERT INTO purchase_invoices (proveedor_id, numero_factura, total, fecha, metodo_pago)
            VALUES (?, ?, ?, ?, ?)
          `
        )
        .run(payload.proveedor_id, payload.numero_factura, payload.total, invoiceDate, payload.metodo_pago);

      const invoiceId = Number(info.lastInsertRowid);

      const insertItem = db.prepare(
        `
          INSERT INTO purchase_invoice_items (invoice_id, product_id, cantidad, costo_unitario, cantidad_restante)
          VALUES (?, ?, ?, ?, ?)
        `
      );

      for (const item of payload.items) {
        let productId: number;

        if (typeof item.product_id === "string" && item.product_id.startsWith("new:")) {
          const productName = item.product_id.replace("new:", "").trim();
          if (!productName) {
            throw new AppError("Nombre de producto nuevo invÃ¡lido.", 400);
          }
          productId = createProductInSqlite(productName, item.costo_unitario);
        } else {
          productId = Number(item.product_id);
        }

        insertItem.run(invoiceId, productId, item.cantidad, item.costo_unitario, item.cantidad);

        db.prepare("UPDATE products SET stock = stock + ?, cost = ? WHERE id = ?").run(
          item.cantidad,
          item.costo_unitario,
          productId
        );

        db.prepare(
          `
            INSERT INTO stock_movimientos (product_id, cantidad, costo_unitario, cantidad_restante, descripcion, tipo_movimiento, motivo, usuario)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `
        ).run(
          productId,
          item.cantidad,
          item.costo_unitario,
          item.cantidad,
          `Factura Compra #${payload.numero_factura}`,
          "ingreso",
          "compra",
          userName || "Sistema"
        );
      }

      const nextPaymentNum = getNextPaymentNumberSqlite();

      db.prepare(
        `
          INSERT INTO movimientos_financieros (tipo, origen, descripcion, categoria, forma_pago, monto, fecha, usuario, numero_pago)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      ).run(
        "egreso",
        "compra",
        `Factura Compra #${payload.numero_factura}`,
        "Compras",
        payload.metodo_pago,
        payload.total,
        invoiceDate,
        userName || "Sistema",
        nextPaymentNum
      );

      return invoiceId;
    });

    const invoiceId = runTransaction();
    return getPurchaseInvoiceById(invoiceId);
  }

  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const invoiceInsert = await client.query(
      `
        INSERT INTO purchase_invoices (proveedor_id, numero_factura, total, fecha, metodo_pago)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `,
      [payload.proveedor_id, payload.numero_factura, payload.total, invoiceDate, payload.metodo_pago]
    );

    const invoiceId = toNumber(invoiceInsert.rows[0]?.id);

    for (const item of payload.items) {
      let productId: number;

      if (typeof item.product_id === "string" && item.product_id.startsWith("new:")) {
        const productName = item.product_id.replace("new:", "").trim();
        if (!productName) {
          throw new AppError("Nombre de producto nuevo invÃ¡lido.", 400);
        }
        productId = await createProductInPg(client, productName, item.costo_unitario);
      } else {
        productId = Number(item.product_id);
      }

      await client.query(
        `
          INSERT INTO purchase_invoice_items (invoice_id, product_id, cantidad, costo_unitario, cantidad_restante)
          VALUES ($1, $2, $3, $4, $5)
        `,
        [invoiceId, productId, item.cantidad, item.costo_unitario, item.cantidad]
      );

      await client.query(
        `
          UPDATE products
          SET stock = COALESCE(stock, 0) + $1,
              cost = $2
          WHERE id = $3
        `,
        [item.cantidad, item.costo_unitario, productId]
      );

      await client.query(
        `
          INSERT INTO stock_movimientos (product_id, cantidad, costo_unitario, cantidad_restante, descripcion, tipo_movimiento, motivo, usuario)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          productId,
          item.cantidad,
          item.costo_unitario,
          item.cantidad,
          `Factura Compra #${payload.numero_factura}`,
          "ingreso",
          "compra",
          userName || "Sistema",
        ]
      );
    }

    const nextPaymentNum = await getNextPaymentNumberPg(client);

    await client.query(
      `
        INSERT INTO movimientos_financieros (tipo, origen, descripcion, categoria, forma_pago, monto, fecha, usuario, numero_pago)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        "egreso",
        "compra",
        `Factura Compra #${payload.numero_factura}`,
        "Compras",
        payload.metodo_pago,
        payload.total,
        invoiceDate,
        userName || "Sistema",
        nextPaymentNum,
      ]
    );

    await client.query("COMMIT");

    return getPurchaseInvoiceById(invoiceId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};
