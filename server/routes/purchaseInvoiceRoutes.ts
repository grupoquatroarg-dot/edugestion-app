import { Router } from "express";
import db from "../db.js";
import { requirePermission } from "../middleware/authMiddleware.js";
import { validate } from "../middleware/validate.js";
import { z } from "zod";
import { sendSuccess } from "../utils/response.js";
import { getIo } from "../socket.js";

const router = Router();

const purchaseInvoiceSchema = z.object({
  body: z.object({
    proveedor_id: z.number(),
    numero_factura: z.string().min(1, "Número de factura requerido"),
    total: z.number().positive(),
    fecha: z.string().optional(),
    metodo_pago: z.string(),
    items: z.array(z.object({
      product_id: z.union([z.number(), z.string()]),
      cantidad: z.number().positive(),
      costo_unitario: z.number().nonnegative(),
    })).min(1, "Debe incluir al menos un producto"),
  }),
});

router.get("/", requirePermission('suppliers', 'view'), (req, res) => {
  const invoices = db.prepare(`
    SELECT pi.*, p.nombre as proveedor_nombre
    FROM purchase_invoices pi
    JOIN proveedores p ON pi.proveedor_id = p.id
    ORDER BY pi.fecha DESC
  `).all();
  
  const invoicesWithItems = invoices.map(inv => {
    const items = db.prepare(`
      SELECT pii.*, p.name as product_name, p.codigo_unico
      FROM purchase_invoice_items pii
      JOIN products p ON pii.product_id = p.id
      WHERE pii.invoice_id = ?
    `).all(inv.id);
    return { ...inv, items };
  });
  
  return sendSuccess(res, invoicesWithItems);
});

router.get("/:id", requirePermission('suppliers', 'view'), (req, res) => {
  const invoice = db.prepare(`
    SELECT pi.*, p.nombre as proveedor
    FROM purchase_invoices pi
    JOIN proveedores p ON pi.proveedor_id = p.id
    WHERE pi.id = ?
  `).get(req.params.id);
  
  if (!invoice) {
    return res.status(404).json({ message: "Factura no encontrada" });
  }
  
  const items = db.prepare(`
    SELECT pii.*, p.name as product_name, p.codigo_unico
    FROM purchase_invoice_items pii
    JOIN products p ON pii.product_id = p.id
    WHERE pii.invoice_id = ?
  `).all(req.params.id);
  
  return sendSuccess(res, { ...invoice, items });
});

router.post("/", requirePermission('suppliers', 'create'), validate(purchaseInvoiceSchema), (req, res) => {
  const { proveedor_id, numero_factura, total, items, fecha, metodo_pago } = req.body;
  
  db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO purchase_invoices (proveedor_id, numero_factura, total, fecha, metodo_pago)
      VALUES (?, ?, ?, ?, ?)
    `).run(proveedor_id, numero_factura, total, fecha || new Date().toISOString(), metodo_pago);
    const invoiceId = info.lastInsertRowid;

    const insertItem = db.prepare(`
      INSERT INTO purchase_invoice_items (invoice_id, product_id, cantidad, costo_unitario, cantidad_restante)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const item of items) {
      let productId = item.product_id;

      // Handle new product creation
      if (typeof productId === 'string' && productId.startsWith('new:')) {
        const productName = productId.replace('new:', '');
        const company = 'Edu';
        const code = productName.substring(0, 5).toUpperCase() + Math.floor(Math.random() * 1000);
        const codigo_unico = `${company}-${code}`;
        
        const productInfo = db.prepare(`
          INSERT INTO products (code, codigo_unico, name, cost, sale_price, stock, company, estado)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          code,
          codigo_unico,
          productName,
          item.costo_unitario,
          item.costo_unitario * 1.3, // Default 30% markup
          0, // Initial stock 0, will be updated below
          company,
          'activo'
        );
        productId = productInfo.lastInsertRowid as number;
      }

      insertItem.run(invoiceId, productId, item.cantidad, item.costo_unitario, item.cantidad);
      
      // Update product stock and cost
      db.prepare("UPDATE products SET stock = stock + ?, cost = ? WHERE id = ?").run(item.cantidad, item.costo_unitario, productId);
      
      // Register stock movement
      const usuario = (req as any).user?.userName || 'Sistema';
      db.prepare(`
        INSERT INTO stock_movimientos (product_id, cantidad, costo_unitario, cantidad_restante, descripcion, tipo_movimiento, motivo, usuario)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(productId, item.cantidad, item.costo_unitario, item.cantidad, `Factura Compra #${numero_factura}`, "ingreso", "compra", usuario);
    }

    // Register financial movement (egreso)
    const usuario = (req as any).user?.userName || 'Sistema';
    const nextPaymentNum = parseInt(db.prepare("SELECT value FROM settings WHERE key = 'next_payment_number'").get()?.value || '1');
    db.prepare("UPDATE settings SET value = ? WHERE key = 'next_payment_number'").run((nextPaymentNum + 1).toString());

    db.prepare(`
      INSERT INTO movimientos_financieros (tipo, origen, descripcion, categoria, forma_pago, monto, fecha, usuario, numero_pago)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('egreso', 'compra', `Factura Compra #${numero_factura}`, 'Compras', metodo_pago, total, fecha || new Date().toISOString(), usuario, nextPaymentNum);
  })();

  // Emit socket events for real-time updates
  const io = getIo();
  io.emit('financial_movement_created');
  
  // Fetch and emit updated products
  const productIds = items.map((item: any) => item.product_id);
  // Note: some productIds might have been strings starting with 'new:', but we need their actual IDs now.
  // Actually, it's easier to just fetch all products that were involved.
  // We can't easily get the new IDs here without more logic, but we can just emit the ones we know.
  // Or better, just fetch them from the DB.
  
  // For simplicity, let's just emit a general 'products_updated' if we had a lot, 
  // but here we can try to be specific.
  const allProducts = db.prepare(`
    SELECT p.*, f.name as family_name, c.name as category_name
    FROM products p
    LEFT JOIN product_families f ON p.family_id = f.id
    LEFT JOIN product_categories c ON p.category_id = c.id
    WHERE p.eliminado = 0
  `).all();
  
  // Actually, the frontend often just needs to know SOMETHING changed.
  // But ProductModule.tsx expects the specific product object.
  allProducts.forEach((p: any) => {
    io.emit('product_updated', p);
  });
  
  return sendSuccess(res, null, "Factura de compra registrada", 201);
});

export default router;
