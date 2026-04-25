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
          s.fecha,
          COALESCE(c.nombre_apellido, s.nombre_cliente, 'Consumidor Final') AS cliente,
          STRING_AGG(p.name || ' (x' || si.cantidad::text || ')', ', ' ORDER BY p.name) AS productos,
          s.metodo_pago AS forma_pago,
          s.total
        FROM sales s
        JOIN sale_items si ON s.id = si.sale_id
        JOIN products p ON si.product_id = p.id
        LEFT JOIN clientes c ON s.cliente_id = c.id
        WHERE TO_CHAR(s.fecha::timestamp, 'YYYY-MM') = $1
        GROUP BY s.id, s.fecha, cliente, s.metodo_pago, s.total
        ORDER BY s.fecha DESC, s.id DESC
      `,
      [currentMonth]
    );

    return sendSuccess(
      res,
      result.rows.map((row: any) => ({
        fecha: row.fecha,
        cliente: row.cliente,
        productos: row.productos || "",
        forma_pago: row.forma_pago,
        total: toNumber(row.total),
      }))
    );
  } catch (error: any) {
    return sendError(res, error?.message || "Error al obtener detalle de ventas", 400);
  }
}
