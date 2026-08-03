import fs from "node:fs";
import path from "node:path";
import {
  BACKUP_EXCLUDED_SECURITY_TABLES,
  BACKUP_SCHEMA_VERSION,
  BACKUP_TABLE_ORDER,
  backupRestoreIntegrityService,
} from "../server/services/backupRestoreIntegrityService.js";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};

const migration = read("supabase/42_backup_restore_integrity.sql");
const service = read("server/services/backupRestoreIntegrityService.ts");
const api = read("api/config/[endpoint].ts");
const ui = read("src/components/ConfigModule.tsx");
const database = read("server/db.ts");
const maintenance = read("server/services/maintenanceOperationSecurityService.ts");
const packageJson = JSON.parse(read("package.json"));

assert(BACKUP_TABLE_ORDER.length === 64, "El registro debe contener exactamente 64 tablas operativas.");
assert(new Set(BACKUP_TABLE_ORDER).size === 64, "El registro contiene tablas duplicadas.");
for (const table of [
  "customer_content_history",
  "provider_content_history",
  "product_content_history",
  "sale_cancellations",
  "purchase_invoice_cancellations",
  "supplier_order_content_history",
  "customer_order_content_history",
  "checklist_template_content_history",
]) {
  assert(BACKUP_TABLE_ORDER.includes(table as any), `Falta ${table} en la copia íntegra.`);
}
for (const table of ["users", "user_permissions", "user_content_history", "maintenance_operation_history", "auth_failed_login_attempts"]) {
  assert(!BACKUP_TABLE_ORDER.includes(table as any), `${table} no debe ser restaurable.`);
  assert(BACKUP_EXCLUDED_SECURITY_TABLES.includes(table as any), `${table} no figura como exclusión de seguridad.`);
}

assert(service.includes("canonicalStringify"), "No existe serialización canónica.");
assert(service.includes('createHash("sha256")'), "No se calcula SHA-256.");
assert(service.includes("checksum SHA-256 inválido"), "No se rechaza un checksum inválido.");
assert(service.includes("information_schema.columns"), "No se valida el esquema actual.");
assert(service.includes("TRUNCATE TABLE"), "No se restaura transaccionalmente el conjunto completo.");
assert(service.includes("assertStringSetEqual(Object.keys(row)"), "No se validan columnas por fila.");
assert(service.includes("BACKUP_SCHEMA_VERSION = 2"), "La versión de esquema no está fijada.");

assert(api.includes("backupRestoreIntegrityService.create"), "El backup no usa el servicio íntegro.");
assert(api.includes("backupRestoreIntegrityService.restore"), "La restauración no usa el servicio íntegro.");
assert(!api.includes("const backupTables = ["), "Quedó el registro parcial de backup.");
assert(!api.includes("const restoreTables = ["), "Quedó el registro parcial de restore.");
assert(api.includes("BEGIN ISOLATION LEVEL REPEATABLE READ"), "El backup no usa snapshot consistente.");
assert(api.includes("BEGIN ISOLATION LEVEL SERIALIZABLE"), "La restauración no usa aislamiento serializable.");
assert(api.includes("artifactChecksumSha256"), "La auditoría no registra checksum.");
assert(api.includes("artifactSchemaVersion"), "La auditoría no registra versión de esquema.");

assert(ui.includes("edugestion_backup_integro_v2_"), "El nombre del archivo no identifica el formato íntegro.");
assert(ui.includes("verified-operational-backup"), "La UI no hace prevalidación del formato.");
assert(ui.includes("checksum SHA-256"), "La UI no informa integridad.");
assert(database.includes("artifact_checksum_sha256"), "SQLite no contempla el checksum.");
assert(maintenance.includes("artifact_schema_version"), "El historial no registra versión.");
assert(migration.includes("artifact_checksum_sha256"), "La migración 42 no agrega checksum.");
assert(migration.includes("idx_maintenance_operation_history_checksum"), "Falta índice de checksum.");
assert(packageJson.scripts?.["check:backup-restore-integrity"], "Falta script de auditoría.");

