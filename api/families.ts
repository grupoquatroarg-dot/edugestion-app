import { sendError, sendSuccess } from "../server/utils/response.js";
import {
  getPoolOrFail,
  getRequestBody,
  mapFamily,
  requireSettingsPermission,
  validateName,
} from "../server/services/vercel/configApiHelpers.js";

export default async function handler(req: any, res: any) {
  try {
    if (req.method === "GET") {
      const user = await requireSettingsPermission(req, res, "view");
      if (!user) return;

      const pool = getPoolOrFail(res);
      if (!pool) return;

      const result = await pool.query(`
        SELECT f.*, c.name AS category_name
        FROM product_families f
        LEFT JOIN product_categories c ON f.category_id = c.id
        ORDER BY f.name ASC
      `);
      return sendSuccess(res, result.rows.map(mapFamily));
    }

    if (req.method === "POST") {
      const user = await requireSettingsPermission(req, res, "create");
      if (!user) return;

      const pool = getPoolOrFail(res);
      if (!pool) return;

      const body = getRequestBody(req);
      const name = validateName(body);
      const categoryId = body.category_id === null || body.category_id === undefined || body.category_id === "" ? null : Number(body.category_id);

      const result = await pool.query(
        `INSERT INTO product_families (name, category_id, estado)
         VALUES ($1, $2, $3)
         RETURNING id, name, category_id, estado`,
        [name, categoryId, body.estado || "activo"]
      );

      return sendSuccess(res, mapFamily(result.rows[0]), "Familia creada", 201);
    }

    return sendError(res, "Method not allowed", 405);
  } catch (error: any) {
    return sendError(res, error?.message || "Error al procesar familias", 400);
  }
}
