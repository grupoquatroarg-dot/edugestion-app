import fs from "node:fs";
import path from "node:path";
import { configurationItemContentLifecycleService } from "../server/services/configurationItemContentLifecycleService.js";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};

const migration = read("supabase/35_configuration_item_content_lifecycle.sql");
const service = read("server/services/configurationItemContentLifecycleService.ts");
const routes = read("server/routes/configRoutes.ts");
const api = read("api/config/[endpoint]/[id].ts");
const configApi = read("api/config/[endpoint].ts");
const ui = read("src/components/ConfigModule.tsx");
const database = read("server/db.ts");
const helpers = read("server/services/vercel/configApiHelpers.ts");
const packageJson = JSON.parse(read("package.json"));

for (const token of [
  "configuration_item_content_history",
  "content_version",
  "content_changed_at",
  "content_changed_by",
  "content_change_reason",
  "before_snapshot",
  "after_snapshot",
  "configuration_item_content_history_item_version_key",
  "idx_configuration_item_content_history_item",
]) {
  assert(migration.includes(token), `La migración 35 no contiene ${token}.`);
}

for (const table of ["payment_methods", "product_categories", "product_families"]) {
  assert(
    migration.includes(`ALTER TABLE public.${table}`),
    `La migración no protege ${table}.`
  );
}

assert(service.includes('FOR UPDATE'), "El servicio no bloquea la configuración durante la edición.");
assert(service.includes('BEGIN'), "El servicio PostgreSQL no inicia transacción.");
assert(service.includes('ROLLBACK'), "El servicio PostgreSQL no ejecuta rollback.");
assert(service.includes('No se detectaron cambios para guardar'), "No se bloquea guardar sin cambios.");
assert(service.includes('La configuración cambió mientras estaba abierta'), "No existe control de concurrencia.");
assert(service.includes('Reactivalo antes de editarlo'), "No se bloquean elementos inactivos.");
assert(service.includes('PROTECTED_PAYMENT_NAMES'), "No se conservan las formas de pago protegidas.");
assert(service.includes('Ya existe otro elemento con ese nombre'), "No se validan nombres duplicados.");

assert(
  routes.includes("runContentUpdate('payment_method')") &&
    routes.includes("runContentUpdate('product_category')") &&
    routes.includes("runContentUpdate('product_family')"),
  "Express no usa el servicio auditado para los tres tipos."
);
assert(
  !routes.includes("UPDATE payment_methods SET name = ?, tipo = ?") &&
    !routes.includes("UPDATE product_categories SET name = ?, description = ?") &&
    !routes.includes("UPDATE product_families SET name = ?, category_id = ?"),
  "Express conserva actualizaciones directas sin trazabilidad."
);
assert(
  api.includes("configurationItemContentLifecycleService.update"),
  "Vercel no usa el servicio de edición auditada."
);
assert(
  !api.includes("UPDATE payment_methods SET name = $1") &&
    !api.includes("UPDATE product_categories SET name = $1") &&
    !api.includes("UPDATE product_families SET name = $1"),
  "Vercel conserva actualizaciones directas."
);
assert(ui.includes("Motivo del cambio"), "La UI no solicita motivo.");
assert(ui.includes("expectedContentVersion"), "La UI no envía la versión esperada.");
assert(ui.includes("contentChangeReason"), "La UI no administra el motivo.");
assert(database.includes("configuration_item_content_history"), "SQLite no crea el historial.");
assert(configApi.includes('"configuration_item_content_history"'), "Backup y restauración no incluyen el nuevo historial.");
assert(helpers.includes("content_changed_at"), "Los endpoints GET no devuelven la metadata.");
assert(
  packageJson.scripts?.["check:configuration-item-content-lifecycle"],
  "Falta el script de auditoría en package.json."
);

type MockOptions = {
  row: any;
  duplicate?: boolean;
  category?: any;
  failUpdate?: boolean;
};