const columnsByTable = new Map<string, string[]>(
  BACKUP_TABLE_ORDER.map((name) => [name, ["id", "value"]])
);
const dataByTable = new Map<string, Array<{ id: number; value: string }>>(
  BACKUP_TABLE_ORDER.map((name, index) => [name, [{ id: index + 1, value: `fila-${index + 1}` }]])
);

const quoteRegex = /"([^"]+)"/;
const createMock = () => {
  const inserted = new Map<string, any[]>();
  const queries: string[] = [];
  return {
    inserted,
    queries,
    async query(text: string, params: any[] = []) {
      const sql = text.replace(/\s+/g, " ").trim();
      queries.push(sql);

      if (sql.startsWith("SELECT table_name, column_name FROM information_schema.columns")) {
        return {
          rows: BACKUP_TABLE_ORDER.flatMap((table) =>
            (columnsByTable.get(table) || []).map((column) => ({
              table_name: table,
              column_name: column,
            }))
          ),
          rowCount: BACKUP_TABLE_ORDER.length * 2,
        };
      }

      if (sql.startsWith("SELECT * FROM ")) {
        const table = sql.match(quoteRegex)?.[1] || "";
        return { rows: structuredClone(dataByTable.get(table) || []), rowCount: 1 };
      }

      if (sql.startsWith("TRUNCATE TABLE ")) {
        return { rows: [], rowCount: null };
      }

      if (sql.startsWith("INSERT INTO ")) {
        const table = sql.match(quoteRegex)?.[1] || "";
        const rows = inserted.get(table) || [];
        rows.push({ id: params[0], value: params[1] });
        inserted.set(table, rows);
        return { rows: [], rowCount: 1 };
      }

      if (sql.startsWith("SELECT pg_get_serial_sequence")) {
        return { rows: [{ sequence_name: null }], rowCount: 1 };
      }

      throw new Error(`Consulta mock no contemplada: ${sql}`);
    },
  };
};

const mock = createMock();
const backup = await backupRestoreIntegrityService.create(mock);
assert(backup.version === 2, "Versión de backup incorrecta.");
assert(backup.schema_version === BACKUP_SCHEMA_VERSION, "Versión de esquema incorrecta.");
assert(backup.manifest.tables.length === 64, "Manifiesto incompleto.");
assert(/^[a-f0-9]{64}$/.test(backup.manifest.checksum_sha256), "Checksum inválido.");
assert(Object.keys(backup.tables).length === 64, "Tablas incompletas.");

const restoreMock = createMock();
const restored = await backupRestoreIntegrityService.restore(restoreMock, backup);
assert(restored.restoredTables === 64, "Cantidad de tablas restauradas incorrecta.");
assert(restored.restoredRows === 64, "Cantidad de filas restauradas incorrecta.");
assert(restoreMock.inserted.size === 64, "No se insertaron todas las tablas.");

const expectFailure = async (value: any, fragment: string) => {
  let failed = false;
  try {
    await backupRestoreIntegrityService.restore(createMock(), value);
  } catch (error: any) {
    failed = String(error?.message || error).includes(fragment);
  }
  assert(failed, `Se esperaba error con: ${fragment}`);
};

const damaged = structuredClone(backup);
damaged.tables.products[0].value = "ALTERADO";
await expectFailure(damaged, "checksum SHA-256 inválido");

const missingTable = structuredClone(backup);
delete missingTable.tables.product_content_history;
await expectFailure(missingTable, "conjunto de tablas");

const wrongColumns = structuredClone(backup);
wrongColumns.manifest.tables[0].columns = ["id", "otra"];
await expectFailure(wrongColumns, "columnas de settings");

const oldBackup = { app: "edugestion", type: "manual-json-backup", version: 1, tables: {} };
await expectFailure(oldBackup, "versión íntegra");

console.log(
  "Backup/restauración íntegros: 64 tablas, esquema, checksum, exclusión de seguridad y restauración validados."
);
