import { UserRepository } from "../../repositories/userRepository.js";
import { verifyToken } from "../../utils/jwt.js";
import { sendError } from "../../utils/response.js";
import { getPostgresPool, isPostgresConfigured } from "../../utils/postgres.js";

export type ConfigAction = "view" | "create" | "edit" | "delete";

export const toNumber = (value: any, fallback: number = 0) => {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

export const getEndpoint = (req: any) => {
  const value = req.query?.endpoint;
  return Array.isArray(value) ? value[0] : String(value || "");
};

export const getId = (req: any) => {
  const value = req.query?.id;
  return Number(Array.isArray(value) ? value[0] : value);
};

export const getRequestBody = (req: any) => {
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

export const getPoolOrFail = (res: any) => {
  if (!isPostgresConfigured()) {
    sendError(res, "DATABASE_URL no configurada", 500);
    return null;
  }

  return getPostgresPool();
};

const getPermissionKey = (action: ConfigAction) => {
  if (action === "view") return "can_view";
  if (action === "create") return "can_create";
  if (action === "edit") return "can_edit";
  return "can_delete";
};

const getBearerToken = (req: any) => {
  const authHeader = req.headers?.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  return authHeader.slice(7);
};

export const requireSettingsPermission = async (req: any, res: any, action: ConfigAction) => {
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
  const settingsPermissions = permissions?.settings;
  const permissionKey = getPermissionKey(action);

  if (!settingsPermissions?.[permissionKey]) {
    sendError(res, "Forbidden: No permission for settings", 403);
    return null;
  }

  return decoded;
};

export const mapCategory = (row: any) => ({
  id: toNumber(row.id),
  name: row.name,
  description: row.description || "",
  estado: row.estado || "activo",
});

export const mapFamily = (row: any) => ({
  id: toNumber(row.id),
  name: row.name,
  category_id: row.category_id === null || row.category_id === undefined ? null : toNumber(row.category_id),
  estado: row.estado || "activo",
  category_name: row.category_name || null,
});

export const mapPaymentMethod = (row: any) => ({
  id: toNumber(row.id),
  name: row.name,
  tipo: row.tipo || "Efectivo",
  activo: toNumber(row.activo, 1),
});

export const validateName = (body: any) => {
  const name = String(body?.name || "").trim();
  if (name.length < 2) {
    throw new Error("Nombre demasiado corto");
  }
  return name;
};
