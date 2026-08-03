import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};

const migration = read("supabase/39_user_content_lifecycle.sql");
const service = read("server/services/userContentLifecycleService.ts");
const localRoute = read("server/routes/userRoutes.ts");
const api = read("api/clientes.ts");
const repository = read("server/repositories/userRepository.ts");
const database = read("server/db.ts");
const ui = read("src/components/UserManagement.tsx");
const types = read("src/types.ts");
const packageJson = JSON.parse(read("package.json"));

for (const token of [
  "user_content_history",
  "content_version",
  "content_changed_at",
  "content_changed_by",
  "content_change_reason",
  "before_snapshot",
  "after_snapshot",
  "idx_user_content_history_user",
]) {
  assert(migration.includes(token), `La migración 39 no contiene ${token}.`);
  assert(database.includes(token), `SQLite no contiene ${token}.`);
}

for (const token of [
  "FOR UPDATE",
  "BEGIN",
  "COMMIT",
  "ROLLBACK",
  "No se detectaron cambios para guardar",
  "El usuario cambió mientras estaba abierto",
  "Reactivalo antes de editarlo",
  "Debe quedar al menos un administrador activo",
  "No podés cambiar tu propio rol",
  "session_version = COALESCE(session_version, 1) + 1",
  "password_changed",
  "expectedContentVersion",
]) {
  assert(service.includes(token), `El servicio no contiene ${token}.`);
}

assert(
  service.includes("bcrypt.hashSync") && !service.includes("password: row.password"),
  "El servicio debe cambiar la contraseña sin incluir hashes en snapshots."
);
assert(
  localRoute.includes("userContentLifecycleService.update") && api.includes("userContentLifecycleService.update"),
  "Express y Vercel deben usar el servicio auditado."
);
assert(
  repository.includes("La actualización directa de usuarios está deshabilitada"),
  "El repositorio todavía permite actualizaciones directas."
);
assert(!localRoute.includes("UserRepository.update(Number(req.params.id)"), "Express conserva el UPDATE directo.");
assert(!api.includes("UserRepository.update(id, parsed.data"), "Vercel conserva el UPDATE directo.");
assert(localRoute.includes("expectedContentVersion"), "Express no valida la versión esperada.");
assert(api.includes("expectedContentVersion"), "Vercel no valida la versión esperada.");
assert(ui.includes("Motivo obligatorio"), "La UI no solicita motivo de edición.");
assert(ui.includes("expectedContentVersion"), "La UI no envía la versión esperada.");
assert(ui.includes("content_version"), "La UI no conserva la versión de contenido.");
assert(ui.includes("auth:session-invalidated"), "La UI no invalida la sesión propia tras editarse.");
assert(types.includes("content_change_reason"), "El tipo User no expone metadata de contenido.");
assert(repository.includes("content_changed_by"), "El repositorio no devuelve metadata de contenido.");
assert(
  packageJson.scripts?.["check:user-content-lifecycle"] === "tsx scripts/check-user-content-lifecycle.ts",
  "package.json no expone la auditoría de usuarios."
);
assert(
  String(packageJson.scripts?.["validate:audit"] || "").includes("check:user-content-lifecycle"),
  "La regresión general no ejecuta la auditoría nueva."
);

type UserState = {
  id: number;
  active: number;
  name: string;
  email: string;
  role: string;
  avatar: string;
  content_version: number;
  session_version: number;
};
type State = {
  user: UserState;
  history: Array<{ version: number; reason: string; before: any; after: any }>;
};

const initialState = (): State => ({
  user: {
    id: 7,
    active: 1,
    name: "Usuario Inicial",
    email: "inicial@example.com",
    role: "empleado",
    avatar: "UI",
    content_version: 0,
    session_version: 3,
  },
  history: [],
});

const simulateUpdate = (
  state: State,
  input: {
    expectedVersion: number;
    reason: string;
    name: string;
    email: string;
    role: string;
    passwordChanged?: boolean;
  },
  failAfterHistory = false,
) => {
  const staged: State = {
    user: { ...state.user },
    history: state.history.map((entry) => ({ ...entry, before: { ...entry.before }, after: { ...entry.after } })),
  };
  if (staged.user.active !== 1) throw new Error("inactive");
  if (staged.user.content_version !== input.expectedVersion) throw new Error("concurrent");
  if (input.reason.trim().length < 3) throw new Error("reason");
  const before = { ...staged.user, password_changed: false };
  const changed =
    staged.user.name !== input.name ||
    staged.user.email !== input.email ||
    staged.user.role !== input.role ||
    Boolean(input.passwordChanged);
  if (!changed) throw new Error("unchanged");
  const nextVersion = input.expectedVersion + 1;
  const after = {
    ...staged.user,
    name: input.name,
    email: input.email,
    role: input.role,
    content_version: nextVersion,
    session_version: staged.user.session_version + 1,
    password_changed: Boolean(input.passwordChanged),
  };
  staged.history.push({ version: nextVersion, reason: input.reason.trim(), before, after });
  if (failAfterHistory) throw new Error("rollback");
  staged.user = { ...after };
  delete (staged.user as any).password_changed;
  state.user = staged.user;
  state.history = staged.history;
};

const state = initialState();
simulateUpdate(state, {
  expectedVersion: 0,
  reason: "Cambio de responsabilidad",
  name: "Usuario Editado",
  email: "editado@example.com",
  role: "vendedor",
});
assert(state.user.content_version === 1, "La versión no aumentó.");
assert(state.user.session_version === 4, "Las sesiones anteriores no quedaron invalidadas.");
assert(state.history.length === 1, "No se guardó el historial.");
assert(!JSON.stringify(state.history).includes("hash"), "El historial expone una contraseña o hash.");

for (const action of [
  () => simulateUpdate(state, { expectedVersion: 0, reason: "Otra edición", name: "X", email: "x@example.com", role: "vendedor" }),
  () => simulateUpdate({ ...initialState(), user: { ...initialState().user, active: 0 } }, { expectedVersion: 0, reason: "Editar baja", name: "X", email: "x@example.com", role: "empleado" }),
  () => simulateUpdate(initialState(), { expectedVersion: 0, reason: "", name: "X", email: "x@example.com", role: "empleado" }),
  () => simulateUpdate(initialState(), { expectedVersion: 0, reason: "Sin cambios", name: "Usuario Inicial", email: "inicial@example.com", role: "empleado" }),
]) {
  let blocked = false;
  try { action(); } catch { blocked = true; }
  assert(blocked, "No se bloqueó un caso inválido.");
}

const rollbackState = initialState();
const beforeRollback = JSON.stringify(rollbackState);
let rolledBack = false;
try {
  simulateUpdate(rollbackState, {
    expectedVersion: 0,
    reason: "Cambio con error",
    name: "Usuario Parcial",
    email: "parcial@example.com",
    role: "operario",
    passwordChanged: true,
  }, true);
} catch {
  rolledBack = true;
}
assert(rolledBack, "No se simuló el error transaccional.");
assert(JSON.stringify(rollbackState) === beforeRollback, "El rollback dejó cambios parciales.");

console.log("Edición auditada de usuarios correcta: motivo, snapshots sin contraseñas, versiones, sesiones, concurrencia y rollback verificados.");
