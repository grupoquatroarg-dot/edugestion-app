import { Router } from "express";
import db from "../db.js";
import { requirePermission } from "../middleware/authMiddleware.js";
import { validate } from "../middleware/validate.js";
import { z } from "zod";
import { sendSuccess } from "../utils/response.js";

const router = Router();

const reportParamsSchema = z.object({
  query: z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    cliente_id: z.string().regex(/^\d+$/).optional(),
  }),
});

router.get("/", requirePermission('dashboard', 'view'), validate(reportParamsSchema), (req, res) => {
  const { from, to, cliente_id } = req.query;
  const fromDate = from ? `${from} 00:00:00` : '1970-01-01 00:00:00';
  const toDate = to ? `${to} 23:59:59` : '2099-12-31 23:59:59';
  const clienteId = cliente_id ? parseInt(cliente_id as string) : null;

  const reports: any = {};

  // 1. Ventas
  let salesStatsQuery = `
    SELECT 
      SUM(total) as total,
      COUNT(*) as cantidad,
      AVG(total) as promedio
    FROM sales 
    WHERE fecha BETWEEN ? AND ?
  `;
  const salesStatsParams: any[] = [fromDate, toDate];
  if (clienteId) {
    salesStatsQuery += " AND cliente_id = ?";
    salesStatsParams.push(clienteId);
  }
  const salesStats = db.prepare(salesStatsQuery).get(...salesStatsParams) as any;

  let salesByDayQuery = `
    SELECT date(fecha) as fecha, SUM(total) as total, COUNT(*) as cantidad
    FROM sales
    WHERE fecha BETWEEN ? AND ?
  `;
  const salesByDayParams: any[] = [fromDate, toDate];
  if (clienteId) {
    salesByDayQuery += " AND cliente_id = ?";
    salesByDayParams.push(clienteId);
  }
  salesByDayQuery += " GROUP BY date(fecha) ORDER BY fecha ASC";
  const salesByDay = db.prepare(salesByDayQuery).all(...salesByDayParams);

  let salesByMethodQuery = `
    SELECT metodo_pago as name, SUM(total) as value
    FROM sales
    WHERE fecha BETWEEN ? AND ?
  `;
  const salesByMethodParams: any[] = [fromDate, toDate];
  if (clienteId) {
    salesByMethodQuery += " AND cliente_id = ?";
    salesByMethodParams.push(clienteId);
  }
  salesByMethodQuery += " GROUP BY metodo_pago";
  const salesByMethod = db.prepare(salesByMethodQuery).all(...salesByMethodParams);

  let salesListQuery = `
    SELECT id, fecha, nombre_cliente, total, metodo_pago
    FROM sales
    WHERE fecha BETWEEN ? AND ?
  `;
  const salesListParams: any[] = [fromDate, toDate];
  if (clienteId) {
    salesListQuery += " AND cliente_id = ?";
    salesListParams.push(clienteId);
  }
  salesListQuery += " ORDER BY fecha DESC";
  const salesList = db.prepare(salesListQuery).all(...salesListParams);

  reports.ventas = {
    total: salesStats.total || 0,
    cantidad: salesStats.cantidad || 0,
    promedio: salesStats.promedio || 0,
    porDia: salesByDay,
    porMetodoPago: salesByMethod,
    listaVentas: salesList
  };

  // 2. Clientes
  const newClients = db.prepare(`
    SELECT COUNT(*) as count FROM clientes WHERE fecha_alta BETWEEN ? AND ?
  `).get(fromDate, toDate) as any;

  const activeClients = db.prepare(`
    SELECT COUNT(DISTINCT cliente_id) as count FROM sales WHERE fecha BETWEEN ? AND ?
  `).get(fromDate, toDate) as any;

  const clientsWithDebt = db.prepare(`
    SELECT COUNT(*) as count FROM clientes WHERE saldo_cta_cte > 0
  `).get() as any;

  const listadoClientes = db.prepare(`
    SELECT 
      c.id,
      c.nombre_apellido as nombre, 
      SUM(s.total) as total, 
      COUNT(s.id) as cantidad,
      MAX(s.fecha) as ultima_compra
    FROM sales s
    JOIN clientes c ON s.cliente_id = c.id
    WHERE s.fecha BETWEEN ? AND ?
    GROUP BY s.cliente_id
    ORDER BY total DESC
  `).all(fromDate, toDate);

  reports.clientes = {
    nuevos: newClients.count || 0,
    activos: activeClients.count || 0,
    conDeuda: clientsWithDebt.count || 0,
    listadoClientes: listadoClientes
  };

  // 3. Productos
  const listadoProductos = db.prepare(`
    SELECT 
      p.name, 
      SUM(si.cantidad) as cantidad, 
      SUM(si.cantidad * si.precio_venta) as total,
      MAX(s.fecha) as ultima_venta
    FROM sale_items si
    JOIN sales s ON si.sale_id = s.id
    JOIN products p ON si.product_id = p.id
    WHERE s.fecha BETWEEN ? AND ?
    GROUP BY si.product_id
    ORDER BY cantidad DESC
  `).all(fromDate, toDate);

  const salesByFamily = db.prepare(`
    SELECT f.name, SUM(si.cantidad * si.precio_venta) as value
    FROM sale_items si
    JOIN sales s ON si.sale_id = s.id
    JOIN products p ON si.product_id = p.id
    JOIN product_families f ON p.family_id = f.id
    WHERE s.fecha BETWEEN ? AND ?
    GROUP BY f.id
  `).all(fromDate, toDate);

  const lowStock = db.prepare(`
    SELECT name, stock FROM products WHERE stock <= 5 AND eliminado = 0
  `).all();

  reports.productos = {
    listadoProductos: listadoProductos,
    porFamilia: salesByFamily,
    bajoStock: lowStock
  };

  // 4. Deudas
  const totalDebt = db.prepare(`SELECT SUM(saldo_cta_cte) as total FROM clientes`).get() as any;
  const debtorsCount = db.prepare(`SELECT COUNT(*) as count FROM clientes WHERE saldo_cta_cte > 0`).get() as any;
  
  const rankingDeudores = db.prepare(`
    SELECT 
      c.id,
      c.nombre_apellido as nombre, 
      c.saldo_cta_cte as saldo,
      (SELECT COUNT(*) FROM sales WHERE cliente_id = c.id AND monto_pendiente > 0) as ventas_pendientes,
      (SELECT MIN(fecha) FROM sales WHERE cliente_id = c.id AND monto_pendiente > 0) as fecha_antigua
    FROM clientes c
    WHERE c.saldo_cta_cte > 0
    ORDER BY c.saldo_cta_cte DESC
  `).all();

  reports.deudas = {
    totalAdeudado: totalDebt.total || 0,
    clientesDeudores: debtorsCount.count || 0,
    rankingDeudores: rankingDeudores
  };

  // 5. Finanzas
  const financeStats = db.prepare(`
    SELECT 
      SUM(CASE WHEN tipo = 'ingreso' THEN monto ELSE 0 END) as ingresos,
      SUM(CASE WHEN tipo = 'egreso' THEN monto ELSE 0 END) as egresos
    FROM movimientos_financieros
    WHERE fecha BETWEEN ? AND ?
  `).get(fromDate, toDate) as any;

  const expensesByCategory = db.prepare(`
    SELECT categoria as name, SUM(monto) as value
    FROM movimientos_financieros
    WHERE tipo = 'egreso' AND fecha BETWEEN ? AND ?
    GROUP BY categoria
  `).all(fromDate, toDate);

  const cashFlow = db.prepare(`
    SELECT 
      date(fecha) as fecha,
      SUM(CASE WHEN tipo = 'ingreso' THEN monto ELSE 0 END) as ingresos,
      SUM(CASE WHEN tipo = 'egreso' THEN monto ELSE 0 END) as egresos
    FROM movimientos_financieros
    WHERE fecha BETWEEN ? AND ?
    GROUP BY date(fecha)
    ORDER BY fecha ASC
  `).all(fromDate, toDate);

  reports.finanzas = {
    ingresos: financeStats.ingresos || 0,
    egresos: financeStats.egresos || 0,
    balance: (financeStats.ingresos || 0) - (financeStats.egresos || 0),
    egresosPorCategoria: expensesByCategory,
    flujoCaja: cashFlow
  };

  return sendSuccess(res, reports);
});

