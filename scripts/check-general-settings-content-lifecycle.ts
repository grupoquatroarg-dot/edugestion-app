import fs from "node:fs";
import path from "node:path";
import { generalSettingsContentLifecycleService } from "../server/services/generalSettingsContentLifecycleService.js";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};

const migration = read("supabase/40_general_settings_content_lifecycle.sql");
const service = read("server/services/generalSettingsContentLifecycleService.ts");
const routes = read("server/routes/configRoutes.ts");
const api = read("api/config/[endpoint].ts");
const ui = read("src/components/ConfigModule.tsx");
const database = read("server/db.ts");
const packageJson = JSON.parse(read("package.json"));

for (const token of [
  "general_settings_content_state",
  "general_settings_content_history",
  "content_version",
  "content_changed_at",
  "content_changed_by",
  "content_change_reason",
  "before_snapshot",
  "after_snapshot",
  "general_settings_content_history_version_key",
  "idx_general_settings_content_history_changed_at",
]) {
  assert(migration.includes(token), `La migración 40 no contiene ${token}.`);
}

assert(service.includes("GENERAL_SETTINGS_KEYS"), "El servicio no limita las claves editables.");
assert(service.includes("FOR UPDATE"), "El servicio no bloquea el estado de configuración.");
assert(service.includes("BEGIN"), "El servicio PostgreSQL no inicia transacción.");
assert(service.includes("ROLLBACK"), "El servicio PostgreSQL no ejecuta rollback.");
assert(service.includes("No se detectaron cambios para guardar"), "No se bloquea guardar sin cambios.");
assert(service.includes("cambió mientras estaba abierta"), "No existe control de concurrencia.");
assert(service.includes("general_settings_content_history"), "El servicio no registra historial.");
assert(service.includes("expectedContentVersion"), "El servicio no valida versión esperada.");
assert(service.includes("El motivo del cambio es obligatorio"), "El motivo no es obligatorio.");
assert(service.includes("El email del negocio no es válido"), "No se valida el email.");
assert(service.includes("La próxima venta"), "No se validan numeraciones.");

assert(
  routes.includes("generalSettingsContentLifecycleService.get") &&
    routes.includes("generalSettingsContentLifecycleService.update"),
  "Express no usa el servicio auditado para configuración general."
);
assert(
  routes.includes("requirePermission('settings', 'edit')"),
  "Express no exige permiso de edición."
);
assert(
  !routes.includes("INSERT OR REPLACE INTO settings") &&
    !routes.includes("for (const [key, value] of Object.entries(data))"),
  "Express conserva la actualización directa sin trazabilidad."
);

assert(
  api.includes("generalSettingsContentLifecycleService.get") &&
    api.includes("generalSettingsContentLifecycleService.update"),
  "Vercel no usa el servicio auditado."
);
assert(
  !api.includes('if (endpoint === "settings") {\n        const client = await pool.connect();'),
  "Vercel conserva el bloque directo anterior."
);
assert(
  api.includes('"general_settings_content_state"') &&
    api.includes('"general_settings_content_history"'),
  "Backup y restauración no incluyen el nuevo historial."
);

assert(ui.includes("Motivo del cambio"), "La UI no solicita motivo.");
assert(ui.includes("expectedContentVersion: settingsContentVersion"), "La UI no envía la versión esperada.");
assert(ui.includes("settingsChangeReason"), "La UI no administra el motivo.");
assert(ui.includes("settings_content_version"), "La UI no carga la versión.");
assert(ui.includes("Última modificación:"), "La UI no muestra la última modificación.");
assert(database.includes("general_settings_content_state"), "SQLite no crea el estado.");
assert(database.includes("general_settings_content_history"), "SQLite no crea el historial.");
assert(
  packageJson.scripts?.["check:general-settings-content-lifecycle"],
  "Falta el script de auditoría en package.json."
);

type MockOptions = {
  stateVersion?: number;
  rows?: Array<{ key: string; value: string }>;
  failStateUpdate?: boolean;
};

