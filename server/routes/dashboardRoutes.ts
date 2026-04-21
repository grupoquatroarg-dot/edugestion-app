eimport { Router } from "express";
import db from "../db.js";
import { requirePermission } from "../middleware/authMiddleware.js";
import { sendError, sendSuccess } from "../utils/response.js";
import { getPostgresPool, isPostgresConfigured } from "../utils/postgres.js";

const router = Router();

const toNumber = (value: any, fallback: number = 0) => {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

router.get("/summary", requirePermission("dashboard", "view"), async (_req, res) => {
  const now = new Date();
  const currentMonth = now.toISOString().slice(0, 7);
  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonth = prevMonthDate.toISOString().slice(0, 7);
  const today = now.toISOString().slice(0, 10);

  try {
    if (!isPostgresConfigured()) {
      const cuentasCobrar = db.prepare("SELECT SUM(saldo_cta_cte) as total FROM clientes").get() as any;
      const cuentasPagar = db.prepare("SELECT SUM(total) as total FROM purchase_invoices WHERE metodo_pago = 'Cta Cte'").get() as any;
      const gananciaMes = db.prepare("SELECT SUM(ganancia) as total FROM sales WHERE strftime('%Y-%m', fecha) = ?").get(currentMonth) as any;
      const gananciaPrevMes = db.prepare("SELECT SUM(ganancia) as total FROM sales WHERE strftime('%Y-%m', fecha) = ?").get(prevMonth) as any;

      const ventasMes = db.prepare(`
        SELECT
          SUM(total) as total,
          COUNT(*) as cantidad,
          AVG(total) as ticketPromedio
        FROM sales
        WHERE strftime('%Y-%m', fecha) = ?
      `).get(currentMonth) as any;

      const ventasPrevMes = db.prepare("SELECT SUM(total) as total FROM sales WHERE strftime('%Y-%m', fecha) = ?").get(prevMonth) as any;
      const ventasDia = db.prepare("SELECT SUM(total) as total FROM sales WHERE strftime('%Y-%m-%d', fecha) = ?").get(today) as any;

      const topClientes = db.prepare(`
        SELECT nombre_cliente, SUM(total) as total
        FROM sales
        WHERE strftime('%Y-%m', fecha) = ?
        GROUP BY cliente_id
        ORDER BY total DESC
        LIMIT 5
      `).all(currentMonth);

      const topProductos = db.prepare(`
        SELECT p.name, SUM(si.cantidad) as total_qty
        FROM sale_items si
        JOIN products p ON si.product_id = p.id
        JOIN sales s ON si.sale_id = s.id
        WHERE strftime('%Y-%m', s.fecha) = ?
        GROUP BY si.product_id
        ORDER BY total_qty DESC
        LIMIT 5
      `).all(currentMonth);

      const topProductosRentables = db.prepare(`
        SELECT
          p.name as producto,
          SUM(si.cantidad * si.precio_venta) as ventas,
          SUM(si.costo_total_peps) as costo,
          SUM((si.cantidad * si.precio_venta) - si.costo_total_peps) as ganancia,
          CASE
            WHEN SUM(si.cantidad * si.precio_venta) > 0
            THEN (SUM((si.cantidad * si.precio_venta) - si.costo_total_peps) / SUM(si.cantidad * si.precio_venta)) * 100
            ELSE 0
          END as margen
        FROM sale_items si
        JOIN products p ON si.product_id = p.id
        JOIN sales s ON si.sale_id = s.id
        WHERE strftime('%Y-%m', s.fecha) = ?
        GROUP BY si.product_id
        ORDER BY ganancia DESC
        LIMIT 5
      `).all(currentMonth);

      const stockValorizado = db.prepare("SELECT SUM(stock * cost) as total FROM products WHERE eliminado = 0").get() as any;
      const stockCritico = db.prepare("SELECT COUNT(*) as count FROM products WHERE stock <= stock_minimo AND eliminado = 0").get() as any;
      const pedidosPendientes = db.prepare("SELECT COUNT(*) as count FROM supplier_orders WHERE estado = 'pendiente'").get() as any;

      const rutaDia = db.prepare(`
        SELECT
          COUNT(*) as planificados,
          SUM(visitado) as visitados,
          SUM(venta_registrada) as ventas
        FROM route_items ri
        JOIN routes r ON ri.route_id = r.id
        WHERE r.date = ?
      `).get(today) as any;

      const alertasDeuda = db.prepare(`
        SELECT COUNT(*) as count
        FROM clientes
        WHERE saldo_cta_cte > 0
          AND id IN (
            SELECT cliente_id
            FROM sales
            WHERE metodo_pago = 'Cta Cte'
              AND date(fecha) <= date('now', '-7 days')
          )
      `).get() as any;

      return sendSuccess(res, {
        finanzas: {
          cuentasCobrar: cuentasCobrar?.total || 0,
          cuentasPagar: cuentasPagar?.total || 0,
          gananciaMes: gananciaMes?.total || 0,
          gananciaPrevMes: gananciaPrevMes?.total || 0,
        },
        ventas: {
          mes: {
            total: ventasMes?.total || 0,
            cantidad: ventasMes?.cantidad || 0,
            ticketPromedio: ventasMes?.ticketPromedio || 0,
            prevTotal: ventasPrevMes?.total || 0,
          },
          dia: ventasDia?.total || 0,
          topClientes: topClientes || [],
          topProductos: topProductos || [],
          topProductosRentables: topProductosRentables || [],
        },
        stock: {
          valorizado: stockValorizado?.total || 0,
          critico: stockCritico?.count || 0,
          pedidosPendientes: pedidosPendientes?.count || 0,
        },
        operaciones: {
          rutaDia: {
            planificados: rutaDia?.planificados || 0,
            visitados: rutaDia?.visitados || 0,
            ventas: rutaDia?.ventas || 0,
          },
          alertasDeuda: alertasDeuda?.count || 0,
        },
      });
    }

    const pool = getPostgresPool();

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

    return sendSuccess(res, {
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
        topClientes: topClientesResult.rows.map((row) => ({
          nombre_cliente: row.nombre_cliente,
          total: toNumber(row.total),
        })),
        topProductos: topProductosResult.rows.map((row) => ({
          name: row.name,
          total_qty: toNumber(row.total_qty),
        })),
        topProductosRentables: topProductosRentablesResult.rows.map((row) => ({
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
    });
  } catch (error: any) {
    return sendError(res, error.message || "Error al cargar dashboard", 400);
  }
});

router.get("/cuentas-cobrar", requirePermission("dashboard", "view"), async (req, res) => {
  const days = req.query.days === "all" ? 0 : parseInt(String(req.query.days || "30"), 10) || 30;

  try {
    if (!isPostgresConfigured()) {
      let query = `
        SELECT
          c.nombre_apellido as cliente,
          c.saldo_cta_cte as deuda,
          MAX(s.fecha) as fecha_venta,
          CAST((julianday('now') - julianday(MAX(s.fecha))) AS INTEGER) as dias_atraso
        FROM clientes c
        JOIN sales s ON c.id = s.cliente_id
        WHERE c.saldo_cta_cte > 0 AND s.metodo_pago = 'Cta Cte'
      `;

      if (days > 0) {
        query += ` AND date(s.fecha) <= date('now', ?)`;
      }

      query += ` GROUP BY c.id ORDER BY dias_atraso DESC`;

      const results = db.prepare(query).all(days > 0 ? `-${days} days` : undefined);
      return sendSuccess(res, results);
    }

    const pool = getPostgresPool();
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
      result.rows.map((row) => ({
        cliente: row.cliente,
        deuda: toNumber(row.deuda),
        fecha_venta: row.fecha_venta,
        dias_atraso: toNumber(row.dias_atraso),
      }))
    );
  } catch (error: any) {
    return sendError(res, error.message || "Error al obtener cuentas a cobrar", 400);
  }
});

router.get("/cuentas-pagar", requirePermission("dashboard", "view"), async (_req, res) => {
  try {
    if (!isPostgresConfigured()) {
      const results = db.prepare(`
        SELECT
          p.nombre as proveedor,
          pi.total as monto,
          pi.fecha,
          'Pendiente' as estado
        FROM purchase_invoices pi
        JOIN proveedores p ON pi.proveedor_id = p.id
        WHERE pi.metodo_pago = 'Cta Cte'
        ORDER BY pi.fecha ASC
      `).all();
      return sendSuccess(res, results);
    }

    const pool = getPostgresPool();
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
      result.rows.map((row) => ({
        proveedor: row.proveedor,
        monto: toNumber(row.monto),
        fecha: row.fecha,
        estado: row.estado,
      }))
    );
  } catch (error: any) {
    return sendError(res, error.message || "Error al obtener cuentas a pagar", 400);
  }
});

router.get("/ganancia-mes-detalle", requirePermission("dashboard", "view"), async (_req, res) => {
  const currentMonth = new Date().toISOString().slice(0, 7);

  try {
    if (!isPostgresConfigured()) {
      const results = db.prepare(`
        SELECT
          fecha,
          nombre_cliente as cliente,
          total as venta,
          costo_total as costo,
          ganancia
        FROM sales
        WHERE strftime('%Y-%m', fecha) = ?
        ORDER BY fecha DESC
      `).all(currentMonth);
      return sendSuccess(res, results);
    }

    const pool = getPostgresPool();
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
      result.rows.map((row) => ({
        fecha: row.fecha,
        cliente: row.cliente,
        venta: toNumber(row.venta),
        costo: toNumber(row.costo),
        ganancia: toNumber(row.ganancia),
      }))
    );
  } catch (error: any) {
    return sendError(res, error.message || "Error al obtener detalle de ganancia", 400);
  }
});

router.get("/ventas-mes-detalle", requirePermission("dashboard", "view"), async (_req, res) => {
  const currentMonth = new Date().toISOString().slice(0, 7);

  try {
    if (!isPostgresConfigured()) {
      const results = db.prepare(`
        SELECT
          s.fecha,
          s.nombre_cliente as cliente,
          GROUP_CONCAT(p.name || ' (x' || si.cantidad || ')', ', ') as productos,
          s.metodo_pago as forma_pago,
          s.total
        FROM sales s
        JOIN sale_items si ON s.id = si.sale_id
        JOIN products p ON si.product_id = p.id
        WHERE strftime('%Y-%m', s.fecha) = ?
        GROUP BY s.id
        ORDER BY s.fecha DESC
      `).all(currentMonth);
      return sendSuccess(res, results);
    }

    const pool = getPostgresPool();
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
      result.rows.map((row) => ({
        fecha: row.fecha,
        cliente: row.cliente,
        productos: row.productos || "",
        forma_pago: row.forma_pago,
        total: toNumber(row.total),
      }))
    );
  } catch (error: any) {
    return sendError(res, error.message || "Error al obtener detalle de ventas", 400);
  }
});