router.get("/commissions", requirePermission('dashboard', 'view'), validate(reportParamsSchema), (req, res) => {
  const { from, to } = req.query;
  const commissionPct = parseFloat(db.prepare("SELECT value FROM settings WHERE key = 'default_commission_percentage'").get()?.value || '5');
  
  const sales = db.prepare(`
    SELECT 
      s.id,
      s.fecha,
      s.nombre_cliente as cliente,
      s.total as total_venta,
      ? as porcentaje_comision,
      (s.total * ? / 100) as comision_generada
    FROM sales s
    JOIN clientes c ON s.cliente_id = c.id
    WHERE s.fecha BETWEEN ? AND ?
      AND c.tipo_cliente = 'mayorista'
    ORDER BY s.fecha DESC
  `).all(commissionPct, commissionPct, from + ' 00:00:00', to + ' 23:59:59');

  const totalComisiones = sales.reduce((acc: number, s: any) => acc + s.comision_generada, 0);

  return sendSuccess(res, {
    sales,
    summary: {
      totalComisiones
    }
  });
});

router.get("/sales-period", requirePermission('dashboard', 'view'), validate(reportParamsSchema), (req, res) => {
  const { from, to, cliente_id } = req.query;
  const fromDate = from ? `${from} 00:00:00` : '1970-01-01 00:00:00';
  const toDate = to ? `${to} 23:59:59` : '2099-12-31 23:59:59';

  let query = `
    SELECT 
      s.id,
      s.fecha, 
      s.nombre_cliente as cliente, 
      s.metodo_pago,
      GROUP_CONCAT(p.name || ' (x' || si.cantidad || ')', ', ') as productos,
      (SELECT SUM(cantidad) FROM sale_items WHERE sale_id = s.id) as cantidad,
      s.total as total_venta,
      s.costo_total,
      s.ganancia
    FROM sales s
    JOIN sale_items si ON s.id = si.sale_id
    JOIN products p ON si.product_id = p.id
    WHERE s.fecha BETWEEN ? AND ?
  `;
  const params: any[] = [fromDate, toDate];

  if (cliente_id) {
    query += ` AND s.cliente_id = ? `;
    params.push(cliente_id);
  }

  query += ` GROUP BY s.id ORDER BY s.fecha DESC `;

  const sales = db.prepare(query).all(...params);

  let summaryQuery = `
    SELECT 
      SUM(total) as total_ventas,
      SUM(costo_total) as total_costo,
      SUM(ganancia) as total_ganancia,
      COUNT(*) as cantidad_ventas,
      AVG(total) as ticket_promedio
    FROM sales
    WHERE fecha BETWEEN ? AND ?
  `;
  const summaryParams: any[] = [fromDate, toDate];

  if (cliente_id) {
    summaryQuery += ` AND cliente_id = ? `;
    summaryParams.push(cliente_id);
  }

  const summary = db.prepare(summaryQuery).get(...summaryParams) as any;

  return sendSuccess(res, {
    sales,
    summary: {
      totalVentas: summary.total_ventas || 0,
      totalCosto: summary.total_costo || 0,
      totalGanancia: summary.total_ganancia || 0,
      cantidadVentas: summary.cantidad_ventas || 0,
      ticketPromedio: summary.ticket_promedio || 0
    }
  });
});

export default router;
