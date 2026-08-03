import db from "../db.js";
import { getPostgresPool, isPostgresConfigured } from "../utils/postgres.js";
import { AppError } from "../utils/response.js";

type Queryable = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

export type PetiSalesReportFilters = {
  from?: string | null;
  to?: string | null;
};

export type PetiSalesReportRow = {
  cliente: string;
  pedidos: number;
  unidades: number;
  total: number;
  efectivo: number;
  cobrado: number;
  cuenta_corriente: number;
};

export type PetiSalesReportResult = {
  empresa: "Peti";
  desde: string | null;
  hasta: string | null;
  ventas_incluidas: number;
  clientes: PetiSalesReportRow[];
  totales: {
    pedidos: number;
    unidades: number;
    total: number;
    efectivo: number;
    cobrado: number;
    cuenta_corriente: number;
  };
};

type SaleItemRow = {
  sale_id: number;
  cliente: string;
  sale_total: number;
  sale_paid: number;
  sale_payment_method: string;
  cantidad: number;
  precio_venta: number;
};

type PaymentRow = {
  sale_id: number;
  monto: number;
  forma_pago: string;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const toNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const normalizeDate = (value: unknown, label: string) => {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  if (!DATE_PATTERN.test(normalized)) {
    throw new AppError(`${label} debe tener formato AAAA-MM-DD`, 400);
  }

  const [year, month, day] = normalized.split("-").map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    throw new AppError(`${label} no es una fecha válida`, 400);
  }

  return normalized;
};

const normalizePaymentMethod = (value: unknown) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/_/g, " ")
    .trim();

const isCashMethod = (value: unknown) => normalizePaymentMethod(value).includes("efectivo");

const normalizeCustomerName = (value: unknown) => {
  const normalized = String(value ?? "").trim();
  return normalized || "Sin cliente";
};

const mapSaleItemRow = (row: any): SaleItemRow => ({
  sale_id: Math.trunc(toNumber(row.sale_id)),
  cliente: normalizeCustomerName(row.cliente),
  sale_total: roundMoney(toNumber(row.sale_total)),
  sale_paid: roundMoney(toNumber(row.sale_paid)),
  sale_payment_method: String(row.sale_payment_method ?? ""),
  cantidad: toNumber(row.cantidad),
  precio_venta: roundMoney(toNumber(row.precio_venta)),
});

const mapPaymentRow = (row: any): PaymentRow => ({
  sale_id: Math.trunc(toNumber(row.sale_id)),
  monto: roundMoney(toNumber(row.monto)),
  forma_pago: String(row.forma_pago ?? ""),
});

