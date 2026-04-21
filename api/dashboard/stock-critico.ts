import { sendError, sendSuccess } from "../../server/utils/response.js";
import { getPoolOrFail, requireDashboardAccess, toNumber } from "./_shared.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    return sendError(res, "Method not allowed", 405);
  }

  const user = await requireDashboardAccess(req, res);
  if (!user) return;

  try {
    const pool = getPoolOrFail(res);
    if (!pool) return;

    const result = await pool.query(`
      SELECT id, name, codigo_unico, stock, stock_minimo
      FROM products
      WHERE stock <= stock_minimo AND eliminado = 0
      ORDER BY stock ASC, name ASC
    `);

    return sendSuccess(
      res,
      result.rows.map((row: any) => ({
        id: toNumber(row.id),
        name: row.name,
        codigo_unico: row.codigo_unico,
        stock: toNumber(row.stock),
        stock_minimo: toNumber(row.stock_minimo),
      }))
    );
  } catch (error: any) {
    return sendError(res, error?.message || "Error al obtener stock crítico", 400);
  }
}
