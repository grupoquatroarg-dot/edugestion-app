import crypto from "node:crypto";
import { AppError } from "../utils/response.js";

export const BACKUP_SCHEMA_VERSION = 2;
export const BACKUP_SCOPE = "operational-without-user-credentials";

export const BACKUP_TABLE_ORDER = [
  "settings",
  "general_settings_content_state",
  "general_settings_content_history",
  "payment_methods",
  "product_categories",
  "product_families",
  "configuration_item_status_history",
  "configuration_item_content_history",
  "clientes",
  "customer_status_history",
  "customer_content_history",
  "proveedores",
  "provider_status_history",
  "provider_content_history",
  "products",
  "product_status_history",
  "product_content_history",
  "sales",
  "sale_items",
  "sale_stock_allocations",
  "sale_payment_allocations",
  "sale_cancellations",
  "purchase_invoices",
  "purchase_invoice_items",
  "purchase_invoice_payment_allocations",
  "purchase_invoice_cancellations",
  "movimientos_financieros",
  "financial_movement_cancellations",
  "client_payment_cancellations",
  "supplier_payment_cancellations",
  "cheques",
  "cheque_status_changes",
  "cheque_rejection_allocations",
  "stock_movimientos",
  "stock_movement_cancellations",
  "price_update_history",
  "price_update_history_items",
  "routes",
  "route_status_history",
  "route_operational_status_history",
  "route_items",
  "route_item_status_history",
  "checklist_templates",
  "checklist_template_items",
  "checklist_template_status_history",
  "checklist_template_content_history",
  "checklists",
  "checklist_items",
  "checklist_status_history",
  "supplier_orders",
  "supplier_order_items",
  "supplier_order_status_history",
  "supplier_order_content_history",
  "supplier_order_cancellations",
  "supplier_order_deliveries",
  "supplier_order_delivery_items",
  "customer_orders",
  "customer_order_items",
  "customer_order_approvals",
  "customer_order_rejections",
  "customer_order_cancellations",
  "customer_order_content_history",
  "customer_order_deliveries",
  "customer_order_delivery_items"
] as const;

export const BACKUP_EXCLUDED_SECURITY_TABLES = [
  "users",
  "user_permissions",
  "user_status_history",
  "user_permission_history",
  "user_content_history",
  "maintenance_operation_history",
  "auth_failed_login_attempts",
] as const;

const LEGACY_BACKUP_EXCLUDED_SECURITY_TABLES_V2 = [
  "users",
  "user_permissions",
  "user_status_history",
  "user_permission_history",
  "user_content_history",
  "maintenance_operation_history",
] as const;

type TransactionClient = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

type TableManifest = {
  name: string;
  columns: string[];
  row_count: number;
};

type BackupEnvelope = {
  app: "edugestion";
  type: "verified-operational-backup";
  version: 2;
  schema_version: 2;
  scope: typeof BACKUP_SCOPE;
  created_at: string;
  manifest: {
    table_order: string[];
    tables: TableManifest[];
    excluded_security_tables: string[];
    checksum_sha256: string;
  };
  tables: Record<string, any[]>;
};

const quoteIdentifier = (value: string) => `"${value.replace(/"/g, '""')}"`;

const canonicalize = (value: any): any => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = canonicalize(value[key]);
      return acc;
    }, {});
};

const canonicalStringify = (value: unknown) => JSON.stringify(canonicalize(value));
const sha256 = (value: unknown) =>
  crypto.createHash("sha256").update(canonicalStringify(value), "utf8").digest("hex");

const checksumPayload = (backup: Pick<BackupEnvelope, "app" | "type" | "version" | "schema_version" | "scope" | "tables">) => ({
  app: backup.app,
  type: backup.type,
  version: backup.version,
  schema_version: backup.schema_version,
  scope: backup.scope,
  tables: backup.tables,
});