router.get("/stock-critico", requirePermission("dashboard", "view"), async (_req, res) => {
  try {
    if (!isPostgresConfigured()) {
      const results = db.prepare(`
        SELECT id, name, codigo_unico, stock, stock_minimo
        FROM products
        WHERE stock <= stock_minimo AND eliminado = 0
        ORDER BY stock ASC
      `).all();
      return sendSuccess(res, results);
    }

    const pool = getPostgresPool();
    const result = await pool.query(`
      SELECT id, name, codigo_unico, stock, stock_minimo
      FROM products
      WHERE stock <= stock_minimo AND eliminado = 0
      ORDER BY stock ASC, name ASC
    `);

    return sendSuccess(
      res,
      result.rows.map((row) => ({
        id: toNumber(row.id),
        name: row.name,
        codigo_unico: row.codigo_unico,
        stock: toNumber(row.stock),
        stock_minimo: toNumber(row.stock_minimo),
      }))
    );
  } catch (error: any) {
    return sendError(res, error.message || "Error al obtener stock crítico", 400);
  }
});

router.get("/pedidos-pendientes", requirePermission("dashboard", "view"), async (_req, res) => {
  try {
    if (!isPostgresConfigured()) {
      const results = db.prepare(`
        SELECT
          cliente,
          fecha,
          estado
        FROM supplier_orders
        WHERE estado = 'pendiente'
        ORDER BY fecha DESC
      `).all();
      return sendSuccess(res, results);
    }

    const pool = getPostgresPool();
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
    return sendError(res, error.message || "Error al obtener pedidos pendientes", 400);
  }
});

router.get("/deuda-vencida", requirePermission("dashboard", "view"), async (_req, res) => {
  try {
    if (!isPostgresConfigured()) {
      const results = db.prepare(`
        SELECT
          c.nombre_apellido as cliente,
          c.saldo_cta_cte as deuda,
          CAST((julianday('now') - julianday(MAX(s.fecha))) AS INTEGER) as dias_atraso
        FROM clientes c
        JOIN sales s ON c.id = s.cliente_id
        WHERE c.saldo_cta_cte > 0 AND s.metodo_pago = 'Cta Cte'
        GROUP BY c.id
        HAVING dias_atraso > 7
        ORDER BY dias_atraso DESC
      `).all();
      return sendSuccess(res, results);
    }

    const pool = getPostgresPool();
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
      result.rows.map((row) => ({
        cliente: row.cliente,
        deuda: toNumber(row.deuda),
        dias_atraso: toNumber(row.dias_atraso),
      }))
    );
  } catch (error: any) {
    return sendError(res, error.message || "Error al obtener deuda vencida", 400);
  }
});

router.get("/stats", requirePermission("dashboard", "view"), async (req, res) => {
  req.url = "/summary";
  return router.handle(req, res, () => undefined);
});

export default router;