const buildReport = (
  itemRows: SaleItemRow[],
  paymentRows: PaymentRow[],
  from: string | null,
  to: string | null
): PetiSalesReportResult => {
  const paymentsBySale = new Map<number, PaymentRow[]>();
  for (const payment of paymentRows) {
    if (!payment.sale_id || payment.monto <= 0) continue;
    if (!paymentsBySale.has(payment.sale_id)) paymentsBySale.set(payment.sale_id, []);
    paymentsBySale.get(payment.sale_id)!.push(payment);
  }

  const sales = new Map<number, {
    sale_id: number;
    cliente: string;
    sale_total: number;
    sale_paid: number;
    sale_payment_method: string;
    peti_total: number;
    unidades: number;
  }>();

  for (const item of itemRows) {
    if (!item.sale_id || item.cantidad <= 0 || item.precio_venta < 0) continue;

    if (!sales.has(item.sale_id)) {
      sales.set(item.sale_id, {
        sale_id: item.sale_id,
        cliente: item.cliente,
        sale_total: item.sale_total,
        sale_paid: item.sale_paid,
        sale_payment_method: item.sale_payment_method,
        peti_total: 0,
        unidades: 0,
      });
    }

    const sale = sales.get(item.sale_id)!;
    sale.peti_total += item.cantidad * item.precio_venta;
    sale.unidades += item.cantidad;
  }

  const customers = new Map<string, PetiSalesReportRow>();

  for (const sale of sales.values()) {
    const petiTotal = roundMoney(sale.peti_total);
    if (petiTotal <= 0) continue;

    const saleTotal = Math.max(0, roundMoney(sale.sale_total));
    const declaredPaid = clamp(roundMoney(sale.sale_paid), 0, saleTotal);
    const ratio = saleTotal > 0 ? clamp(petiTotal / saleTotal, 0, 1) : 0;

    const tracedPayments = paymentsBySale.get(sale.sale_id) || [];
    const tracedTotal = roundMoney(
      tracedPayments.reduce((sum, payment) => sum + Math.max(0, payment.monto), 0)
    );
    const tracedScale = tracedTotal > declaredPaid + 0.01 && tracedTotal > 0
      ? declaredPaid / tracedTotal
      : 1;

    let adjustedTracedTotal = 0;
    let cashPaid = 0;

    for (const payment of tracedPayments) {
      const adjustedAmount = roundMoney(Math.max(0, payment.monto) * tracedScale);
      adjustedTracedTotal += adjustedAmount;
      if (isCashMethod(payment.forma_pago)) cashPaid += adjustedAmount;
    }

    adjustedTracedTotal = roundMoney(adjustedTracedTotal);
    const untracedPaid = roundMoney(Math.max(0, declaredPaid - adjustedTracedTotal));
    if (untracedPaid > 0 && isCashMethod(sale.sale_payment_method)) {
      cashPaid += untracedPaid;
    }

    const petiCollected = roundMoney(declaredPaid * ratio);
    const petiCash = Math.min(petiCollected, roundMoney(cashPaid * ratio));
    const petiPending = roundMoney(Math.max(0, petiTotal - petiCollected));

    const customerKey = sale.cliente;
    if (!customers.has(customerKey)) {
      customers.set(customerKey, {
        cliente: customerKey,
        pedidos: 0,
        unidades: 0,
        total: 0,
        efectivo: 0,
        cobrado: 0,
        cuenta_corriente: 0,
      });
    }

    const customer = customers.get(customerKey)!;
    customer.pedidos += 1;
    customer.unidades += sale.unidades;
    customer.total += petiTotal;
    customer.efectivo += petiCash;
    customer.cobrado += petiCollected;
    customer.cuenta_corriente += petiPending;
  }

  const clientes = Array.from(customers.values())
    .map((row) => ({
      ...row,
      unidades: Math.round(row.unidades * 1000) / 1000,
      total: roundMoney(row.total),
      efectivo: roundMoney(row.efectivo),
      cobrado: roundMoney(row.cobrado),
      cuenta_corriente: roundMoney(row.cuenta_corriente),
    }))
    .sort((a, b) => b.total - a.total || a.cliente.localeCompare(b.cliente, "es"));

  const totales = clientes.reduce(
    (acc, row) => {
      acc.pedidos += row.pedidos;
      acc.unidades += row.unidades;
      acc.total += row.total;
      acc.efectivo += row.efectivo;
      acc.cobrado += row.cobrado;
      acc.cuenta_corriente += row.cuenta_corriente;
      return acc;
    },
    {
      pedidos: 0,
      unidades: 0,
      total: 0,
      efectivo: 0,
      cobrado: 0,
      cuenta_corriente: 0,
    }
  );

  return {
    empresa: "Peti",
    desde: from,
    hasta: to,
    ventas_incluidas: sales.size,
    clientes,
    totales: {
      pedidos: totales.pedidos,
      unidades: Math.round(totales.unidades * 1000) / 1000,
      total: roundMoney(totales.total),
      efectivo: roundMoney(totales.efectivo),
      cobrado: roundMoney(totales.cobrado),
      cuenta_corriente: roundMoney(totales.cuenta_corriente),
    },
  };
};

