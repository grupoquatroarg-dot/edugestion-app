import { UserRepository } from "../../repositories/userRepository.js";
import { requireBearerUser } from "../currentUserAuthService.js";
import { sendError } from "../../utils/response.js";

const getPermissionKey = (action: "view" | "create" | "delete") => {
  if (action === "view") return "can_view";
  if (action === "delete") return "can_delete";
  return "can_create";
};

export const requirePurchaseInvoicePermission = async (
  req: any,
  res: any,
  action: "view" | "create" | "delete"
) => {
  const decoded = await requireBearerUser(req, res);
  if (!decoded) return null;

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
