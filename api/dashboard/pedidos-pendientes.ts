import { sendError, sendSuccess } from "../../server/utils/response.js";
import { getPoolOrFail, requireDashboardAccess } from "../../server/services/vercel/dashboardApiHelpers.js";

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
      SELECT
        cliente,
        fecha,
        estado
      FROM supplier_orders
      WHERE estado = 'pendiente'
      ORDER BY fecha DESC, id DESC
    `);

    return sendSuccess(res, result.rows);
  } catch (error: any) {
    return sendError(res, error?.message || "Error al obtener pedidos pendientes", 400);
  }
}
