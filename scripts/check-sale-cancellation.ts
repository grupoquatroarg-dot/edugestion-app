import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const assert = (condition: any, message: string) => {
  if (!condition) throw new Error(message);
};

const servicePath = 'server/services/saleCancellationService.ts';
const service = read(servicePath);

for (const required of [
  "client.query('BEGIN')",
  "client.query('COMMIT')",
  "client.query('ROLLBACK')",
  'FOR UPDATE',
  'reversion_version',
  'sale_stock_allocations',
  'sale_payment_allocations',
  'sale_cancellations',
  'reversed_movement_id',
  "SET estado = 'Anulada'",
  "['en_cartera', 'anulado']",
  'El motivo de anulación no puede superar los 500 caracteres',
]) {
  assert(service.includes(required), `Falta protección de anulación: ${required}`);
}

assert(!/DELETE\s+FROM\s+sales/i.test(service), 'La anulación no debe borrar la venta.');
assert(!/DELETE\s+FROM\s+sale_items/i.test(service), 'La anulación no debe borrar los productos vendidos.');

const sourceFile = ts.createSourceFile(servicePath, service, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
let parameterizedQueries = 0;

const getSqlText = (node: ts.Expression) => {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
};

const visit = (node: ts.Node) => {
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'query' &&
    node.arguments.length >= 2
  ) {
    const sql = getSqlText(node.arguments[0]);
    const params = node.arguments[1];
    if (sql && ts.isArrayLiteralExpression(params)) {
      const placeholders = [...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
      const maximum = placeholders.length ? Math.max(...placeholders) : 0;
      if (maximum) {
        parameterizedQueries += 1;
        assert(maximum === params.elements.length, `Consulta de anulación con parámetros incorrectos: ${maximum}/${params.elements.length}.`);
      }
    }
  }
  ts.forEachChild(node, visit);
};
visit(sourceFile);
assert(parameterizedQueries >= 20, 'No se auditaron suficientes consultas de anulación.');

const apiSales = read('api/sales.ts');
assert(apiSales.includes('endpoint === "sale-cancel"'), 'Falta endpoint sale-cancel.');
assert(apiSales.includes('"sales", "delete"'), 'Falta permiso sales/delete.');
assert(apiSales.includes('saleCancellationService.cancelSale'), 'La API no ejecuta el servicio transaccional.');

const salesUi = read('src/components/SalesModule.tsx');
for (const required of ['sale-cancel', 'Confirmar anulación', 'Sin trazabilidad', 'Venta anulada']) {
  assert(salesUi.includes(required), `Falta interfaz de anulación: ${required}`);
}

const pdf = read('src/utils/pdfGenerator.ts');
assert(pdf.includes('COMPROBANTE DE VENTA - ANULADO'), 'El PDF no identifica la venta anulada.');
assert(pdf.includes('_ANULADA'), 'El nombre del PDF no identifica la anulación.');

const filteredFiles: Array<[string, number]> = [
  ['api/dashboard/[endpoint].ts', 20],
  ['server/services/vercel/dashboardApiHelpers.ts', 8],
  ['server/routes/dashboardRoutes.ts', 20],
  ['server/routes/reportRoutes.ts', 10],
  ['server/routes/checklistRoutes.ts', 1],
  ['api/clientes.ts', 6],
];

for (const [file, minimum] of filteredFiles) {
  const occurrences = (read(file).match(/anulada/gi) || []).length;
  assert(occurrences >= minimum, `${file} no excluye/representa ventas anuladas en todos los flujos (${occurrences}/${minimum}).`);
}

assert(read('src/components/CustomerPortal.tsx').includes('value="cancelled">Anuladas'), 'El portal no permite filtrar anuladas.');
assert(read('src/components/CustomerDetail.tsx').includes('Venta anulada'), 'La ficha del cliente no muestra la anulación.');
assert(read('src/components/FinanceModule.tsx').includes('anulacion_venta'), 'Finanzas no muestra contramovimientos.');
assert(read('src/components/SupplierOrders.tsx').includes("'cancelado'"), 'Pedidos no contempla cancelación por venta anulada.');

console.log(`Anular venta correcto: transacción, permisos, ${parameterizedQueries} consultas, UI, PDF, clientes y métricas verificados.`);
