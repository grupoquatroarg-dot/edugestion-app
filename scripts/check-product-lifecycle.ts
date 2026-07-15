import fs from "node:fs";
import path from "node:path";
import { productLifecycleService } from "../server/services/productLifecycleService.js";

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

class FakeClient {
  product: any;
  supplierOrder: any;
  customerOrder: any;
  history: any[] = [];

  constructor(options: { product?: any; supplierOrder?: any; customerOrder?: any } = {}) {
    this.product = options.product || {
      id: 10,
      code: "P-10",
      codigo_unico: "Edu-P-10",
      name: "Producto de prueba",
      stock: 7,
      estado: "activo",
      active: 1,
      eliminado: 0,
    };
    this.supplierOrder = options.supplierOrder || null;
    this.customerOrder = options.customerOrder || null;
  }

  async query(text: string, params: any[] = []) {
    const normalized = text.replace(/\s+/g, " ").trim();

    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(normalized)) {
      return { rows: [], rowCount: null };
    }

    if (normalized.startsWith("SELECT * FROM products")) {
      return this.product && Number(this.product.id) === Number(params[0])
        ? { rows: [{ ...this.product }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }

    if (normalized.includes("FROM supplier_order_items soi")) {
      return this.supplierOrder
        ? { rows: [{ ...this.supplierOrder }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }

    if (normalized.includes("FROM customer_order_items coi")) {
      return this.customerOrder
        ? { rows: [{ ...this.customerOrder }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }

    if (normalized.startsWith("INSERT INTO product_status_history")) {
      const entry = {
        id: this.history.length + 1,
        product_id: params[0],
        action: params[1],
        reason: params[2],
        performed_by: params[3],
        previous_status: params[4],
        new_status: params[5],
        performed_at: "2026-07-15T12:00:00.000Z",
      };
      this.history.push(entry);
      return { rows: [entry], rowCount: 1 };
    }

    if (normalized.startsWith("UPDATE products SET estado = 'inactivo'")) {
      this.product = {
        ...this.product,
        estado: "inactivo",
        active: 0,
        eliminado: 0,
        deactivated_at: params[0],
        deactivated_by: params[1],
        deactivation_reason: params[2],
      };
      return { rows: [{ ...this.product }], rowCount: 1 };
    }

    if (normalized.startsWith("UPDATE products SET estado = 'activo'")) {
      this.product = {
        ...this.product,
        estado: "activo",
        active: 1,
        eliminado: 0,
        deactivated_at: null,
        deactivated_by: null,
        deactivation_reason: null,
      };
      return { rows: [{ ...this.product }], rowCount: 1 };
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
  const successClient = new FakeClient();
  const deactivated = await productLifecycleService.changeStatus(
    {
      productId: 10,
      action: "deactivate",
      motivo: "Producto discontinuado",
      usuario: "Auditor local",
    },
    successClient as any
  );

  assert(deactivated.product.estado === "inactivo", "La baja no dejó el producto inactivo.");
  assert(deactivated.product.active === 0, "La baja no sincronizó active = 0.");
  assert(deactivated.product.eliminado === 0, "La baja no debe marcar eliminado = 1.");
  assert(successClient.history.length === 1, "No se registró el historial de baja.");

  const reactivateClient = new FakeClient({
    product: {
      ...successClient.product,
      estado: "inactivo",
      active: 0,
      deactivated_at: "2026-07-15T12:00:00.000Z",
      deactivated_by: "Auditor local",
      deactivation_reason: "Producto discontinuado",
    },
  });
  const reactivated = await productLifecycleService.changeStatus(
    {
      productId: 10,
      action: "reactivate",
      motivo: "Vuelve a comercializarse",
      usuario: "Auditor local",
    },
    reactivateClient as any
  );

  assert(reactivated.product.estado === "activo", "La reactivación no dejó el producto activo.");
  assert(reactivated.product.active === 1, "La reactivación no sincronizó active = 1.");
  assert(reactivated.product.deactivation_reason === null, "La reactivación no limpió el motivo vigente.");

  const supplierBlocked = new FakeClient({ supplierOrder: { id: 5, numero_pedido: 125 } });
  await expectFailure(
    () => productLifecycleService.changeStatus(
      { productId: 10, action: "deactivate", motivo: "Prueba bloqueo", usuario: "Auditor" },
      supplierBlocked as any
    ),
    "pedido a proveedor"
  );
  assert(supplierBlocked.history.length === 0, "El bloqueo por pedido a proveedor creó historial parcial.");

  const customerBlocked = new FakeClient({ customerOrder: { id: 6, numero_pedido: 220 } });
  await expectFailure(
    () => productLifecycleService.changeStatus(
      { productId: 10, action: "deactivate", motivo: "Prueba bloqueo", usuario: "Auditor" },
      customerBlocked as any
    ),
    "pedido de cliente"
  );
  assert(customerBlocked.history.length === 0, "El bloqueo por pedido de cliente creó historial parcial.");

  const duplicateClient = new FakeClient({
    product: { id: 10, estado: "inactivo", active: 0, eliminado: 0 },
  });
  await expectFailure(
    () => productLifecycleService.changeStatus(
      { productId: 10, action: "deactivate", motivo: "Segunda baja", usuario: "Auditor" },
      duplicateClient as any
    ),
    "ya está dado de baja"
  );
};

const runStaticAudit = () => {
  const migration = read("supabase/09_product_lifecycle.sql");
  ["product_status_history", "deactivated_at", "deactivated_by", "deactivation_reason"].forEach(
    (token) => assert(migration.includes(token), `Falta ${token} en la migración.`)
  );

  const vercelApi = read("api/products/[id].ts");
  assert(vercelApi.includes('"deactivate"'), "Falta la acción deactivate en Vercel.");
  assert(vercelApi.includes('"reactivate"'), "Falta la acción reactivate en Vercel.");
  assert(vercelApi.includes('requireProductPermission(req, res, "delete")'), "Falta permiso products/delete.");
  assert(vercelApi.includes("La eliminación física de productos está deshabilitada"), "DELETE físico no quedó bloqueado.");
  assert(!vercelApi.includes("ProductRepository.softDelete"), "La API todavía llama a softDelete.");

  const expressRoutes = read("server/routes/productRoutes.ts");
  assert(expressRoutes.includes('"/:id/deactivate"'), "Falta ruta Express de baja.");
  assert(expressRoutes.includes('"/:id/reactivate"'), "Falta ruta Express de reactivación.");
  assert(expressRoutes.includes("La eliminación física de productos está deshabilitada"), "Express no bloquea DELETE.");

  const repository = read("server/repositories/productRepository.ts");
  const updateSection = repository.slice(repository.indexOf("update(id:"), repository.indexOf("softDelete(id:"));
  assert(!/SET[\s\S]*\bstock\s*=/.test(updateSection), "Editar producto todavía puede modificar stock sin movimiento.");
  assert(repository.includes("activeOnly"), "El repositorio no soporta filtro de productos activos.");

  const inventory = read("server/services/vercel/productInventoryApiHelpers.ts");
  assert(inventory.includes("El producto está inactivo"), "Inventario no bloquea productos inactivos.");

  const productUi = read("src/components/ProductModule.tsx");
  assert(productUi.includes("Dar de baja producto"), "Falta modal de baja.");
  assert(productUi.includes("Reactivar producto"), "Falta modal de reactivación.");
  assert(productUi.includes("Registrar merma"), "La merma sigue confundida con la baja del producto.");
  assert(!productUi.includes("Fallback imprescindible si el delete falla"), "Permanece el fallback inseguro de eliminación.");
  assert(!productUi.includes("method: 'DELETE'"), "La interfaz todavía intenta DELETE de productos.");

  for (const file of [
    "src/components/SalesModule.tsx",
    "src/components/PurchaseInvoiceModule.tsx",
    "src/components/SupplierOrders.tsx",
    "src/components/RouteModule.tsx",
  ]) {
    assert(read(file).includes("active_only=true"), `${file} no limita la selección a productos activos.`);
  }

  for (const file of [
    "api/dashboard/[endpoint].ts",
    "server/services/vercel/dashboardApiHelpers.ts",
    "server/routes/dashboardRoutes.ts",
    "server/routes/reportRoutes.ts",
  ]) {
    assert(read(file).includes("estado = 'activo'"), `${file} no excluye inactivos de alertas de stock.`);
  }
};

await runServiceSimulation();
runStaticAudit();
console.log("Auditoría de ciclo de vida de productos correcta.");
