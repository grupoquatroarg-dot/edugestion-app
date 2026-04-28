import { z } from "zod";
import db from "../db.js";
import { getPostgresPool, isPostgresConfigured } from "../utils/postgres.js";
import { AppError } from "../utils/response.js";

type Queryable = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

export const purchaseInvoiceBodySchema = z.object({
  proveedor_id: z.number(),
  numero_factura: z.string().min(1, "Numero de factura requerido"),
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

export const purchaseInvoicePaymentSchema = z.object({
  metodo_pago_real: z.string().min(1, "Metodo de pago requerido"),
  fecha_pago: z.string().optional(),
});

const CTA_CTE = "Cta Cte";

const toNumber = (value: any, fallback: number = 0) => {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const getExecutor = (executor?: Queryable) => executor || getPostgresPool();

const isCurrentAccount = (method?: string | null) => String(method || "").trim().toLowerCase() === CTA_CTE.toLowerCase();

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

const mapInvoice = (row: any) => {
  const total = toNumber(row.total);
  const montoPagado = toNumber(row.monto_pagado);
  const saldoPendiente = Math.max(0, total - montoPagado);

  return {
    id: toNumber(row.id),
    proveedor_id: toNumber(row.proveedor_id),
    proveedor: row.proveedor ?? row.proveedor_nombre ?? "",
    numero_factura: row.numero_factura || "",
    total,
    fecha_compra: row.fecha_compra || row.fecha || "",
    metodo_pago: row.metodo_pago || "",
    estado_pago: row.estado_pago || (isCurrentAccount(row.metodo_pago) ? "pendiente" : "pagado"),
    monto_pagado: montoPagado,
    saldo_pendiente: saldoPendiente,
    fecha_pago: row.fecha_pago || null,
    metodo_pago_real: row.metodo_pago_real || null,
  };
};

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

  throw new AppError("No se pudo generar un codigo unico para el producto nuevo.", 400);
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

  throw new AppError("No se pudo generar un codigo unico para el producto nuevo.", 400);
};

const insertPurchaseFinancialMovementPg = async (
  client: Queryable,
  params: {
    numeroFactura: string;
    proveedor?: string;
    metodoPago: string;
    total: number;
    fecha: string;
    usuario: string;
  }
) => {
  const nextPaymentNum = await getNextPaymentNumberPg(client);
  const proveedorTxt = params.proveedor ? ` - ${params.proveedor}` : "";

  await client.query(
    `
      INSERT INTO movimientos_financieros (tipo, origen, descripcion, categoria, forma_pago, monto, fecha, usuario, numero_pago)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [
      "egreso",
      "compra",
      `Factura Compra #${params.numeroFactura}${proveedorTxt}`,
      "Compras",
      params.metodoPago,
      params.total,
      params.fecha,
      params.usuario || "Sistema",
      nextPaymentNum,
    ]
  );
};

export const listPurchaseInvoices = async (executor?: Queryable) => {
  if (!isPostgresConfigured()) {
    const rows = db
      .prepare(
        `
          SELECT pi.id, pi.proveedor_id, pi.numero_factura, pi.total, pi.fecha AS fecha_compra, pi.metodo_pago, p.nombre AS proveedor,
                 pi.estado_pago, pi.monto_pagado, pi.fecha_pago, pi.metodo_pago_real
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
      SELECT pi.id, pi.proveedor_id, pi.numero_factura, pi.total, pi.fecha AS fecha_compra, pi.metodo_pago, p.nombre AS proveedor,
             pi.estado_pago, pi.monto_pagado, pi.fecha_pago, pi.metodo_pago_real
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
          SELECT pi.id, pi.proveedor_id, pi.numero_factura, pi.total, pi.fecha AS fecha_compra, pi.metodo_pago, p.nombre AS proveedor,
                 pi.estado_pago, pi.monto_pagado, pi.fecha_pago, pi.metodo_pago_real
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
      SELECT pi.id, pi.proveedor_id, pi.numero_factura, pi.total, pi.fecha AS fecha_compra, pi.metodo_pago, p.nombre AS proveedor,
             pi.estado_pago, pi.monto_pagado, pi.fecha_pago, pi.metodo_pago_real
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
  const isDebt = isCurrentAccount(payload.metodo_pago);
  const estadoPago = isDebt ? "pendiente" : "pagado";
  const montoPagado = isDebt ? 0 : payload.total;
  const fechaPago = isDebt ? null : invoiceDate;
  const metodoPagoReal = isDebt ? null : payload.metodo_pago;

  if (!isPostgresConfigured()) {
    const runTransaction = db.transaction(() => {
      const info = db
        .prepare(
          `
            INSERT INTO purchase_invoices (proveedor_id, numero_factura, total, fecha, metodo_pago, estado_pago, monto_pagado, fecha_pago, metodo_pago_real)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
        )
        .run(
          payload.proveedor_id,
          payload.numero_factura,
          payload.total,
          invoiceDate,
          payload.metodo_pago,
          estadoPago,
          montoPagado,
          fechaPago,
          metodoPagoReal
        );

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
            throw new AppError("Nombre de producto nuevo invalido.", 400);
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

      if (!isDebt) {
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
      }

      return invoiceId;
    });

    const invoiceId = runTransaction();
    return getPurchaseInvoiceById(invoiceId);
  }

  const pool = getPostgresPool();
  const client: any = await pool.connect();

  try {
    await client.query("BEGIN");

    const proveedorResult = await client.query(
      `SELECT nombre FROM proveedores WHERE id = $1 LIMIT 1`,
      [payload.proveedor_id]
    );

    const proveedorNombre = proveedorResult.rows[0]?.nombre || "";

    const invoiceInsert = await client.query(
      `
        INSERT INTO purchase_invoices (proveedor_id, numero_factura, total, fecha, metodo_pago, estado_pago, monto_pagado, fecha_pago, metodo_pago_real)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id
      `,
      [
        payload.proveedor_id,
        payload.numero_factura,
        payload.total,
        invoiceDate,
        payload.metodo_pago,
        estadoPago,
        montoPagado,
        fechaPago,
        metodoPagoReal,
      ]
    );

    const invoiceId = toNumber(invoiceInsert.rows[0]?.id);

    for (const item of payload.items) {
      let productId: number;

      if (typeof item.product_id === "string" && item.product_id.startsWith("new:")) {
        const productName = item.product_id.replace("new:", "").trim();
        if (!productName) {
          throw new AppError("Nombre de producto nuevo invalido.", 400);
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

    if (!isDebt) {
      await insertPurchaseFinancialMovementPg(client, {
        numeroFactura: payload.numero_factura,
        proveedor: proveedorNombre,
        metodoPago: payload.metodo_pago,
        total: payload.total,
        fecha: invoiceDate,
        usuario: userName || "Sistema",
      });
    }

    await client.query("COMMIT");

    return getPurchaseInvoiceById(invoiceId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export const payPurchaseInvoice = async (
  id: number,
  payload: z.infer<typeof purchaseInvoicePaymentSchema>,
  userName: string
) => {
  const paymentDate = payload.fecha_pago || new Date().toISOString();

  if (isCurrentAccount(payload.metodo_pago_real)) {
    throw new AppError("El pago de una cuenta corriente debe registrarse con un metodo real de pago.", 400);
  }

  if (!isPostgresConfigured()) {
    const runTransaction = db.transaction(() => {
      const invoice = db
        .prepare(
          `
            SELECT pi.*, p.nombre AS proveedor
            FROM purchase_invoices pi
            JOIN proveedores p ON pi.proveedor_id = p.id
            WHERE pi.id = ?
          `
        )
        .get(id) as any;

      if (!invoice) throw new AppError("Factura no encontrada", 404);
      if (!isCurrentAccount(invoice.metodo_pago)) throw new AppError("Esta factura no esta en cuenta corriente.", 400);

      const total = toNumber(invoice.total);
      const montoPagadoActual = toNumber(invoice.monto_pagado);
      const saldo = Math.max(0, total - montoPagadoActual);

      if (saldo <= 0 || invoice.estado_pago === "pagado") {
        throw new AppError("Esta factura ya esta pagada.", 400);
      }

      db.prepare(
        `
          UPDATE purchase_invoices
          SET estado_pago = ?, monto_pagado = ?, fecha_pago = ?, metodo_pago_real = ?
          WHERE id = ?
        `
      ).run("pagado", total, paymentDate, payload.metodo_pago_real, id);

      const nextPaymentNum = getNextPaymentNumberSqlite();

      db.prepare(
        `
          INSERT INTO movimientos_financieros (tipo, origen, descripcion, categoria, forma_pago, monto, fecha, usuario, numero_pago)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      ).run(
        "egreso",
        "compra",
        `Pago Factura Compra #${invoice.numero_factura} - ${invoice.proveedor || ""}`,
        "Compras",
        payload.metodo_pago_real,
        saldo,
        paymentDate,
        userName || "Sistema",
        nextPaymentNum
      );
    });

    runTransaction();
    return getPurchaseInvoiceById(id);
  }

  const pool = getPostgresPool();
  const client: any = await pool.connect();

  try {
    await client.query("BEGIN");

    const invoiceResult = await client.query(
      `
        SELECT pi.*, p.nombre AS proveedor
        FROM purchase_invoices pi
        JOIN proveedores p ON pi.proveedor_id = p.id
        WHERE pi.id = $1
        LIMIT 1
      `,
      [id]
    );

    const invoice = invoiceResult.rows[0];

    if (!invoice) throw new AppError("Factura no encontrada", 404);
    if (!isCurrentAccount(invoice.metodo_pago)) throw new AppError("Esta factura no esta en cuenta corriente.", 400);

    const total = toNumber(invoice.total);
    const montoPagadoActual = toNumber(invoice.monto_pagado);
    const saldo = Math.max(0, total - montoPagadoActual);

    if (saldo <= 0 || invoice.estado_pago === "pagado") {
      throw new AppError("Esta factura ya esta pagada.", 400);
    }

    await client.query(
      `
        UPDATE purchase_invoices
        SET estado_pago = $1,
            monto_pagado = $2,
            fecha_pago = $3,
            metodo_pago_real = $4
        WHERE id = $5
      `,
      ["pagado", total, paymentDate, payload.metodo_pago_real, id]
    );

    await insertPurchaseFinancialMovementPg(client, {
      numeroFactura: invoice.numero_factura,
      proveedor: invoice.proveedor,
      metodoPago: payload.metodo_pago_real,
      total: saldo,
      fecha: paymentDate,
      usuario: userName || "Sistema",
    });

    await client.query("COMMIT");

    return getPurchaseInvoiceById(id);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

