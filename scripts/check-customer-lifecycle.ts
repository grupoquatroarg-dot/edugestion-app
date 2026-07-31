import fs from "node:fs";
import path from "node:path";
import { customerLifecycleService } from "../server/services/customerLifecycleService.js";

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

class FakeClient {
  customer: any;
  pendingSale: any;
  activeOrder: any;
  activeRoute: any;
  activeCheque: any;
  history: any[] = [];
  commands: string[] = [];

  constructor(options: any = {}) {
    this.customer = options.customer || {
      id: 25,
      nombre_apellido: "Cliente de prueba",
      saldo_cta_cte: 0,
      activo: 1,
      portal_enabled: 1,
    };
    this.pendingSale = options.pendingSale || null;
    this.activeOrder = options.activeOrder || null;
    this.activeRoute = options.activeRoute || null;
    this.activeCheque = options.activeCheque || null;
  }

  async query(text: string, params: any[] = []) {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(normalized)) {
      this.commands.push(normalized);
      return { rows: [], rowCount: null };
    }
    if (normalized.startsWith("SELECT * FROM clientes")) {
      return this.customer && Number(this.customer.id) === Number(params[0])
        ? { rows: [{ ...this.customer }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (normalized.includes("FROM sales") && normalized.includes("monto_pendiente")) {
      return this.pendingSale ? { rows: [this.pendingSale], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (normalized.includes("FROM customer_orders")) {
      return this.activeOrder ? { rows: [this.activeOrder], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (normalized.includes("FROM route_items ri")) {
      return this.activeRoute ? { rows: [this.activeRoute], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (normalized.includes("FROM cheques")) {
      return this.activeCheque ? { rows: [this.activeCheque], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (normalized.startsWith("INSERT INTO customer_status_history")) {
      const entry = { id: this.history.length + 1, performed_at: "2026-07-15T15:00:00.000Z" };
      this.history.push({ ...entry, action: params[1], reason: params[2] });
      return { rows: [entry], rowCount: 1 };
    }
    if (normalized.startsWith("UPDATE clientes SET activo = 0")) {
      this.customer = {
        ...this.customer,
        activo: 0,
        portal_enabled: 0,
        deactivated_at: params[0],
        deactivated_by: params[1],
        deactivation_reason: params[2],
      };
      return { rows: [{ ...this.customer }], rowCount: 1 };
    }
    if (normalized.startsWith("UPDATE clientes SET activo = 1")) {
      this.customer = {
        ...this.customer,
        activo: 1,
        deactivated_at: null,
        deactivated_by: null,
        deactivation_reason: null,
      };
      return { rows: [{ ...this.customer }], rowCount: 1 };
    }
    throw new Error(`Consulta no simulada: ${normalized}`);
  }
}

const expectFailure = async (fn: () => Promise<any>, includes: string) => {
  try {
    await fn();
    throw new Error(`Se esperaba un bloqueo que contuviera: ${includes}`);
  } catch (error: any) {
    assert(String(error?.message || error).toLowerCase().includes(includes.toLowerCase()), `Mensaje inesperado: ${error?.message || error}`);
  }
};

const runServiceSimulation = async () => {
  const success = new FakeClient();
  const deactivated = await customerLifecycleService.changeStatus(
    { customerId: 25, action: "deactivate", motivo: "Dejó de operar", usuario: "Auditor" },
    success as any
  );
  assert(deactivated.customer.activo === 0, "La baja no desactivó al cliente.");
  assert(deactivated.customer.portal_enabled === 0, "La baja no deshabilitó el portal.");
  assert(success.history.length === 1, "No se registró historial de baja.");

  const reactivate = new FakeClient({ customer: { ...success.customer, activo: 0 } });
  const reactivated = await customerLifecycleService.changeStatus(
    { customerId: 25, action: "reactivate", motivo: "Vuelve a operar", usuario: "Auditor" },
    reactivate as any
  );
  assert(reactivated.customer.activo === 1, "La reactivación no activó al cliente.");
  assert(reactivated.customer.portal_enabled === 0, "La reactivación no debe habilitar el portal automáticamente.");

  await expectFailure(
    () => customerLifecycleService.changeStatus(
      { customerId: 1, action: "deactivate", motivo: "Prueba", usuario: "Auditor" },
      new FakeClient({ customer: { id: 1, activo: 1, saldo_cta_cte: 0 } }) as any
    ),
    "Consumidor Final"
  );
  await expectFailure(
    () => customerLifecycleService.changeStatus(
      { customerId: 25, action: "deactivate", motivo: "Prueba", usuario: "Auditor" },
      new FakeClient({ customer: { id: 25, activo: 1, saldo_cta_cte: 100 } }) as any
    ),
    "saldo"
  );
  await expectFailure(
    () => customerLifecycleService.changeStatus(
      { customerId: 25, action: "deactivate", motivo: "Prueba", usuario: "Auditor" },
      new FakeClient({ activeOrder: { id: 5, numero_pedido: 88 } }) as any
    ),
    "pedido"
  );
  await expectFailure(
    () => customerLifecycleService.changeStatus(
      { customerId: 25, action: "deactivate", motivo: "Prueba", usuario: "Auditor" },
      new FakeClient({ activeRoute: { id: 7, name: "Ruta Centro" } }) as any
    ),
    "ruta"
  );
  await expectFailure(
    () => customerLifecycleService.changeStatus(
      { customerId: 25, action: "deactivate", motivo: "Prueba", usuario: "Auditor" },
      new FakeClient({ activeCheque: { id: 9, numero_cheque: "CH-9" } }) as any
    ),
    "cheque"
  );
  await expectFailure(
    () => customerLifecycleService.changeStatus(
      { customerId: 25, action: "deactivate", motivo: "Prueba", usuario: "Auditor" },
      new FakeClient({ customer: { id: 25, activo: 0, saldo_cta_cte: 0 } }) as any
    ),
    "ya está dado de baja"
  );
};

const runStaticAudit = () => {
  const migration = read("supabase/10_customer_lifecycle.sql");
  ["customer_status_history", "deactivated_at", "deactivated_by", "deactivation_reason"].forEach((token) =>
    assert(migration.includes(token), `Falta ${token} en la migración.`)
  );

  const api = read("api/clientes.ts");
  assert(api.includes("customerLifecycleService.changeStatus"), "La API Vercel no usa el servicio de ciclo de vida.");
  assert(api.includes("isCustomerLifecycleAction"), "Faltan acciones deactivate/reactivate.");
  assert(api.includes("active_only"), "La API no permite solicitar clientes activos.");
  assert(api.includes("La eliminación física de clientes está deshabilitada"), "DELETE físico no está bloqueado.");
  assert(api.includes("El acceso al portal de este cliente está deshabilitado"), "El portal no bloquea clientes inactivos.");
  const contentService = read("server/services/customerContentLifecycleService.ts");
  assert(
    contentService.includes("El cliente está inactivo. Reactivalo antes de editarlo"),
    "Editar no protege los datos ni el portal de clientes inactivos."
  );
  assert(api.includes("La ruta contiene uno o más clientes inactivos"), "Las rutas no validan clientes activos.");

  const expressRoutes = read("server/routes/clientRoutes.ts");
  assert(expressRoutes.includes("/:id/deactivate"), "Falta ruta Express de baja.");
  assert(expressRoutes.includes("/:id/reactivate"), "Falta ruta Express de reactivación.");
  assert(expressRoutes.includes("La eliminación física de clientes está deshabilitada"), "Express no bloquea DELETE.");

  const repository = read("server/repositories/clientRepository.ts");
  assert(repository.includes("activeOnly"), "El repositorio no soporta filtro de activos.");
  assert(!repository.includes("DELETE FROM clientes"), "El repositorio todavía elimina clientes físicamente.");

  const ui = read("src/components/CustomerModule.tsx");
  assert(ui.includes("Dar de baja cliente"), "Falta modal de baja de cliente.");
  assert(ui.includes("Reactivar cliente"), "Falta modal de reactivación.");
  assert(!ui.includes("method: 'DELETE'"), "La interfaz todavía intenta DELETE de clientes.");

  assert(read("src/components/SalesModule.tsx").includes("/api/clientes?active_only=true"), "Ventas no limita a clientes activos.");
  assert(read("src/components/RouteModule.tsx").includes("/api/clientes?active_only=true"), "Rutas no limita a clientes activos.");
  assert(read("server/services/salesService.ts").includes("El cliente está inactivo"), "La venta directa no bloquea clientes inactivos.");
};

await runServiceSimulation();
runStaticAudit();
console.log("Auditoría de ciclo de vida de clientes correcta.");
