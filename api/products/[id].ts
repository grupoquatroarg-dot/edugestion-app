import { z } from "zod";
import { ProductRepository } from "../../server/repositories/productRepository.js";
import { UserRepository } from "../../server/repositories/userRepository.js";
import { sendError, sendSuccess } from "../../server/utils/response.js";
import { verifyToken } from "../../server/utils/jwt.js";

const productSchema = z.object({
  code: z.string().min(1, "El codigo es requerido"),
  name: z.string().min(2, "El nombre debe tener al menos 2 caracteres"),
  description: z.string().optional().nullable(),
  cost: z.number().min(0, "El costo no puede ser negativo"),
  sale_price: z.number().min(0, "El precio de venta no puede ser negativo"),
  stock: z.number().min(0, "El stock no puede ser negativo").optional(),
  stock_minimo: z.number().min(0, "El stock minimo no puede ser negativo").optional(),
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
  edit: "can_edit",
  delete: "can_delete",
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

const getId = (req: any) => {
  const rawId = Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id;
  const id = Number(rawId);
  return Number.isFinite(id) && id > 0 ? id : null;
};

export default async function handler(req: any, res: any) {
  const id = getId(req);

  if (!id) {
    return sendError(res, "ID de producto invalido", 400);
  }

  if (req.method === "PUT") {
    const user = await requireProductPermission(req, res, "edit");
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

    try {
      const updatedProduct = await ProductRepository.update(id, parsed.data);
      return sendSuccess(res, updatedProduct, "Producto actualizado exitosamente");
    } catch (error: any) {
      return sendError(res, error?.message || "Error al actualizar el producto", error?.statusCode || 400, error?.errors || []);
    }
  }

  if (req.method === "DELETE") {
    const user = await requireProductPermission(req, res, "delete");
    if (!user) return;

    try {
      await ProductRepository.softDelete(id);
      return sendSuccess(res, null, "Producto eliminado exitosamente");
    } catch (error: any) {
      return sendError(res, error?.message || "Error al eliminar el producto", error?.statusCode || 400, error?.errors || []);
    }
  }

  return sendError(res, "Method not allowed", 405);
}

