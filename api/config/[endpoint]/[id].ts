import { sendError, sendSuccess } from "../../../server/utils/response.js";
import {
  getEndpoint,
  getId,
  getPoolOrFail,
  getRequestBody,
  requireSettingsPermission,
  validateName,
} from "../../../server/services/vercel/configApiHelpers.js";

export default async function handler(req: any, res: any) {
  const endpoint = getEndpoint(req);
  const id = getId(req);

  if (!id) {
    return sendError(res, "ID invÃ¡lido", 400);
  }

  try {
    if (req.method === "PUT") {
      const user = await requireSettingsPermission(req, res, "edit");
      if (!user) return;

      const pool = getPoolOrFail(res);
      if (!pool) return;

      const body = getRequestBody(req);
      const name = validateName(body);

      if (endpoint === "payment-methods") {
        await pool.query(
          "UPDATE payment_methods SET name = $1, tipo = $2, activo = $3 WHERE id = $4",
          [name, body.tipo || "Efectivo", body.activo !== undefined ? Number(body.activo) : 1, id]
        );
        return sendSuccess(res, null, "MÃ©todo de pago actualizado");
      }

      if (endpoint === "product-categories") {
        await pool.query(
          "UPDATE product_categories SET name = $1, description = $2, estado = $3 WHERE id = $4",
          [name, body.description || null, body.estado || "activo", id]
        );
        return sendSuccess(res, null, "CategorÃ­a actualizada");
      }

      if (endpoint === "product-families" || endpoint === "families") {
        const categoryId = body.category_id === null || body.category_id === undefined || body.category_id === "" ? null : Number(body.category_id);
        await pool.query(
          "UPDATE product_families SET name = $1, category_id = $2, estado = $3 WHERE id = $4",
          [name, categoryId, body.estado || "activo", id]
        );
        return sendSuccess(res, null, "Familia actualizada");
      }

      return sendError(res, "Endpoint de configuraciÃ³n no encontrado", 404);
    }

    if (req.method === "DELETE") {
      const user = await requireSettingsPermission(req, res, "delete");
      if (!user) return;

      const pool = getPoolOrFail(res);
      if (!pool) return;

      if (endpoint === "payment-methods") {
        await pool.query("DELETE FROM payment_methods WHERE id = $1", [id]);
        return sendSuccess(res, null, "MÃ©todo de pago eliminado");
      }

      if (endpoint === "product-categories") {
        await pool.query("DELETE FROM product_categories WHERE id = $1", [id]);
        return sendSuccess(res, null, "CategorÃ­a eliminada");
      }

      if (endpoint === "product-families" || endpoint === "families") {
        await pool.query("DELETE FROM product_families WHERE id = $1", [id]);
        return sendSuccess(res, null, "Familia eliminada");
      }

      return sendError(res, "Endpoint de configuraciÃ³n no encontrado", 404);
    }

    return sendError(res, "Method not allowed", 405);
  } catch (error: any) {
    if (error?.code === "23503") {
      return sendError(res, "No se puede eliminar porque tiene datos relacionados.", 400);
    }
    return sendError(res, error?.message || "Error en configuraciÃ³n", 400);
  }
}
