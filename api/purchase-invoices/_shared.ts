import { UserRepository } from "../../server/repositories/userRepository.js";
import { verifyToken } from "../../server/utils/jwt.js";
import { sendError } from "../../server/utils/response.js";

export const getBearerToken = (req: any) => {
  const authHeader = req.headers?.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  return authHeader.slice(7);
};

const getPermissionKey = (action: "view" | "create") => (action === "view" ? "can_view" : "can_create");

export const requirePurchaseInvoicePermission = async (req: any, res: any, action: "view" | "create") => {
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
  const supplierPermissions = permissions?.suppliers;
  const permissionKey = getPermissionKey(action);

  if (!supplierPermissions?.[permissionKey]) {
    sendError(res, "Forbidden: No permission for purchase invoices", 403);
    return null;
  }

  return decoded;
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
