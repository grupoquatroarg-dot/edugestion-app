import { Router } from "express";
import db from "../db.js";
import { requirePermission } from "../middleware/authMiddleware.js";
import { sendSuccess } from "../utils/response.js";

const router = Router();

router.get("/summary", requirePermission('dashboard', 'view'), (req, res) => {
  const now = new Date();
  const currentMonth = now.toISOString().slice(0, 7); // YYYY-MM
  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonth = prevMonthDate.toISOString().slice(0, 7);
  const today = now.toISOString().slice(0, 10);

  // Finanzas
  const cuentasCobrar = db.prepare("SELECT SUM(saldo_cta_cte) as total FROM clientes").get() as any;
  const cuentasPagar = db.prepare("SELECT SUM(total) as total FROM purchase_invoices WHERE metodo_pago = 'Cta Cte'").get() as any;
  const gananciaMes = db.prepare("SELECT SUM(ganancia) as total FROM sales WHERE strftime('%Y-%m', fecha) = ?").get(currentMonth) as any;
  const gananciaPrevMes = db.prepare("SELECT SUM(ganancia) as total FROM sales WHERE strftime('%Y-%m', fecha) = ?").get(prevMonth) as any;

  // Ventas
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

  // Stock
  const stockValorizado = db.prepare("SELECT SUM(stock * cost) as total FROM products WHERE eliminado = 0").get() as any;
  const stockCritico = db.prepare("SELECT COUNT(*) as count FROM products WHERE stock <= stock_minimo AND eliminado = 0").get() as any;
  const pedidosPendientes = db.prepare("SELECT COUNT(*) as count FROM supplier_orders WHERE estado = 'pendiente'").get() as any;

  // Operaciones
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
      cuentasCobrar: cuentasCobrar.total || 0,
      cuentasPagar: cuentasPagar.total || 0,
      gananciaMes: gananciaMes.total || 0,
      gananciaPrevMes: gananciaPrevMes.total || 0
    },
    ventas: {
      mes: {
        total: ventasMes.total || 0,
        cantidad: ventasMes.cantidad || 0,
        ticketPromedio: ventasMes.ticketPromedio || 0,
        prevTotal: ventasPrevMes.total || 0
      },
      dia: ventasDia.total || 0,
      topClientes: topClientes || [],
      topProductos: topProductos || [],
      topProductosRentables: topProductosRentables || []
    },
    stock: {
      valorizado: stockValorizado.total || 0,
      critico: stockCritico.count || 0,
      pedidosPendientes: pedidosPendientes.count || 0
    },
    operaciones: {
      rutaDia: {
        planificados: rutaDia?.planificados || 0,
        visitados: rutaDia?.visitados || 0,
        ventas: rutaDia?.ventas || 0
      },
      alertasDeuda: alertasDeuda.count || 0
    }
  });
});

router.get("/cuentas-cobrar", requirePermission('dashboard', 'view'), (req, res) => {
  const days = req.query.days === 'all' ? 0 : parseInt(req.query.days as string) || 30;
  
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
});

router.get("/cuentas-pagar", requirePermission('dashboard', 'view'), (req, res) => {
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
});

router.get("/ganancia-mes-detalle", requirePermission('dashboard', 'view'), (req, res) => {
  const currentMonth = new Date().toISOString().slice(0, 7);
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
});

router.get("/ventas-mes-detalle", requirePermission('dashboard', 'view'), (req, res) => {
  const currentMonth = new Date().toISOString().slice(0, 7);
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
});

router.get("/stock-critico", requirePermission('dashboard', 'view'), (req, res) => {
  const results = db.prepare(`
    SELECT id, name, codigo_unico, stock, stock_minimo
    FROM products
    WHERE stock <= stock_minimo AND eliminado = 0
    ORDER BY stock ASC
  `).all();
  return sendSuccess(res, results);
});

router.get("/pedidos-pendientes", requirePermission('dashboard', 'view'), (req, res) => {
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
});

router.get("/deuda-vencida", requirePermission('dashboard', 'view'), (req, res) => {
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
});

router.get("/stats", requirePermission('dashboard', 'view'), (req, res) => {
  // Redirect or call the same logic as /summary
  res.redirect('/api/dashboard/summary');
});

export default router;
