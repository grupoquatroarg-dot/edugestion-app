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

const PROTECTED_PAYMENT_NAMES = new Set(["Cta Cte", "Cheque"]);

const getItemType = (endpoint: string): ConfigurationItemType | null => {
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

      const pool = getPoolOrFail(res);
      if (!pool) return;

      const body = getRequestBody(req);
      const name = validateName(body);

      if (endpoint === "payment-methods") {
        const current = await pool.query("SELECT id, name FROM payment_methods WHERE id = $1 LIMIT 1", [id]);
        if (!current.rowCount) return sendError(res, "Forma de pago no encontrada", 404);

        const currentName = String(current.rows[0]?.name || "");
        if (PROTECTED_PAYMENT_NAMES.has(currentName) && name !== currentName) {
          return sendError(
            res,
            `La forma de pago ${currentName} es utilizada por reglas internas y no puede cambiar de nombre.`,
            409
          );
        }

        await pool.query(
          "UPDATE payment_methods SET name = $1, tipo = $2 WHERE id = $3",
          [name, body.tipo || "Efectivo", id]
        );
        return sendSuccess(res, null, "Método de pago actualizado");
      }

      if (endpoint === "product-categories") {
        const result = await pool.query(
          "UPDATE product_categories SET name = $1, description = $2 WHERE id = $3 RETURNING id",
          [name, body.description || null, id]
        );
        if (!result.rowCount) return sendError(res, "Categoría no encontrada", 404);
        return sendSuccess(res, null, "Categoría actualizada");
      }

      if (endpoint === "product-families" || endpoint === "families") {
        const current = await pool.query(
          "SELECT id, category_id, estado FROM product_families WHERE id = $1 LIMIT 1",
          [id]
        );
        if (!current.rowCount) return sendError(res, "Familia no encontrada", 404);

        const categoryId = body.category_id === null || body.category_id === undefined || body.category_id === ""
          ? null
          : Number(body.category_id);

        if (categoryId) {
          const category = await pool.query(
            "SELECT id, estado FROM product_categories WHERE id = $1 LIMIT 1",
            [categoryId]
          );
          const unchangedInactiveAssociation =
            Number(current.rows[0]?.category_id || 0) === categoryId &&
            String(current.rows[0]?.estado || "activo").toLowerCase() === "inactivo";

          if (!category.rowCount || (
            String(category.rows[0]?.estado || "activo").toLowerCase() !== "activo" &&
            !unchangedInactiveAssociation
          )) {
            return sendError(res, "La categoría seleccionada está inactiva o no existe", 409);
          }
        }

        await pool.query(
          "UPDATE product_families SET name = $1, category_id = $2 WHERE id = $3",
          [name, categoryId, id]
        );
        return sendSuccess(res, null, "Familia actualizada");
      }

      return sendError(res, "Endpoint de configuración no encontrado", 404);
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
