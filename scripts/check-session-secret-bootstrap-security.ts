import fs from "node:fs";
import path from "node:path";
import { generateToken, verifyToken } from "../server/utils/jwt.js";
import {
  getBootstrapAdminConfig,
  getSessionSecret,
  validateSessionSecret,
} from "../server/utils/securityConfig.js";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};

const server = read("server.ts");
const jwt = read("server/utils/jwt.ts");
const security = read("server/utils/securityConfig.ts");
const database = read("server/db.ts");
const envExample = read(".env.example");
const packageJson = JSON.parse(read("package.json"));

assert(server.includes("getSessionSecret"), "Express no usa la configuración segura de sesión.");
assert(server.includes("secret: sessionSecret"), "Express no usa el secreto validado.");
assert(!server.includes("fallback-insecure-key"), "Express conserva el secreto fallback inseguro.");
assert(!server.includes("Using insecure fallback"), "Express conserva la advertencia permisiva de producción.");

assert(jwt.includes("getSessionSecret"), "JWT no usa la configuración segura.");
assert(!jwt.includes("fallback-jwt-secret-key"), "JWT conserva el secreto predecible.");
assert(!jwt.includes("process.env.SESSION_SECRET ||"), "JWT conserva un fallback silencioso.");

assert(security.includes("randomBytes(48)"), "Desarrollo no genera un secreto efímero criptográfico.");
assert(security.includes("isProductionLikeRuntime"), "No se detectan runtimes productivos/serverless.");
assert(security.includes("SESSION_SECRET es obligatorio en producción"), "Producción no falla cerrada sin secreto.");
assert(security.includes("al menos 32 caracteres"), "No se exige longitud mínima del secreto.");
assert(security.includes("BOOTSTRAP_ADMIN_PASSWORD"), "No se exige contraseña explícita de bootstrap.");
assert(security.includes("entre 12 y 256 caracteres"), "El bootstrap no exige contraseña robusta.");
assert(security.includes("al menos tres tipos"), "El bootstrap no exige diversidad de contraseña.");

assert(database.includes("getBootstrapAdminConfig"), "SQLite no usa el bootstrap seguro.");
assert(database.includes("bcrypt.hashSync(bootstrapAdmin.password, 12)"), "SQLite no usa costo bcrypt 12.");
assert(!database.includes('bcrypt.hashSync("admin123"'), "SQLite conserva admin123.");
assert(!database.includes('"admin123"'), "SQLite conserva una credencial conocida.");
assert(database.includes("SQLite no tiene un administrador activo"), "SQLite no bloquea el estado sin administrador activo.");

assert(envExample.includes("SESSION_SECRET="), ".env.example no documenta SESSION_SECRET.");
assert(!envExample.includes("super-secret-key-change-me"), ".env.example conserva un secreto de ejemplo inseguro.");
assert(envExample.includes("BOOTSTRAP_ADMIN_PASSWORD="), ".env.example no documenta el bootstrap seguro.");

assert(
  packageJson.scripts?.["check:session-secret-bootstrap-security"],
  "Falta el script de auditoría en package.json."
);
assert(
  String(packageJson.scripts?.["validate:audit"] || "").includes("check:session-secret-bootstrap-security"),
  "La auditoría nueva no está incluida en validate:audit."
);

const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  VERCEL: process.env.VERCEL,
  AWS_LAMBDA_FUNCTION_NAME: process.env.AWS_LAMBDA_FUNCTION_NAME,
  LAMBDA_TASK_ROOT: process.env.LAMBDA_TASK_ROOT,
  K_SERVICE: process.env.K_SERVICE,
  SESSION_SECRET: process.env.SESSION_SECRET,
  BOOTSTRAP_ADMIN_NAME: process.env.BOOTSTRAP_ADMIN_NAME,
  BOOTSTRAP_ADMIN_EMAIL: process.env.BOOTSTRAP_ADMIN_EMAIL,
  BOOTSTRAP_ADMIN_PASSWORD: process.env.BOOTSTRAP_ADMIN_PASSWORD,
};

const restoreEnv = () => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
};

const expectFailure = (run: () => unknown, fragment: string) => {
  let failed = false;
  try {
    run();
  } catch (error: any) {
    failed = String(error?.message || error).includes(fragment);
  }
  assert(failed, `Se esperaba error con: ${fragment}`);
};

try {
  delete process.env.VERCEL;
  delete process.env.AWS_LAMBDA_FUNCTION_NAME;
  delete process.env.LAMBDA_TASK_ROOT;
  delete process.env.K_SERVICE;

  process.env.NODE_ENV = "production";
  delete process.env.SESSION_SECRET;
  expectFailure(() => getSessionSecret(), "SESSION_SECRET es obligatorio en producción");

  process.env.SESSION_SECRET = "fallback-jwt-secret-key-fallback-jwt-secret-key";
  expectFailure(() => getSessionSecret(), "predecible");
  expectFailure(() => validateSessionSecret("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), "diversidad");

  const strongSecret = "9f4A7c2E8d1B6a3F0e5C9b7D4f2A8c6E1d3B5a7F9c2E4b6D";
  process.env.SESSION_SECRET = strongSecret;
  assert(getSessionSecret() === strongSecret, "No se devuelve el secreto configurado.");

  const token = generateToken({
    userId: 7,
    role: "administrador",
    userName: "Prueba",
    sessionVersion: 3,
  });
  const decoded = verifyToken(token);
  assert(decoded?.userId === 7 && decoded?.sessionVersion === 3, "JWT válido no pudo verificarse.");

  process.env.SESSION_SECRET = "1A3c5E7g9I2k4M6o8Q0s2U4w6Y8a0C2e4G6i8K0m2O4q6S8u";
  assert(verifyToken(token) === null, "Un token firmado con otro secreto continúa siendo válido.");

  process.env.NODE_ENV = "development";
  delete process.env.SESSION_SECRET;
  const developmentA = getSessionSecret();
  const developmentB = getSessionSecret();
  assert(developmentA === developmentB, "El secreto efímero cambia dentro del mismo proceso.");
  assert(developmentA.length >= 32, "El secreto efímero es demasiado corto.");
  assert(!developmentA.includes("fallback"), "El secreto efímero usa un valor predecible.");

  process.env.BOOTSTRAP_ADMIN_NAME = "Administrador Seguro";
  process.env.BOOTSTRAP_ADMIN_EMAIL = "admin.seguro@edugestion.com";
  delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
  expectFailure(() => getBootstrapAdminConfig(), "BOOTSTRAP_ADMIN_PASSWORD es obligatorio");

  process.env.BOOTSTRAP_ADMIN_PASSWORD = "admin123";
  expectFailure(() => getBootstrapAdminConfig(), "entre 12 y 256");

  process.env.BOOTSTRAP_ADMIN_PASSWORD = "AdministradorSeguro123!";
  expectFailure(() => getBootstrapAdminConfig(), "datos previsibles");

  process.env.BOOTSTRAP_ADMIN_PASSWORD = "V9!rT2#qL7@xP4$z";
  const bootstrap = getBootstrapAdminConfig();
  assert(bootstrap.email === "admin.seguro@edugestion.com", "No se normaliza el email de bootstrap.");
  assert(bootstrap.name === "Administrador Seguro", "No se conserva el nombre de bootstrap.");
  assert(bootstrap.password === "V9!rT2#qL7@xP4$z", "No se conserva la contraseña segura.");
} finally {
  restoreEnv();
}

console.log(
  "Seguridad de sesión y bootstrap correcta: secretos fuertes, producción fail-closed, JWT rotado y admin123 eliminado."
);
