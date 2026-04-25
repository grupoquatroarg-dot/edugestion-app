import { getPostgresPool, isPostgresConfigured } from "../../utils/postgres.js";
import { UserRepository } from "../../repositories/userRepository.js";
import { verifyToken } from "../../utils/jwt.js";
import { sendError } from "../../utils/response.js";

export const toNumber = (value: any, fallback: number = 0) => {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

export const getDateKeys = () => {
  const now = new Date();
  const currentMonth = now.toISOString().slice(0, 7);
  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonth = prevMonthDate.toISOString().slice(0, 7);
  const today = now.toISOString().slice(0, 10);

  return { currentMonth, prevMonth, today };
};

export const getBearerToken = (req: any) => {
  const authHeader = req.headers?.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  return authHeader.slice(7);
};

export const requireDashboardAccess = async (req: any, res: any) => {
  const token = getBearerToken(req);

  if (!token) {
    sendError(res, "Unauthorized: Login required", 401);
    return null;
  }

  const decoded = verifyToken(token);

  if (!decoded?.userId) {
    sendError(res, "Unauthorized: Login required", 401);
    return null;
  }

  if (decoded.role === "administrador") {
    return decoded;
  }

  const permissions = await UserRepository.getPermissions(Number(decoded.userId));
  const perm = permissions?.dashboard;

  if (!perm?.can_view) {
    sendError(res, "Forbidden: No view permission for dashboard", 403);
    return null;
  }

  return decoded;
};

export const getPoolOrFail = (res: any) => {
  if (!isPostgresConfigured()) {
    sendError(res, "DATABASE_URL no configurada", 500);
    return null;
  }

  return getPostgresPool();
};

export const getSummaryData = async (pool: any) => {
  const { currentMonth, prevMonth, today } = getDateKeys();

  const [
    cuentasCobrarResult,
    cuentasPagarResult,
    gananciaMesResult,
    gananciaPrevMesResult,
    ventasMesResult,
    ventasPrevMesResult,
    ventasDiaResult,
    topClientesResult,
    topProductosResult,
    topProductosRentablesResult,
    stockValorizadoResult,
    stockCriticoResult,
    pedidosPendientesResult,
    rutaDiaResult,
    alertasDeudaResult,
  ] = await Promise.all([
    pool.query(`SELECT COALESCE(SUM(saldo_cta_cte), 0) AS total FROM clientes WHERE activo = 1`),
    pool.query(`SELECT COALESCE(SUM(total), 0) AS total FROM purchase_invoices WHERE metodo_pago = 'Cta Cte'`),
    pool.query(`
      SELECT COALESCE(SUM(ganancia), 0) AS total
      FROM sales
      WHERE TO_CHAR(fecha::timestamp, 'YYYY-MM') = $1
    `, [currentMonth]),
    pool.query(`
      SELECT COALESCE(SUM(ganancia), 0) AS total
      FROM sales
      WHERE TO_CHAR(fecha::timestamp, 'YYYY-MM') = $1
    `, [prevMonth]),
    pool.query(`
      SELECT
        COALESCE(SUM(total), 0) AS total,
        COUNT(*)::int AS cantidad,
        COALESCE(AVG(total), 0) AS ticket_promedio
      FROM sales
      WHERE TO_CHAR(fecha::timestamp, 'YYYY-MM') = $1
    `, [currentMonth]),
    pool.query(`
      SELECT COALESCE(SUM(total), 0) AS total
      FROM sales
      WHERE TO_CHAR(fecha::timestamp, 'YYYY-MM') = $1
    `, [prevMonth]),
    pool.query(`
      SELECT COALESCE(SUM(total), 0) AS total
      FROM sales
      WHERE TO_CHAR(fecha::timestamp, 'YYYY-MM-DD') = $1
    `, [today]),
    pool.query(`
      SELECT
        COALESCE(c.nombre_apellido, s.nombre_cliente, 'Sin nombre') AS nombre_cliente,
        COALESCE(SUM(s.total), 0) AS total
      FROM sales s
      LEFT JOIN clientes c ON s.cliente_id = c.id
      WHERE TO_CHAR(s.fecha::timestamp, 'YYYY-MM') = $1
      GROUP BY COALESCE(c.nombre_apellido, s.nombre_cliente, 'Sin nombre')
      ORDER BY total DESC
      LIMIT 5
    `, [currentMonth]),
    pool.query(`
      SELECT
        p.name,
        COALESCE(SUM(si.cantidad), 0)::int AS total_qty
      FROM sale_items si
      JOIN products p ON si.product_id = p.id
      JOIN sales s ON si.sale_id = s.id
      WHERE TO_CHAR(s.fecha::timestamp, 'YYYY-MM') = $1
      GROUP BY p.id, p.name
      ORDER BY total_qty DESC, p.name ASC
      LIMIT 5
    `, [currentMonth]),
    pool.query(`
      SELECT
        p.name AS producto,
        COALESCE(SUM(si.cantidad * si.precio_venta), 0) AS ventas,
        COALESCE(SUM(si.costo_total_peps), 0) AS costo,
        COALESCE(SUM((si.cantidad * si.precio_venta) - si.costo_total_peps), 0) AS ganancia,
        CASE
          WHEN COALESCE(SUM(si.cantidad * si.precio_venta), 0) > 0 THEN
            (COALESCE(SUM((si.cantidad * si.precio_venta) - si.costo_total_peps), 0) / SUM(si.cantidad * si.precio_venta)) * 100
          ELSE 0
        END AS margen
      FROM sale_items si
      JOIN products p ON si.product_id = p.id
      JOIN sales s ON si.sale_id = s.id
      WHERE TO_CHAR(s.fecha::timestamp, 'YYYY-MM') = $1
      GROUP BY p.id, p.name
      ORDER BY ganancia DESC, p.name ASC
      LIMIT 5
    `, [currentMonth]),
    pool.query(`SELECT COALESCE(SUM(stock * cost), 0) AS total FROM products WHERE eliminado = 0`),
    pool.query(`SELECT COUNT(*)::int AS count FROM products WHERE stock <= stock_minimo AND eliminado = 0`),
    pool.query(`SELECT COUNT(*)::int AS count FROM supplier_orders WHERE estado = 'pendiente'`),
    pool.query(`
      SELECT
        COUNT(*)::int AS planificados,
        COALESCE(SUM(CASE WHEN ri.visitado <> 0 THEN 1 ELSE 0 END), 0)::int AS visitados,
        COALESCE(SUM(CASE WHEN ri.venta_registrada <> 0 THEN 1 ELSE 0 END), 0)::int AS ventas
      FROM route_items ri
      JOIN routes r ON ri.route_id = r.id
      WHERE r.date = $1
    `, [today]),
    pool.query(`
      SELECT COUNT(*)::int AS count
      FROM clientes c
      WHERE c.saldo_cta_cte > 0
        AND EXISTS (
          SELECT 1
          FROM sales s
          WHERE s.cliente_id = c.id
            AND s.metodo_pago = 'Cta Cte'
            AND DATE(s.fecha::timestamp) <= CURRENT_DATE - INTERVAL '7 days'
        )
    `),
  ]);

  return {
    finanzas: {
      cuentasCobrar: toNumber(cuentasCobrarResult.rows[0]?.total),
      cuentasPagar: toNumber(cuentasPagarResult.rows[0]?.total),
      gananciaMes: toNumber(gananciaMesResult.rows[0]?.total),
      gananciaPrevMes: toNumber(gananciaPrevMesResult.rows[0]?.total),
    },
    ventas: {
      mes: {
        total: toNumber(ventasMesResult.rows[0]?.total),
        cantidad: toNumber(ventasMesResult.rows[0]?.cantidad),
        ticketPromedio: toNumber(ventasMesResult.rows[0]?.ticket_promedio),
        prevTotal: toNumber(ventasPrevMesResult.rows[0]?.total),
      },
      dia: toNumber(ventasDiaResult.rows[0]?.total),
      topClientes: topClientesResult.rows.map((row: any) => ({
        nombre_cliente: row.nombre_cliente,
        total: toNumber(row.total),
      })),
      topProductos: topProductosResult.rows.map((row: any) => ({
        name: row.name,
        total_qty: toNumber(row.total_qty),
      })),
      topProductosRentables: topProductosRentablesResult.rows.map((row: any) => ({
        producto: row.producto,
        ventas: toNumber(row.ventas),
        costo: toNumber(row.costo),
        ganancia: toNumber(row.ganancia),
        margen: toNumber(row.margen),
      })),
    },
    stock: {
      valorizado: toNumber(stockValorizadoResult.rows[0]?.total),
      critico: toNumber(stockCriticoResult.rows[0]?.count),
      pedidosPendientes: toNumber(pedidosPendientesResult.rows[0]?.count),
    },
    operaciones: {
      rutaDia: {
        planificados: toNumber(rutaDiaResult.rows[0]?.planificados),
        visitados: toNumber(rutaDiaResult.rows[0]?.visitados),
        ventas: toNumber(rutaDiaResult.rows[0]?.ventas),
      },
      alertasDeuda: toNumber(alertasDeudaResult.rows[0]?.count),
    },
  };
};
