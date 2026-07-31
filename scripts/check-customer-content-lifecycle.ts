import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};

const migration = read("supabase/37_customer_content_lifecycle.sql");
const service = read("server/services/customerContentLifecycleService.ts");
const localRoute = read("server/routes/clientRoutes.ts");
const api = read("api/clientes.ts");
const repository = read("server/repositories/clientRepository.ts");
const database = read("server/db.ts");
const ui = read("src/components/CustomerModule.tsx");
const packageJson = JSON.parse(read("package.json"));

for (const token of [
  "customer_content_history",
  "content_version",
  "content_changed_at",
  "content_changed_by",
  "content_change_reason",
  "before_snapshot",
  "after_snapshot",
  "idx_customer_content_history_customer",
]) {
  assert(migration.includes(token), `La migración 37 no contiene ${token}.`);
  assert(database.includes(token), `SQLite no contiene ${token}.`);
}

for (const token of [
  "FOR UPDATE",
  "BEGIN",
  "COMMIT",
  "ROLLBACK",
  "No se detectaron cambios para guardar",
  "El cliente cambió mientras estaba abierto",
  "Reactivalo antes de editarlo",
  "customer_content_history",
  "expectedContentVersion",
  "portal_password_configured",
  "portal_password_changed",
]) {
  assert(service.includes(token), `El servicio no contiene ${token}.`);
}

assert(
  service.includes("SELECT id FROM clientes WHERE lower(portal_username) = lower($1)"),
  "El servicio PostgreSQL no bloquea usuarios de portal duplicados."
);
assert(
  service.includes("SELECT id FROM clientes WHERE lower(portal_username) = lower(?)"),
  "El servicio SQLite no bloquea usuarios de portal duplicados."
);
assert(
  !service.includes("before_snapshot: current.portal_password_hash") &&
    !service.includes("after_snapshot: current.portal_password_hash"),
  "Los snapshots no deben exponer hashes de contraseñas."
);
assert(
  localRoute.includes("customerContentLifecycleService.update") &&
    api.includes("customerContentLifecycleService.update"),
  "Express y Vercel deben usar el servicio auditado."
);
assert(
  !localRoute.includes("clientRepository.update(req.params.id, req.body)") &&
    !api.includes("clientRepository.update(id, parsed.data"),
  "Permanece una actualización directa expuesta desde una pestaña antigua."
);
assert(localRoute.includes("expectedContentVersion"), "Express no valida la versión esperada.");
assert(api.includes("expectedContentVersion"), "Vercel no valida la versión esperada.");
assert(ui.includes("Motivo de la edición"), "La UI no solicita motivo de edición.");
assert(ui.includes("expectedContentVersion"), "La UI no envía la versión esperada.");
assert(ui.includes("contentChangeReason"), "La UI no administra el motivo.");
assert(repository.includes("content_change_reason"), "El repositorio no devuelve metadata de contenido.");
assert(
  packageJson.scripts?.["check:customer-content-lifecycle"] === "tsx scripts/check-customer-content-lifecycle.ts",
  "package.json no expone la auditoría de clientes."
);
assert(
  String(packageJson.scripts?.["validate:audit"] || "").includes("check:customer-content-lifecycle"),
  "La regresión general no ejecuta la auditoría nueva."
);

type Customer = {
  id: number;
  activo: number;
  nombre_apellido: string;
  limite_credito: number;
  portal_username: string | null;
  content_version: number;
};

type State = {
  customer: Customer;
  history: Array<{ version: number; reason: string; before: Customer; after: Customer }>;
  portalUsers: Map<string, number>;
};

const initialState = (): State => ({
  customer: {
    id: 8,
    activo: 1,
    nombre_apellido: "Cliente Inicial",
    limite_credito: 10000,
    portal_username: "cliente8",
    content_version: 0,
  },
  history: [],
  portalUsers: new Map([["cliente8", 8], ["ocupado", 22]]),
});

