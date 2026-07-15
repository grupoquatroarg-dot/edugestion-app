import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

const migrationPath = "supabase/05_purchase_invoice_reversal_traceability.sql";
const migration = read(migrationPath);

for (const required of [
  "purchase_invoices_reversion_version_check",
  "purchase_invoice_payment_allocations",
  "purchase_invoice_cancellations",
  "previous_product_cost",
  "product_was_created",
  "stock_movement_id",
  "purchase_invoice_id",
  "purchase_invoice_item_id",
  "purchase_invoice_cancellation_id",
  "cheques_purchase_invoice_id_fkey",
]) {
  assert(migration.includes(required), `Falta estructura en ${migrationPath}: ${required}`);
}

assert(
  migration.includes("CHECK (reversion_version IN (0, 1))"),
  "La versión de reversión no está restringida."
);
assert(
  migration.includes("UNIQUE (purchase_invoice_id, movimiento_financiero_id)"),
  "La asignación de pago no protege duplicados."
);

const servicePath = "server/services/purchaseInvoiceService.ts";
const service = read(servicePath);

for (const required of [
  'reversion_version',
  '"Activa"',
  'previous_product_cost',
  'product_was_created',
  'stock_movement_id',
  'purchase_invoice_payment_allocations',
  'purchase_invoice_id',
  'purchase_invoice_item_id',
  '"initial_payment"',
  '"supplier_payment"',
  "FOR UPDATE",
  'client.query("BEGIN")',
  'client.query("COMMIT")',
  'client.query("ROLLBACK")',
  "No se puede pagar una factura anulada",
]) {
  assert(service.includes(required), `Falta trazabilidad en ${servicePath}: ${required}`);
}

for (const requiredSql of [
  "INSERT INTO purchase_invoices",
  "INSERT INTO purchase_invoice_items",
  "INSERT INTO stock_movimientos",
  "INSERT INTO movimientos_financieros",
  "INSERT INTO purchase_invoice_payment_allocations",
  "UPDATE purchase_invoice_items",
]) {
  assert(service.includes(requiredSql), `Falta operación trazable: ${requiredSql}`);
}

assert(
  /INSERT INTO purchase_invoices[\s\S]*?estado,[\s\S]*?reversion_version[\s\S]*?VALUES \(\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8, \$9, \$10, \$11\)/.test(service),
  "La factura PostgreSQL no guarda estado y versión."
);
assert(
  /INSERT INTO purchase_invoice_items[\s\S]*?previous_product_cost,[\s\S]*?product_was_created[\s\S]*?RETURNING id/.test(service),
  "El lote no guarda costo previo y origen del producto."
);
assert(
  /INSERT INTO stock_movimientos[\s\S]*?purchase_invoice_id,[\s\S]*?purchase_invoice_item_id[\s\S]*?RETURNING id/.test(service),
  "El ingreso de stock no queda vinculado a factura e ítem."
);
assert(
  /UPDATE purchase_invoice_items[\s\S]*?SET stock_movement_id = \$1/.test(service),
  "El ítem no queda vinculado al movimiento de stock."
);
assert(
  /INSERT INTO movimientos_financieros[\s\S]*?purchase_invoice_id[\s\S]*?RETURNING id/.test(service),
  "El movimiento financiero no queda vinculado a la factura."
);

const sourceFile = ts.createSourceFile(
  servicePath,
  service,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS
);

let parameterizedQueries = 0;
const getSqlText = (node: ts.Expression) => {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
};
const visit = (node: ts.Node) => {
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "query" &&
    node.arguments.length >= 2
  ) {
    const sql = getSqlText(node.arguments[0]);
    const params = node.arguments[1];
    if (sql && ts.isArrayLiteralExpression(params)) {
      const placeholders = [...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
      const max = placeholders.length ? Math.max(...placeholders) : 0;
      if (max > 0) {
        parameterizedQueries += 1;
        assert(
          params.elements.length === max,
          `Parámetros SQL incorrectos en facturas de compra: ${params.elements.length}/${max}.`
        );
      }
    }
  }
  ts.forEachChild(node, visit);
};
visit(sourceFile);
assert(parameterizedQueries >= 15, "No se auditaron suficientes consultas parametrizadas de compras.");

const dbSource = read("server/db.ts");
for (const required of [
  "purchase_invoice_payment_allocations",
  "purchase_invoice_cancellations",
  "previous_product_cost",
  "purchase_invoice_id",
  "purchase_invoice_item_id",
]) {
  assert(dbSource.includes(required), `SQLite no contiene la estructura de trazabilidad: ${required}`);
}

const typesSource = read("src/types.ts");
assert(typesSource.includes("reversion_version?: number"), "El tipo PurchaseInvoice no expone la versión.");
assert(typesSource.includes("previous_product_cost?: number | null"), "El tipo de ítem no expone el costo previo.");

console.log(
  `Trazabilidad de compras correcta: migración, transacciones, ${parameterizedQueries} consultas, stock, costo previo y pagos auditados.`
);
