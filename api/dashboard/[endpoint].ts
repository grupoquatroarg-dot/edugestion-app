import { sendError, sendSuccess } from "../../server/utils/response.js";
import {
  getDateKeys,
  getPoolOrFail,
  getSummaryData,
  requireDashboardAccess,
  toNumber,
} from "../../server/services/vercel/dashboardApiHelpers.js";

const getEndpoint = (req: any) => {
  const value = req.query?.endpoint;
  return Array.isArray(value) ? value[0] : String(value || "");
};

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    return sendError(res, "Method not allowed", 405);
  }

  const user = await requireDashboardAccess(req, res);
  if (!user) return;

  const endpoint = getEndpoint(req);

  try {
    const pool = getPoolOrFail(res);
    if (!pool) return;

    if (endpoint === "summary" || endpoint === "stats") {
      const data = await getSummaryData(pool);
      return sendSuccess(res, data);
    }

    if (endpoint === "cuentas-cobrar") {
      const days = req.query?.days === "all" ? 0 : parseInt(String(req.query?.days || "30"), 10) || 30;
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
    }

    if (endpoint === "cuentas-pagar") {
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
    }

    if (endpoint === "ganancia-mes-detalle") {
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
    }

    if (endpoint === "ventas-mes-detalle") {
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
    }

    if (endpoint === "stock-critico") {
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
    }

    if (endpoint === "pedidos-pendientes") {
      const result = await pool.query(`
        SELECT cliente, fecha, estado
        FROM supplier_orders
        WHERE estado = 'pendiente'
        ORDER BY fecha DESC, id DESC
      `);

      return sendSuccess(res, result.rows);
    }

    if (endpoint === "deuda-vencida") {
      const result = await pool.query(`
        SELECT
          c.nombre_apellido AS cliente,
          c.saldo_cta_cte AS deuda,
          (CURRENT_DATE - MAX(DATE(s.fecha::timestamp)))::int AS dias_atraso
        FROM clientes c
        JOIN sales s ON c.id = s.cliente_id
        WHERE c.saldo_cta_cte > 0
          AND s.metodo_pago = 'Cta Cte'
        GROUP BY c.id, c.nombre_apellido, c.saldo_cta_cte
        HAVING (CURRENT_DATE - MAX(DATE(s.fecha::timestamp))) > 7
        ORDER BY dias_atraso DESC, cliente ASC
      `);

      return sendSuccess(
        res,
        result.rows.map((row: any) => ({
          cliente: row.cliente,
          deuda: toNumber(row.deuda),
          dias_atraso: toNumber(row.dias_atraso),
        }))
      );
    }

    return sendError(res, "Endpoint de dashboard no encontrado", 404);
  } catch (error: any) {
    return sendError(res, error?.message || "Error al obtener datos de dashboard", 400);
  }
}
