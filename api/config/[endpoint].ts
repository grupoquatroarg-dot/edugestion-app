import { sendError, sendSuccess } from "../../server/utils/response.js";
import {
  getEndpoint,
  getPoolOrFail,
  getRequestBody,
  mapCategory,
  mapFamily,
  mapPaymentMethod,
  requireSettingsPermission,
  validateName,
} from "../../server/services/vercel/configApiHelpers.js";

export default async function handler(req: any, res: any) {
  const endpoint = getEndpoint(req);

  try {
    if (req.method === "GET") {
      const user = await requireSettingsPermission(req, res, "view");
      if (!user) return;

      const pool = getPoolOrFail(res);
      if (!pool) return;

      if (endpoint === "settings") {
        const result = await pool.query("SELECT key, value FROM settings");
        const settingsMap = result.rows.reduce((acc: any, row: any) => {
          acc[row.key] = row.value;
          return acc;
        }, {});
        return sendSuccess(res, settingsMap);
      }

      if (endpoint === "payment-methods") {
        const activeOnly = req.query?.active === "true";
        const result = activeOnly
          ? await pool.query("SELECT * FROM payment_methods WHERE activo = 1 ORDER BY name ASC")
          : await pool.query("SELECT * FROM payment_methods ORDER BY name ASC");
        return sendSuccess(res, result.rows.map(mapPaymentMethod));
      }

      if (endpoint === "product-categories") {
        const activeOnly = req.query?.active === "true";
        const result = activeOnly
          ? await pool.query("SELECT * FROM product_categories WHERE estado = 'activo' ORDER BY name ASC")
          : await pool.query("SELECT * FROM product_categories ORDER BY name ASC");
        return sendSuccess(res, result.rows.map(mapCategory));
      }

      if (endpoint === "product-families" || endpoint === "families") {
        const result = await pool.query(`
          SELECT f.*, c.name AS category_name
          FROM product_families f
          LEFT JOIN product_categories c ON f.category_id = c.id
          ORDER BY f.name ASC
        `);
        return sendSuccess(res, result.rows.map(mapFamily));
      }

      return sendError(res, "Endpoint de configuraciÃ³n no encontrado", 404);
    }

    if (req.method === "POST") {
      const user = await requireSettingsPermission(req, res, "create");
      if (!user) return;

      const pool = getPoolOrFail(res);
      if (!pool) return;

      const body = getRequestBody(req);

      if (endpoint === "settings") {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          for (const [key, value] of Object.entries(body)) {
            await client.query(
              `INSERT INTO settings (key, value)
               VALUES ($1, $2)
               ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
              [key, String(value)]
            );
          }
          await client.query("COMMIT");
          return sendSuccess(res, null, "ConfiguraciÃ³n guardada");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      }

      if (endpoint === "payment-methods") {
        const name = validateName(body);
        const tipo = body.tipo || "Efectivo";
        const result = await pool.query(
          `INSERT INTO payment_methods (name, tipo)
           VALUES ($1, $2)
           RETURNING id, name, tipo, activo`,
          [name, tipo]
        );
        return sendSuccess(res, mapPaymentMethod(result.rows[0]), "MÃ©todo de pago creado", 201);
      }

      if (endpoint === "product-categories") {
        const name = validateName(body);
        const result = await pool.query(
          `INSERT INTO product_categories (name, description, estado)
           VALUES ($1, $2, $3)
           RETURNING id, name, description, estado`,
          [name, body.description || null, body.estado || "activo"]
        );
        return sendSuccess(res, mapCategory(result.rows[0]), "CategorÃ­a creada", 201);
      }

      if (endpoint === "product-families" || endpoint === "families") {
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

      return sendError(res, "Endpoint de configuraciÃ³n no encontrado", 404);
    }

    return sendError(res, "Method not allowed", 405);
  } catch (error: any) {
    return sendError(res, error?.message || "Error en configuraciÃ³n", 400);
  }
}
