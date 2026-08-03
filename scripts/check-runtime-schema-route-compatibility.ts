import fs from "node:fs";
import path from "node:path";
import { resolveConsolidatedApiTarget } from "../server/middleware/consolidatedApiCompatibility.js";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};

const migration = read("supabase/44_runtime_schema_compatibility.sql");
const database = read("server/db.ts");
const supplierRepository = read("server/repositories/supplierOrderRepository.ts");
const supplierRoutes = read("server/routes/supplierOrderRoutes.ts");
const middleware = read("server/middleware/consolidatedApiCompatibility.ts");
const server = read("server.ts");
const salesRepository = read("server/repositories/salesRepository.ts");
const productLifecycle = read("server/services/productLifecycleService.ts");
const customerLifecycle = read("server/services/customerLifecycleService.ts");

for (const table of ["product_status_history", "customer_status_history"]) {
  assert(migration.includes(`CREATE TABLE IF NOT EXISTS public.${table}`), `La migración 44 no crea ${table}.`);
  assert(database.includes(`CREATE TABLE IF NOT EXISTS ${table}`), `SQLite no crea ${table}.`);
}

for (const column of [
  "costo_total_peps",
  "precio_unitario_original",
  "bonificacion_tipo",
  "bonificacion_valor",
  "precio_unitario_bonificado",
]) {
  assert(migration.includes(`ADD COLUMN IF NOT EXISTS ${column}`), `La migración 44 no repara sale_items.${column}.`);
  assert(database.includes(`ALTER TABLE sale_items ADD COLUMN ${column}`), `SQLite no migra sale_items.${column}.`);
  assert(salesRepository.includes(column), `El repositorio de ventas no utiliza ${column}.`);
}

assert(migration.includes("sale_items_bonificacion_tipo_check"), "Falta validar tipos de bonificación.");
assert(migration.includes("ALTER COLUMN cliente SET DEFAULT 'Pedido a proveedor'"), "Falta el valor por defecto de proveedor.");
assert(migration.includes("ALTER COLUMN cliente SET NOT NULL"), "El campo cliente no queda normalizado después del backfill.");
assert(database.includes("cliente TEXT NOT NULL DEFAULT 'Pedido a proveedor'"), "SQLite conserva supplier_orders.cliente sin valor por defecto.");
assert(supplierRepository.includes("|| 'Pedido a proveedor'"), "El repositorio local puede insertar cliente vacío.");
assert(supplierRoutes.includes("cliente: z.string().trim().min(1).max(250).optional().nullable()"), "La API local no acepta pedidos generales.");
assert(!/proveedor_id:\s*z\.number\(\),/.test(supplierRoutes), "La ruta local todavía exige proveedor_id sin utilizarlo.");

assert(productLifecycle.includes("INSERT INTO product_status_history"), "El ciclo de productos no audita estado.");
assert(customerLifecycle.includes("INSERT INTO customer_status_history"), "El ciclo de clientes no audita estado.");

const cases: Array<{
  pathname: string;
  query?: Record<string, unknown>;
  expected: string | null;
  endpoint?: string;
  id?: string;
}> = [
  { pathname: "/api/clientes", query: { endpoint: "routes" }, expected: "clientes" },
  { pathname: "/api/clientes", query: { endpoint: "checklists" }, expected: "clientes" },
  { pathname: "/api/clientes", query: { endpoint: "users" }, expected: "clientes" },
  { pathname: "/api/clientes", query: { endpoint: "portal-login" }, expected: "clientes" },
  { pathname: "/api/clientes", query: { id: "4", action: "deactivate" }, expected: "clientes" },
  { pathname: "/api/products", query: { endpoint: "bulk-price-history" }, expected: "products" },
  { pathname: "/api/products/7", query: { action: "stock" }, expected: "product-id", id: "7" },
  { pathname: "/api/products/7", query: { action: "inventory-revert" }, expected: "product-id", id: "7" },
  { pathname: "/api/sales", query: { endpoint: "supplier-orders" }, expected: "sales" },
  { pathname: "/api/sales", query: { endpoint: "customer-orders" }, expected: "sales" },
  { pathname: "/api/sales", query: { endpoint: "peti-customer-report" }, expected: "sales" },
  { pathname: "/api/sales", query: { id: "9" }, expected: "sales" },
  { pathname: "/api/finanzas", query: { endpoint: "cheques" }, expected: "finanzas" },
  { pathname: "/api/dashboard/reports", expected: "dashboard", endpoint: "reports" },
  { pathname: "/api/dashboard/current-accounts", expected: "dashboard", endpoint: "current-accounts" },
  { pathname: "/api/purchase-invoices", query: { endpoint: "available-cheques" }, expected: "purchase-invoices" },
  { pathname: "/api/purchase-invoices", query: { id: "3" }, expected: "purchase-invoices" },
  { pathname: "/api/config/backup-data", expected: "config", endpoint: "backup-data" },
  { pathname: "/api/config/restore-app-data", expected: "config", endpoint: "restore-app-data" },
  { pathname: "/api/clientes", query: { active_only: "true" }, expected: null },
  { pathname: "/api/products", query: { active_only: "true" }, expected: null },
];

for (const testCase of cases) {
  const result = resolveConsolidatedApiTarget(testCase.pathname, testCase.query || {});
  assert(result?.key === testCase.expected || (!result && testCase.expected === null),
    `Resolución incorrecta para ${testCase.pathname}: ${result?.key || "null"}.`);
  if (testCase.endpoint) assert(result?.endpoint === testCase.endpoint, `Endpoint incorrecto para ${testCase.pathname}.`);
  if (testCase.id) assert(result?.id === testCase.id, `ID incorrecto para ${testCase.pathname}.`);
}

assert(server.indexOf("app.use(consolidatedApiCompatibility)") < server.indexOf('app.use("/api/auth", authRoutes)'),
  "El adaptador debe montarse antes de los routers locales.");
assert(server.includes('"PATCH"'), "CORS local no habilita PATCH.");
assert(middleware.includes("isPostgresConfigured"), "El adaptador no protege el modo SQLite.");
assert(middleware.includes("clientesHandler") && middleware.includes("dashboardHandler"), "Faltan handlers consolidados.");

console.log(
  "Compatibilidad reparada: historiales de producto/cliente, sale_items, pedidos generales y rutas consolidadas local/Vercel verificados."
);
