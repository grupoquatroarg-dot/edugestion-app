import fs from "node:fs";
import path from "node:path";
import { hashAuthToken } from "../server/utils/tokenHash.js";

const root = process.cwd();
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};

const migration = read("supabase/46_staff_token_revocation.sql");
const database = read("server/db.ts");
const service = read("server/services/staffTokenRevocationService.ts");
const currentAuth = read("server/services/currentUserAuthService.ts");
const vercelLogout = read("api/auth/logout.ts");
const expressAuth = read("server/routes/authRoutes.ts");
const frontendAuth = read("src/contexts/AuthContext.tsx");
const backupService = read("server/services/backupRestoreIntegrityService.ts");
const auditGuide = read("docs/AUDITORIA_FUNCIONAL_ADMIN.md");
const packageJson = JSON.parse(read("package.json"));

for (const token of [
  "auth_revoked_staff_tokens",
  "token_hash",
  "user_id",
  "revoked_at",
  "expires_at",
  "auth_revoked_staff_tokens_hash_check",
  "auth_revoked_staff_tokens_expiry_check",
  "idx_auth_revoked_staff_tokens_user",
  "idx_auth_revoked_staff_tokens_cleanup",
]) {
  assert(migration.includes(token), `La migración 46 no contiene ${token}.`);
  assert(database.includes(token), `SQLite no contiene ${token}.`);
}

assert(!migration.includes("raw_token"), "La migración no debe guardar el JWT en texto plano.");
assert(service.includes('DELETE FROM auth_revoked_staff_tokens WHERE expires_at <= now()'), "PostgreSQL no limpia revocaciones vencidas.");
assert(service.includes("datetime(expires_at) <= CURRENT_TIMESTAMP"), "SQLite no limpia revocaciones vencidas.");
assert(service.includes("ON CONFLICT (token_hash) DO UPDATE"), "La revocación PostgreSQL no es idempotente.");
assert(service.includes("ON CONFLICT(token_hash) DO UPDATE"), "La revocación SQLite no es idempotente.");
assert(service.includes("validateStaffToken(token)"), "Logout no valida el token antes de revocarlo.");

assert(currentAuth.includes("hashAuthToken(token)"), "La autenticación no calcula el hash del token.");
assert(currentAuth.includes("NOT EXISTS"), "La autenticación no excluye tokens revocados.");
assert(currentAuth.includes("revoked.token_hash = $2"), "PostgreSQL no compara la revocación actual.");
assert(currentAuth.includes("revoked.token_hash = ?"), "SQLite no compara la revocación actual.");

for (const [label, source] of [["Vercel", vercelLogout], ["Express", expressAuth]] as const) {
  assert(
    source.includes("staffTokenRevocationService.revokeBearerTokenIfValid"),
    `${label} no revoca el token actual al cerrar sesión.`
  );
  assert(source.includes("token revocado"), `${label} no confirma la revocación.`);
}

assert(frontendAuth.includes("finally"), "El frontend no limpia la sesión local si falla la red.");
assert(frontendAuth.includes("localStorage.removeItem('auth_token')"), "El frontend no elimina el token local.");
assert(backupService.includes('"auth_revoked_staff_tokens"'), "La tabla de revocaciones no está excluida del backup.");
assert(backupService.includes("PRE_STAFF_TOKEN_REVOCATION_SECURITY_TABLES_V2"), "Los backups anteriores dejaron de ser compatibles.");
assert(auditGuide.includes("Cierre seguro de sesión administrativa"), "La guía funcional no prueba el logout seguro.");
assert(
  packageJson.scripts?.["check:staff-token-revocation"] === "tsx scripts/check-staff-token-revocation.ts",
  "package.json no expone la auditoría de revocación."
);
assert(
  String(packageJson.scripts?.["validate:audit"] || "").includes("check:staff-token-revocation"),
  "La regresión general no ejecuta la auditoría de revocación."
);

const tokenA = "jwt-sesion-a-firmado-con-alta-entropia";
const tokenB = "jwt-sesion-b-firmado-con-alta-entropia";
const hashA = hashAuthToken(tokenA);
const hashB = hashAuthToken(tokenB);

assert(/^[a-f0-9]{64}$/.test(hashA), "El hash del token no es SHA-256 hexadecimal.");
assert(hashA !== hashB, "Dos sesiones diferentes generaron el mismo hash.");
assert(!hashA.includes(tokenA), "El registro expone el token original.");

const revoked = new Map<string, number>();
const now = Date.now();
const isAllowed = (token: string) => {
  const expiresAt = revoked.get(hashAuthToken(token));
  return expiresAt === undefined || expiresAt <= now;
};

assert(isAllowed(tokenA) && isAllowed(tokenB), "Las sesiones nuevas deberían comenzar activas.");
revoked.set(hashA, now + 60_000);
assert(!isAllowed(tokenA), "La sesión cerrada siguió activa.");
assert(isAllowed(tokenB), "Cerrar una sesión revocó otra computadora.");
revoked.set(hashB, now - 1);
assert(isAllowed(tokenB), "Una revocación vencida siguió bloqueando el token.");

console.log("Logout seguro correcto: token actual revocado, otras sesiones preservadas y expiración verificada.");
