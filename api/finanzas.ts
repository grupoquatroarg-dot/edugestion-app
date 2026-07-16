import { financeRepository } from "../server/repositories/financeRepository.js";
import { providerRepository } from "../server/repositories/providerRepository.js";
import { UserRepository } from "../server/repositories/userRepository.js";
import { requireBearerUser } from "../server/services/currentUserAuthService.js";
import { sendError, sendSuccess } from "../server/utils/response.js";
import { manualExpenseCancellationService } from "../server/services/manualExpenseCancellationService.js";
import { listActivePaymentMethods } from "../server/services/paymentMethodAvailabilityService.js";

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

const permissionKeyByAction = {
  view: "can_view",
  create: "can_create",
  edit: "can_edit",
  delete: "can_delete",
} as const;

const requireCurrentAccountsPermission = async (req: any, res: any, action: keyof typeof permissionKeyByAction) => {
  const decoded = await requireBearerUser(req, res);
  if (!decoded) return null;

  if (decoded.role === "administrador") {
    return decoded;
  }

  const permissions = await UserRepository.getPermissions(Number(decoded.userId));
  const perm = permissions?.current_accounts;
  const permissionKey = permissionKeyByAction[action];

  if (!perm?.[permissionKey]) {
    sendError(res, "Forbidden: No permission for current accounts", 403);
    return null;
  }

  return decoded;
};

const getEndpoint = (req: any) => {
  const raw = req.query?.endpoint;
  return Array.isArray(raw) ? String(raw[0] || "") : String(raw || "");
};

const toNumber = (value: any, fallback: number = 0) => {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

export default async function handler(req: any, res: any) {
  const endpoint = getEndpoint(req);

  if (req.method === "GET" && endpoint === "movimientos") {
    const user = await requireCurrentAccountsPermission(req, res, "view");
    if (!user) return;

    try {
      const movimientos = await financeRepository.getMovements();
      return sendSuccess(res, movimientos);
    } catch (error: any) {
      return sendError(res, error?.message || "Error al obtener movimientos", error?.statusCode || 400, error?.errors || []);
    }
  }

  if (req.method === "GET" && endpoint === "cheques") {
    const user = await requireCurrentAccountsPermission(req, res, "view");
    if (!user) return;

    try {
      const cheques = await financeRepository.getCheques();
      return sendSuccess(res, cheques);
    } catch (error: any) {
      return sendError(res, error?.message || "Error al obtener cheques", error?.statusCode || 400, error?.errors || []);
    }
  }


  if (req.method === "GET" && endpoint === "payment-methods") {
    const user = await requireCurrentAccountsPermission(req, res, "view");
    if (!user) return;

    try {
      return sendSuccess(res, await listActivePaymentMethods());
    } catch (error: any) {
      return sendError(res, error?.message || "Error al obtener formas de pago", error?.statusCode || 400, error?.errors || []);
    }
  }

  if (req.method === "GET" && endpoint === "proveedores") {
    const user = await requireCurrentAccountsPermission(req, res, "view");
    if (!user) return;

    try {
      const proveedores = await providerRepository.findAll({ activeOnly: true });
      return sendSuccess(res, proveedores);
    } catch (error: any) {
      return sendError(res, error?.message || "Error al obtener proveedores", error?.statusCode || 400, error?.errors || []);
    }
  }

  if (req.method === "POST" && endpoint === "egresos") {
    const user = await requireCurrentAccountsPermission(req, res, "create");
    if (!user) return;

    const body = getBody(req);
    const amount = toNumber(body.monto);

    if (amount <= 0) return sendError(res, "El monto debe ser positivo", 400);
    if (!body.descripcion || String(body.descripcion).trim().length < 3) return sendError(res, "La descripción es muy corta", 400);
    if (!body.categoria) return sendError(res, "La categoría es requerida", 400);
    if (!body.forma_pago) return sendError(res, "La forma de pago es requerida", 400);

    try {
      await financeRepository.registerExpense({
        ...body,
        monto: amount,
        usuario: user.userName || "Sistema",
      });

      return sendSuccess(res, null, "Egreso registrado exitosamente", 201);
    } catch (error: any) {
      return sendError(res, error?.message || "Error al registrar egreso", error?.statusCode || 400, error?.errors || []);
    }
  }


  if (req.method === "POST" && endpoint === "manual-expense-cancel") {
    const user = await requireCurrentAccountsPermission(req, res, "delete");
    if (!user) return;

    const movementId = Number(req.query?.id);
    const body = getBody(req);

    if (!Number.isInteger(movementId) || movementId <= 0) {
      return sendError(res, "ID de movimiento inválido", 400);
    }

    try {
      const result = await manualExpenseCancellationService.cancelManualExpense({
        movementId,
        motivo: body.motivo,
        usuario: user.userName || "Sistema",
      });
      return sendSuccess(res, result, "Egreso anulado correctamente");
    } catch (error: any) {
      return sendError(
        res,
        error?.message || "No se pudo anular el egreso",
        error?.statusCode || 400,
        error?.errors || []
      );
    }
  }

  if (req.method === "PATCH" && endpoint === "cheques-estado") {
    const user = await requireCurrentAccountsPermission(req, res, "edit");
    if (!user) return;

    const chequeId = Number(req.query?.id);
    const body = getBody(req);

    if (!Number.isFinite(chequeId) || chequeId <= 0) return sendError(res, "ID de cheque inválido", 400);
    if (!body.estado) return sendError(res, "Estado requerido", 400);

    try {
      await financeRepository.updateChequeStatus(chequeId, body.estado, body.observaciones);
      return sendSuccess(res, null, "Estado de cheque actualizado");
    } catch (error: any) {
      return sendError(res, error?.message || "Error al actualizar cheque", error?.statusCode || 400, error?.errors || []);
    }
  }

  return sendError(res, "Endpoint de finanzas no encontrado", 404);
}
