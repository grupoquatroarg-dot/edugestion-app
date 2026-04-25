import { sendError, sendSuccess } from "../../server/utils/response.js";
import { getDateKeys, getPoolOrFail, requireDashboardAccess, toNumber } from "../../server/services/vercel/dashboardApiHelpers.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    return sendError(res, "Method not allowed", 405);
  }

  const user = await requireDashboardAccess(req, res);
  if (!user) return;

  try {
    const pool = getPoolOrFail(res);
    if (!pool) return;

    const { currentMonth } = getDateKeys();
    const result = await pool.query(
      `
        SELECT
          fecha,
          COALESCE(nombre_cliente, 'Consumidor Final') AS cliente,
          total AS venta,
          costo_total AS costo,
          ganancia
        FROM sales
        WHERE TO_CHAR(fecha::timestamp, 'YYYY-MM') = $1
        ORDER BY fecha DESC, id DESC
      `,
      [currentMonth]
    );

    return sendSuccess(
      res,
      result.rows.map((row: any) => ({
        fecha: row.fecha,
        cliente: row.cliente,
        venta: toNumber(row.venta),
        costo: toNumber(row.costo),
        ganancia: toNumber(row.ganancia),
      }))
    );
  } catch (error: any) {
    return sendError(res, error?.message || "Error al obtener detalle de ganancia", 400);
  }
}