const fetchPostgresRows = async (
  queryable: Queryable,
  from: string | null,
  to: string | null
) => {
  const params: any[] = [];
  const conditions = [
    "lower(btrim(COALESCE(p.company, ''))) = 'peti'",
    "lower(COALESCE(s.estado, '')) <> 'anulada'",
  ];

  if (from) {
    params.push(from);
    conditions.push(`s.fecha::date >= $${params.length}::date`);
  }
  if (to) {
    params.push(to);
    conditions.push(`s.fecha::date <= $${params.length}::date`);
  }

  const itemsResult = await queryable.query(
    `SELECT
       s.id AS sale_id,
       COALESCE(NULLIF(btrim(c.nombre_apellido), ''), NULLIF(btrim(s.nombre_cliente), ''), 'Sin cliente') AS cliente,
       COALESCE(s.total, 0) AS sale_total,
       COALESCE(s.monto_pagado, 0) AS sale_paid,
       COALESCE(s.metodo_pago, '') AS sale_payment_method,
       COALESCE(si.cantidad, 0) AS cantidad,
       COALESCE(si.precio_venta, 0) AS precio_venta
     FROM sales s
     JOIN sale_items si ON si.sale_id = s.id
     JOIN products p ON p.id = si.product_id
     LEFT JOIN clientes c ON c.id = s.cliente_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY s.id ASC, si.id ASC`,
    params
  );

  const itemRows = itemsResult.rows.map(mapSaleItemRow);
  const saleIds = Array.from(new Set(itemRows.map((row) => row.sale_id).filter(Boolean)));

  if (!saleIds.length) {
    return { itemRows, paymentRows: [] as PaymentRow[] };
  }

  const paymentsResult = await queryable.query(
    `SELECT
       spa.sale_id,
       COALESCE(spa.monto, 0) AS monto,
       COALESCE(mf.forma_pago, '') AS forma_pago
     FROM sale_payment_allocations spa
     JOIN movimientos_financieros mf ON mf.id = spa.movimiento_financiero_id
     WHERE spa.sale_id = ANY($1::int[])
       AND lower(COALESCE(spa.estado, 'Activo')) = 'activo'
       AND lower(COALESCE(mf.estado, 'Activo')) = 'activo'
     ORDER BY spa.sale_id ASC, spa.id ASC`,
    [saleIds]
  );

  return {
    itemRows,
    paymentRows: paymentsResult.rows.map(mapPaymentRow),
  };
};

const fetchSqliteRows = (from: string | null, to: string | null) => {
  const params: any[] = [];
  const conditions = [
    "lower(trim(COALESCE(p.company, ''))) = 'peti'",
    "lower(COALESCE(s.estado, '')) <> 'anulada'",
  ];

  if (from) {
    conditions.push("date(s.fecha) >= date(?)");
    params.push(from);
  }
  if (to) {
    conditions.push("date(s.fecha) <= date(?)");
    params.push(to);
  }

  const itemRows = (db.prepare(
    `SELECT
       s.id AS sale_id,
       COALESCE(NULLIF(trim(c.nombre_apellido), ''), NULLIF(trim(s.nombre_cliente), ''), 'Sin cliente') AS cliente,
       COALESCE(s.total, 0) AS sale_total,
       COALESCE(s.monto_pagado, 0) AS sale_paid,
       COALESCE(s.metodo_pago, '') AS sale_payment_method,
       COALESCE(si.cantidad, 0) AS cantidad,
       COALESCE(si.precio_venta, 0) AS precio_venta
     FROM sales s
     JOIN sale_items si ON si.sale_id = s.id
     JOIN products p ON p.id = si.product_id
     LEFT JOIN clientes c ON c.id = s.cliente_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY s.id ASC, si.id ASC`
  ).all(...params) as any[]).map(mapSaleItemRow);

  const saleIds = Array.from(new Set(itemRows.map((row) => row.sale_id).filter(Boolean)));
  if (!saleIds.length) {
    return { itemRows, paymentRows: [] as PaymentRow[] };
  }

  const placeholders = saleIds.map(() => "?").join(", ");
  const paymentRows = (db.prepare(
    `SELECT
       spa.sale_id,
       COALESCE(spa.monto, 0) AS monto,
       COALESCE(mf.forma_pago, '') AS forma_pago
     FROM sale_payment_allocations spa
     JOIN movimientos_financieros mf ON mf.id = spa.movimiento_financiero_id
     WHERE spa.sale_id IN (${placeholders})
       AND lower(COALESCE(spa.estado, 'Activo')) = 'activo'
       AND lower(COALESCE(mf.estado, 'Activo')) = 'activo'
     ORDER BY spa.sale_id ASC, spa.id ASC`
  ).all(...saleIds) as any[]).map(mapPaymentRow);

  return { itemRows, paymentRows };
};

export const petiSalesReportService = {
  async getReport(filters: PetiSalesReportFilters = {}, executor?: Queryable): Promise<PetiSalesReportResult> {
    const from = normalizeDate(filters.from, "Desde");
    const to = normalizeDate(filters.to, "Hasta");

    if (from && to && from > to) {
      throw new AppError("La fecha Desde no puede ser posterior a Hasta", 400);
    }

    if (executor || isPostgresConfigured()) {
      const queryable = executor || getPostgresPool();
      const { itemRows, paymentRows } = await fetchPostgresRows(queryable, from, to);
      return buildReport(itemRows, paymentRows, from, to);
    }

    const { itemRows, paymentRows } = fetchSqliteRows(from, to);
    return buildReport(itemRows, paymentRows, from, to);
  },
};