const getColumnMap = async (client: TransactionClient) => {
  const result = await client.query(
    `SELECT table_name, column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = ANY($1::text[])
     ORDER BY table_name, ordinal_position`,
    [BACKUP_TABLE_ORDER]
  );

  const columns = new Map<string, string[]>();
  for (const row of result.rows) {
    const tableName = String(row.table_name);
    const columnName = String(row.column_name);
    const current = columns.get(tableName) || [];
    current.push(columnName);
    columns.set(tableName, current);
  }

  const missing = BACKUP_TABLE_ORDER.filter((tableName) => !columns.has(tableName));
  if (missing.length > 0) {
    throw new AppError(
      `La base de datos no tiene todas las tablas requeridas para una copia íntegra: ${missing.join(", ")}`,
      409
    );
  }

  return columns;
};

const assertStringArrayEqual = (actual: unknown, expected: readonly string[], label: string) => {
  if (!Array.isArray(actual) || actual.length !== expected.length) {
    throw new AppError(`${label} no coincide con el esquema actual`, 409);
  }
  for (let index = 0; index < expected.length; index += 1) {
    if (String(actual[index]) !== expected[index]) {
      throw new AppError(`${label} no coincide con el esquema actual`, 409);
    }
  }
};

const assertStringSetEqual = (actual: unknown, expected: readonly string[], label: string) => {
  if (!Array.isArray(actual) || actual.length !== expected.length) {
    throw new AppError(`${label} no coincide con el esquema actual`, 409);
  }
  const actualSorted = actual.map(String).sort();
  const expectedSorted = [...expected].sort();
  for (let index = 0; index < expectedSorted.length; index += 1) {
    if (actualSorted[index] !== expectedSorted[index]) {
      throw new AppError(`${label} no coincide con el esquema actual`, 409);
    }
  }
};

const validateBackupEnvelope = async (client: TransactionClient, input: unknown) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AppError("El archivo de copia no es válido", 400);
  }
  const backup = input as Partial<BackupEnvelope>;

  if (
    backup.app !== "edugestion" ||
    backup.type !== "verified-operational-backup" ||
    backup.version !== 2 ||
    backup.schema_version !== BACKUP_SCHEMA_VERSION ||
    backup.scope !== BACKUP_SCOPE
  ) {
    throw new AppError(
      "La copia no pertenece a la versión íntegra y compatible de EduGestión",
      409
    );
  }

  if (!backup.tables || typeof backup.tables !== "object" || Array.isArray(backup.tables)) {
    throw new AppError("La copia no contiene tablas válidas", 400);
  }
  if (!backup.manifest || typeof backup.manifest !== "object") {
    throw new AppError("La copia no contiene un manifiesto de integridad", 400);
  }

  assertStringArrayEqual(backup.manifest.table_order, BACKUP_TABLE_ORDER, "El orden de tablas");
  const excludedSecurityTables = backup.manifest.excluded_security_tables;
  const matchesCurrentSecurityExclusions = (() => {
    try {
      assertStringArrayEqual(
        excludedSecurityTables,
        BACKUP_EXCLUDED_SECURITY_TABLES,
        "La exclusión de seguridad"
      );
      return true;
    } catch {
      return false;
    }
  })();

  if (!matchesCurrentSecurityExclusions) {
    assertStringArrayEqual(
      excludedSecurityTables,
      LEGACY_BACKUP_EXCLUDED_SECURITY_TABLES_V2,
      "La exclusión de seguridad"
    );
  }

  const tableNames = Object.keys(backup.tables);
  assertStringSetEqual(tableNames, BACKUP_TABLE_ORDER, "El conjunto de tablas");

  const manifestTables = backup.manifest.tables;
  if (!Array.isArray(manifestTables) || manifestTables.length !== BACKUP_TABLE_ORDER.length) {
    throw new AppError("El manifiesto de tablas está incompleto", 409);
  }

  const currentColumns = await getColumnMap(client);
  let totalRows = 0;

  for (let index = 0; index < BACKUP_TABLE_ORDER.length; index += 1) {
    const tableName = BACKUP_TABLE_ORDER[index];
    const rows = backup.tables[tableName];
    const manifestEntry = manifestTables[index];

    if (!Array.isArray(rows)) {
      throw new AppError(`La tabla ${tableName} no contiene una lista de filas`, 400);
    }
    if (!manifestEntry || manifestEntry.name !== tableName) {
      throw new AppError(`El manifiesto de ${tableName} es inválido`, 409);
    }

    const expectedColumns = currentColumns.get(tableName) || [];
    assertStringArrayEqual(manifestEntry.columns, expectedColumns, `Las columnas de ${tableName}`);

    if (!Number.isInteger(manifestEntry.row_count) || manifestEntry.row_count !== rows.length) {
      throw new AppError(`La cantidad de filas de ${tableName} no coincide con el manifiesto`, 409);
    }

    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        throw new AppError(`La tabla ${tableName} contiene una fila inválida`, 400);
      }
      assertStringSetEqual(Object.keys(row), expectedColumns, `Las columnas de una fila de ${tableName}`);
    }
    totalRows += rows.length;
  }

  const expectedChecksum = sha256(checksumPayload(backup as BackupEnvelope));
  const suppliedChecksum = String(backup.manifest.checksum_sha256 || "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(suppliedChecksum) || suppliedChecksum !== expectedChecksum) {
    throw new AppError("La copia fue modificada o está dañada: checksum SHA-256 inválido", 409);
  }

  return {
    backup: backup as BackupEnvelope,
    checksum: expectedChecksum,
    totalRows,
    columns: currentColumns,
  };
};

