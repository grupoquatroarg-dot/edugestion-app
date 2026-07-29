import fs from "node:fs";
import path from "node:path";
import { routeLifecycleService } from "../server/services/routeLifecycleService.js";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

class FakeClient {
  route: any;
  items: any[];
  history: any[] = [];
  transactionLog: string[] = [];
  failUpdate = false;

  constructor(options: any = {}) {
    this.route = options.route || {
      id: 12,
      name: "Ruta centro",
      date: "2026-07-26",
      status: "en curso",
      cancelled_at: null,
      cancelled_by: null,
      cancel_reason: null,
      cancelled_from_status: null,
      reopened_at: null,
      reopened_by: null,
      reopen_reason: null,
    };
    this.items = options.items || [
      { id: 1, route_id: 12, client_id: 4, status: "visitado", visitado: 1, notes: "Venta registrada" },
      { id: 2, route_id: 12, client_id: 8, status: "pendiente", visitado: 0, notes: null },
    ];
    this.failUpdate = Boolean(options.failUpdate);
  }

  async query(text: string, params: any[] = []) {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(normalized)) {
      this.transactionLog.push(normalized);
      return { rows: [], rowCount: null };
    }
    if (normalized.startsWith("SELECT * FROM routes")) {
      return this.route && Number(this.route.id) === Number(params[0])
        ? { rows: [{ ...this.route }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (normalized.startsWith("SELECT * FROM route_items")) {
      return { rows: this.items.map(item => ({ ...item })), rowCount: this.items.length };
    }
    if (normalized.startsWith("INSERT INTO route_status_history")) {
      const entry = {
        id: this.history.length + 1,
        route_id: params[0],
        action: params[1],
        reason: params[2],
        performed_by: params[3],
        previous_status: params[4],
        new_status: params[5],
        snapshot: params[6],
        performed_at: "2026-07-26T18:00:00.000Z",
      };
      this.history.push(entry);
      return { rows: [entry], rowCount: 1 };
    }
    if (normalized.startsWith("UPDATE routes SET status = 'cancelada'")) {
      if (this.failUpdate) throw new Error("Falla simulada al actualizar");
      this.route = {
        ...this.route,
        status: "cancelada",
        cancelled_at: params[0],
        cancelled_by: params[1],
        cancel_reason: params[2],
        cancelled_from_status: params[3],
        reopened_at: null,
        reopened_by: null,
        reopen_reason: null,
      };
      return { rows: [{ ...this.route }], rowCount: 1 };
    }
    if (normalized.startsWith("UPDATE routes SET status = $1")) {
      if (this.failUpdate) throw new Error("Falla simulada al actualizar");
      this.route = {
        ...this.route,
        status: params[0],
        reopened_at: params[1],
        reopened_by: params[2],
        reopen_reason: params[3],
      };
      return { rows: [{ ...this.route }], rowCount: 1 };
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

const runSimulation = async () => {
  const client = new FakeClient();
  const cancelled = await routeLifecycleService.changeStatus(
    {
      routeId: 12,
      action: "cancel",
      motivo: "Se suspenden las visitas por mal clima",
      usuario: "Auditor local",
    },
    client as any
  );

  assert(cancelled.route.status === "cancelada", "La ruta no quedó cancelada.");
  assert(cancelled.route.cancelled_from_status === "en curso", "No preservó el estado anterior.");
  assert(client.history.length === 1, "No registró el historial de cancelación.");
  const snapshot = JSON.parse(client.history[0].snapshot);
  assert(snapshot.items.length === 2, "El snapshot no conservó los ítems.");
  assert(snapshot.items[0].status === "visitado", "El snapshot no conservó la actividad previa.");
  const reopened = await routeLifecycleService.changeStatus(
    {
      routeId: 12,
      action: "reopen",
      motivo: "Se retoman las visitas pendientes",
      usuario: "Auditor local",
    },
    client as any
  );
  assert(reopened.route.status === "en curso", "La reapertura no restauró el estado anterior.");
  assert(reopened.route.reopen_reason === "Se retoman las visitas pendientes", "No registró el motivo de reapertura.");
  assert(client.history.length === 2, "No registró ambos cambios de estado.");

  await expectFailure(
    () => routeLifecycleService.changeStatus(
      { routeId: 12, action: "cancel", motivo: "Intento inválido", usuario: "Auditor" },
      new FakeClient({ route: { ...client.route, status: "finalizada" } }) as any
    ),
    "finalizada"
  );
  await expectFailure(
    () => routeLifecycleService.changeStatus(
      { routeId: 12, action: "cancel", motivo: "Otra cancelación", usuario: "Auditor" },
      new FakeClient({ route: { ...client.route, status: "cancelada" } }) as any
    ),
    "ya está cancelada"
  );
  await expectFailure(
    () => routeLifecycleService.changeStatus(
      { routeId: 12, action: "reopen", motivo: "Otra reapertura", usuario: "Auditor" },
      new FakeClient() as any
    ),
    "solo se puede reabrir"
  );
  await expectFailure(
    () => routeLifecycleService.changeStatus(
      { routeId: 12, action: "cancel", motivo: "x", usuario: "Auditor" },
      new FakeClient() as any
    ),
    "al menos 3"
  );


};

const runStaticAudit = () => {
  const migration = read("supabase/19_route_lifecycle.sql");
  for (const token of [
    "route_status_history",
    "cancelled_at",
    "cancel_reason",
    "cancelled_from_status",
    "reopened_at",
    "reopen_reason",
  ]) {
    assert(migration.includes(token), `Falta ${token} en la migración.`);
  }

  const api = read("api/clientes.ts");
  assert(api.includes('endpoint === "route-lifecycle"'), "Vercel no expone el ciclo de vida de rutas.");
  assert(api.includes("routeLifecycleService.changeStatus"), "Vercel no usa el servicio transaccional.");
  assert(api.includes("La eliminación física de rutas está deshabilitada"), "Vercel todavía permite DELETE físico.");
  assert(api.includes("COALESCE(r.status, 'planificada') <> 'cancelada'"), "La ruta cancelada todavía aparece como ruta operativa del día.");
  assert(api.includes("FOR UPDATE OF r, ri"), "Las acciones de ruta no bloquean ruta e ítem conjuntamente.");
  assert(api.includes("route_item_id: z.number().int().positive()"), "El pedido rápido no exige trazabilidad de ruta.");
  assert(api.includes("Pedido a proveedor #"), "El pedido rápido no actualiza el ítem dentro de la transacción.");
  assert(api.includes("permissions?.suppliers?.can_create"), "El pedido rápido no exige permiso de proveedores en el backend.");

  const salesApi = read("api/sales.ts");
  assert(salesApi.includes("route_item_id: z.number().int().positive().optional()"), "La venta rápida no acepta el ítem de ruta.");

  const salesService = read("server/services/salesService.ts");
  assert(salesService.includes("La ruta está ${routeStatus} y no admite nuevas ventas"), "Ventas no bloquea rutas cerradas.");
  assert(salesService.includes("La ruta está ${routeStatus} y no admite nuevas cobranzas"), "Cobranzas no bloquea rutas cerradas.");
  assert(salesService.includes("Venta N° ${nextSaleNum} registrada desde la ruta"), "La venta rápida no actualiza el ítem de forma atómica.");

  const express = read("server/routes/businessRouteRoutes.ts");
  const routeItemService = read("server/services/routeItemLifecycleService.ts");
  assert(express.includes('"/:id/cancel"'), "Express no expone cancelación de rutas.");
  assert(express.includes('"/:id/reopen"'), "Express no expone reapertura de rutas.");
  assert(express.includes("La eliminación física de rutas está deshabilitada"), "Express no bloquea DELETE físico.");
  assert(express.includes("routeItemLifecycleService.changeStatus"), "Express no delega las visitas al servicio seguro.");
  assert(routeItemService.includes("La ruta está ${routeStatus} y no admite cambios"), "El servicio de visitas no bloquea rutas cerradas.");

  const ui = read("src/components/RouteModule.tsx");
  assert(ui.includes("Cancelar ruta"), "La interfaz no ofrece cancelación segura.");
  assert(ui.includes("Reabrir ruta"), "La interfaz no ofrece reapertura auditada.");
  assert(ui.includes("Motivo obligatorio"), "La interfaz no exige motivo.");
  assert(ui.includes("route_item_id: selectedItemForAction.id"), "Las acciones rápidas no envían trazabilidad de ruta.");
  assert(ui.includes("monto_pagado: quickSaleTotal"), "La venta rápida en efectivo no queda pagada por el total.");
  assert(ui.includes("cheque_data: paymentMethod === 'cheque'"), "La cobranza rápida no envía la trazabilidad del cheque.");
  assert(ui.includes("quickChequeDueDate"), "La cobranza rápida no solicita vencimiento del cheque.");
  assert(ui.includes("hasPermission('current_accounts', 'create')"), "La interfaz muestra cobranzas sin permiso de cuenta corriente.");
  assert(!ui.includes("Eliminar ruta"), "La interfaz todavía ofrece eliminación física.");
  assert(!ui.includes("handleDeleteRoute"), "La interfaz conserva el flujo DELETE anterior.");

  const service = read("server/services/routeLifecycleService.ts");
  assert(service.includes('await client.query("BEGIN")'), "El servicio no inicia transacción propia.");
  assert(service.includes('await client.query("ROLLBACK")'), "El servicio no ejecuta rollback ante errores.");
  assert(service.includes('FOR UPDATE'), "El servicio no bloquea la ruta antes de cambiar su estado.");

  const db = read("server/db.ts");
  assert(db.includes("route_status_history"), "SQLite no tiene historial de rutas.");
  assert(db.includes("ALTER TABLE routes ADD COLUMN cancelled_at"), "SQLite no migra las columnas de cancelación.");
};

await runSimulation();
runStaticAudit();
console.log("Ciclo de vida seguro de rutas correcto: cancelación, reapertura, bloqueos, acciones atómicas y rollback verificados.");
