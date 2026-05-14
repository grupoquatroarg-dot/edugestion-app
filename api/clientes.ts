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

const baseUserSchema = z.object({
  name: z.string().min(2, "Nombre demasiado corto"),
  email: z.string().email("Email invalido"),
  role: z.enum(["administrador", "empleado", "vendedor", "operario"]),
  active: z.union([z.number(), z.boolean()]).optional(),
  avatar: z.string().optional(),
});

const createUserSchema = baseUserSchema.extend({
  password: z.string().min(6, "La contrasena debe tener al menos 6 caracteres"),
});

const updateUserSchema = baseUserSchema.extend({
  password: z
    .string()
    .optional()
    .refine(
      (value) => value === undefined || value === "" || value.length >= 6,
      "La contrasena debe tener al menos 6 caracteres"
    ),
});

const permissionsSchema = z.object({
  permissions: z.record(
    z.string(),
    z.object({
      module: z.string(),
      can_view: z.boolean(),
      can_create: z.boolean(),
      can_edit: z.boolean(),
      can_delete: z.boolean(),
    })
  ),
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
  delete: "can_delete",
} as const;

const requireClientPermission = async (req: any, res: any, action: keyof typeof permissionKeyByAction) => {
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
  const permissionKey = permissionKeyByAction[action];
  const clientPermissions = permissions?.clients || permissions?.customers;

  if (!clientPermissions?.[permissionKey]) {
    sendError(res, "Forbidden: No permission for clients", 403);
    return null;
  }

  return decoded;
};

const requireAdmin = async (req: any, res: any) => {
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

  if (decoded.role !== "administrador") {
    sendError(res, "Forbidden: Solo administrador", 403);
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

const normalizeClientBody = (body: any) => ({
  ...body,
  tipo_cliente: body.tipo_cliente || "minorista",
  limite_credito: Number(body.limite_credito || 0),
});

const handleUsers = async (req: any, res: any) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const id = getId(req);

  if (req.method === "GET") {
    try {
      if (id) {
        const user = await UserRepository.findById(id);
        if (!user) return sendError(res, "Usuario no encontrado", 404);
        return sendSuccess(res, user);
      }

      const users = await UserRepository.findAll();
      return sendSuccess(res, users);
    } catch (error: any) {
      return sendError(res, error?.message || "Error al obtener usuarios", error?.statusCode || 400, error?.errors || []);
    }
  }

  if (req.method === "POST") {
    const parsed = createUserSchema.safeParse(getBody(req));

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
      const newUser = await UserRepository.create(parsed.data);
      return sendSuccess(res, newUser, "Usuario creado exitosamente", 201);
    } catch (error: any) {
      if (error?.code === "SQLITE_CONSTRAINT" || error?.code === "23505") {
        return sendError(res, "El email ya esta registrado", 400);
      }

      return sendError(res, error?.message || "Error al crear usuario", error?.statusCode || 400, error?.errors || []);
    }
  }

  if (req.method === "PUT") {
    if (!id) return sendError(res, "ID de usuario invalido", 400);

    const parsed = updateUserSchema.safeParse(getBody(req));

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
      const updatedUser = await UserRepository.update(id, parsed.data);
      return sendSuccess(res, updatedUser, "Usuario actualizado exitosamente");
    } catch (error: any) {
      if (error?.code === "SQLITE_CONSTRAINT" || error?.code === "23505") {
        return sendError(res, "El email ya esta registrado", 400);
      }

      return sendError(res, error?.message || "Error al actualizar usuario", error?.statusCode || 400, error?.errors || []);
    }
  }

  return sendError(res, "Method not allowed", 405);
};

const handleUserPermissions = async (req: any, res: any) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const id = getId(req);
  if (!id) return sendError(res, "ID de usuario invalido", 400);

  if (req.method === "GET") {
    try {
      const permissions = await UserRepository.getPermissions(id);
      return sendSuccess(res, permissions);
    } catch (error: any) {
      return sendError(res, error?.message || "Error al obtener permisos", error?.statusCode || 400, error?.errors || []);
    }
  }

  if (req.method === "PUT") {
    const parsed = permissionsSchema.safeParse(getBody(req));

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
      await UserRepository.updatePermissions(id, parsed.data.permissions);
      return sendSuccess(res, null, "Permisos actualizados");
    } catch (error: any) {
      return sendError(res, error?.message || "Error al actualizar permisos", error?.statusCode || 400, error?.errors || []);
    }
  }

  return sendError(res, "Method not allowed", 405);
};

export default async function handler(req: any, res: any) {
  const endpoint = getEndpoint(req);

  if (endpoint === "users") {
    return handleUsers(req, res);
  }

  if (endpoint === "users-permissions") {
    return handleUserPermissions(req, res);
  }

  const id = getId(req);

  if (req.method === "GET") {
    const user = await requireClientPermission(req, res, "view");
    if (!user) return;

    try {
      if (id) {
        const cliente = await clientRepository.findById(id);

        if (!cliente) {
          return sendError(res, "Cliente no encontrado", 404);
        }

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

    const parsed = clientSchema.safeParse(normalizeClientBody(getBody(req)));

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

    if (!id) {
      return sendError(res, "ID de cliente invalido", 400);
    }

    const parsed = clientSchema.safeParse(normalizeClientBody(getBody(req)));

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

    if (!id) {
      return sendError(res, "ID de cliente invalido", 400);
    }

    try {
      await clientRepository.delete(id);
      return sendSuccess(res, null, "Cliente eliminado exitosamente");
    } catch (error: any) {
      return sendError(res, error?.message || "Error al eliminar cliente", error?.statusCode || 400, error?.errors || []);
    }
  }

  return sendError(res, "Method not allowed", 405);
}
