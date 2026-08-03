import fs from "node:fs";
import path from "node:path";
import { petiSalesReportService } from "../server/services/petiSalesReportService.js";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};

const service = read("server/services/petiSalesReportService.ts");
const vercelApi = read("api/sales.ts");
const expressRoute = read("server/routes/salesRoutes.ts");
const salesUi = read("src/components/SalesModule.tsx");
const packageJson = JSON.parse(read("package.json"));

for (const token of [
  "lower(btrim(COALESCE(p.company, ''))) = 'peti'",
  "lower(trim(COALESCE(p.company, ''))) = 'peti'",
  "JOIN sale_items si ON si.sale_id = s.id",
  "JOIN products p ON p.id = si.product_id",
  "lower(COALESCE(s.estado, '')) <> 'anulada'",
  "sale_payment_allocations",
  "movimientos_financieros",
  "cuenta_corriente",
  "ventas_incluidas",
]) {
  assert(service.includes(token), `El servicio del reporte no contiene: ${token}`);
}

assert(!service.includes("supplier_orders"), "El reporte Peti no debe depender de pedidos a proveedor.");
assert(!service.includes("stock >") && !service.includes("stock_actual"), "El reporte Peti no debe depender del stock.");
assert(
  service.includes("petiTotal / saleTotal"),
  "Las ventas mixtas no prorratean cobros según el valor Peti."
);
assert(
  service.includes("declaredPaid * ratio") && service.includes("cashPaid * ratio"),
  "Cobrado y Efectivo no se limitan a la proporción Peti."
);
assert(
  vercelApi.includes('endpoint === "peti-customer-report"') &&
    vercelApi.includes("petiSalesReportService.getReport"),
  "La función Vercel no expone el reporte Peti."
);
assert(
  expressRoute.includes("'peti-customer-report'") &&
    expressRoute.includes("petiSalesReportService.getReport"),
  "Express no expone el reporte Peti."
);

for (const token of [
  "Reporte de ventas Peti por cliente",
  "REPORTE VENTAS PETI POR CLIENTE",
  "Cliente",
  "Pedidos",
  "Unidades",
  "Total",
  "Efectivo",
  "Cobrado",
  "Cuenta Corriente",
  "Reporte_Ventas_Peti_Por_Cliente.pdf",
  "petiReportDateFrom",
  "petiReportDateTo",
  "Generar reporte",
  "Imprimir económico",
]) {
  assert(salesUi.includes(token), `La interfaz del reporte no contiene: ${token}`);
}

assert(
  packageJson.scripts?.["check:peti-sales-report"],
  "Falta el script check:peti-sales-report."
);
assert(
  String(packageJson.scripts?.["validate:audit"] || "").includes("check:peti-sales-report"),
  "validate:audit no ejecuta la auditoría del reporte Peti."
);

const itemRows = [
  {
    sale_id: 1,
    cliente: "Cliente A",
    sale_total: 100,
    sale_paid: 50,
    sale_payment_method: "Efectivo",
    cantidad: 2,
    precio_venta: 30,
  },
  {
    sale_id: 2,
    cliente: "Cliente A",
    sale_total: 80,
    sale_paid: 20,
    sale_payment_method: "Transferencia",
    cantidad: 4,
    precio_venta: 20,
  },
  {
    sale_id: 3,
    cliente: "Cliente B",
    sale_total: 100,
    sale_paid: 50,
    sale_payment_method: "mixto (Efectivo + cta_cte)",
    cantidad: 5,
    precio_venta: 10,
  },
  {
    sale_id: 4,
    cliente: "Cliente B",
    sale_total: 60,
    sale_paid: 30,
    sale_payment_method: "Efectivo",
    cantidad: 3,
    precio_venta: 10,
  },
];

const paymentRows = [
  { sale_id: 1, monto: 50, forma_pago: "Efectivo" },
  { sale_id: 2, monto: 20, forma_pago: "Transferencia" },
  { sale_id: 3, monto: 20, forma_pago: "Efectivo" },
  { sale_id: 3, monto: 30, forma_pago: "Transferencia" },
];

