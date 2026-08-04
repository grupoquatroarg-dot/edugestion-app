import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};

const migration = read("supabase/45_customer_portal_session_security.sql");
const api = read("api/clientes.ts");
const contentService = read("server/services/customerContentLifecycleService.ts");
const lifecycleService = read("server/services/customerLifecycleService.ts");
const database = read("server/db.ts");
const portalUi = read("src/components/CustomerPortal.tsx");
const auditGuide = read("docs/AUDITORIA_FUNCIONAL_ADMIN.md");
const packageJson = JSON.parse(read("package.json"));

for (const token of [
  "ADD COLUMN IF NOT EXISTS portal_session_version",
  "ALTER COLUMN portal_session_version SET DEFAULT 1",
  "ALTER COLUMN portal_session_version SET NOT NULL",
  "clientes_portal_session_version_check",
  "CHECK (portal_session_version > 0)",
]) {
  assert(migration.includes(token), `La migración 45 no contiene ${token}.`);
}

assert(
  database.includes("portal_session_version INTEGER NOT NULL DEFAULT 1 CHECK(portal_session_version > 0)"),
  "El esquema SQLite nuevo no inicializa la versión de sesión del portal."
);
assert(
  database.includes("ALTER TABLE clientes ADD COLUMN portal_session_version INTEGER NOT NULL DEFAULT 1"),
  "La compatibilidad SQLite no actualiza bases existentes."
);

for (const token of [
  "SELECT id, portal_session_version",
  "decoded.sessionVersion",
  "tokenSessionVersion !== currentSessionVersion",
  "La sesión del portal fue revocada",
  "sessionVersion: getPortalSessionVersion(cliente.portal_session_version) || 1",
]) {
  assert(api.includes(token), `La API del portal no contiene ${token}.`);
}

for (const token of [
  "portalCredentialsChanged",
  "nextPortalSessionVersion",
  "portal_session_version = ?",
  "portal_session_version = $19",
  "portal_session_version: toPortalSessionVersion",
]) {
  assert(contentService.includes(token), `La edición auditada de clientes no contiene ${token}.`);
}

assert(
  (lifecycleService.match(/portal_session_version = COALESCE\(portal_session_version, 1\) \+ 1/g) || []).length === 2,
  "La baja de clientes debe revocar sesiones tanto en SQLite como en PostgreSQL."
);
assert(
  portalUi.includes("localStorage.removeItem('customer_portal_token')") && portalUi.includes("setToken('')"),
  "El portal no limpia el token cuando el servidor rechaza la sesión."
);
assert(
  auditGuide.includes("Revocación de sesiones del Portal de Clientes"),
  "La guía funcional no incluye la revocación de sesiones del portal."
);
assert(
  packageJson.scripts?.["check:customer-portal-session-security"]
    === "tsx scripts/check-customer-portal-session-security.ts",
  "package.json no expone la auditoría de sesiones del portal."
);
assert(
  String(packageJson.scripts?.["validate:audit"] || "").includes("check:customer-portal-session-security"),
  "La regresión general no ejecuta la auditoría de sesiones del portal."
);

type Customer = {
  enabled: boolean;
  username: string | null;
  passwordMarker: string;
  sessionVersion: number;
};

const canUseToken = (customer: Customer, tokenVersion: number) =>
  customer.enabled && tokenVersion === customer.sessionVersion;

const updateCustomer = (
  customer: Customer,
  change: Partial<Pick<Customer, "enabled" | "username" | "passwordMarker">>
) => {
  const next = { ...customer, ...change };
  const credentialsChanged =
    next.enabled !== customer.enabled
    || next.username !== customer.username
    || next.passwordMarker !== customer.passwordMarker;

  if (credentialsChanged) next.sessionVersion += 1;
  return next;
};

let customer: Customer = {
  enabled: true,
  username: "cliente-prueba",
  passwordMarker: "hash-1",
  sessionVersion: 3,
};
const originalToken = customer.sessionVersion;
assert(canUseToken(customer, originalToken), "El token recién emitido debería ser válido.");

customer = updateCustomer(customer, {});
assert(
  canUseToken(customer, originalToken),
  "Una edición sin cambios de acceso no debería cerrar la sesión del portal."
);

customer = updateCustomer(customer, { passwordMarker: "hash-2" });
assert(
  !canUseToken(customer, originalToken),
  "El token anterior siguió activo después de cambiar la contraseña."
);
const replacementToken = customer.sessionVersion;
assert(canUseToken(customer, replacementToken), "El token nuevo debería usar la versión vigente.");

customer = updateCustomer(customer, { username: "cliente-nuevo" });
assert(
  !canUseToken(customer, replacementToken),
  "El token anterior siguió activo después de cambiar el usuario."
);

const beforeDisableToken = customer.sessionVersion;
customer = updateCustomer(customer, { enabled: false });
assert(
  !canUseToken(customer, beforeDisableToken),
  "Deshabilitar el portal no revocó la sesión existente."
);

console.log("Seguridad del portal correcta: emisión versionada y revocación por contraseña, usuario o baja verificadas.");
