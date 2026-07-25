import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

const login = read("api/auth/login.ts");
const me = read("api/auth/me.ts");
const service = read("server/services/serverlessUserService.ts");
const currentUserAuth = read("server/services/currentUserAuthService.ts");
const databaseModule = read("server/db.ts");
const apiClient = read("src/utils/api.ts");

const failures: string[] = [];

for (const [file, source] of [["api/auth/login.ts", login], ["api/auth/me.ts", me]] as const) {
  if (/repositories\/userRepository/.test(source)) {
    failures.push(`${file} no debe importar UserRepository directamente.`);
  }
  if (/server\/db/.test(source) || /better-sqlite3/.test(source)) {
    failures.push(`${file} no debe cargar SQLite en Vercel.`);
  }
}

if (!service.includes('await import("../repositories/userRepository.js")')) {
  failures.push("El fallback SQLite de usuarios debe mantenerse como importación dinámica.");
}
if (/^import .*userRepository/m.test(service)) {
  failures.push("serverlessUserService no debe importar UserRepository estáticamente.");
}
if (!service.includes("WHERE email = $1 AND active = 1")) {
  failures.push("El login PostgreSQL debe filtrar usuarios activos.");
}
if (!currentUserAuth.includes('await import("../repositories/userRepository.js")')) {
  failures.push("La validación de sesión debe cargar UserRepository dinámicamente en SQLite.");
}
if (/^import .*better-sqlite3/m.test(databaseModule)) {
  failures.push("server/db.ts no debe importar better-sqlite3 estáticamente.");
}
if (!databaseModule.includes('require("better-sqlite3")')) {
  failures.push("server/db.ts debe conservar la carga diferida de better-sqlite3 para desarrollo local.");
}
if (!databaseModule.includes("new Proxy")) {
  failures.push("server/db.ts debe exponer SQLite mediante un proxy de inicialización diferida.");
}
if (!apiClient.includes("!isLoginRequest && token")) {
  failures.push("El frontend no debe enviar un token anterior en el login.");
}

const serverlessFunctions = [
  "api/auth/login.ts",
  "api/auth/logout.ts",
  "api/auth/me.ts",
  "api/clientes.ts",
  "api/config/[endpoint].ts",
  "api/config/[endpoint]/[id].ts",
  "api/dashboard/[endpoint].ts",
  "api/finanzas.ts",
  "api/products.ts",
  "api/products/[id].ts",
  "api/purchase-invoices/index.ts",
  "api/sales.ts",
];

for (const file of serverlessFunctions) {
  const importCode = `import(${JSON.stringify(`./${file}`)})`
    + `.then(() => process.exit(0))`
    + `.catch((error) => { console.error(error?.stack || error); process.exit(1); });`;

  const result = spawnSync(process.execPath, ["--import", "tsx", "--eval", importCode], {
    cwd: root,
    encoding: "utf8",
    timeout: 30_000,
    env: {
      ...process.env,
      DATABASE_URL: "postgresql://audit_user:audit_password@127.0.0.1:5432/audit_db",
      POSTGRES_URL: "",
      SUPABASE_DB_URL: "",
      VERCEL: "1",
    },
  });

  if (result.error) {
    failures.push(`${file} no pudo probarse en arranque en frío: ${result.error.message}`);
    continue;
  }

  if (result.status !== 0) {
    const details = String(result.stderr || result.stdout || "Error desconocido")
      .trim()
      .split("\n")
      .slice(0, 4)
      .join(" | ");
    failures.push(`${file} carga una dependencia incompatible con Vercel: ${details}`);
  }
}


if (process.platform === "win32") {
  const sqliteProbe = `import("./server/db.ts")`
    + `.then(({ default: db }) => {`
    + `const row = db.prepare("SELECT 1 AS ok").get();`
    + `if (Number(row?.ok) !== 1) throw new Error("Consulta SQLite inválida");`
    + `process.exit(0);`
    + `})`
    + `.catch((error) => { console.error(error?.stack || error); process.exit(1); });`;

  const sqliteResult = spawnSync(process.execPath, ["--import", "tsx", "--eval", sqliteProbe], {
    cwd: root,
    encoding: "utf8",
    timeout: 30_000,
    env: {
      ...process.env,
      DATABASE_URL: "",
      POSTGRES_URL: "",
      SUPABASE_DB_URL: "",
      VERCEL: "",
    },
  });

  if (sqliteResult.error || sqliteResult.status !== 0) {
    const details = sqliteResult.error?.message
      || String(sqliteResult.stderr || sqliteResult.stdout || "Error desconocido").trim();
    const missingNativeBinding = /Could not locate the bindings file|better_sqlite3\.node|No native build was found/i.test(details);

    if (missingNativeBinding) {
      console.warn(
        "Advertencia: SQLite local no se probó porque better-sqlite3 no tiene un binario nativo "
        + `instalado para Node ${process.version}. Esto no afecta las funciones Vercel/PostgreSQL.`,
      );
    } else {
      failures.push(`SQLite local falló después de la carga diferida: ${details}`);
    }
  }
}

if (failures.length > 0) {
  console.error("Auditoría de aislamiento serverless fallida:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Aislamiento serverless correcto: ${serverlessFunctions.length}/12 funciones importadas sin inicializar SQLite.`);
