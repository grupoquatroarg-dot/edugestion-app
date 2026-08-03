import fs from "node:fs";
import path from "node:path";

process.env.SESSION_SECRET = "Audit-Auth-Attempts-2026-X7k9_Qp2-Mv8_Zt4-Secure";

const {
  AUTH_ATTEMPT_LIMITS,
  authAttemptSecurityService,
  getLockoutMessage,
  getRequestClientAddress,
  setRetryAfterHeader,
} = await import("../server/services/authAttemptSecurityService.js");

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};

const migration = read("supabase/43_auth_attempt_security.sql");
const service = read("server/services/authAttemptSecurityService.ts");
const database = read("server/db.ts");
const vercelLogin = read("api/auth/login.ts");
const expressLogin = read("server/routes/authRoutes.ts");
const customerApi = read("api/clientes.ts");
const backupService = read("server/services/backupRestoreIntegrityService.ts");
const packageJson = JSON.parse(read("package.json"));

for (const token of [
  "auth_failed_login_attempts",
  "identifier_hash",
  "address_hash",
  "attempted_at",
  "auth_failed_login_attempts_scope_check",
  "auth_failed_login_attempts_identifier_hash_check",
  "auth_failed_login_attempts_address_hash_check",
  "idx_auth_failed_login_attempts_identifier",
  "idx_auth_failed_login_attempts_address",
  "idx_auth_failed_login_attempts_cleanup",
]) {
  assert(migration.includes(token), `La migración 43 no contiene ${token}.`);
}

assert(!migration.includes("email "), "La migración no debe guardar emails en texto plano.");
assert(!migration.includes("username "), "La migración no debe guardar usuarios en texto plano.");
assert(!migration.includes("ip_address"), "La migración no debe guardar direcciones IP en texto plano.");
assert(service.includes('createHmac("sha256", getSessionSecret())'), "Los identificadores no usan HMAC con SESSION_SECRET.");
assert(service.includes("ACCOUNT_FAILURE_LIMIT = 5"), "El límite de cuenta no es 5.");
assert(service.includes("ADDRESS_FAILURE_LIMIT = 30"), "El límite por dirección no es 30.");
assert(service.includes("LOCK_SECONDS = 15 * 60"), "El bloqueo no dura 15 minutos.");
assert(service.includes("WINDOW_SECONDS = 15 * 60"), "La ventana no es de 15 minutos.");
assert(service.includes("pg_advisory_xact_lock"), "PostgreSQL no serializa intentos concurrentes.");
assert(service.includes('await client.query("BEGIN")'), "El registro de fallos no inicia transacción.");
assert(service.includes('await client.query("ROLLBACK")'), "El registro de fallos no revierte ante errores.");
assert(service.includes("Retry-After"), "No se establece Retry-After.");
assert(service.includes("RETENTION_DAYS = 7"), "No se limita la retención de intentos.");
assert(database.includes("auth_failed_login_attempts"), "SQLite no crea la tabla de intentos.");
assert(
  backupService.includes('"auth_failed_login_attempts"'),
  "La tabla de intentos no figura como exclusión de seguridad del backup."
);
assert(
  packageJson.scripts?.["check:auth-attempt-security"],
  "Falta check:auth-attempt-security en package.json."
);

for (const [label, source] of [
  ["Vercel", vercelLogin],
  ["Express", expressLogin],
  ["Portal", customerApi],
] as const) {
  assert(source.includes("authAttemptSecurityService.check"), `${label} no consulta el bloqueo.`);
  assert(source.includes("authAttemptSecurityService.recordFailure"), `${label} no registra fallos.`);
  assert(source.includes("authAttemptSecurityService.clearFailures"), `${label} no limpia fallos tras éxito.`);
  assert(source.includes("getRequestClientAddress"), `${label} no identifica la dirección de origen.`);
  assert(source.includes("setRetryAfterHeader"), `${label} no devuelve Retry-After.`);
  assert(source.includes("getLockoutMessage"), `${label} no devuelve mensaje de bloqueo.`);
}

assert(!service.includes("admin123"), "La protección de intentos no debe modificar ni depender de admin123.");
assert(!service.includes("UPDATE users"), "La protección no debe modificar usuarios.");
assert(!migration.includes("REFERENCES public.users"), "Los intentos no deben revelar si la cuenta existe.");

assert(AUTH_ATTEMPT_LIMITS.accountFailureLimit === 5, "Límite de cuenta incorrecto.");
assert(AUTH_ATTEMPT_LIMITS.addressFailureLimit === 30, "Límite por dirección incorrecto.");
assert(AUTH_ATTEMPT_LIMITS.windowSeconds === 900, "Ventana incorrecta.");
assert(AUTH_ATTEMPT_LIMITS.lockSeconds === 900, "Duración de bloqueo incorrecta.");

type Attempt = {
  scope: string;
  identifierHash: string;
  addressHash: string;
  attemptedAt: Date;
};

