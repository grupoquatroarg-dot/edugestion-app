import { sendError, sendSuccess } from "../../server/utils/response.js";
import { getPoolOrFail, requireDashboardAccess, toNumber } from "./_shared.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    return sendError(res, "Method not allowed", 405);
  }

  const user = await requireDashboardAccess(req, res);
  if (!user) return;

  const days = req.query?.days === "all" ? 0 : parseInt(String(req.query?.days || "30"), 10) || 30;

  try {
    const pool = getPoolOrFail(res);
    if (!pool) return;

    const result = await pool.query(
      `
        SELECT
          c.nombre_apellido AS cliente,
          c.saldo_cta_cte AS deuda,
          MAX(s.fecha) AS fecha_venta,
          (CURRENT_DATE - MAX(DATE(s.fecha::timestamp)))::int AS dias_atraso
        FROM clientes c
        JOIN sales s ON c.id = s.cliente_id
        WHERE c.saldo_cta_cte > 0
          AND s.metodo_pago = 'Cta Cte'
          AND ($1::int = 0 OR DATE(s.fecha::timestamp) <= CURRENT_DATE - ($1::int * INTERVAL '1 day'))
        GROUP BY c.id, c.nombre_apellido, c.saldo_cta_cte
        ORDER BY dias_atraso DESC, cliente ASC
      `,
      [days]
    );

    return sendSuccess(
      res,
      result.rows.map((row: any) => ({
        cliente: row.cliente,
        deuda: toNumber(row.deuda),
        fecha_venta: row.fecha_venta,
        dias_atraso: toNumber(row.dias_atraso),
      }))
    );
  } catch (error: any) {
    return sendError(res, error?.message || "Error al obtener cuentas a cobrar", 400);
  }
}
