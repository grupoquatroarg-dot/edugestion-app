import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

const login = read("api/auth/login.ts");
const me = read("api/auth/me.ts");
const service = read("server/services/serverlessUserService.ts");
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
  failures.push("El fallback SQLite debe mantenerse como importación dinámica.");
}
if (/^import .*userRepository/m.test(service)) {
  failures.push("serverlessUserService no debe importar UserRepository estáticamente.");
}
if (!service.includes("WHERE email = $1 AND active = 1")) {
  failures.push("El login PostgreSQL debe filtrar usuarios activos.");
}
if (!apiClient.includes("!isLoginRequest && token")) {
  failures.push("El frontend no debe enviar un token anterior en el login.");
}

if (failures.length > 0) {
  console.error("Auditoría de aislamiento serverless de autenticación fallida:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Autenticación serverless aislada de SQLite correctamente.");
