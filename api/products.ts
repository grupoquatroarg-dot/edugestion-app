import { z } from "zod";
import db from "../server/db.js";
import { requireAuth } from "../server/middleware/authMiddleware.js";
import { ProductRepository } from "../server/repositories/productRepository.js";
import { UserRepository } from "../server/repositories/userRepository.js";
import { getPostgresPool, isPostgresConfigured } from "../server/utils/postgres.js";
import { sendError, sendSuccess } from "../server/utils/response.js";
import { verifyToken } from "../server/utils/jwt.js";

const productSchema = z.object({
  code: z.string().min(1, "El cÃ³digo es requerido"),
  name: z.string().min(2, "El nombre debe tener al menos 2 caracteres"),
  description: z.string().optional().nullable(),
  cost: z.number().min(0, "El costo no puede ser negativo"),
  sale_price: z.number().min(0, "El precio de venta no puede ser negativo"),
  stock: z.number().min(0, "El stock no puede ser negativo").optional(),
  stock_minimo: z.number().min(0, "El stock mÃ­nimo no puede ser negativo").optional(),
  company: z.enum(["Edu", "Peti"]),
  family_id: z.number().nullable(),
  category_id: z.number().nullable(),
  estado: z.enum(["activo", "inactivo"]).optional(),
});

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

const getBearerToken = (req: any) => {
  const authHeader = req.headers?.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  return authHeader.slice(7);
};

const permissionKeyByAction = {
  view: "can_view",
  create: "can_create",
} as const;

const requireProductPermission = async (req: any, res: any, action: keyof typeof permissionKeyByAction) => {
  const token = getBearerToken(req);

  if (!token) {
    return sendError(res, "Unauthorized: Login required", 401);
  }

  const decoded = verifyToken(token);

  if (!decoded?.userId) {
    return sendError(res, "Unauthorized: Login required", 401);
  }

  if (decoded.role === "administrador") {
    return decoded;
  }

  const permissions = await UserRepository.getPermissions(Number(decoded.userId));
  const productPermissions = permissions?.products;
  const permissionKey = permissionKeyByAction[action];

  if (!productPermissions?.[permissionKey]) {
    return sendError(res, "Forbidden: No permission for products", 403);
  }

  return decoded;
};

export default async function handler(req: any, res: any) {
  if (req.method === "GET") {
    const user = await requireProductPermission(req, res, "view");
    if (!user) return;

    try {
      const products = await ProductRepository.findAll();
      return sendSuccess(res, products);
    } catch (error: any) {
      return sendError(res, error?.message || "Error al obtener productos", 400);
    }
  }

  if (req.method === "POST") {
    const user = await requireProductPermission(req, res, "create");
    if (!user) return;

    const parsed = productSchema.safeParse(getBody(req));

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
      if (!isPostgresConfigured()) {
        let newProduct: any;

        db.transaction(() => {
          newProduct = ProductRepository.create(parsed.data) as any;

          if (parsed.data.stock && parsed.data.stock > 0) {
            db.prepare(`
              INSERT INTO stock_movimientos (product_id, cantidad, costo_unitario, cantidad_restante, tipo_movimiento, usuario, motivo)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(newProduct.id, parsed.data.stock, parsed.data.cost, parsed.data.stock, "ingreso", usuario, "Carga inicial");
          }
        })();

        return sendSuccess(res, newProduct, "Producto creado exitosamente", 201);
      }

      const pool = getPostgresPool();
      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        const newProduct = await ProductRepository.create(parsed.data, client);

        if (parsed.data.stock && parsed.data.stock > 0) {
          await client.query(
            `INSERT INTO stock_movimientos (product_id, cantidad, costo_unitario, cantidad_restante, tipo_movimiento, usuario, motivo)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [newProduct.id, parsed.data.stock, parsed.data.cost, parsed.data.stock, "ingreso", usuario, "Carga inicial"]
          );
        }

        await client.query("COMMIT");
        return sendSuccess(res, newProduct, "Producto creado exitosamente", 201);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } catch (error: any) {
      return sendError(res, error?.message || "Error al crear el producto", error?.statusCode || 400, error?.errors || []);
    }
  }

  return sendError(res, "Method not allowed", 405);
}