export const backupRestoreIntegrityService = {
  async create(client: TransactionClient): Promise<BackupEnvelope> {
    const columns = await getColumnMap(client);
    const tables: Record<string, any[]> = {};
    const manifestTables: TableManifest[] = [];

    for (const tableName of BACKUP_TABLE_ORDER) {
      const result = await client.query(`SELECT * FROM ${quoteIdentifier(tableName)}`);
      tables[tableName] = result.rows;
      manifestTables.push({
        name: tableName,
        columns: columns.get(tableName) || [],
        row_count: result.rows.length,
      });
    }

    const createdAt = new Date().toISOString();
    const envelopeWithoutChecksum: BackupEnvelope = {
      app: "edugestion" as const,
      type: "verified-operational-backup" as const,
      version: 2 as const,
      schema_version: BACKUP_SCHEMA_VERSION as 2,
      scope: BACKUP_SCOPE,
      created_at: createdAt,
      manifest: {
        table_order: [...BACKUP_TABLE_ORDER],
        tables: manifestTables,
        excluded_security_tables: [...BACKUP_EXCLUDED_SECURITY_TABLES],
        checksum_sha256: "",
      },
      tables,
    };

    const checksum = sha256(checksumPayload(envelopeWithoutChecksum));
    return {
      ...envelopeWithoutChecksum,
      manifest: {
        ...envelopeWithoutChecksum.manifest,
        checksum_sha256: checksum,
      },
    };
  },

  async restore(client: TransactionClient, input: unknown) {
    const validated = await validateBackupEnvelope(client, input);
    const backup = validated.backup;

    const truncateTables = [...BACKUP_TABLE_ORDER].reverse().map(quoteIdentifier).join(", ");
    await client.query(`TRUNCATE TABLE ${truncateTables} RESTART IDENTITY CASCADE`);

    let restoredRows = 0;
    for (const tableName of BACKUP_TABLE_ORDER) {
      const columns = validated.columns.get(tableName) || [];
      const rows = backup.tables[tableName];

      for (const row of rows) {
        const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
        await client.query(
          `INSERT INTO ${quoteIdentifier(tableName)} (${columns.map(quoteIdentifier).join(", ")})
           VALUES (${placeholders})`,
          columns.map((column) => row[column])
        );
        restoredRows += 1;
      }

      if (columns.includes("id")) {
        const sequenceResult = await client.query(
          "SELECT pg_get_serial_sequence($1, 'id') AS sequence_name",
          [`public.${tableName}`]
        );
        const sequenceName = sequenceResult.rows[0]?.sequence_name;
        if (sequenceName) {
          await client.query(
            `SELECT setval(
               $1,
               COALESCE((SELECT MAX(id) FROM ${quoteIdentifier(tableName)}), 1),
               COALESCE((SELECT COUNT(*) FROM ${quoteIdentifier(tableName)}), 0) > 0
             )`,
            [sequenceName]
          );
        }
      }
    }

    return {
      restoredTables: BACKUP_TABLE_ORDER.length,
      restoredRows,
      checksum: validated.checksum,
      schemaVersion: BACKUP_SCHEMA_VERSION,
    };
  },

  validate: validateBackupEnvelope,
  checksum: sha256,
};
