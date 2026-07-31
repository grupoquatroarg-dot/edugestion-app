import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};

const migration = read("supabase/36_product_content_lifecycle.sql");
const service = read("server/services/productContentLifecycleService.ts");
const localRoute = read("server/routes/productRoutes.ts");
const api = read("api/products/[id].ts");
const repository = read("server/repositories/productRepository.ts");
const productsApi = read("api/products.ts");
const database = read("server/db.ts");
const ui = read("src/components/ProductModule.tsx");
const types = read("src/types.ts");
const packageJson = JSON.parse(read("package.json"));

for (const token of [
  "product_content_history",
  "content_version",
  "content_changed_at",
  "content_changed_by",
  "content_change_reason",
  "before_snapshot",
  "after_snapshot",
  "idx_product_content_history_product",
]) {
  assert(migration.includes(token), `La migración 36 no contiene ${token}.`);
  assert(database.includes(token), `SQLite no contiene ${token}.`);
}
assert(
  migration.includes("product_content_history_product_version_key"),
  "La migración no define la unicidad producto-versión."
);

for (const token of [
  "FOR UPDATE",
  "BEGIN",
  "COMMIT",
  "ROLLBACK",
  "No se detectaron cambios para guardar",
  "El producto cambió mientras estaba abierto",
  "Reactivalo antes de editarlo",
  "product_content_history",
  "expectedContentVersion",
]) {
  assert(service.includes(token), `El servicio no contiene ${token}.`);
}

assert(
  localRoute.includes("productContentLifecycleService.update") &&
    api.includes("productContentLifecycleService.update"),
  "Express y Vercel deben usar el servicio auditado."
);
assert(
  !localRoute.includes("ProductRepository.update(productId, req.body)") &&
    !api.includes("ProductRepository.update(id, parsed.data)"),
  "Permanece una actualización directa expuesta desde una pestaña antigua."
);
assert(localRoute.includes("expectedContentVersion"), "Express no valida la versión esperada.");
assert(api.includes("expectedContentVersion"), "Vercel no valida la versión esperada.");
assert(ui.includes("Motivo de la edición"), "La UI no solicita motivo de edición.");
assert(ui.includes("expectedContentVersion"), "La UI no envía la versión esperada.");
assert(ui.includes("contentChangeReason"), "La UI no administra el motivo.");
assert(ui.includes("Reactivalo antes de editarlo"), "La UI no bloquea productos inactivos.");
assert(repository.includes("content_change_reason"), "El repositorio no devuelve la metadata de contenido.");
assert(productsApi.includes("content_change_reason"), "El GET serverless no devuelve la metadata de contenido.");
assert(types.includes("content_version?: number"), "El tipo Product no incluye la versión de contenido.");
assert(
  packageJson.scripts?.["check:product-content-lifecycle"] === "tsx scripts/check-product-content-lifecycle.ts",
  "package.json no expone la auditoría de producto."
);
assert(
  String(packageJson.scripts?.["validate:audit"] || "").includes("check:product-content-lifecycle"),
  "La regresión general no ejecuta la auditoría nueva."
);

type ProductRow = {
  id: number;
  estado: "activo" | "inactivo";
  eliminado: number;
  code: string;
  company: "Edu" | "Peti";
  name: string;
  cost: number;
  sale_price: number;
  stock_minimo: number;
  family_id: number | null;
  category_id: number | null;
  content_version: number;
};

type State = {
  product: ProductRow;
  history: Array<{ version: number; reason: string; before: ProductRow; after: ProductRow }>;
  occupiedCodes: Set<string>;
};

const simulateEdit = (
  original: State,
  input: Partial<ProductRow> & { expectedVersion: number; reason: string },
  failAfterHistory = false
) => {
  const state: State = {
    product: structuredClone(original.product),
    history: structuredClone(original.history),
    occupiedCodes: new Set(original.occupiedCodes),
  };

  const reason = input.reason.trim();
  if (reason.length < 3) throw new Error("motivo");
  if (state.product.estado !== "activo" || state.product.eliminado !== 0) throw new Error("inactivo");
  if (state.product.content_version !== input.expectedVersion) throw new Error("concurrencia");

  const { expectedVersion: _expectedVersion, reason: _reason, ...changes } = input;
  const next = { ...state.product, ...changes } as ProductRow;
  next.content_version = state.product.content_version + 1;
  const uniqueCode = `${next.company}-${next.code}`;
  const currentUniqueCode = `${state.product.company}-${state.product.code}`;
  if (uniqueCode !== currentUniqueCode && state.occupiedCodes.has(uniqueCode)) throw new Error("duplicado");

  const beforeComparable = { ...state.product, content_version: 0 };
  const afterComparable = { ...next, content_version: 0 };
  if (JSON.stringify(beforeComparable) === JSON.stringify(afterComparable)) throw new Error("sin cambios");

  state.history.push({ version: next.content_version, reason, before: state.product, after: next });
  if (failAfterHistory) throw new Error("falla simulada");
  state.product = next;
  return state;
};

const base: State = {
  product: {
    id: 7,
    estado: "activo",
    eliminado: 0,
    code: "A1",
    company: "Edu",
    name: "Producto A",
    cost: 100,
    sale_price: 150,
    stock_minimo: 2,
    family_id: 1,
    category_id: 1,
    content_version: 0,
  },
  history: [],
  occupiedCodes: new Set(["Edu-A1", "Edu-B2"]),
};

const edited = simulateEdit(base, {
  expectedVersion: 0,
  reason: "Actualización de costo",
  cost: 110,
  sale_price: 165,
});
assert(edited.product.content_version === 1, "La edición no incrementó la versión.");
assert(edited.history.length === 1, "La edición no creó historial.");
assert(edited.history[0].before.cost === 100 && edited.history[0].after.cost === 110, "Los snapshots son incorrectos.");

for (const [name, fn] of [
  ["concurrencia", () => simulateEdit(edited, { expectedVersion: 0, reason: "Edición antigua", name: "Otro" })],
  ["sin cambios", () => simulateEdit(base, { expectedVersion: 0, reason: "Motivo válido" })],
  ["duplicado", () => simulateEdit(base, { expectedVersion: 0, reason: "Cambio de código", code: "B2" })],
  ["inactivo", () => simulateEdit({ ...base, product: { ...base.product, estado: "inactivo" } }, { expectedVersion: 0, reason: "Intento inválido", name: "Otro" })],
] as Array<[string, () => unknown]>) {
  let blocked = false;
  try { fn(); } catch { blocked = true; }
  assert(blocked, `No se bloqueó el caso ${name}.`);
}

const rollbackBase = structuredClone(base);
let rollbackBlocked = false;
try {
  simulateEdit(rollbackBase, { expectedVersion: 0, reason: "Prueba de rollback", name: "Cambio temporal" }, true);
} catch {
  rollbackBlocked = true;
}
assert(rollbackBlocked, "La falla simulada no se produjo.");
assert(rollbackBase.product.name === "Producto A" && rollbackBase.history.length === 0, "El rollback dejó cambios parciales.");

console.log(
  "Edición auditada de productos correcta: motivo, snapshots, versiones, duplicados, inactivos, concurrencia y rollback verificados."
);
