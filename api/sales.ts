import { z } from "zod";
import { salesRepository } from "../server/repositories/salesRepository.js";
import { salesService } from "../server/services/salesService.js";
import { UserRepository } from "../server/repositories/userRepository.js";
import { verifyToken } from "../server/utils/jwt.js";
import { sendError, sendSuccess } from "../server/utils/response.js";

const saleSchema = z.object({
  cliente_id: z.number(),
  nombre_cliente: z.string().optional(),
  metodo_pago: z.string(),
  monto_pagado: z.number().nonnegative().optional(),
  notes: z.string().optional(),
  cheque_data: z.any().optional(),
  items: z.array(z.object({
    product_id: z.number(),
    cantidad: z.number().positive(),
    precio_venta: z.number().nonnegative(),
  })).min(1, "Debe incluir al menos un producto"),
  total: z.number().nonnegative(),
});

const paymentSchema = z.object({
  monto: z.number().positive("El monto debe ser mayor a cero"),
  metodo_pago: z.string().min(1, "Metodo de pago requerido"),
  observaciones: z.string().optional(),
  fecha: z.string().optional(),
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
  edit: "can_edit",
} as const;

const requirePermission = async (
  req: any,
  res: any,
  moduleName: "sales" | "current_accounts",
  action: keyof typeof permissionKeyByAction
) => {
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

  if (decoded.role === "administrador") {
    return decoded;
  }

  const permissions = await UserRepository.getPermissions(Number(decoded.userId));
  const perm = permissions?.[moduleName];
  const permissionKey = permissionKeyByAction[action];

  if (!perm?.[permissionKey]) {
    sendError(res, `Forbidden: No permission for ${moduleName}`, 403);
    return null;
  }

  return decoded;
};

const getId = (req: any) => {
  const rawId = Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id;
  const id = Number(rawId);
  return Number.isFinite(id) && id > 0 ? id : null;
};

const getEndpoint = (req: any) => {
  const rawEndpoint = Array.isArray(req.query?.endpoint) ? req.query.endpoint[0] : req.query?.endpoint;
  return String(rawEndpoint || "");
};

export default async function handler(req: any, res: any) {
  const id = getId(req);
  const endpoint = getEndpoint(req);

  if (req.method === "GET") {
    const user = await requirePermission(req, res, "sales", "view");
    if (!user) return;

    try {
      if (id) {
        const sale = await salesRepository.getById(id);

        if (!sale) {
          return sendError(res, "Venta no encontrada", 404);
        }

        return sendSuccess(res, sale);
      }

      const sales = await salesRepository.getAll();
      return sendSuccess(res, sales);
    } catch (error: any) {
      return sendError(res, error?.message || "Error al obtener ventas", error?.statusCode || 400, error?.errors || []);
    }
  }

  if (req.method === "POST" && endpoint === "client-payment") {
    const user = await requirePermission(req, res, "current_accounts", "create");
    if (!user) return;

    const clienteId = id;

    if (!clienteId) {
      return sendError(res, "ID de cliente invalido", 400);
    }

    const parsed = paymentSchema.safeParse(getBody(req));

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
      const result = await salesService.registerClientPayment({
        cliente_id: clienteId,
        ...parsed.data,
        usuario: user.userName || "Sistema",
      });

      return sendSuccess(res, result, "Pago registrado exitosamente", 201);
    } catch (error: any) {
      return sendError(res, error?.message || "Error al registrar pago", error?.statusCode || 400, error?.errors || []);
    }
  }

  if (req.method === "POST") {
    const user = await requirePermission(req, res, "sales", "create");
    if (!user) return;

    const parsed = saleSchema.safeParse(getBody(req));

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
      const result = await salesService.createSale({
        ...parsed.data,
        usuario: user.userName || "Sistema",
      });

      return sendSuccess(res, result, "Venta registrada exitosamente", 201);
    } catch (error: any) {
      return sendError(res, error?.message || "Error al procesar la venta", error?.statusCode || 400, error?.errors || []);
    }
  }

  return sendError(res, "Method not allowed", 405);
}
