import { z } from "zod";
import { clientRepository } from "../server/repositories/clientRepository.js";
import { UserRepository } from "../server/repositories/userRepository.js";
import { verifyToken } from "../server/utils/jwt.js";
import { sendError, sendSuccess } from "../server/utils/response.js";

const clientSchema = z.object({
  nombre_apellido: z.string().min(2, "El nombre es requerido"),
  razon_social: z.string().optional().nullable(),
  cuit: z.string().optional().nullable(),
  telefono: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  direccion: z.string().optional().nullable(),
  localidad: z.string().optional().nullable(),
  provincia: z.string().optional().nullable(),
  latitud: z.number().optional().nullable(),
  longitud: z.number().optional().nullable(),
  observaciones: z.string().optional().nullable(),
  tipo_cliente: z.enum(["minorista", "mayorista"]).optional(),
  lista_precio: z.string().optional().nullable(),
  limite_credito: z.number().optional().nullable(),
});

const getBody = (req: any) => {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
};

const getBearerToken = (req: any) => {
  const authHeader = req.headers?.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  return authHeader.slice(7);
};

const permissionKeyByAction = { view: "can_view", create: "can_create", edit: "can_edit", delete: "can_delete" } as const;

const requireClientPermission = async (req: any, res: any, action: keyof typeof permissionKeyByAction) => {
  const token = getBearerToken(req);
  if (!token) { sendError(res, "Unauthorized: Login required", 401); return null; }

  const decoded = verifyToken(token);
  if (!decoded?.userId) { sendError(res, "Unauthorized: Login required", 401); return null; }
  if (decoded.role === "administrador") return decoded;

  const permissions = await UserRepository.getPermissions(Number(decoded.userId));
  const permissionKey = permissionKeyByAction[action];
  const clientPermissions = permissions?.clients || permissions?.customers;

  if (!clientPermissions?.[permissionKey]) {
    sendError(res, "Forbidden: No permission for clients", 403);
    return null;
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

  if (req.method === "GET") {
    const user = await requireClientPermission(req, res, "view");
    if (!user) return;

    try {
      if (id) {
        const cliente = await clientRepository.findById(id);
        if (!cliente) return sendError(res, "Cliente no encontrado", 404);
        return sendSuccess(res, cliente);
      }

      const clientes = await clientRepository.findAll();
      return sendSuccess(res, clientes);
    } catch (error: any) {
      return sendError(res, error?.message || "Error al obtener clientes", error?.statusCode || 400, error?.errors || []);
    }
  }

  if (req.method === "POST") {
    const user = await requireClientPermission(req, res, "create");
    if (!user) return;

    const rawBody = getBody(req);
    const body = {
      ...rawBody,
      tipo_cliente: rawBody.tipo_cliente || "minorista",
      limite_credito: Number(rawBody.limite_credito || 0),
    };

    const parsed = clientSchema.safeParse(body);
    if (!parsed.success) {
      return sendError(res, "Validation failed", 400, parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })));
    }

    try {
      const newId = await clientRepository.create(parsed.data as any);
      const cliente = await clientRepository.findById(newId);
      return sendSuccess(res, cliente, "Cliente creado exitosamente", 201);
    } catch (error: any) {
      return sendError(res, error?.message || "Error al crear cliente", error?.statusCode || 400, error?.errors || []);
    }
  }

  if (req.method === "PUT") {
    const user = await requireClientPermission(req, res, "edit");
    if (!user) return;
    if (!id) return sendError(res, "ID de cliente invalido", 400);

    const rawBody = getBody(req);
    const body = {
      ...rawBody,
      tipo_cliente: rawBody.tipo_cliente || "minorista",
      limite_credito: Number(rawBody.limite_credito || 0),
    };

    const parsed = clientSchema.safeParse(body);
    if (!parsed.success) {
      return sendError(res, "Validation failed", 400, parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })));
    }

    try {
      await clientRepository.update(id, parsed.data as any);
      const cliente = await clientRepository.findById(id);
      return sendSuccess(res, cliente, "Cliente actualizado exitosamente");
    } catch (error: any) {
      return sendError(res, error?.message || "Error al actualizar cliente", error?.statusCode || 400, error?.errors || []);
    }
  }

  if (req.method === "DELETE") {
    const user = await requireClientPermission(req, res, "delete");
    if (!user) return;
    if (!id) return sendError(res, "ID de cliente invalido", 400);

    try {
      await clientRepository.delete(id);
      return sendSuccess(res, null, "Cliente eliminado exitosamente");
    } catch (error: any) {
      return sendError(res, error?.message || "Error al eliminar cliente", error?.statusCode || 400, error?.errors || []);
    }
  }

  return sendError(res, "Method not allowed", 405);
}
