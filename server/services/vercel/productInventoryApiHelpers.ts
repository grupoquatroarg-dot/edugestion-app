import { z } from "zod";
import { getPostgresPool, isPostgresConfigured } from "../../utils/postgres.js";
import { AppError, sendError, sendSuccess } from "../../utils/response.js";
import { verifyToken } from "../../utils/jwt.js";

const stockSchema = z.object({
  cantidad: z.number().min(1, "La cantidad debe ser al menos 1"),
  costo_unitario: z.number().min(0, "El costo no puede ser negativo"),
  notes: z.string().max(500).optional(),
});

const minStockSchema = z.object({
  stock_minimo: z.number().min(0, "El stock mínimo no puede ser negativo"),
});

const expireSchema = z.object({
  cantidad: z.number().min(1, "La cantidad debe ser al menos 1"),
  notes: z.string().max(500).optional(),
});

export type InventoryAction = "stock" | "expire" | "min-stock";

const getBody = (req: any) => {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return {};
};

const getProductId = (req: any) => {
  const rawId = Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id;
  const id = Number(rawId);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const getBearerToken = (req: any) => {
  const authHeader = req.headers?.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  return authHeader.slice(7);
};

const requireProductEditPermission = async (req: any, res: any) => {
  const token = getBearerToken(req);
  if (!token) {
    sendError(res, "Unauthorized: Login required", 401);
    return null;
  }

  const decoded = verifyToken(token);
  if (!decoded?.userId) {
    sendError(res, "Unauthorized: Login required", 401);
    return null;
  }

  if (decoded.role === "administrador") return decoded;

  const { UserRepository } = await import("../../repositories/userRepository.js");
  const permissions = await UserRepository.getPermissions(Number(decoded.userId));
  if (!permissions?.products?.can_edit) {
    sendError(res, "Forbidden: No permission for products", 403);
    return null;
  }

  return decoded;
};

const parseBody = (action: InventoryAction, body: any) => {
  if (action === "stock") return stockSchema.safeParse(body);
  if (action === "expire") return expireSchema.safeParse(body);
  return minStockSchema.safeParse(body);
};

const handleSqlite = async (action: InventoryAction, productId: number, data: any, usuario: string) => {
  const { default: db } = await import("../../db.js");
  return db.transaction(() => {
    const product = db
      .prepare("SELECT id, stock FROM products WHERE id = ? AND eliminado = 0")
      .get(productId) as any;

    if (!product) throw new AppError("Producto no encontrado", 404);

    if (action === "stock") {
      db.prepare("UPDATE products SET stock = stock + ? WHERE id = ?").run(data.cantidad, productId);
      db.prepare(`
        INSERT INTO stock_movimientos (
          product_id, cantidad, costo_unitario, cantidad_restante,
          descripcion, tipo_movimiento, motivo, usuario
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        productId,
        data.cantidad,
        data.costo_unitario,
        data.cantidad,
        data.notes || "Carga de stock",
        "ingreso",
        "carga_stock",
        usuario
      );
      return "Stock actualizado exitosamente";
    }

    if (action === "min-stock") {
      db.prepare("UPDATE products SET stock_minimo = ? WHERE id = ?").run(data.stock_minimo, productId);
      return "Stock mínimo actualizado exitosamente";
    }

    if (Number(product.stock || 0) < data.cantidad) {
      throw new AppError("Stock insuficiente para realizar la merma", 400);
    }

    db.prepare("UPDATE products SET stock = stock - ? WHERE id = ?").run(data.cantidad, productId);
    db.prepare(`
      INSERT INTO stock_movimientos (
        product_id, cantidad, cantidad_restante, descripcion,
        tipo_movimiento, motivo, usuario
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      productId,
      data.cantidad,
      0,
      data.notes || "Merma/Vencimiento",
      "egreso",
      "merma",
      usuario
    );

    return "Merma registrada exitosamente";
  })();
};

export const applyProductInventoryPostgres = async (
  client: any,
  action: InventoryAction,
  productId: number,
  data: any,
  usuario: string
) => {
  const productResult = await client.query(
    `SELECT id, stock
     FROM products
     WHERE id = $1 AND eliminado = 0
     LIMIT 1
     FOR UPDATE`,
    [productId]
  );

  if (!productResult.rowCount) throw new AppError("Producto no encontrado", 404);

  if (action === "stock") {
    await client.query(
      "UPDATE products SET stock = COALESCE(stock, 0) + $1 WHERE id = $2",
      [data.cantidad, productId]
    );
    await client.query(
      `INSERT INTO stock_movimientos (
         product_id, cantidad, costo_unitario, cantidad_restante,
         descripcion, tipo_movimiento, motivo, usuario
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        productId,
        data.cantidad,
        data.costo_unitario,
        data.cantidad,
        data.notes || "Carga de stock",
        "ingreso",
        "carga_stock",
        usuario,
      ]
    );
    return "Stock actualizado exitosamente";
  }

  if (action === "min-stock") {
    await client.query("UPDATE products SET stock_minimo = $1 WHERE id = $2", [
      data.stock_minimo,
      productId,
    ]);
    return "Stock mínimo actualizado exitosamente";
  }

  const currentStock = Number(productResult.rows[0]?.stock || 0);
  if (currentStock < data.cantidad) {
    throw new AppError("Stock insuficiente para realizar la merma", 400);
  }

  await client.query("UPDATE products SET stock = stock - $1 WHERE id = $2", [
    data.cantidad,
    productId,
  ]);
  await client.query(
    `INSERT INTO stock_movimientos (
       product_id, cantidad, cantidad_restante, descripcion,
       tipo_movimiento, motivo, usuario
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      productId,
      data.cantidad,
      0,
      data.notes || "Merma/Vencimiento",
      "egreso",
      "merma",
      usuario,
    ]
  );

  return "Merma registrada exitosamente";
};

const handlePostgres = async (
  action: InventoryAction,
  productId: number,
  data: any,
  usuario: string
) => {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const message = await applyProductInventoryPostgres(client, action, productId, data, usuario);
    await client.query("COMMIT");
    return message;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export const handleProductInventoryAction = async (
  req: any,
  res: any,
  action: InventoryAction
) => {
  if (req.method !== "POST") return sendError(res, "Method not allowed", 405);

  const user = await requireProductEditPermission(req, res);
  if (!user) return;

  const productId = getProductId(req);
  if (!productId) return sendError(res, "ID de producto inválido", 400);

  const parsed = parseBody(action, getBody(req));
  if (!parsed.success) {
    return sendError(
      res,
      "Validation failed",
      400,
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      }))
    );
  }

  const usuario = user.userName || "Sistema";

  try {
    const message = isPostgresConfigured()
      ? await handlePostgres(action, productId, parsed.data, usuario)
      : await handleSqlite(action, productId, parsed.data, usuario);

    return sendSuccess(res, null, message);
  } catch (error: any) {
    return sendError(
      res,
      error?.message || "Error al actualizar inventario",
      error?.statusCode || 400,
      error?.errors || []
    );
  }
};
