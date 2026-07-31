import { sendError, sendSuccess } from "../../../server/utils/response.js";
import {
  getEndpoint,
  getId,
  getPoolOrFail,
  getRequestBody,
  requireSettingsPermission,
  validateName,
} from "../../../server/services/vercel/configApiHelpers.js";
import {
  configurationItemLifecycleService,
  type ConfigurationItemType,
  type ConfigurationLifecycleAction,
} from "../../../server/services/configurationItemLifecycleService.js";
import {
  configurationItemContentLifecycleService,
  type ConfigurationContentItemType,
} from "../../../server/services/configurationItemContentLifecycleService.js";

const PROTECTED_PAYMENT_NAMES = new Set(["Cta Cte", "Cheque"]);

const getItemType = (endpoint: string): ConfigurationItemType | null => {
  if (endpoint === "payment-methods") return "payment_method";
  if (endpoint === "product-categories") return "product_category";
  if (endpoint === "product-families" || endpoint === "families") return "product_family";
  return null;
};

const getContentItemType = (endpoint: string): ConfigurationContentItemType | null => {
  if (endpoint === "payment-methods") return "payment_method";
  if (endpoint === "product-categories") return "product_category";
  if (endpoint === "product-families" || endpoint === "families") return "product_family";
  return null;
};

export default async function handler(req: any, res: any) {
  const endpoint = getEndpoint(req);
  const id = getId(req);

  if (!id) return sendError(res, "ID inválido", 400);

  try {
    if (req.method === "PUT") {
      const user = await requireSettingsPermission(req, res, "edit");
      if (!user) return;

      const itemType = getContentItemType(endpoint);
      if (!itemType) return sendError(res, "Endpoint de configuración no encontrado", 404);

      const body = getRequestBody(req);
      const result = await configurationItemContentLifecycleService.update({
        itemType,
        itemId: id,
        name: validateName(body),
        tipo: body.tipo,
        description: body.description,
        categoryId: body.category_id,
        motivo: String(body.motivo || ""),
        usuario: String(user.userName || "Sistema"),
        expectedContentVersion: Number(body.expectedContentVersion),
      });

      return sendSuccess(res, result, "Elemento actualizado con trazabilidad");
    }

    if (req.method === "POST") {
      const user = await requireSettingsPermission(req, res, "delete");
      if (!user) return;

      const itemType = getItemType(endpoint);
      if (!itemType) return sendError(res, "Endpoint de configuración no encontrado", 404);

      const body = getRequestBody(req);
      const action = String(body.action || "") as ConfigurationLifecycleAction;
      if (action !== "deactivate" && action !== "reactivate") {
        return sendError(res, "Acción de ciclo de vida inválida", 400);
      }

      const result = await configurationItemLifecycleService.changeStatus({
        itemType,
        itemId: id,
        action,
        motivo: String(body.motivo || ""),
        usuario: String(user.userName || "Sistema"),
      });

      return sendSuccess(
        res,
        result,
        action === "deactivate" ? "Elemento dado de baja correctamente" : "Elemento reactivado correctamente"
      );
    }

    if (req.method === "DELETE") {
      const user = await requireSettingsPermission(req, res, "delete");
      if (!user) return;
      return sendError(
        res,
        "La eliminación física de elementos de configuración está deshabilitada. Usá Dar de baja.",
        405
      );
    }

    return sendError(res, "Method not allowed", 405);
  } catch (error: any) {
    return sendError(res, error?.message || "Error en configuración", error?.statusCode || 400, error?.errors || []);
  }
}
