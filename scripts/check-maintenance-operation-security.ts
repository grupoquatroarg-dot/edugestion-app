import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { maintenanceOperationSecurityService } from "../server/services/maintenanceOperationSecurityService.js";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};

const migration = read("supabase/41_maintenance_operation_security.sql");
const service = read("server/services/maintenanceOperationSecurityService.ts");
const api = read("api/config/[endpoint].ts");
const ui = read("src/components/ConfigModule.tsx");
const database = read("server/db.ts");
const packageJson = JSON.parse(read("package.json"));

for (const token of [
  "maintenance_operation_history",
  "operation",
  "reason",
  "performed_by_user_id",
  "performed_by",
  "performed_at",
  "affected_tables",
  "affected_rows",
  "details",
  "maintenance_operation_history_user_fkey",
  "maintenance_operation_history_operation_check",
  "idx_maintenance_operation_history_performed_at",
  "idx_maintenance_operation_history_actor",
  "idx_maintenance_operation_history_operation",
]) {
  assert(migration.includes(token), `La migración 41 no contiene ${token}.`);
}

assert(service.includes('bcrypt.compareSync'), "No se compara la contraseña real del administrador.");
assert(service.includes('FROM users'), "No se revalida el usuario actual.");
assert(service.includes('FOR UPDATE'), "La reautenticación no bloquea al administrador.");
assert(service.includes('"backup": "RESPALDAR"') || service.includes('backup: "RESPALDAR"'), "No se confirma el respaldo.");
assert(service.includes('restore: "RESTAURAR"'), "No se confirma la restauración.");
assert(service.includes('reset: "REESTABLECER"'), "No se confirma el restablecimiento.");
assert(service.includes("El motivo es obligatorio"), "El motivo no es obligatorio.");
assert(service.includes("Reautenticación inválida"), "La respuesta de reautenticación no es genérica.");
assert(service.includes("sanitizeDetails"), "No se sanitizan los detalles de auditoría.");
assert(service.includes('normalizedKey.includes("password")'), "La auditoría podría guardar contraseñas.");
assert(service.includes('normalizedKey.includes("token")'), "La auditoría podría guardar tokens.");
assert(service.includes('normalizedKey.includes("secret")'), "La auditoría podría guardar secretos.");

assert(!api.includes("RESET_APP_PASSWORD"), "Vercel conserva RESET_APP_PASSWORD.");
assert(!api.includes('"admin123"'), "Vercel conserva la contraseña insegura admin123.");
assert(
  api.includes("maintenanceOperationSecurityService.authorize") &&
    (api.match(/maintenanceOperationSecurityService\.authorize/g) || []).length === 3,
  "Las tres operaciones no reautentican al administrador."
);
assert(
  api.includes("maintenanceOperationSecurityService.record") &&
    (api.match(/maintenanceOperationSecurityService\.record/g) || []).length === 3,
  "Las tres operaciones no registran auditoría."
);
assert(
  api.includes("La copia de seguridad requiere reautenticación") &&
    api.includes("405"),
  "La descarga GET insegura no quedó bloqueada."
);
assert(
  !api.includes('"maintenance_operation_history"'),
  "La restauración o el restablecimiento podrían sobrescribir el historial de seguridad."
);

assert(ui.includes("showBackupModal"), "La UI no abre reautenticación para respaldos.");
assert(ui.includes("backupAdminPassword"), "La UI no solicita contraseña para respaldos.");
assert(ui.includes("backupReason"), "La UI no solicita motivo para respaldos.");
assert(ui.includes("RESPALDAR"), "La UI no exige confirmación de respaldo.");
assert(ui.includes("restoreReason"), "La UI no solicita motivo de restauración.");
assert(ui.includes("resetReason"), "La UI no solicita motivo de restablecimiento.");
assert(
  ui.includes("method: 'POST'") && ui.includes("/api/config/backup-data"),
  "La UI conserva la descarga GET insegura."
);
assert(database.includes("maintenance_operation_history"), "SQLite no crea el historial de mantenimiento.");
assert(
  packageJson.scripts?.["check:maintenance-operation-security"],
  "Falta el script de auditoría en package.json."
);

type MockUser = {
  id: number;
  name: string;
  role: string;
  active: number;
  password: string;
};