const queries: Array<{ text: string; params: any[] }> = [];
const executor = {
  async query(text: string, params: any[] = []) {
    queries.push({ text, params });
    if (text.includes("FROM sales s") && text.includes("JOIN sale_items")) {
      return { rows: itemRows, rowCount: itemRows.length };
    }
    if (text.includes("FROM sale_payment_allocations")) {
      return { rows: paymentRows, rowCount: paymentRows.length };
    }
    throw new Error(`Consulta mock no contemplada: ${text}`);
  },
};

const report = await petiSalesReportService.getReport(
  { from: "2026-07-01", to: "2026-07-31" },
  executor
);

assert(report.empresa === "Peti", "La empresa del reporte no es Peti.");
assert(report.desde === "2026-07-01" && report.hasta === "2026-07-31", "El período no se conserva.");
assert(report.ventas_incluidas === 4, "La cantidad de ventas Peti es incorrecta.");
assert(report.clientes.length === 2, "La cantidad de clientes es incorrecta.");

const clientA = report.clientes.find((row) => row.cliente === "Cliente A");
const clientB = report.clientes.find((row) => row.cliente === "Cliente B");
assert(clientA, "Falta Cliente A.");
assert(clientB, "Falta Cliente B.");

assert(clientA.pedidos === 2, "Pedidos de Cliente A incorrectos.");
assert(clientA.unidades === 6, "Unidades de Cliente A incorrectas.");
assert(clientA.total === 140, "Total Peti de Cliente A incorrecto.");
assert(clientA.efectivo === 30, "Efectivo Peti de Cliente A incorrecto.");
assert(clientA.cobrado === 50, "Cobrado Peti de Cliente A incorrecto.");
assert(clientA.cuenta_corriente === 90, "Cuenta corriente Peti de Cliente A incorrecta.");

assert(clientB.pedidos === 2, "Pedidos de Cliente B incorrectos.");
assert(clientB.unidades === 8, "Unidades de Cliente B incorrectas.");
assert(clientB.total === 80, "Total Peti de Cliente B incorrecto.");
assert(clientB.efectivo === 25, "Efectivo Peti de Cliente B incorrecto.");
assert(clientB.cobrado === 40, "Cobrado Peti de Cliente B incorrecto.");
assert(clientB.cuenta_corriente === 40, "Cuenta corriente Peti de Cliente B incorrecta.");

assert(report.totales.pedidos === 4, "Total de pedidos incorrecto.");
assert(report.totales.unidades === 14, "Total de unidades incorrecto.");
assert(report.totales.total === 220, "Total general Peti incorrecto.");
assert(report.totales.efectivo === 55, "Total de efectivo incorrecto.");
assert(report.totales.cobrado === 90, "Total cobrado incorrecto.");
assert(report.totales.cuenta_corriente === 130, "Total de cuenta corriente incorrecto.");

assert(queries.length === 2, "El reporte debe usar una consulta de ítems y otra de pagos.");
assert(
  queries[0].params[0] === "2026-07-01" && queries[0].params[1] === "2026-07-31",
  "Las fechas no se parametrizaron correctamente."
);
assert(
  Array.isArray(queries[1].params[0]) &&
    queries[1].params[0].join(",") === "1,2,3,4",
  "Los pagos no se limitaron a las ventas Peti seleccionadas."
);

let invalidRangeRejected = false;
try {
  await petiSalesReportService.getReport(
    { from: "2026-08-01", to: "2026-07-01" },
    executor
  );
} catch (error: any) {
  invalidRangeRejected = String(error?.message || error).includes("Desde no puede");
}
assert(invalidRangeRejected, "No se rechazó un rango de fechas invertido.");

let invalidDateRejected = false;
try {
  await petiSalesReportService.getReport({ from: "2026-02-30" }, executor);
} catch (error: any) {
  invalidDateRejected = String(error?.message || error).includes("fecha válida");
}
assert(invalidDateRejected, "No se rechazó una fecha inexistente.");

console.log(
  "Reporte Peti correcto: filtro por empresa, ventas mixtas, cobros prorrateados, período, PDF y totales por cliente verificados."
);
