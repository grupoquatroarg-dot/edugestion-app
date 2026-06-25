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
            (CURRENT_DATE - MAX(DATE(s.fecha::timestamptz AT TIME ZONE 'America/Argentina/Buenos_Aires')))::int AS dias_atraso
          FROM clientes c
          JOIN sales s ON c.id = s.cliente_id
          WHERE c.saldo_cta_cte > 0
            AND s.metodo_pago = 'Cta Cte'
            AND ($1::int = 0 OR DATE(s.fecha::timestamptz AT TIME ZONE 'America/Argentina/Buenos_Aires') <= CURRENT_DATE - ($1::int * INTERVAL '1 day'))
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
          (pi.total - COALESCE(pi.monto_pagado, 0)) AS monto,
          pi.fecha,
          'Pendiente' AS estado
        FROM purchase_invoices pi
        JOIN proveedores p ON pi.proveedor_id = p.id
        WHERE pi.metodo_pago = 'Cta Cte' AND COALESCE(pi.estado_pago, 'pendiente') <> 'pagado'
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
          WHERE TO_CHAR(fecha::timestamptz AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM') = $1
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
          WHERE TO_CHAR(s.fecha::timestamptz AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM') = $1
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


    if (endpoint === "pedidos-clientes") {
      const result = await pool.query(`
        SELECT
          co.id,
          co.numero_pedido,
          co.fecha,
          co.estado,
          co.subtotal,
          co.total_final,
          c.nombre_apellido AS cliente,
          COUNT(coi.id)::int AS items,
          CASE
            WHEN co.estado = 'aprobado_pendiente_entrega'
              AND EXISTS (
                SELECT 1
                FROM customer_order_items shortage_item
                JOIN products p ON p.id = shortage_item.product_id
                WHERE shortage_item.order_id = co.id
                  AND COALESCE(shortage_item.cantidad, 0) > COALESCE(p.stock, 0)
              )
              THEN 'esperando_stock'
            WHEN co.estado = 'aprobado_pendiente_entrega'
              THEN 'listo_entrega'
            ELSE NULL
          END AS stock_status
        FROM customer_orders co
        JOIN clientes c ON c.id = co.cliente_id
        LEFT JOIN customer_order_items coi ON coi.order_id = co.id
        WHERE co.estado IN ('pendiente_aprobacion', 'aprobado_pendiente_entrega')
        GROUP BY co.id, c.nombre_apellido
        ORDER BY
          CASE
            WHEN co.estado = 'pendiente_aprobacion' THEN 1
            WHEN co.estado = 'aprobado_pendiente_entrega' THEN 2
            ELSE 3
          END,
          co.fecha DESC,
          co.id DESC
      `);

      return sendSuccess(res, result.rows.map((row: any) => ({
        id: toNumber(row.id),
        numero_pedido: toNumber(row.numero_pedido),
        fecha: row.fecha,
        estado: row.estado,
        stock_status: row.stock_status || null,
        subtotal: toNumber(row.subtotal),
        total_final: toNumber(row.total_final),
        cliente: row.cliente,
        items: toNumber(row.items),
      })));
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
          (CURRENT_DATE - MAX(DATE(s.fecha::timestamptz AT TIME ZONE 'America/Argentina/Buenos_Aires')))::int AS dias_atraso
        FROM clientes c
        JOIN sales s ON c.id = s.cliente_id
        WHERE c.saldo_cta_cte > 0
          AND s.metodo_pago = 'Cta Cte'
        GROUP BY c.id, c.nombre_apellido, c.saldo_cta_cte
        HAVING (CURRENT_DATE - MAX(DATE(s.fecha::timestamptz AT TIME ZONE 'America/Argentina/Buenos_Aires'))) > 7
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


    const isReportEndpoint = [
      "reports",
      "sales-period",
      "sales-by-client",
      "best-selling-products",
      "product-profitability",
      "current-accounts",
      "commissions",
    ].includes(endpoint);

    if (isReportEndpoint) {
      const rawFrom = Array.isArray(req.query?.from) ? req.query.from[0] : req.query?.from;
      const rawTo = Array.isArray(req.query?.to) ? req.query.to[0] : req.query?.to;
      const rawClienteId = Array.isArray(req.query?.cliente_id) ? req.query.cliente_id[0] : req.query?.cliente_id;
      const rawProductId = Array.isArray(req.query?.productId) ? req.query.productId[0] : req.query?.productId;

      const fromDate = String(rawFrom || "1970-01-01");
      const toDate = String(rawTo || "2099-12-31");
      const clienteId = rawClienteId ? Number(rawClienteId) : null;
      const productId = rawProductId && rawProductId !== "all" ? Number(rawProductId) : null;

      if (endpoint === "reports") {
        const salesStatsResult = await pool.query(
          `
            SELECT
              COALESCE(SUM(total), 0) AS total,
              COUNT(*)::int AS cantidad,
              COALESCE(AVG(total), 0) AS promedio
            FROM sales s
            WHERE DATE(s.fecha::timestamptz AT TIME ZONE 'America/Argentina/Buenos_Aires') BETWEEN $1::date AND $2::date
              AND ($3::int IS NULL OR s.cliente_id = $3)
          `,
          [fromDate, toDate, clienteId]
        );

        const salesByDayResult = await pool.query(
          `
            SELECT
              TO_CHAR(s.fecha::timestamptz AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD') AS fecha,
              COALESCE(SUM(s.total), 0) AS total,
              COUNT(*)::int AS cantidad
            FROM sales s
            WHERE DATE(s.fecha::timestamptz AT TIME ZONE 'America/Argentina/Buenos_Aires') BETWEEN $1::date AND $2::date
              AND ($3::int IS NULL OR s.cliente_id = $3)
            GROUP BY TO_CHAR(s.fecha::timestamptz AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD')
            ORDER BY fecha ASC
          `,
          [fromDate, toDate, clienteId]
        );

        const salesByMethodResult = await pool.query(
          `
            SELECT
              s.metodo_pago AS name,
              COALESCE(SUM(s.total), 0) AS value
            FROM sales s
            WHERE DATE(s.fecha::timestamptz AT TIME ZONE 'America/Argentina/Buenos_Aires') BETWEEN $1::date AND $2::date
              AND ($3::int IS NULL OR s.cliente_id = $3)
            GROUP BY s.metodo_pago
            ORDER BY value DESC
          `,
          [fromDate, toDate, clienteId]
        );

        const salesListResult = await pool.query(
          `
            SELECT
              s.id,
              s.fecha,
              COALESCE(c.nombre_apellido, s.nombre_cliente, 'Consumidor Final') AS nombre_cliente,
              s.total,
              s.metodo_pago
            FROM sales s
            LEFT JOIN clientes c ON s.cliente_id = c.id
            WHERE DATE(s.fecha::timestamptz AT TIME ZONE 'America/Argentina/Buenos_Aires') BETWEEN $1::date AND $2::date
              AND ($3::int IS NULL OR s.cliente_id = $3)
            ORDER BY s.fecha DESC, s.id DESC
          `,
          [fromDate, toDate, clienteId]
        );

        const newClientsResult = await pool.query(
          `
            SELECT COUNT(*)::int AS count
            FROM clientes
            WHERE DATE(fecha_alta::timestamptz AT TIME ZONE 'America/Argentina/Buenos_Aires') BETWEEN $1::date AND $2::date
          `,
          [fromDate, toDate]
        );

        const activeClientsResult = await pool.query(
          `
            SELECT COUNT(DISTINCT cliente_id)::int AS count
            FROM sales
            WHERE DATE(fecha::timestamptz AT TIME ZONE 'America/Argentina/Buenos_Aires') BETWEEN $1::date AND $2::date
          `,
          [fromDate, toDate]
        );

        const clientsWithDebtResult = await pool.query(
          `SELECT COUNT(*)::int AS count FROM clientes WHERE COALESCE(saldo_cta_cte, 0) > 0`
        );

        const clientListResult = await pool.query(
          `
            SELECT
              c.id,
              c.nombre_apellido AS nombre,
              COALESCE(SUM(s.total), 0) AS total,
              COUNT(s.id)::int AS cantidad,
              MAX(s.fecha) AS ultima_compra
            FROM sales s
            JOIN clientes c ON s.cliente_id = c.id
            WHERE DATE(s.fecha::timestamptz AT TIME ZONE 'America/Argentina/Buenos_Aires') BETWEEN $1::date AND $2::date
            GROUP BY c.id, c.nombre_apellido
            ORDER BY total DESC, c.nombre_apellido ASC
          `,
          [fromDate, toDate]
        );

        const productListResult = await pool.query(
          `
            SELECT
              p.name,
              COALESCE(SUM(si.cantidad), 0)::int AS cantidad,
              COALESCE(SUM(si.cantidad * si.precio_venta), 0) AS total,
              MAX(s.fecha) AS ultima_venta
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            JOIN products p ON si.product_id = p.id
            WHERE DATE(s.fecha::timestamptz AT TIME ZONE 'America/Argentina/Buenos_Aires') BETWEEN $1::date AND $2::date
            GROUP BY p.id, p.name
            ORDER BY cantidad DESC, p.name ASC
          `,
          [fromDate, toDate]
        );

        const productFamilyResult = await pool.query(
          `
            SELECT
              COALESCE(f.name, 'Sin familia') AS name,
              COALESCE(SUM(si.cantidad * si.precio_venta), 0) AS value
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            JOIN products p ON si.product_id = p.id
            LEFT JOIN product_families f ON p.family_id = f.id
            WHERE DATE(s.fecha::timestamptz AT TIME ZONE 'America/Argentina/Buenos_Aires') BETWEEN $1::date AND $2::date
            GROUP BY COALESCE(f.name, 'Sin familia')
            ORDER BY value DESC
          `,
          [fromDate, toDate]
        );

        const lowStockResult = await pool.query(
          `
            SELECT name, stock
            FROM products
            WHERE stock <= stock_minimo AND eliminado = 0
            ORDER BY stock ASC, name ASC
          `
        );

        const totalDebtResult = await pool.query(
          `SELECT COALESCE(SUM(saldo_cta_cte), 0) AS total FROM clientes`
        );

        const debtorsCountResult = await pool.query(
          `SELECT COUNT(*)::int AS count FROM clientes WHERE COALESCE(saldo_cta_cte, 0) > 0`
        );

        const rankingDebtorsResult = await pool.query(
          `
            SELECT
              c.id,
              c.nombre_apellido AS nombre,
              c.saldo_cta_cte AS saldo,
              COUNT(s.id)::int AS ventas_pendientes,
              MIN(s.fecha) AS fecha_antigua
            FROM clientes c
            LEFT JOIN sales s ON s.cliente_id = c.id AND s.monto_pendiente > 0
            WHERE COALESCE(c.saldo_cta_cte, 0) > 0
            GROUP BY c.id, c.nombre_apellido, c.saldo_cta_cte
            ORDER BY c.saldo_cta_cte DESC
          `
        );

        const financeStatsResult = await pool.query(
          `
            SELECT
              COALESCE(SUM(CASE WHEN tipo = 'ingreso' THEN monto ELSE 0 END), 0) AS ingresos,
              COALESCE(SUM(CASE WHEN tipo = 'egreso' THEN monto ELSE 0 END), 0) AS egresos
            FROM movimientos_financieros
            WHERE DATE(fecha::timestamptz AT TIME ZONE 'America/Argentina/Buenos_Aires') BETWEEN $1::date AND $2::date
          `,
          [fromDate, toDate]
        );

        const expensesByCategoryResult = await pool.query(
          `
            SELECT categoria AS name, COALESCE(SUM(monto), 0) AS value
            FROM movimientos_financieros
            WHERE tipo = 'egreso' AND DATE(fecha::timestamptz AT TIME ZONE 'America/Argentina/Buenos_Aires') BETWEEN $1::date AND $2::date
            GROUP BY categoria
            ORDER BY value DESC
          `,
          [fromDate, toDate]
        );

        const cashFlowResult = await pool.query(
          `
            SELECT
              TO_CHAR(fecha::timestamptz AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD') AS fecha,
              COALESCE(SUM(CASE WHEN tipo = 'ingreso' THEN monto ELSE 0 END), 0) AS ingresos,
              COALESCE(SUM(CASE WHEN tipo = 'egreso' THEN monto ELSE 0 END), 0) AS egresos
            FROM movimientos_financieros
            WHERE DATE(fecha::timestamptz AT TIME ZONE 'America/Argentina/Buenos_Aires') BETWEEN $1::date AND $2::date
            GROUP BY TO_CHAR(fecha::timestamptz AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD')
            ORDER BY fecha ASC
          `,
          [fromDate, toDate]
        );

        const salesStats = salesStatsResult.rows[0] || {};
        const financeStats = financeStatsResult.rows[0] || {};

        return sendSuccess(res, {
          ventas: {
            total: toNumber(salesStats.total),
            cantidad: toNumber(salesStats.cantidad),
            promedio: toNumber(salesStats.promedio),
            porDia: salesByDayResult.rows.map((row: any) => ({
              fecha: row.fecha,
              total: toNumber(row.total),
              cantidad: toNumber(row.cantidad),
            })),
            porMetodoPago: salesByMethodResult.rows.map((row: any) => ({
              name: row.name || "Sin metodo",
              value: toNumber(row.value),
            })),
            listaVentas: salesListResult.rows.map((row: any) => ({
              id: toNumber(row.id),
              fecha: row.fecha,
              nombre_cliente: row.nombre_cliente,
              total: toNumber(row.total),
              metodo_pago: row.metodo_pago,
            })),
          },
          clientes: {
            nuevos: toNumber(newClientsResult.rows[0]?.count),
            activos: toNumber(activeClientsResult.rows[0]?.count),
            conDeuda: toNumber(clientsWithDebtResult.rows[0]?.count),
            listadoClientes: clientListResult.rows.map((row: any) => ({
              id: toNumber(row.id),
              nombre: row.nombre,
              total: toNumber(row.total),
              cantidad: toNumber(row.cantidad),
              ultima_compra: row.ultima_compra,
            })),
          },
          productos: {
            listadoProductos: productListResult.rows.map((row: any) => ({
              name: row.name,
              cantidad: toNumber(row.cantidad),
              total: toNumber(row.total),
              ultima_venta: row.ultima_venta,
            })),
            porFamilia: productFamilyResult.rows.map((row: any) => ({
              name: row.name,
              value: toNumber(row.value),
            })),
            bajoStock: lowStockResult.rows.map((row: any) => ({
              name: row.name,
              stock: toNumber(row.stock),
            })),
          },
          deudas: {
            totalAdeudado: toNumber(totalDebtResult.rows[0]?.total),
            clientesDeudores: toNumber(debtorsCountResult.rows[0]?.count),
            deudaVencida: 0,
            rankingDeudores: rankingDebtorsResult.rows.map((row: any) => ({
              id: toNumber(row.id),
              nombre: row.nombre,
              saldo: toNumber(row.saldo),
              ventas_pendientes: toNumber(row.ventas_pendientes),
              fecha_antigua: row.fecha_antigua,
            })),
          },
          finanzas: {
            ingresos: toNumber(financeStats.ingresos),
            egresos: toNumber(financeStats.egresos),
            balance: toNumber(financeStats.ingresos) - toNumber(financeStats.egresos),
            egresosPorCategoria: expensesByCategoryResult.rows.map((row: any) => ({
              name: row.name || "Sin categoria",
              value: toNumber(row.value),
            })),
            flujoCaja: cashFlowResult.rows.map((row: any) => ({
              fecha: row.fecha,
              ingresos: toNumber(row.ingresos),
              egresos: toNumber(row.egresos),
            })),
          },
        });
      }

      if (endpoint === "sales-period") {
        const salesResult = await pool.query(
          `
            SELECT
              s.id,
              s.fecha,
              COALESCE(c.nombre_apellido, s.nombre_cliente, 'Consumidor Final') AS cliente,
              s.metodo_pago,
              STRING_AGG(p.name || ' (x' || si.cantidad::text || ')', ', ' ORDER BY p.name) AS productos,
              COALESCE(SUM(si.cantidad), 0)::int AS cantidad,
              s.total AS total_venta,
              COALESCE(s.costo_total, 0) AS costo_total,
              COALESCE(s.ganancia, 0) AS ganancia
            FROM sales s
            JOIN sale_items si ON s.id = si.sale_id
            JOIN products p ON si.product_id = p.id
            LEFT JOIN clientes c ON s.cliente_id = c.id
            WHERE DATE(s.fecha::timestamptz AT TIME ZONE 'America/Argentina/Buenos_Aires') BETWEEN $1::date AND $2::date
              AND ($3::int IS NULL OR s.cliente_id = $3)
            GROUP BY s.id, s.fecha, cliente, s.metodo_pago, s.total, s.costo_total, s.ganancia
            ORDER BY s.fecha DESC, s.id DESC
          `,
          [fromDate, toDate, clienteId]
        );

        const summaryResult = await pool.query(
          `
            SELECT
              COALESCE(SUM(total), 0) AS total_ventas,
              COALESCE(SUM(costo_total), 0) AS total_costo,
              COALESCE(SUM(ganancia), 0) AS total_ganancia,
              COUNT(*)::int AS cantidad_ventas,
              COALESCE(AVG(total), 0) AS ticket_promedio
            FROM sales s
            WHERE DATE(s.fecha::timestamptz AT TIME ZONE 'America/Argentina/Buenos_Aires') BETWEEN $1::date AND $2::date
              AND ($3::int IS NULL OR s.cliente_id = $3)
          `,
          [fromDate, toDate, clienteId]
        );

        const summary = summaryResult.rows[0] || {};

        return sendSuccess(res, {
          sales: salesResult.rows.map((row: any) => ({
            id: toNumber(row.id),
            fecha: row.fecha,
            cliente: row.cliente,
            metodo_pago: row.metodo_pago,
            productos: row.productos || "",
            cantidad: toNumber(row.cantidad),
            total_venta: toNumber(row.total_venta),
            costo_total: toNumber(row.costo_total),
            ganancia: toNumber(row.ganancia),
          })),
          summary: {
            totalVentas: toNumber(summary.total_ventas),
            totalCosto: toNumber(summary.total_costo),
            totalGanancia: toNumber(summary.total_ganancia),
            cantidadVentas: toNumber(summary.cantidad_ventas),
            ticketPromedio: toNumber(summary.ticket_promedio),
          },
        });
      }

      if (endpoint === "sales-by-client") {
        const result = await pool.query(
          `
            SELECT
              COALESCE(c.id, s.cliente_id) AS cliente_id,
              COALESCE(c.nombre_apellido, s.nombre_cliente, 'Consumidor Final') AS cliente,
              COUNT(s.id)::int AS cantidad_ventas,
              COALESCE(SUM(s.total), 0) AS total_comprado,
              COALESCE(SUM(s.ganancia), 0) AS total_ganancia
            FROM sales s
            LEFT JOIN clientes c ON s.cliente_id = c.id
            WHERE DATE(s.fecha::timestamptz AT TIME ZONE 'America/Argentina/Buenos_Aires') BETWEEN $1::date AND $2::date
            GROUP BY COALESCE(c.id, s.cliente_id), COALESCE(c.nombre_apellido, s.nombre_cliente, 'Consumidor Final')
            ORDER BY total_comprado DESC, cliente ASC
          `,
          [fromDate, toDate]
        );

        return sendSuccess(
          res,
          result.rows.map((row: any) => ({
            cliente_id: toNumber(row.cliente_id),
            cliente: row.cliente,
            cantidad_ventas: toNumber(row.cantidad_ventas),
            total_comprado: toNumber(row.total_comprado),
            total_ganancia: toNumber(row.total_ganancia),
          }))
        );
      }

      if (endpoint === "best-selling-products") {
        const result = await pool.query(
          `
            SELECT
              p.name AS producto,
              COALESCE(SUM(si.cantidad), 0)::int AS cantidad_vendida,
              COALESCE(SUM(si.cantidad * si.precio_venta), 0) AS total_facturado,
              COALESCE(SUM((si.cantidad * si.precio_venta) - COALESCE(si.costo_total_peps, 0)), 0) AS total_ganancia
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            JOIN products p ON si.product_id = p.id
            WHERE DATE(s.fecha::timestamptz AT TIME ZONE 'America/Argentina/Buenos_Aires') BETWEEN $1::date AND $2::date
            GROUP BY p.id, p.name
            ORDER BY cantidad_vendida DESC, producto ASC
          `,
          [fromDate, toDate]
        );

        return sendSuccess(
          res,
          result.rows.map((row: any) => ({
            producto: row.producto,
            cantidad_vendida: toNumber(row.cantidad_vendida),
            total_facturado: toNumber(row.total_facturado),
            total_ganancia: toNumber(row.total_ganancia),
          }))
        );
      }

      if (endpoint === "product-profitability") {
        const result = await pool.query(
          `
            SELECT
              p.id AS product_id,
              p.name AS producto,
              COALESCE(SUM(si.cantidad), 0)::int AS cantidad_vendida,
              COALESCE(SUM(si.cantidad * si.precio_venta), 0) AS ventas_totales,
              COALESCE(SUM(COALESCE(si.costo_total_peps, 0)), 0) AS costo_total,
              COALESCE(SUM((si.cantidad * si.precio_venta) - COALESCE(si.costo_total_peps, 0)), 0) AS ganancia,
              CASE
                WHEN COALESCE(SUM(si.cantidad * si.precio_venta), 0) > 0 THEN
                  (COALESCE(SUM((si.cantidad * si.precio_venta) - COALESCE(si.costo_total_peps, 0)), 0)
                    / SUM(si.cantidad * si.precio_venta)) * 100
                ELSE 0
              END AS margen_porcentual
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            JOIN products p ON si.product_id = p.id
            WHERE DATE(s.fecha::timestamptz AT TIME ZONE 'America/Argentina/Buenos_Aires') BETWEEN $1::date AND $2::date
              AND ($3::int IS NULL OR p.id = $3)
            GROUP BY p.id, p.name
            ORDER BY ganancia DESC, producto ASC
          `,
          [fromDate, toDate, productId]
        );

        return sendSuccess(
          res,
          result.rows.map((row: any) => ({
            product_id: toNumber(row.product_id),
            producto: row.producto,
            cantidad_vendida: toNumber(row.cantidad_vendida),
            ventas_totales: toNumber(row.ventas_totales),
            costo_total: toNumber(row.costo_total),
            ganancia: toNumber(row.ganancia),
            margen_porcentual: toNumber(row.margen_porcentual),
          }))
        );
      }

      if (endpoint === "current-accounts") {
        const result = await pool.query(
          `
            SELECT
              c.id AS cliente_id,
              c.nombre_apellido AS cliente,
              c.saldo_cta_cte AS monto_deuda,
              COUNT(s.id)::int AS ventas_pendientes,
              MIN(s.fecha) AS fecha_antigua,
              COALESCE((CURRENT_DATE - MIN(DATE(s.fecha::timestamptz AT TIME ZONE 'America/Argentina/Buenos_Aires')))::int, 0) AS dias_vencidos
            FROM clientes c
            LEFT JOIN sales s ON s.cliente_id = c.id AND s.monto_pendiente > 0
            WHERE COALESCE(c.saldo_cta_cte, 0) > 0
            GROUP BY c.id, c.nombre_apellido, c.saldo_cta_cte
            ORDER BY c.saldo_cta_cte DESC
          `
        );

        return sendSuccess(
          res,
          result.rows.map((row: any) => ({
            cliente_id: toNumber(row.cliente_id),
            cliente: row.cliente,
            monto_deuda: toNumber(row.monto_deuda),
            ventas_pendientes: toNumber(row.ventas_pendientes),
            fecha_antigua: row.fecha_antigua,
            dias_vencidos: toNumber(row.dias_vencidos),
          }))
        );
      }

      if (endpoint === "commissions") {
        const pctResult = await pool.query(
          `SELECT COALESCE((SELECT value::numeric FROM settings WHERE key = 'default_commission_percentage' LIMIT 1), 5) AS pct`
        );
        const commissionPct = toNumber(pctResult.rows[0]?.pct, 5);

        const result = await pool.query(
          `
            SELECT
              s.id,
              s.fecha,
              COALESCE(c.nombre_apellido, s.nombre_cliente, 'Consumidor Final') AS cliente,
              s.total AS total_venta,
              $3::numeric AS porcentaje_comision,
              (s.total * $3::numeric / 100) AS comision_generada
            FROM sales s
            JOIN clientes c ON s.cliente_id = c.id
            WHERE DATE(s.fecha::timestamptz AT TIME ZONE 'America/Argentina/Buenos_Aires') BETWEEN $1::date AND $2::date
              AND c.tipo_cliente = 'mayorista'
            ORDER BY s.fecha DESC, s.id DESC
          `,
          [fromDate, toDate, commissionPct]
        );

        const sales = result.rows.map((row: any) => ({
          id: toNumber(row.id),
          fecha: row.fecha,
          cliente: row.cliente,
          total_venta: toNumber(row.total_venta),
          porcentaje_comision: toNumber(row.porcentaje_comision),
          comision_generada: toNumber(row.comision_generada),
        }));

        return sendSuccess(res, {
          sales,
          summary: {
            totalComisiones: sales.reduce((acc: number, sale: any) => acc + sale.comision_generada, 0),
          },
        });
      }
    }

    return sendError(res, "Endpoint de dashboard no encontrado", 404);
  } catch (error: any) {
    return sendError(res, error?.message || "Error al obtener datos de dashboard", 400);
  }
}