const createExecutor = (user: MockUser | null) => {
  const inserts: any[][] = [];
  const queries: string[] = [];

  return {
    queries,
    inserts,
    async query(text: string, params: any[] = []) {
      const sql = text.replace(/\s+/g, " ").trim();
      queries.push(sql);

      if (sql.startsWith("SELECT id, name, role, active, password FROM users")) {
        return { rows: user ? [{ ...user }] : [], rowCount: user ? 1 : 0 };
      }

      if (sql.startsWith("INSERT INTO maintenance_operation_history")) {
        inserts.push(params);
        return {
          rows: [{ id: inserts.length, performed_at: "2026-08-03T15:00:00.000Z" }],
          rowCount: 1,
        };
      }

      throw new Error(`Consulta mock no contemplada: ${sql}`);
    },
  };
};

const expectFailure = async (run: () => Promise<any>, fragment: string) => {
  let failed = false;
  try {
    await run();
  } catch (error: any) {
    failed = String(error?.message || error).includes(fragment);
  }
  assert(failed, `Se esperaba error con: ${fragment}`);
};

const password = "Clave-admin-824";
const administrator = {
  id: 1,
  name: "Administrador",
  role: "administrador",
  active: 1,
  password: bcrypt.hashSync(password, 10),
};

const executor = createExecutor(administrator);
const authorization = await maintenanceOperationSecurityService.authorize(
  {
    operation: "backup",
    actorUserId: 1,
    actorName: "Administrador",
    password,
    motivo: "Respaldo previo al cierre",
    confirmation: "RESPALDAR",
  },
  executor
);
assert(authorization.actorUserId === 1, "No se autorizó al administrador correcto.");
assert(authorization.motivo === "Respaldo previo al cierre", "No se normalizó el motivo.");

await maintenanceOperationSecurityService.record(
  {
    ...authorization,
    affectedTables: 31,
    affectedRows: 425,
    details: {
      backup_version: 1,
      password: "NO-DEBE-GUARDARSE",
      token: "NO-DEBE-GUARDARSE",
      secret_key: "NO-DEBE-GUARDARSE",
      nested: { adminPassword: "NO-DEBE-GUARDARSE", safe: "sí" },
      tables: { clientes: [] },
    },
  },
  executor
);

assert(executor.inserts.length === 1, "No se registró la operación.");
const details = JSON.parse(String(executor.inserts[0][6]));
assert(details.backup_version === 1, "Se perdió metadata permitida.");
assert(!("password" in details), "Se guardó la contraseña.");
assert(!("token" in details), "Se guardó el token.");
assert(!("secret_key" in details), "Se guardó un secreto.");
assert(!("tables" in details), "Se guardó el contenido completo del respaldo.");
assert(details.nested?.safe === "sí", "Se perdió metadata segura.");
assert(!("adminPassword" in details.nested), "Se guardó una contraseña anidada.");

await expectFailure(
  () => maintenanceOperationSecurityService.authorize(
    {
      operation: "backup",
      actorUserId: 1,
      password: "incorrecta",
      motivo: "Intento inválido",
      confirmation: "RESPALDAR",
    },
    createExecutor(administrator)
  ),
  "Reautenticación inválida"
);

await expectFailure(
  () => maintenanceOperationSecurityService.authorize(
    {
      operation: "restore",
      actorUserId: 2,
      password,
      motivo: "Restauración",
      confirmation: "RESTAURAR",
    },
    createExecutor({ ...administrator, id: 2, role: "administrativo" })
  ),
  "Reautenticación inválida"
);

await expectFailure(
  () => maintenanceOperationSecurityService.authorize(
    {
      operation: "reset",
      actorUserId: 1,
      password,
      motivo: "",
      confirmation: "REESTABLECER",
    },
    createExecutor(administrator)
  ),
  "motivo es obligatorio"
);

await expectFailure(
  () => maintenanceOperationSecurityService.authorize(
    {
      operation: "restore",
      actorUserId: 1,
      password,
      motivo: "Restauración controlada",
      confirmation: "CONFIRMAR",
    },
    createExecutor(administrator)
  ),
  "Debe escribir RESTAURAR"
);

console.log(
  "Mantenimiento seguro correcto: contraseña real, rol activo, motivo, confirmaciones, auditoría y sanitización verificados."
);