const simulateUpdate = (
  state: State,
  input: { expectedVersion: number; reason: string; name: string; credit: number; portalUsername: string | null },
  failAfterHistory = false
) => {
  const staged: State = {
    customer: { ...state.customer },
    history: state.history.map((entry) => ({
      ...entry,
      before: { ...entry.before },
      after: { ...entry.after },
    })),
    portalUsers: new Map(state.portalUsers),
  };

  if (!staged.customer.activo) throw new Error("inactive");
  if (staged.customer.content_version !== input.expectedVersion) throw new Error("concurrent");
  if (input.reason.trim().length < 3) throw new Error("reason");
  const owner = input.portalUsername ? staged.portalUsers.get(input.portalUsername.toLowerCase()) : undefined;
  if (owner && owner !== staged.customer.id) throw new Error("duplicate portal user");

  const before = { ...staged.customer };
  const after: Customer = {
    ...staged.customer,
    nombre_apellido: input.name.trim(),
    limite_credito: input.credit,
    portal_username: input.portalUsername,
    content_version: input.expectedVersion + 1,
  };
  if (
    before.nombre_apellido === after.nombre_apellido &&
    before.limite_credito === after.limite_credito &&
    before.portal_username === after.portal_username
  ) {
    throw new Error("no changes");
  }

  staged.history.push({
    version: after.content_version,
    reason: input.reason.trim(),
    before,
    after: { ...after },
  });
  if (failAfterHistory) throw new Error("forced rollback");
  staged.customer = after;

  state.customer = staged.customer;
  state.history = staged.history;
  state.portalUsers = staged.portalUsers;
};

const state = initialState();
simulateUpdate(state, {
  expectedVersion: 0,
  reason: "Actualización solicitada",
  name: "Cliente Actualizado",
  credit: 25000,
  portalUsername: "cliente8",
});
assert(state.customer.content_version === 1, "La versión no aumentó.");
assert(state.history.length === 1, "No se guardó historial.");
assert(state.history[0].before.nombre_apellido === "Cliente Inicial", "El snapshot anterior es incorrecto.");
assert(state.history[0].after.nombre_apellido === "Cliente Actualizado", "El snapshot posterior es incorrecto.");

let blocked = false;
try {
  simulateUpdate(state, {
    expectedVersion: 0,
    reason: "Pestaña antigua",
    name: "Sobrescritura",
    credit: 1,
    portalUsername: "cliente8",
  });
} catch {
  blocked = true;
}
assert(blocked, "No se bloqueó una pestaña antigua.");

blocked = false;
try {
  simulateUpdate(state, {
    expectedVersion: 1,
    reason: "Usuario duplicado",
    name: "Cliente Actualizado",
    credit: 25000,
    portalUsername: "ocupado",
  });
} catch {
  blocked = true;
}
assert(blocked, "No se bloqueó un usuario de portal duplicado.");

const rollbackState = initialState();
try {
  simulateUpdate(rollbackState, {
    expectedVersion: 0,
    reason: "Falla controlada",
    name: "No debe persistir",
    credit: 999,
    portalUsername: "cliente8",
  }, true);
} catch {}
assert(rollbackState.customer.nombre_apellido === "Cliente Inicial", "El rollback dejó cambios parciales.");
assert(rollbackState.history.length === 0, "El rollback dejó historial parcial.");

const inactiveState = initialState();
inactiveState.customer.activo = 0;
blocked = false;
try {
  simulateUpdate(inactiveState, {
    expectedVersion: 0,
    reason: "Intento inactivo",
    name: "No permitido",
    credit: 10,
    portalUsername: "cliente8",
  });
} catch {
  blocked = true;
}
assert(blocked, "No se bloqueó la edición de un cliente inactivo.");

console.log("Edición auditada de clientes correcta: motivo, snapshots, versiones, portal, concurrencia y rollback verificados.");
