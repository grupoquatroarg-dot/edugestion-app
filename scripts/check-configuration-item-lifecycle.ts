import fs from "node:fs";
import path from "node:path";
import { configurationItemLifecycleService } from "../server/services/configurationItemLifecycleService.js";
import { assertPaymentMethodActive, listActivePaymentMethods } from "../server/services/paymentMethodAvailabilityService.js";

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

type FakeOptions = {
  itemType?: "payment_method" | "product_category" | "product_family";
  item?: any;
  otherActivePaymentMethods?: number;
  activeFamily?: any;
  activeProduct?: any;
  category?: any;
};

class FakeClient {
  itemType: "payment_method" | "product_category" | "product_family";
  item: any;
  otherActivePaymentMethods: number;
  activeFamily: any;
  activeProduct: any;
  category: any;
  history: any[] = [];

  constructor(options: FakeOptions = {}) {
    this.itemType = options.itemType || "payment_method";
    this.item = options.item || (
      this.itemType === "payment_method"
        ? { id: 7, name: "Transferencia", tipo: "Transferencia", activo: 1 }
        : this.itemType === "product_category"
          ? { id: 7, name: "Categoría de prueba", description: "", estado: "activo" }
          : { id: 7, name: "Familia de prueba", category_id: 3, estado: "activo" }
    );
    this.otherActivePaymentMethods = options.otherActivePaymentMethods ?? 2;
    this.activeFamily = options.activeFamily || null;
    this.activeProduct = options.activeProduct || null;
    this.category = options.category ?? { id: 3, name: "Categoría principal", estado: "activo" };
  }

  async query(text: string, params: any[] = []) {
    const normalized = text.replace(/\s+/g, " ").trim();

    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(normalized)) {
      return { rows: [], rowCount: null };
    }

