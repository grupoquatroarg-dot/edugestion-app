import fs from "node:fs";
import path from "node:path";
import { providerLifecycleService } from "../server/services/providerLifecycleService.js";

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

class FakeClient {
  provider: any;
  pendingInvoice: any;
  activeCheque: any;
  history: any[] = [];
  commands: string[] = [];

  constructor(options: any = {}) {
    this.provider = options.provider || {
      id: 31,
      nombre: "Proveedor de prueba",
      estado: "activo",
      deactivated_at: null,
      deactivated_by: null,
      deactivation_reason: null,
    };
    this.pendingInvoice = options.pendingInvoice || null;
    this.activeCheque = options.activeCheque || null;
  }

  async query(text: string, params: any[] = []) {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(normalized)) {
      this.commands.push(normalized);
      return { rows: [], rowCount: null };
    }
    if (normalized.startsWith("SELECT * FROM proveedores")) {
      return this.provider && Number(this.provider.id) === Number(params[0])
        ? { rows: [{ ...this.provider }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (normalized.includes("FROM purchase_invoices")) {
      return this.pendingInvoice ? { rows: [this.pendingInvoice], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (normalized.includes("FROM cheques")) {
      return this.activeCheque ? { rows: [this.activeCheque], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (normalized.startsWith("INSERT INTO provider_status_history")) {
      const entry = { id: this.history.length + 1, performed_at: "2026-07-15T15:00:00.000Z" };
      this.history.push({ ...entry, action: params[1], reason: params[2] });
      return { rows: [entry], rowCount: 1 };
    }
    if (normalized.startsWith("UPDATE proveedores SET estado = 'inactivo'")) {
      this.provider = {
        ...this.provider,
        estado: "inactivo",
        deactivated_at: params[0],
        deactivated_by: params[1],
        deactivation_reason: params[2],
      };
      return { rows: [{ ...this.provider }], rowCount: 1 };
    }
    if (normalized.startsWith("UPDATE proveedores SET estado = 'activo'")) {
      this.provider = {
        ...this.provider,
        estado: "activo",
        deactivated_at: null,
        deactivated_by: null,
        deactivation_reason: null,
      };
      return { rows: [{ ...this.provider }], rowCount: 1 };
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
      `Mensaje inesperado: ${error?.message || error}`
    );
  }
};

const runServiceSimulation = async () => {
  const success = new FakeClient();
  const deactivated = await providerLifecycleService.changeStatus(
    { providerId: 31, action: "deactivate", motivo: "Dejó de operar", usuario: "Auditor" },
    success as any
  );
  assert(deactivated.provider.estado === "inactivo", "La baja no desactivó al proveedor.");
  assert(success.history.length === 1, "No se registró historial de baja.");

  const reactivate = new FakeClient({ provider: { ...success.provider, estado: "inactivo" } });
  const reactivated = await providerLifecycleService.changeStatus(
    { providerId: 31, action: "reactivate", motivo: "Vuelve a operar", usuario: "Auditor" },
    reactivate as any
  );
  assert(reactivated.provider.estado === "activo", "La reactivación no activó al proveedor.");
  assert(reactivated.provider.deactivation_reason === null, "La reactivación no limpió los datos vigentes de baja.");

  await expectFailure(
    () => providerLifecycleService.changeStatus(
      { providerId: 31, action: "deactivate", motivo: "Prueba", usuario: "Auditor" },
      new FakeClient({ pendingInvoice: { id: 9, numero_factura: "A-9" } }) as any
    ),
    "factura"
  );
  await expectFailure(
    () => providerLifecycleService.changeStatus(
      { providerId: 31, action: "deactivate", motivo: "Prueba", usuario: "Auditor" },
      new FakeClient({ activeCheque: { id: 5, numero_cheque: "CH-5", estado: "entregado_proveedor" } }) as any
    ),
    "cheque"
  );
  await expectFailure(
    () => providerLifecycleService.changeStatus(
      { providerId: 31, action: "deactivate", motivo: "Prueba", usuario: "Auditor" },
      new FakeClient({ provider: { id: 31, estado: "inactivo" } }) as any
    ),
    "ya está dado de baja"
  );
  await expectFailure(
    () => providerLifecycleService.changeStatus(
      { providerId: 31, action: "reactivate", motivo: "Prueba", usuario: "Auditor" },
      new FakeClient({ provider: { id: 31, estado: "activo" } }) as any
    ),
    "ya está activo"
  );
};

const runStaticAudit = () => {
  const migration = read("supabase/11_provider_lifecycle.sql");
  ["provider_status_history", "deactivated_at", "deactivated_by", "deactivation_reason"].forEach((token) =>
    assert(migration.includes(token), `Falta ${token} en la migración.`)
  );

  const api = read("api/purchase-invoices/index.ts");
  assert(api.includes("providerLifecycleService.changeStatus"), "La API Vercel no usa el servicio de ciclo de vida.");
  assert(api.includes('endpoint === "provider-lifecycle"'), "Falta endpoint de ciclo de vida de proveedores.");
  assert(api.includes("active_only"), "La API no permite solicitar proveedores activos.");
  assert(api.includes("La eliminación física de proveedores está deshabilitada"), "DELETE físico no está bloqueado.");

  const expressRoutes = read("server/routes/providerRoutes.ts");
  assert(expressRoutes.includes("/:id/deactivate"), "Falta ruta Express de baja.");
  assert(expressRoutes.includes("/:id/reactivate"), "Falta ruta Express de reactivación.");
  assert(expressRoutes.includes("La eliminación física de proveedores está deshabilitada"), "Express no bloquea DELETE.");

  const repository = read("server/repositories/providerRepository.ts");
  assert(repository.includes("activeOnly"), "El repositorio no soporta filtro de activos.");
  assert(!repository.includes("DELETE FROM proveedores"), "El repositorio todavía elimina proveedores físicamente.");
  assert(!repository.includes("SET nombre = $1,\n           cuit = $2,\n           telefono = $3,\n           email = $4,\n           direccion = $5,\n           estado"), "La edición todavía cambia el estado directamente.");

  const purchaseService = read("server/services/purchaseInvoiceService.ts");
  assert(purchaseService.includes("El proveedor está inactivo"), "Las facturas nuevas no bloquean proveedores inactivos.");

  const financeApi = read("api/finanzas.ts");
  assert(financeApi.includes("findAll({ activeOnly: true })"), "Finanzas no limita proveedores activos.");
  const financeRoutes = read("server/routes/financeRoutes.ts");
  assert(financeRoutes.includes("findAll({ activeOnly: true })"), "Express Finanzas no limita proveedores activos.");

  const ui = read("src/components/PurchaseInvoiceModule.tsx");
  assert(ui.includes("Dar de baja proveedor"), "Falta modal de baja de proveedor.");
  assert(ui.includes("Reactivar proveedor"), "Falta modal de reactivación.");
  assert(ui.includes("activeProviders"), "La interfaz no separa proveedores activos.");
  assert(!ui.includes("method: 'DELETE'"), "La interfaz todavía intenta DELETE de proveedores.");
};

await runServiceSimulation();
runStaticAudit();
console.log("Auditoría de ciclo de vida de proveedores correcta.");