const createExecutor = (options: MockOptions) => {
  let row = { ...options.row };
  const history: any[] = [];
  const queries: string[] = [];

  return {
    queries,
    history,
    get row() {
      return row;
    },
    async query(text: string, params: any[] = []) {
      const sql = text.replace(/\s+/g, " ").trim();
      queries.push(sql);

      if (sql.startsWith("SELECT * FROM payment_methods") ||
          sql.startsWith("SELECT * FROM product_categories") ||
          sql.startsWith("SELECT * FROM product_families")) {
        return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
      }

      if (sql.startsWith("SELECT id, estado FROM product_categories")) {
        const category = options.category;
        return { rows: category ? [{ ...category }] : [], rowCount: category ? 1 : 0 };
      }

      if (sql.startsWith("SELECT id FROM payment_methods") ||
          sql.startsWith("SELECT id FROM product_categories") ||
          sql.startsWith("SELECT id FROM product_families")) {
        return options.duplicate
          ? { rows: [{ id: 999 }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }

      if (sql.startsWith("INSERT INTO configuration_item_content_history")) {
        const item = {
          id: history.length + 1,
          changed_at: "2026-07-31T12:00:00.000Z",
          params,
        };
        history.push(item);
        return { rows: [item], rowCount: 1 };
      }

      if (sql.startsWith("UPDATE payment_methods")) {
        if (options.failUpdate) return { rows: [], rowCount: 0 };
        row = {
          ...row,
          name: params[0],
          tipo: params[1],
          content_version: params[2],
          content_changed_at: params[3],
          content_changed_by: params[4],
          content_change_reason: params[5],
        };
        return { rows: [{ ...row }], rowCount: 1 };
      }

      if (sql.startsWith("UPDATE product_categories")) {
        if (options.failUpdate) return { rows: [], rowCount: 0 };
        row = {
          ...row,
          name: params[0],
          description: params[1],
          content_version: params[2],
          content_changed_at: params[3],
          content_changed_by: params[4],
          content_change_reason: params[5],
        };
        return { rows: [{ ...row }], rowCount: 1 };
      }

      if (sql.startsWith("UPDATE product_families")) {
        if (options.failUpdate) return { rows: [], rowCount: 0 };
        row = {
          ...row,
          name: params[0],
          category_id: params[1],
          content_version: params[2],
          content_changed_at: params[3],
          content_changed_by: params[4],
          content_change_reason: params[5],
        };
        return { rows: [{ ...row }], rowCount: 1 };
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

const payment = createExecutor({
  row: { id: 1, name: "Tarjeta", tipo: "Digital", activo: 1, content_version: 0 },
});
const paymentResult = await configurationItemContentLifecycleService.update(
  {
    itemType: "payment_method",
    itemId: 1,
    name: "Tarjeta bancaria",
    tipo: "Crédito",
    motivo: "Ajuste comercial",
    usuario: "Administrador",
    expectedContentVersion: 0,
  },
  payment
);
assert(paymentResult.version === 1, "La versión no aumentó.");
assert(payment.history.length === 1, "No se registró el historial.");
assert(payment.row.name === "Tarjeta bancaria", "No se actualizó la forma de pago.");

await expectFailure(
  () => configurationItemContentLifecycleService.update(
    {
      itemType: "payment_method",
      itemId: 1,
      name: "Otro nombre",
      tipo: "Crédito",
      motivo: "Pestaña antigua",
      usuario: "Administrador",
      expectedContentVersion: 0,
    },
    payment
  ),
  "cambió mientras estaba abierta"
);

const protectedPayment = createExecutor({
  row: { id: 2, name: "Cta Cte", tipo: "Crédito", activo: 1, content_version: 0 },
});
await expectFailure(
  () => configurationItemContentLifecycleService.update(
    {
      itemType: "payment_method",
      itemId: 2,
      name: "Cuenta",
      tipo: "Crédito",
      motivo: "Intento de renombre",
      usuario: "Administrador",
      expectedContentVersion: 0,
    },
    protectedPayment
  ),
  "no puede cambiar de nombre"
);

const inactiveCategory = createExecutor({
  row: { id: 3, name: "Bebidas", description: null, estado: "inactivo", content_version: 0 },
});
await expectFailure(
  () => configurationItemContentLifecycleService.update(
    {
      itemType: "product_category",
      itemId: 3,
      name: "Bebidas nuevas",
      description: "",
      motivo: "Cambio no permitido",
      usuario: "Administrador",
      expectedContentVersion: 0,
    },
    inactiveCategory
  ),
  "Reactivalo antes de editarlo"
);

const family = createExecutor({
  row: { id: 4, name: "Gaseosas", category_id: 5, estado: "activo", content_version: 0 },
  category: { id: 6, estado: "inactivo" },
});
await expectFailure(
  () => configurationItemContentLifecycleService.update(
    {
      itemType: "product_family",
      itemId: 4,
      name: "Gaseosas",
      categoryId: 6,
      motivo: "Cambio de categoría",
      usuario: "Administrador",
      expectedContentVersion: 0,
    },
    family
  ),
  "categoría seleccionada está inactiva"
);

const unchanged = createExecutor({
  row: { id: 5, name: "Alimentos", description: "General", estado: "activo", content_version: 0 },
});
await expectFailure(
  () => configurationItemContentLifecycleService.update(
    {
      itemType: "product_category",
      itemId: 5,
      name: "Alimentos",
      description: "General",
      motivo: "Sin cambios",
      usuario: "Administrador",
      expectedContentVersion: 0,
    },
    unchanged
  ),
  "No se detectaron cambios"
);

console.log(
  "Edición auditada de configuraciones correcta: formas de pago, categorías, familias, motivo, snapshots, versiones, concurrencia y bloqueos verificados."
);
