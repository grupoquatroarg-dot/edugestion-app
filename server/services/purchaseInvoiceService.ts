import { z } from "zod";
import db from "../db.js";
import { getPostgresPool, isPostgresConfigured } from "../utils/postgres.js";
import { AppError } from "../utils/response.js";
import { normalizeBusinessDateForStorage, toStoredDateOnly } from "../utils/businessDate.js";

type Queryable = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

export const purchaseInvoiceBodySchema = z.object({
  proveedor_id: z.number(),
  numero_factura: z.string().min(1, "Número de factura requerido"),
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
  metodo_pago_real: z.string().min(1, "Método de pago requerido"),
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
  const isCancelled = String(row.estado || "").toLowerCase() === "anulada";
  const saldoPendiente = isCancelled ? 0 : Math.max(0, total - montoPagado);

  return {
    id: toNumber(row.id),
    proveedor_id: toNumber(row.proveedor_id),
    proveedor: row.proveedor ?? row.proveedor_nombre ?? "",
    numero_factura: row.numero_factura || "",
    total,
    fecha_compra: toStoredDateOnly(row.fecha_compra || row.fecha),
    metodo_pago: row.metodo_pago || "",
    estado_pago: row.estado_pago || (isCurrentAccount(row.metodo_pago) ? "pendiente" : "pagado"),
    monto_pagado: montoPagado,
    saldo_pendiente: saldoPendiente,
    fecha_pago: row.fecha_pago ? toStoredDateOnly(row.fecha_pago) : null,
    metodo_pago_real: row.metodo_pago_real || null,
    estado: row.estado || "Activa",
    reversion_version: toNumber(row.reversion_version),
    anulada_at: row.anulada_at || null,
    anulada_por: row.anulada_por || null,
    anulacion_motivo: row.anulacion_motivo || null,
  };
};

const mapInvoiceItem = (row: any) => ({
  id: toNumber(row.id),
  invoice_id: toNumber(row.invoice_id),
  product_id: toNumber(row.product_id),
  cantidad: toNumber(row.cantidad),
  costo_unitario: toNumber(row.costo_unitario),
  cantidad_restante: toNumber(row.cantidad_restante),
  previous_product_cost: row.previous_product_cost === null || row.previous_product_cost === undefined
    ? null
    : toNumber(row.previous_product_cost),
  product_was_created: Boolean(row.product_was_created),
  stock_movement_id: row.stock_movement_id === null || row.stock_movement_id === undefined
    ? null
    : toNumber(row.stock_movement_id),
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
     LIMIT 1
     FOR UPDATE`,
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
    purchaseInvoiceId: number;
    numeroFactura: string;
    proveedor?: string;
    metodoPago: string;
    total: number;
    fecha: string;
    usuario: string;
    allocationType: "initial_payment" | "supplier_payment";
  }
) => {
  const nextPaymentNum = await getNextPaymentNumberPg(client);
  const proveedorTxt = params.proveedor ? ` - ${params.proveedor}` : "";

  const movementResult = await client.query(
    `
      INSERT INTO movimientos_financieros (
        tipo,
        origen,
        descripcion,
        categoria,
        forma_pago,
        monto,
        fecha,
        usuario,
        numero_pago,
        purchase_invoice_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id
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
      params.purchaseInvoiceId,
    ]
  );

  const movementId = toNumber(movementResult.rows[0]?.id);

  if (!movementId) {
    throw new AppError("No se pudo registrar la trazabilidad del pago de la factura.", 500);
  }

  await client.query(
    `
      INSERT INTO purchase_invoice_payment_allocations (
        purchase_invoice_id,
        movimiento_financiero_id,
        monto,
        allocation_type
      )
      VALUES ($1, $2, $3, $4)
    `,
    [
      params.purchaseInvoiceId,
      movementId,
      params.total,
      params.allocationType,
    ]
  );

  return movementId;
};

export const listPurchaseInvoices = async (executor?: Queryable) => {
  if (!isPostgresConfigured()) {
    const rows = db
      .prepare(
        `
          SELECT pi.id, pi.proveedor_id, pi.numero_factura, pi.total, pi.fecha AS fecha_compra, pi.metodo_pago, p.nombre AS proveedor,
                 pi.estado_pago, pi.monto_pagado, pi.fecha_pago, pi.metodo_pago_real,
                 pi.estado, pi.reversion_version, pi.anulada_at, pi.anulada_por, pi.anulacion_motivo
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
             pi.estado_pago, pi.monto_pagado, pi.fecha_pago, pi.metodo_pago_real,
             pi.estado, pi.reversion_version, pi.anulada_at, pi.anulada_por, pi.anulacion_motivo
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
                 pi.estado_pago, pi.monto_pagado, pi.fecha_pago, pi.metodo_pago_real,
                 pi.estado, pi.reversion_version, pi.anulada_at, pi.anulada_por, pi.anulacion_motivo
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
          SELECT pii.id, pii.invoice_id, pii.product_id, pii.cantidad, pii.costo_unitario, pii.cantidad_restante,
                 pii.previous_product_cost, pii.product_was_created, pii.stock_movement_id,
                 p.name AS product_name, p.codigo_unico
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
             pi.estado_pago, pi.monto_pagado, pi.fecha_pago, pi.metodo_pago_real,
             pi.estado, pi.reversion_version, pi.anulada_at, pi.anulada_por, pi.anulacion_motivo
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
      SELECT pii.id, pii.invoice_id, pii.product_id, pii.cantidad, pii.costo_unitario, pii.cantidad_restante,
                 pii.previous_product_cost, pii.product_was_created, pii.stock_movement_id,
                 p.name AS product_name, p.codigo_unico
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
  const invoiceDate = normalizeBusinessDateForStorage(payload.fecha);
  const isDebt = isCurrentAccount(payload.metodo_pago);
  const estadoPago = isDebt ? "pendiente" : "pagado";
  const montoPagado = isDebt ? 0 : payload.total;
  const fechaPago = isDebt ? null : invoiceDate;
  const metodoPagoReal = isDebt ? null : payload.metodo_pago;

  if (!isPostgresConfigured()) {
    const runTransaction = db.transaction(() => {
      const provider = db
        .prepare("SELECT nombre, estado FROM proveedores WHERE id = ? LIMIT 1")
        .get(payload.proveedor_id) as any;

      if (!provider) {
        throw new AppError("Proveedor no encontrado.", 404);
      }
      if (String(provider.estado || "activo").toLowerCase() !== "activo") {
        throw new AppError("El proveedor está inactivo. Reactivalo antes de registrar una factura.", 409);
      }

      const info = db
        .prepare(
          `
            INSERT INTO purchase_invoices (
              proveedor_id,
              numero_factura,
              total,
              fecha,
              metodo_pago,
              estado_pago,
              monto_pagado,
              fecha_pago,
              metodo_pago_real,
              estado,
              reversion_version
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          metodoPagoReal,
          "Activa",
          1
        );

      const invoiceId = Number(info.lastInsertRowid);

      for (const item of payload.items) {
        let productId: number;
        let previousProductCost: number;
        let productWasCreated = 0;

        if (typeof item.product_id === "string" && item.product_id.startsWith("new:")) {
          const productName = item.product_id.replace("new:", "").trim();
          if (!productName) {
            throw new AppError("Nombre de producto nuevo inválido.", 400);
          }

          productId = createProductInSqlite(productName, item.costo_unitario);
          previousProductCost = item.costo_unitario;
          productWasCreated = 1;
        } else {
          productId = Number(item.product_id);
          const product = db
            .prepare("SELECT id, cost FROM products WHERE id = ? LIMIT 1")
            .get(productId) as any;

          if (!product) {
            throw new AppError("Producto no encontrado.", 404);
          }

          previousProductCost = toNumber(product.cost);
        }

        const itemInsert = db
          .prepare(
            `
              INSERT INTO purchase_invoice_items (
                invoice_id,
                product_id,
                cantidad,
                costo_unitario,
                cantidad_restante,
                previous_product_cost,
                product_was_created
              )
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `
          )
          .run(
            invoiceId,
            productId,
            item.cantidad,
            item.costo_unitario,
            item.cantidad,
            previousProductCost,
            productWasCreated
          );

        const invoiceItemId = Number(itemInsert.lastInsertRowid);

        db.prepare(
          `
            UPDATE products
            SET stock = COALESCE(stock, 0) + ?,
                cost = ?
            WHERE id = ?
          `
        ).run(item.cantidad, item.costo_unitario, productId);

        const movementInsert = db
          .prepare(
            `
              INSERT INTO stock_movimientos (
                product_id,
                cantidad,
                costo_unitario,
                cantidad_restante,
                descripcion,
                tipo_movimiento,
                motivo,
                usuario,
                purchase_invoice_id,
                purchase_invoice_item_id
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `
          )
          .run(
            productId,
            item.cantidad,
            item.costo_unitario,
            item.cantidad,
            `Factura Compra #${payload.numero_factura}`,
            "ingreso",
            "compra",
            userName || "Sistema",
            invoiceId,
            invoiceItemId
          );

        db.prepare(
          "UPDATE purchase_invoice_items SET stock_movement_id = ? WHERE id = ?"
        ).run(Number(movementInsert.lastInsertRowid), invoiceItemId);
      }

      if (!isDebt) {
        const nextPaymentNum = getNextPaymentNumberSqlite();
        const movementInsert = db
          .prepare(
            `
              INSERT INTO movimientos_financieros (
                tipo,
                origen,
                descripcion,
                categoria,
                forma_pago,
                monto,
                fecha,
                usuario,
                numero_pago,
                purchase_invoice_id
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `
          )
          .run(
            "egreso",
            "compra",
            `Factura Compra #${payload.numero_factura} - ${provider.nombre || ""}`,
            "Compras",
            payload.metodo_pago,
            payload.total,
            invoiceDate,
            userName || "Sistema",
            nextPaymentNum,
            invoiceId
          );

        db.prepare(
          `
            INSERT INTO purchase_invoice_payment_allocations (
              purchase_invoice_id,
              movimiento_financiero_id,
              monto,
              allocation_type
            )
            VALUES (?, ?, ?, ?)
          `
        ).run(
          invoiceId,
          Number(movementInsert.lastInsertRowid),
          payload.total,
          "initial_payment"
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
      `SELECT nombre, estado
       FROM proveedores
       WHERE id = $1
       LIMIT 1
       FOR UPDATE`,
      [payload.proveedor_id]
    );

    if (!proveedorResult.rows[0]) {
      throw new AppError("Proveedor no encontrado.", 404);
    }
    if (String(proveedorResult.rows[0].estado || "activo").toLowerCase() !== "activo") {
      throw new AppError("El proveedor está inactivo. Reactivalo antes de registrar una factura.", 409);
    }

    const proveedorNombre = proveedorResult.rows[0].nombre || "";

    const invoiceInsert = await client.query(
      `
        INSERT INTO purchase_invoices (
          proveedor_id,
          numero_factura,
          total,
          fecha,
          metodo_pago,
          estado_pago,
          monto_pagado,
          fecha_pago,
          metodo_pago_real,
          estado,
          reversion_version
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
        "Activa",
        1,
      ]
    );

    const invoiceId = toNumber(invoiceInsert.rows[0]?.id);

    for (const item of payload.items) {
      let productId: number;
      let previousProductCost: number;
      let productWasCreated = false;

      if (typeof item.product_id === "string" && item.product_id.startsWith("new:")) {
        const productName = item.product_id.replace("new:", "").trim();
        if (!productName) {
          throw new AppError("Nombre de producto nuevo inválido.", 400);
        }

        productId = await createProductInPg(client, productName, item.costo_unitario);
        previousProductCost = item.costo_unitario;
        productWasCreated = true;
      } else {
        productId = Number(item.product_id);
        const productResult = await client.query(
          `
            SELECT id, cost
            FROM products
            WHERE id = $1
            LIMIT 1
            FOR UPDATE
          `,
          [productId]
        );

        const product = productResult.rows[0];
        if (!product) {
          throw new AppError("Producto no encontrado.", 404);
        }

        previousProductCost = toNumber(product.cost);
      }

      const itemInsert = await client.query(
        `
          INSERT INTO purchase_invoice_items (
            invoice_id,
            product_id,
            cantidad,
            costo_unitario,
            cantidad_restante,
            previous_product_cost,
            product_was_created
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING id
        `,
        [
          invoiceId,
          productId,
          item.cantidad,
          item.costo_unitario,
          item.cantidad,
          previousProductCost,
          productWasCreated,
        ]
      );

      const invoiceItemId = toNumber(itemInsert.rows[0]?.id);

      await client.query(
        `
          UPDATE products
          SET stock = COALESCE(stock, 0) + $1,
              cost = $2
          WHERE id = $3
        `,
        [item.cantidad, item.costo_unitario, productId]
      );

      const movementInsert = await client.query(
        `
          INSERT INTO stock_movimientos (
            product_id,
            cantidad,
            costo_unitario,
            cantidad_restante,
            descripcion,
            tipo_movimiento,
            motivo,
            usuario,
            purchase_invoice_id,
            purchase_invoice_item_id
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING id
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
          invoiceId,
          invoiceItemId,
        ]
      );

      const stockMovementId = toNumber(movementInsert.rows[0]?.id);
      if (!stockMovementId) {
        throw new AppError("No se pudo registrar la trazabilidad del ingreso de stock.", 500);
      }

      await client.query(
        `
          UPDATE purchase_invoice_items
          SET stock_movement_id = $1
          WHERE id = $2
        `,
        [stockMovementId, invoiceItemId]
      );
    }

    if (!isDebt) {
      await insertPurchaseFinancialMovementPg(client, {
        purchaseInvoiceId: invoiceId,
        numeroFactura: payload.numero_factura,
        proveedor: proveedorNombre,
        metodoPago: payload.metodo_pago,
        total: payload.total,
        fecha: invoiceDate,
        usuario: userName || "Sistema",
        allocationType: "initial_payment",
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
  const paymentDate = normalizeBusinessDateForStorage(payload.fecha_pago);

  if (isCurrentAccount(payload.metodo_pago_real)) {
    throw new AppError("El pago de una cuenta corriente debe registrarse con un método real de pago.", 400);
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
      if (String(invoice.estado || "").toLowerCase() === "anulada") {
        throw new AppError("No se puede pagar una factura anulada.", 400);
      }
      if (!isCurrentAccount(invoice.metodo_pago)) {
        throw new AppError("Esta factura no está en cuenta corriente.", 400);
      }

      const total = toNumber(invoice.total);
      const montoPagadoActual = toNumber(invoice.monto_pagado);
      const saldo = Math.max(0, total - montoPagadoActual);

      if (saldo <= 0 || invoice.estado_pago === "pagado") {
        throw new AppError("Esta factura ya está pagada.", 400);
      }

      db.prepare(
        `
          UPDATE purchase_invoices
          SET estado_pago = ?, monto_pagado = ?, fecha_pago = ?, metodo_pago_real = ?
          WHERE id = ?
        `
      ).run("pagado", total, paymentDate, payload.metodo_pago_real, id);

      const nextPaymentNum = getNextPaymentNumberSqlite();
      const movementInsert = db
        .prepare(
          `
            INSERT INTO movimientos_financieros (
              tipo,
              origen,
              descripcion,
              categoria,
              forma_pago,
              monto,
              fecha,
              usuario,
              numero_pago,
              purchase_invoice_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
        )
        .run(
          "egreso",
          "compra",
          `Pago Factura Compra #${invoice.numero_factura} - ${invoice.proveedor || ""}`,
          "Compras",
          payload.metodo_pago_real,
          saldo,
          paymentDate,
          userName || "Sistema",
          nextPaymentNum,
          id
        );

      db.prepare(
        `
          INSERT INTO purchase_invoice_payment_allocations (
            purchase_invoice_id,
            movimiento_financiero_id,
            monto,
            allocation_type
          )
          VALUES (?, ?, ?, ?)
        `
      ).run(
        id,
        Number(movementInsert.lastInsertRowid),
        saldo,
        "supplier_payment"
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
        FOR UPDATE
      `,
      [id]
    );

    const invoice = invoiceResult.rows[0];

    if (!invoice) throw new AppError("Factura no encontrada", 404);
    if (String(invoice.estado || "").toLowerCase() === "anulada") {
      throw new AppError("No se puede pagar una factura anulada.", 400);
    }
    if (!isCurrentAccount(invoice.metodo_pago)) {
      throw new AppError("Esta factura no está en cuenta corriente.", 400);
    }

    const total = toNumber(invoice.total);
    const montoPagadoActual = toNumber(invoice.monto_pagado);
    const saldo = Math.max(0, total - montoPagadoActual);

    if (saldo <= 0 || invoice.estado_pago === "pagado") {
      throw new AppError("Esta factura ya está pagada.", 400);
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
      purchaseInvoiceId: id,
      numeroFactura: invoice.numero_factura,
      proveedor: invoice.proveedor,
      metodoPago: payload.metodo_pago_real,
      total: saldo,
      fecha: paymentDate,
      usuario: userName || "Sistema",
      allocationType: "supplier_payment",
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