const createExecutor = () => {
  const attempts: Attempt[] = [];
  const queries: string[] = [];

  return {
    attempts,
    queries,
    async query(text: string, params: any[] = []) {
      const sql = text.replace(/\s+/g, " ").trim();
      queries.push(sql);

      if (
        sql === "BEGIN" ||
        sql === "COMMIT" ||
        sql === "ROLLBACK" ||
        sql.startsWith("SELECT pg_advisory_xact_lock") ||
        sql.startsWith("DELETE FROM auth_failed_login_attempts WHERE attempted_at")
      ) {
        return { rows: [], rowCount: null };
      }

      if (sql.startsWith("SELECT COUNT(*) FILTER")) {
        const [scope, identifierHash, addressHash] = params;
        const minimum = Date.now() - AUTH_ATTEMPT_LIMITS.windowSeconds * 1000;
        const recent = attempts.filter(
          (attempt) =>
            attempt.scope === scope &&
            attempt.attemptedAt.getTime() >= minimum &&
            (attempt.identifierHash === identifierHash || attempt.addressHash === addressHash)
        );
        const account = recent.filter((attempt) => attempt.identifierHash === identifierHash);
        const address = recent.filter((attempt) => attempt.addressHash === addressHash);
        return {
          rows: [{
            account_count: account.length,
            account_latest: account.length ? account[account.length - 1].attemptedAt.toISOString() : null,
            address_count: address.length,
            address_latest: address.length ? address[address.length - 1].attemptedAt.toISOString() : null,
          }],
          rowCount: 1,
        };
      }

      if (sql.startsWith("INSERT INTO auth_failed_login_attempts")) {
        attempts.push({
          scope: String(params[0]),
          identifierHash: String(params[1]),
          addressHash: String(params[2]),
          attemptedAt: new Date(),
        });
        return { rows: [], rowCount: 1 };
      }

      if (
        sql.startsWith("DELETE FROM auth_failed_login_attempts") &&
        sql.includes("scope = $1 AND identifier_hash = $2")
      ) {
        const [scope, identifierHash] = params;
        let removed = 0;
        for (let index = attempts.length - 1; index >= 0; index -= 1) {
          if (attempts[index].scope === scope && attempts[index].identifierHash === identifierHash) {
            attempts.splice(index, 1);
            removed += 1;
          }
        }
        return { rows: [], rowCount: removed };
      }

      throw new Error(`Consulta mock no contemplada: ${sql}`);
    },
  };
};

const executor = createExecutor();
const staffAttempt = {
  scope: "staff" as const,
  identifier: "admin@edugestion.com",
  clientAddress: "203.0.113.10",
};

let decision = await authAttemptSecurityService.check(staffAttempt, executor);
assert(decision.allowed, "Una cuenta sin fallos debería poder intentar.");

for (let attempt = 1; attempt <= 4; attempt += 1) {
  decision = await authAttemptSecurityService.recordFailure(staffAttempt, executor);
  assert(decision.allowed, `El intento ${attempt} no debería bloquear todavía.`);
  assert(decision.accountFailures === attempt, "El contador de cuenta no avanzó correctamente.");
}

decision = await authAttemptSecurityService.recordFailure(staffAttempt, executor);
assert(!decision.allowed, "El quinto fallo debe bloquear la cuenta.");
assert(decision.accountFailures === 5, "El bloqueo no se produjo en el quinto fallo.");
assert(decision.retryAfterSeconds > 0 && decision.retryAfterSeconds <= 900, "Retry-After es inválido.");

const lockedCheck = await authAttemptSecurityService.check(staffAttempt, executor);
assert(!lockedCheck.allowed, "La cuenta bloqueada volvió a habilitarse antes de tiempo.");

const fakeHeaders: Record<string, string> = {};
setRetryAfterHeader(
  { setHeader: (name: string, value: string) => { fakeHeaders[name] = value; } },
  lockedCheck
);
assert(Number(fakeHeaders["Retry-After"]) > 0, "No se escribió el encabezado Retry-After.");
assert(getLockoutMessage(lockedCheck).includes("Demasiados intentos"), "El mensaje de bloqueo no es claro.");

const firstInsert = executor.attempts[0];
assert(firstInsert.identifierHash.length === 64, "El hash de identificador no mide 64 caracteres.");
assert(firstInsert.addressHash.length === 64, "El hash de dirección no mide 64 caracteres.");
assert(!firstInsert.identifierHash.includes("admin"), "Se filtró parte del email en el hash.");
assert(!firstInsert.addressHash.includes("203.0.113.10"), "Se filtró la IP en el hash.");

await authAttemptSecurityService.clearFailures(staffAttempt, executor);
decision = await authAttemptSecurityService.check(staffAttempt, executor);
assert(decision.allowed, "El acceso correcto no limpió los fallos de la cuenta.");

const sharedAddress = "198.51.100.25";
for (let account = 1; account <= 6; account += 1) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    decision = await authAttemptSecurityService.recordFailure(
      {
        scope: "customer_portal",
        identifier: `cliente-${account}`,
        clientAddress: sharedAddress,
      },
      executor
    );
  }
}
assert(!decision.allowed, "Treinta fallos desde una misma dirección deben bloquearla.");
assert(decision.addressFailures === 30, "El límite por dirección no se alcanzó exactamente en 30.");

const otherAccountSameAddress = await authAttemptSecurityService.check(
  {
    scope: "customer_portal",
    identifier: "cliente-nuevo",
    clientAddress: sharedAddress,
  },
  executor
);
assert(!otherAccountSameAddress.allowed, "El bloqueo por dirección no protege cuentas adicionales.");

const differentScope = await authAttemptSecurityService.check(
  {
    scope: "staff",
    identifier: "otro@edugestion.com",
    clientAddress: sharedAddress,
  },
  executor
);
assert(differentScope.allowed, "Los límites de portal y personal no están aislados.");

assert(
  getRequestClientAddress({
    headers: { "x-forwarded-for": "198.51.100.9, 10.0.0.1" },
    socket: { remoteAddress: "127.0.0.1" },
  }) === "198.51.100.9",
  "No se toma correctamente la primera dirección reenviada."
);

assert(
  executor.queries.some((query) => query.includes("pg_advisory_xact_lock")),
  "La prueba no ejecutó el bloqueo transaccional."
);

console.log(
  "Intentos de acceso protegidos: límites por cuenta y dirección, hashes HMAC, Retry-After, limpieza tras éxito y aislamiento de ámbitos verificados."
);
