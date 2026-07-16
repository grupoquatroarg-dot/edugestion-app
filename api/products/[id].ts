import { z } from "zod";
import {
  handleProductInventoryAction,
  type InventoryAction,
} from "../../server/services/vercel/productInventoryApiHelpers.js";
import {
  productLifecycleService,
  type ProductLifecycleAction,
} from "../../server/services/productLifecycleService.js";
import { ProductRepository } from "../../server/repositories/productRepository.js";
import { UserRepository } from "../../server/repositories/userRepository.js";
import { sendError, sendSuccess } from "../../server/utils/response.js";
import { requireBearerUser, type CurrentUserAuth } from "../../server/services/currentUserAuthService.js";

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

const lifecycleSchema = z.object({
  motivo: z.string().trim().min(3, "El motivo debe tener al menos 3 caracteres").max(500),
});

const getBody = (req: any) => {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
};

const permissionKeyByAction = {
  edit: "can_edit",
  delete: "can_delete",
} as const;

const requireProductPermission = async (
  req: any,
  res: any,
  action: keyof typeof permissionKeyByAction
): Promise<CurrentUserAuth | null> => {
  const decoded = await requireBearerUser(req, res);
  if (!decoded) return null;

  if (decoded.role === "administrador") return decoded;

  const permissions = await UserRepository.getPermissions(Number(decoded.userId));
  const productPermissions = permissions?.products;
  const permissionKey = permissionKeyByAction[action];

  if (!productPermissions?.[permissionKey]) {
    sendError(res, "Forbidden: No permission for products", 403);
    return null;
  }

  return decoded;
};

const getId = (req: any) => {
  const rawId = Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id;
  const id = Number(rawId);
  return Number.isFinite(id) && id > 0 ? id : null;
};

const isInventoryAction = (action: string): action is InventoryAction =>
  (["stock", "expire", "min-stock"] as const).includes(action as InventoryAction);

const isLifecycleAction = (action: string): action is ProductLifecycleAction =>
  (["deactivate", "reactivate"] as const).includes(action as ProductLifecycleAction);

export default async function handler(req: any, res: any) {
  const id = getId(req);
  if (!id) return sendError(res, "ID de producto inválido", 400);

  if (req.method === "POST") {
    const rawAction = Array.isArray(req.query?.action) ? req.query.action[0] : req.query?.action;
    const action = typeof rawAction === "string" ? rawAction : "";

    if (isInventoryAction(action)) {
      return handleProductInventoryAction(req, res, action);
    }

    if (isLifecycleAction(action)) {
      const user = await requireProductPermission(req, res, "delete");
      if (!user) return;

      const parsed = lifecycleSchema.safeParse(getBody(req));
      if (!parsed.success) {
        return sendError(
          res,
          "Validation failed",
          400,
          parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }))
        );
      }

      try {
        const result = await productLifecycleService.changeStatus({
          productId: id,
          action,
          motivo: parsed.data.motivo,
          usuario: user.userName || "Sistema",
        });
        return sendSuccess(
          res,
          result,
          action === "deactivate"
            ? "Producto dado de baja correctamente"
            : "Producto reactivado correctamente"
        );
      } catch (error: any) {
        return sendError(
          res,
          error?.message || "No se pudo actualizar el estado del producto",
          error?.statusCode || 400,
          error?.errors || []
        );
      }
    }

    return sendError(res, "Acción de producto inválida", 400);
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
        parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }))
      );
    }

    try {
      const currentProduct = await ProductRepository.findById(id);
      if (!currentProduct) return sendError(res, "Producto no encontrado", 404);

      if (parsed.data.estado && parsed.data.estado !== currentProduct.estado) {
        return sendError(
          res,
          "El estado del producto debe cambiarse desde Dar de baja o Reactivar para conservar la auditoría.",
          409
        );
      }

      const updatedProduct = await ProductRepository.update(id, parsed.data);
      return sendSuccess(res, updatedProduct, "Producto actualizado exitosamente");
    } catch (error: any) {
      return sendError(
        res,
        error?.message || "Error al actualizar el producto",
        error?.statusCode || 400,
        error?.errors || []
      );
    }
  }

  if (req.method === "DELETE") {
    const user = await requireProductPermission(req, res, "delete");
    if (!user) return;
    return sendError(
      res,
      "La eliminación física de productos está deshabilitada. Usá la opción Dar de baja.",
      405
    );
  }

  return sendError(res, "Method not allowed", 405);
}