    if (normalized.startsWith("SELECT * FROM payment_methods")) {
      return this.itemType === "payment_method" && Number(this.item?.id) === Number(params[0])
        ? { rows: [{ ...this.item }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }

    if (normalized.startsWith("SELECT * FROM product_categories")) {
      return this.itemType === "product_category" && Number(this.item?.id) === Number(params[0])
        ? { rows: [{ ...this.item }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }

    if (normalized.startsWith("SELECT * FROM product_families")) {
      return this.itemType === "product_family" && Number(this.item?.id) === Number(params[0])
        ? { rows: [{ ...this.item }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }

    if (normalized.startsWith("SELECT COUNT(*)::int AS total FROM payment_methods")) {
      return { rows: [{ total: this.otherActivePaymentMethods }], rowCount: 1 };
    }

    if (normalized.startsWith("SELECT id, estado FROM product_categories")) {
      return this.category && Number(this.category.id) === Number(params[0])
        ? { rows: [{ ...this.category }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }

    if (normalized.includes("FROM product_families WHERE category_id")) {
      return this.activeFamily ? { rows: [{ ...this.activeFamily }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }

    if (normalized.includes("FROM products WHERE category_id")) {
      return this.activeProduct ? { rows: [{ ...this.activeProduct }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }

    if (normalized.includes("FROM products WHERE family_id")) {
      return this.activeProduct ? { rows: [{ ...this.activeProduct }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }

    if (normalized.startsWith("INSERT INTO configuration_item_status_history")) {
      const entry = {
        id: this.history.length + 1,
        performed_at: "2026-07-16T15:00:00.000Z",
      };
      this.history.push({
        ...entry,
        item_type: params[0],
        item_id: params[1],
        action: params[2],
        reason: params[3],
      });
      return { rows: [entry], rowCount: 1 };
    }

    if (normalized.startsWith("UPDATE payment_methods SET activo = 0")) {
      this.item = {
        ...this.item,
        activo: 0,
        deactivated_at: params[0],
        deactivated_by: params[1],
        deactivation_reason: params[2],
      };
      return { rows: [{ ...this.item }], rowCount: 1 };
    }

    if (normalized.startsWith("UPDATE payment_methods SET activo = 1")) {
      this.item = {
        ...this.item,
        activo: 1,
        deactivated_at: null,
        deactivated_by: null,
        deactivation_reason: null,
      };
      return { rows: [{ ...this.item }], rowCount: 1 };
    }

    if (normalized.startsWith("UPDATE product_categories SET estado = 'inactivo'")) {
      this.item = {
        ...this.item,
        estado: "inactivo",
        deactivated_at: params[0],
        deactivated_by: params[1],
        deactivation_reason: params[2],
      };
      return { rows: [{ ...this.item }], rowCount: 1 };
    }

    if (normalized.startsWith("UPDATE product_categories SET estado = 'activo'")) {
      this.item = {
        ...this.item,
        estado: "activo",
        deactivated_at: null,
        deactivated_by: null,
        deactivation_reason: null,
      };
      return { rows: [{ ...this.item }], rowCount: 1 };
    }

    if (normalized.startsWith("UPDATE product_families SET estado = 'inactivo'")) {
      this.item = {
        ...this.item,
        estado: "inactivo",
        deactivated_at: params[0],
        deactivated_by: params[1],
        deactivation_reason: params[2],
      };
      return { rows: [{ ...this.item }], rowCount: 1 };
    }

    if (normalized.startsWith("UPDATE product_families SET estado = 'activo'")) {
      this.item = {
        ...this.item,
        estado: "activo",
        deactivated_at: null,
        deactivated_by: null,
        deactivation_reason: null,
      };
      return { rows: [{ ...this.item }], rowCount: 1 };
    }

    if (normalized.startsWith("SELECT id, name, tipo FROM payment_methods WHERE COALESCE(activo, 1) = 1")) {
      const rows = this.itemType === "payment_method" && Number(this.item.activo ?? 1) === 1
        ? [{ id: this.item.id, name: this.item.name, tipo: this.item.tipo || "Efectivo" }]
        : [];
      return { rows, rowCount: rows.length };
    }

    if (normalized.startsWith("SELECT id, name FROM payment_methods WHERE LOWER(name)")) {
      const active = this.itemType === "payment_method" && Number(this.item.activo ?? 1) === 1;
      const matches = String(this.item.name || "").toLowerCase() === String(params[0] || "").toLowerCase();
      return active && matches
        ? { rows: [{ id: this.item.id, name: this.item.name }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }

    throw new Error(`Consulta no simulada: ${normalized}`);
  }
}

const expectFailure = async (fn: () => Promise<any>, includes: string) => {
  try {
    await fn();
    throw new Error(`Se esperaba un bloqueo que contuviera: ${includes}`);
  } catch (error: any) {
    assert(
      String(error?.message || error).toLowerCase().includes(includes.toLowerCase()),
      `Mensaje inesperado: ${error?.message || String(error)}`
    );
  }
};

const runServiceSimulation = async () => {
  const payment = new FakeClient();
  const paymentDown = await configurationItemLifecycleService.changeStatus(
    { itemType: "payment_method", itemId: 7, action: "deactivate", motivo: "Ya no se utiliza", usuario: "Auditor" },
    payment as any
  );
  assert(Number(paymentDown.item.activo) === 0, "La baja no desactivó la forma de pago.");
  assert(payment.history.length === 1, "No se registró el historial de la forma de pago.");

  const paymentUpClient = new FakeClient({ item: { ...payment.item, activo: 0 } });
  const paymentUp = await configurationItemLifecycleService.changeStatus(
    { itemType: "payment_method", itemId: 7, action: "reactivate", motivo: "Vuelve a utilizarse", usuario: "Auditor" },
    paymentUpClient as any
  );
  assert(Number(paymentUp.item.activo) === 1, "La reactivación no activó la forma de pago.");

  const category = new FakeClient({ itemType: "product_category" });
  const categoryDown = await configurationItemLifecycleService.changeStatus(
    { itemType: "product_category", itemId: 7, action: "deactivate", motivo: "Categoría discontinuada", usuario: "Auditor" },
    category as any
  );
  assert(categoryDown.item.estado === "inactivo", "La baja no desactivó la categoría.");

  const family = new FakeClient({ itemType: "product_family" });
  const familyDown = await configurationItemLifecycleService.changeStatus(
    { itemType: "product_family", itemId: 7, action: "deactivate", motivo: "Familia discontinuada", usuario: "Auditor" },
    family as any
  );
  assert(familyDown.item.estado === "inactivo", "La baja no desactivó la familia.");

  await expectFailure(
    () => configurationItemLifecycleService.changeStatus(
      { itemType: "payment_method", itemId: 7, action: "deactivate", motivo: "Prueba", usuario: "Auditor" },
      new FakeClient({ item: { id: 7, name: "Cta Cte", tipo: "Cuenta corriente", activo: 1 } }) as any
    ),
    "requerida por el sistema"
  );

  await expectFailure(
    () => configurationItemLifecycleService.changeStatus(
      { itemType: "payment_method", itemId: 7, action: "deactivate", motivo: "Prueba", usuario: "Auditor" },
      new FakeClient({ otherActivePaymentMethods: 0 }) as any
    ),
    "al menos una"
  );

  await expectFailure(
    () => configurationItemLifecycleService.changeStatus(
      { itemType: "product_category", itemId: 7, action: "deactivate", motivo: "Prueba", usuario: "Auditor" },
      new FakeClient({ itemType: "product_category", activeFamily: { id: 2, name: "Familia activa" } }) as any
    ),
    "familia activa"
  );

  await expectFailure(
    () => configurationItemLifecycleService.changeStatus(
      { itemType: "product_category", itemId: 7, action: "deactivate", motivo: "Prueba", usuario: "Auditor" },
      new FakeClient({ itemType: "product_category", activeProduct: { id: 2, name: "Producto activo" } }) as any
    ),
    "producto activo"
  );

  await expectFailure(
    () => configurationItemLifecycleService.changeStatus(
      { itemType: "product_family", itemId: 7, action: "deactivate", motivo: "Prueba", usuario: "Auditor" },
      new FakeClient({ itemType: "product_family", activeProduct: { id: 2, name: "Producto activo" } }) as any
    ),
    "producto activo"
  );

  await expectFailure(
    () => configurationItemLifecycleService.changeStatus(
      { itemType: "product_family", itemId: 7, action: "reactivate", motivo: "Prueba", usuario: "Auditor" },
      new FakeClient({
        itemType: "product_family",
        item: { id: 7, name: "Familia", category_id: 3, estado: "inactivo" },
        category: { id: 3, estado: "inactivo" },
      }) as any
    ),
    "reactivarse la categoría"
  );

  await expectFailure(
    () => configurationItemLifecycleService.changeStatus(
      { itemType: "payment_method", itemId: 7, action: "deactivate", motivo: "Prueba", usuario: "Auditor" },
      new FakeClient({ item: { id: 7, name: "Transferencia", activo: 0 } }) as any
    ),
    "ya está inactiva"
  );

  const activeMethodClient = new FakeClient({ item: { id: 7, name: "Transferencia", tipo: "Transferencia", activo: 1 } });
  const listed = await listActivePaymentMethods(activeMethodClient as any);
  assert(listed.length === 1 && listed[0].name === "Transferencia", "No se listó la forma de pago activa.");
  await assertPaymentMethodActive("transferencia", activeMethodClient as any);
  await expectFailure(
    () => assertPaymentMethodActive("Transferencia", new FakeClient({ item: { id: 7, name: "Transferencia", activo: 0 } }) as any),
    "inactiva"
  );
};

const runStaticAudit = () => {
  const migration = read("supabase/12_configuration_items_lifecycle.sql");
  [
    "configuration_item_status_history",
    "deactivated_at",
    "deactivated_by",
    "deactivation_reason",
    "payment_method",
    "product_category",
    "product_family",
  ].forEach((token) => assert(migration.includes(token), `Falta ${token} en la migración.`));

  const vercelItemApi = read("api/config/[endpoint]/[id].ts");
  assert(vercelItemApi.includes("configurationItemLifecycleService.changeStatus"), "Vercel no usa el servicio de ciclo de vida.");
  assert(vercelItemApi.includes('requireSettingsPermission(req, res, "delete")'), "Falta permiso settings/delete.");
  assert(vercelItemApi.includes("La eliminación física de elementos de configuración está deshabilitada"), "Vercel no bloquea DELETE.");
  assert(vercelItemApi.includes("PROTECTED_PAYMENT_NAMES"), "No se protegen los nombres internos de formas de pago.");
  assert(!vercelItemApi.includes("DELETE FROM payment_methods"), "Vercel todavía elimina formas de pago.");
  assert(!vercelItemApi.includes("DELETE FROM product_categories"), "Vercel todavía elimina categorías.");
  assert(!vercelItemApi.includes("DELETE FROM product_families"), "Vercel todavía elimina familias.");

  const expressRoutes = read("server/routes/configRoutes.ts");
  assert(expressRoutes.includes("configurationItemLifecycleService.changeStatus"), "Express no usa el servicio de ciclo de vida.");
  assert(expressRoutes.includes("physicalDeleteDisabled"), "Express no bloquea DELETE físico.");
  assert(expressRoutes.includes("requirePermission('settings', 'delete')"), "Express no exige settings/delete.");

  const configApi = read("api/config/[endpoint].ts");
  assert(configApi.includes("configuration_item_status_history"), "Backup/restauración no incluye el historial nuevo.");
  assert(configApi.includes('req.query?.active === "true"'), "Configuración no permite filtrar elementos activos.");

  const ui = read("src/components/ConfigModule.tsx");
  assert(ui.includes("Dar de baja"), "Falta la acción Dar de baja en Configuración.");
  assert(ui.includes("Reactivar"), "Falta la acción Reactivar en Configuración.");
  assert(ui.includes("Motivo obligatorio"), "Falta el motivo obligatorio en el modal.");
  assert(!ui.includes("method: 'DELETE'"), "La interfaz todavía intenta eliminar físicamente.");
  assert(!ui.includes('estado: \'activo\''), "Los formularios todavía administran estado directamente.");

  const lifecycleService = read("server/services/configurationItemLifecycleService.ts");
  assert(lifecycleService.includes("Debe quedar al menos una forma de pago activa"), "No se protege la última forma de pago.");
  assert(lifecycleService.includes("Cta Cte es requerida por el sistema"), "No se protege Cta Cte.");
  assert(lifecycleService.includes("Primero debe reactivarse la categoría"), "No se protege la jerarquía familia/categoría.");
  assert(!lifecycleService.includes("DELETE FROM"), "El servicio de ciclo de vida contiene DELETE.");

  const productRepository = read("server/repositories/productRepository.ts");
  assert(productRepository.includes("assertActiveClassificationsSqlite"), "SQLite no valida clasificaciones activas.");
  assert(productRepository.includes("assertActiveClassificationsPostgres"), "PostgreSQL no valida clasificaciones activas.");

  const productUi = read("src/components/ProductModule.tsx");
  assert(productUi.includes("family.estado !== 'inactivo'"), "Productos no filtra familias inactivas.");

  const paymentAvailability = read("server/services/paymentMethodAvailabilityService.ts");
  assert(paymentAvailability.includes("listActivePaymentMethods"), "Falta listado de formas de pago activas.");
  assert(paymentAvailability.includes("assertPaymentMethodActive"), "Falta validación backend de forma de pago.");

  for (const file of [
    "server/services/salesService.ts",
    "server/services/purchaseInvoiceService.ts",
    "server/repositories/financeRepository.ts",
    "api/sales.ts",
  ]) {
    assert(read(file).includes("assertPaymentMethodActive"), `${file} no valida formas de pago activas.`);
  }

  const purchaseApi = read("api/purchase-invoices/index.ts");
  const financeApi = read("api/finanzas.ts");
  assert(purchaseApi.includes('endpoint === "payment-methods"'), "Facturas no expone formas de pago con permisos del módulo.");
  assert(financeApi.includes('endpoint === "payment-methods"'), "Finanzas no expone formas de pago con permisos del módulo.");

  const purchaseUi = read("src/components/PurchaseInvoiceModule.tsx");
  const financeUi = read("src/components/FinanceModule.tsx");
  assert(purchaseUi.includes("fetchPaymentMethods"), "Facturas no carga formas de pago activas.");
  assert(!purchaseUi.includes('<option value="efectivo">Efectivo</option>'), "Facturas conserva opciones fijas.");
  assert(financeUi.includes("fetchPaymentMethods"), "Finanzas no carga formas de pago activas.");
  assert(!financeUi.includes('<option value="efectivo">Efectivo</option>'), "Finanzas conserva opciones fijas.");
};

await runServiceSimulation();
runStaticAudit();
console.log("Auditoría de ciclo de vida de configuraciones comerciales correcta.");
