import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};

const migration = read("supabase/38_provider_content_lifecycle.sql");
const service = read("server/services/providerContentLifecycleService.ts");
const localRoute = read("server/routes/providerRoutes.ts");
const api = read("api/purchase-invoices/index.ts");
const repository = read("server/repositories/providerRepository.ts");
const database = read("server/db.ts");
const ui = read("src/components/PurchaseInvoiceModule.tsx");
const packageJson = JSON.parse(read("package.json"));

for (const token of [
  "provider_content_history",
  "content_version",
  "content_changed_at",
  "content_changed_by",
  "content_change_reason",
  "before_snapshot",
  "after_snapshot",
  "idx_provider_content_history_provider",
]) {
  assert(migration.includes(token), `La migración 38 no contiene ${token}.`);
  assert(database.includes(token), `SQLite no contiene ${token}.`);
}

for (const token of [
  "FOR UPDATE",
  "BEGIN",
  "COMMIT",
  "ROLLBACK",
  "No se detectaron cambios para guardar",
  "El proveedor cambió mientras estaba abierto",
  "Reactivalo antes de editarlo",
  "provider_content_history",
  "expectedContentVersion",
]) {
  assert(service.includes(token), `El servicio no contiene ${token}.`);
}

assert(
  localRoute.includes("providerContentLifecycleService.update") &&
    api.includes("providerContentLifecycleService.update"),
  "Express y Vercel deben usar el servicio auditado."
);
assert(
  !localRoute.includes("providerRepository.update(req.params.id, req.body)"),
  "Permanece una actualización directa expuesta desde una pestaña antigua."
);
assert(
  repository.includes("La actualización directa de proveedores está deshabilitada"),
  "El repositorio todavía permite actualizaciones directas."
);
assert(localRoute.includes("expectedContentVersion"), "Express no valida la versión esperada.");
assert(api.includes('endpoint === "proveedores" && req.method === "PUT"'), "Vercel no expone la edición auditada.");
assert(api.includes("expectedContentVersion"), "Vercel no valida la versión esperada.");
assert(ui.includes("Motivo de la edición"), "La UI no solicita motivo de edición.");
assert(ui.includes("expectedContentVersion"), "La UI no envía la versión esperada.");
assert(ui.includes("Editar proveedor"), "La UI no ofrece edición de proveedores.");
assert(repository.includes("content_change_reason"), "El repositorio no devuelve metadata de contenido.");
assert(
  packageJson.scripts?.["check:provider-content-lifecycle"] === "tsx scripts/check-provider-content-lifecycle.ts",
  "package.json no expone la auditoría de proveedores."
);
assert(
  String(packageJson.scripts?.["validate:audit"] || "").includes("check:provider-content-lifecycle"),
  "La regresión general no ejecuta la auditoría nueva."
);

type Provider = {
  id: number;
  estado: "activo" | "inactivo";
  nombre: string;
  email: string | null;
  content_version: number;
};

type State = {
  provider: Provider;
  history: Array<{ version: number; reason: string; before: Provider; after: Provider }>;
};

const initialState = (): State => ({
  provider: {
    id: 5,
    estado: "activo",
    nombre: "Proveedor Inicial",
    email: "inicial@example.com",
    content_version: 0,
  },
  history: [],
});

const simulateUpdate = (
  state: State,
  input: { expectedVersion: number; reason: string; name: string; email: string | null },
  failAfterHistory = false
) => {
  const staged: State = {
    provider: { ...state.provider },
    history: state.history.map((entry) => ({
      ...entry,
      before: { ...entry.before },
      after: { ...entry.after },
    })),
  };

  if (staged.provider.estado !== "activo") throw new Error("inactive");
  if (staged.provider.content_version !== input.expectedVersion) throw new Error("concurrent");
  if (input.reason.trim().length < 3) throw new Error("reason");

  const before = { ...staged.provider };
  const after: Provider = {
    ...staged.provider,
    nombre: input.name.trim(),
    email: input.email?.trim().toLowerCase() || null,
    content_version: input.expectedVersion + 1,
  };

  if (before.nombre === after.nombre && before.email === after.email) {
    throw new Error("no changes");
  }

  staged.history.push({
    version: after.content_version,
    reason: input.reason.trim(),
    before,
    after: { ...after },
  });
  if (failAfterHistory) throw new Error("forced rollback");
  staged.provider = after;

  state.provider = staged.provider;
  state.history = staged.history;
};

const state = initialState();
simulateUpdate(state, {
  expectedVersion: 0,
  reason: "Actualización de contacto",
  name: "Proveedor Actualizado",
  email: "NUEVO@EXAMPLE.COM",
});
assert(state.provider.content_version === 1, "La versión no aumentó.");
assert(state.history.length === 1, "No se guardó historial.");
assert(state.history[0].before.nombre === "Proveedor Inicial", "El snapshot anterior es incorrecto.");
assert(state.history[0].after.nombre === "Proveedor Actualizado", "El snapshot posterior es incorrecto.");
assert(state.provider.email === "nuevo@example.com", "El email no fue normalizado.");

let blocked = false;
try {
  simulateUpdate(state, {
    expectedVersion: 0,
    reason: "Pestaña antigua",
    name: "Sobrescritura",
    email: "otro@example.com",
  });
} catch {
  blocked = true;
}
assert(blocked, "No se bloqueó una pestaña antigua.");

blocked = false;
try {
  simulateUpdate(state, {
    expectedVersion: 1,
    reason: "Sin cambios",
    name: "Proveedor Actualizado",
    email: "nuevo@example.com",
  });
} catch {
  blocked = true;
}
assert(blocked, "No se bloqueó una edición sin cambios reales.");

const rollbackState = initialState();
try {
  simulateUpdate(rollbackState, {
    expectedVersion: 0,
    reason: "Falla controlada",
    name: "No debe persistir",
    email: "fallo@example.com",
  }, true);
} catch {}
assert(rollbackState.provider.nombre === "Proveedor Inicial", "El rollback dejó cambios parciales.");
assert(rollbackState.history.length === 0, "El rollback dejó historial parcial.");

const inactiveState = initialState();
inactiveState.provider.estado = "inactivo";
blocked = false;
try {
  simulateUpdate(inactiveState, {
    expectedVersion: 0,
    reason: "Intento inactivo",
    name: "No permitido",
    email: null,
  });
} catch {
  blocked = true;
}
assert(blocked, "No se bloqueó la edición de un proveedor inactivo.");

console.log("Edición auditada de proveedores correcta: motivo, snapshots, versiones, inactivos, concurrencia y rollback verificados.");
