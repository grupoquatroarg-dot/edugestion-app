import { z } from "zod";
import { providerRepository } from "../server/repositories/providerRepository.js";
import { UserRepository } from "../server/repositories/userRepository.js";
import { sendError, sendSuccess } from "../server/utils/response.js";
import { verifyToken } from "../server/utils/jwt.js";

const providerSchema = z.object({
  nombre: z.string().min(2, "El nombre debe tener al menos 2 caracteres"),
  cuit: z.string().optional(),
  telefono: z.string().optional(),
  email: z.string().email("Email invalido").optional().or(z.literal("")),
  direccion: z.string().optional(),
  estado: z.string().optional(),
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

const requireSupplierPermission = async (req: any, res: any, action: keyof typeof permissionKeyByAction) => {
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
  const supplierPermissions = permissions?.suppliers;
  const permissionKey = permissionKeyByAction[action];

  if (!supplierPermissions?.[permissionKey]) {
    return sendError(res, "Forbidden: No permission for suppliers", 403);
  }

  return decoded;
};

export default async function handler(req: any, res: any) {
  if (req.method === "GET") {
    const user = await requireSupplierPermission(req, res, "view");
    if (!user) return;

    try {
      const providers = await providerRepository.findAll();
      return sendSuccess(res, providers);
    } catch (error: any) {
      return sendError(res, error?.message || "Error al obtener proveedores", 400);
    }
  }

  if (req.method === "POST") {
    const user = await requireSupplierPermission(req, res, "create");
    if (!user) return;

    const parsed = providerSchema.safeParse(getBody(req));

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
      const id = await providerRepository.create(parsed.data);
      return sendSuccess(res, { id, ...parsed.data }, "Proveedor creado exitosamente", 201);
    } catch (error: any) {
      return sendError(res, error?.message || "Error al crear proveedor", 400);
    }
  }

  return sendError(res, "Method not allowed", 405);
}
