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
      SELECT
        p.nombre AS proveedor,
        pi.total AS monto,
        pi.fecha,
        'Pendiente' AS estado
      FROM purchase_invoices pi
      JOIN proveedores p ON pi.proveedor_id = p.id
      WHERE pi.metodo_pago = 'Cta Cte'
      ORDER BY pi.fecha ASC
    `);

    return sendSuccess(
      res,
      result.rows.map((row: any) => ({
        proveedor: row.proveedor,
        monto: toNumber(row.monto),
        fecha: row.fecha,
        estado: row.estado,
      }))
    );
  } catch (error: any) {
    return sendError(res, error?.message || "Error al obtener cuentas a pagar", 400);
  }
}