const createExecutor = (options: MockOptions = {}) => {
  let state = {
    id: 1,
    content_version: options.stateVersion ?? 0,
    content_changed_at: null,
    content_changed_by: null,
    content_change_reason: null,
  };
  const settings = new Map((options.rows || []).map((row) => [row.key, row.value]));
  const history: any[] = [];
  const queries: string[] = [];

  return {
    queries,
    history,
    settings,
    get state() {
      return state;
    },
    async query(text: string, params: any[] = []) {
      const sql = text.replace(/\s+/g, " ").trim();
      queries.push(sql);

      if (sql.startsWith("INSERT INTO general_settings_content_state")) {
        return { rows: [], rowCount: 0 };
      }

      if (sql.startsWith("SELECT * FROM general_settings_content_state")) {
        return { rows: [{ ...state }], rowCount: 1 };
      }

      if (sql.startsWith("SELECT key, value FROM settings")) {
        return {
          rows: [...settings.entries()].map(([key, value]) => ({ key, value })),
          rowCount: settings.size,
        };
      }

      if (sql.startsWith("INSERT INTO general_settings_content_history")) {
        const row = {
          id: history.length + 1,
          changed_at: "2026-08-03T12:00:00.000Z",
          params,
        };
        history.push(row);
        return { rows: [row], rowCount: 1 };
      }

      if (sql.startsWith("INSERT INTO settings")) {
        settings.set(String(params[0]), String(params[1]));
        return { rows: [], rowCount: 1 };
      }

      if (sql.startsWith("UPDATE general_settings_content_state")) {
        if (options.failStateUpdate) return { rows: [], rowCount: 0 };
        state = {
          ...state,
          content_version: params[0],
          content_changed_at: params[1],
          content_changed_by: params[2],
          content_change_reason: params[3],
        };
        return { rows: [{ ...state }], rowCount: 1 };
      }

      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
        return { rows: [], rowCount: null };
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

const executor = createExecutor({
  rows: [
    { key: "business_name", value: "Empresa anterior" },
    { key: "system_currency", value: "ARS" },
    { key: "next_sale_number", value: "10" },
  ],
});

const result = await generalSettingsContentLifecycleService.update(
  {
    settings: {
      business_name: "Empresa nueva",
      system_currency: "ARS",
      next_sale_number: "11",
    },
    motivo: "Actualización comercial",
    usuario: "Administrador",
    expectedContentVersion: 0,
  },
  executor
);

assert(result.version === 1, "La versión no aumentó.");
assert(executor.history.length === 1, "No se registró el historial.");
assert(executor.state.content_version === 1, "No se actualizó el estado.");
assert(executor.settings.get("business_name") === "Empresa nueva", "No se actualizó el negocio.");
assert(executor.settings.get("next_sale_number") === "11", "No se actualizó la numeración.");

await expectFailure(
  () => generalSettingsContentLifecycleService.update(
    {
      settings: { business_name: "Pestaña antigua" },
      motivo: "Intento concurrente",
      usuario: "Administrador",
      expectedContentVersion: 0,
    },
    executor
  ),
  "cambió mientras estaba abierta"
);

const unchanged = createExecutor({ rows: [{ key: "business_name", value: "" }] });
await expectFailure(
  () => generalSettingsContentLifecycleService.update(
    {
      settings: { business_name: "" },
      motivo: "Sin cambios",
      usuario: "Administrador",
      expectedContentVersion: 0,
    },
    unchanged
  ),
  "No se detectaron cambios"
);

const invalidEmail = createExecutor();
await expectFailure(
  () => generalSettingsContentLifecycleService.update(
    {
      settings: { business_email: "correo-invalido" },
      motivo: "Cambio de contacto",
      usuario: "Administrador",
      expectedContentVersion: 0,
    },
    invalidEmail
  ),
  "email del negocio no es válido"
);

const invalidNumber = createExecutor();
await expectFailure(
  () => generalSettingsContentLifecycleService.update(
    {
      settings: { next_sale_number: "0" },
      motivo: "Cambio de numeración",
      usuario: "Administrador",
      expectedContentVersion: 0,
    },
    invalidNumber
  ),
  "La próxima venta"
);

const failedUpdate = createExecutor({ failStateUpdate: true });
await expectFailure(
  () => generalSettingsContentLifecycleService.update(
    {
      settings: { business_name: "Empresa nueva" },
      motivo: "Falla concurrente",
      usuario: "Administrador",
      expectedContentVersion: 0,
    },
    failedUpdate
  ),
  "cambió mientras se guardaba"
);

console.log(
  "Configuración general auditada correctamente: motivo, snapshots, versiones, validaciones, concurrencia y rollback verificados."
);
