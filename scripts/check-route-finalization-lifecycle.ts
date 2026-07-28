import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { routeLifecycleService } from "../server/services/routeLifecycleService.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

class FakeClient {
  route: any;
  items: any[];
  history: any[] = [];
  failUpdate = false;
  snapshot: any = null;

  constructor(options: any = {}) {
    this.route = options.route || {
      id: 17,
      name: "Ruta norte",
      date: "2026-07-28",
      status: "en curso",
      finalization_version: 0,
      finalized_at: null,
      finalized_by: null,
      finalization_reason: null,
      finalized_from_status: null,
      cancelled_from_status: null,
      reopened_at: null,
      reopened_by: null,
      reopen_reason: null,
    };
    this.items = options.items || [
      { id: 1, route_id: 17, client_id: 3, status: "visitado", notes: "Cobranza realizada" },
      { id: 2, route_id: 17, client_id: 9, status: "pendiente", notes: null },
    ];
    this.failUpdate = Boolean(options.failUpdate);
  }

  begin() {
    this.snapshot = clone({ route: this.route, items: this.items, history: this.history });
  }

  rollback() {
    if (!this.snapshot) return;
    this.route = clone(this.snapshot.route);
    this.items = clone(this.snapshot.items);
    this.history = clone(this.snapshot.history);
  }

  async query(text: string, params: any[] = []) {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (normalized.startsWith("SELECT * FROM routes")) {
      return Number(this.route?.id) === Number(params[0])
        ? { rows: [clone(this.route)], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (normalized.startsWith("SELECT * FROM route_items")) {
      return { rows: clone(this.items), rowCount: this.items.length };
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
        performed_at: "2026-07-28T15:30:00.000Z",
      };
      this.history.push(entry);
      return { rows: [entry], rowCount: 1 };
    }
    if (normalized.startsWith("UPDATE routes SET status = 'finalizada'")) {
      if (this.failUpdate) throw new Error("Falla simulada al finalizar");
      this.route = {
        ...this.route,
        status: "finalizada",
        finalization_version: 1,
        finalized_at: params[0],
        finalized_by: params[1],
        finalization_reason: params[2],
        finalized_from_status: params[3],
        reopened_at: null,
        reopened_by: null,
        reopen_reason: null,
      };
      return { rows: [clone(this.route)], rowCount: 1 };
    }
    if (normalized.startsWith("UPDATE routes SET status = $1")) {
      if (this.failUpdate) throw new Error("Falla simulada al reabrir");
      this.route = {
        ...this.route,
        status: params[0],
        reopened_at: params[1],
        reopened_by: params[2],
        reopen_reason: params[3],
      };
      return { rows: [clone(this.route)], rowCount: 1 };
    }
    throw new Error(`Consulta no simulada: ${normalized}`);
  }
}

const expectFailure = async (fn: () => Promise<unknown>, includes: string) => {
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
  const finalized = await routeLifecycleService.changeStatus(
    {
      routeId: 17,
      action: "finalize",
      motivo: "Se completó la jornada y se verificaron las visitas",
      usuario: "Auditor local",
    },
    client as any
  );

  assert(finalized.route.status === "finalizada", "La ruta no quedó finalizada.");
  assert(finalized.route.finalization_version === 1, "La finalización no quedó marcada como reversible.");
  assert(finalized.route.finalized_from_status === "en curso", "No conservó el estado operativo anterior.");
  assert(client.history.length === 1 && client.history[0].action === "finalize", "No registró el historial de finalización.");
  const snapshot = JSON.parse(client.history[0].snapshot);
  assert(snapshot.items.length === 2, "El snapshot no conservó los ítems de ruta.");
  assert(snapshot.items[0].notes === "Cobranza realizada", "El snapshot no conservó notas y actividad.");

  const reopened = await routeLifecycleService.changeStatus(
    {
      routeId: 17,
      action: "reopen",
      motivo: "Se detectó una visita pendiente y se retoma la ruta",
      usuario: "Auditor local",
    },
    client as any
  );
  assert(reopened.route.status === "en curso", "La reapertura no restauró el estado anterior.");
  assert(reopened.route.reopen_reason.includes("visita pendiente"), "No guardó el motivo de reapertura.");
  assert(Number(client.history.length) === 2 && client.history[1].previous_status === "finalizada", "No auditó la reapertura de la finalización.");

  await expectFailure(
    () => routeLifecycleService.changeStatus(
      { routeId: 17, action: "finalize", motivo: "Otra finalización", usuario: "Auditor" },
      new FakeClient({ route: { ...client.route, status: "finalizada", finalization_version: 1 } }) as any
    ),
    "ya está finalizada"
  );
  await expectFailure(
    () => routeLifecycleService.changeStatus(
      { routeId: 17, action: "finalize", motivo: "Finalización inválida", usuario: "Auditor" },
      new FakeClient({ route: { ...client.route, status: "cancelada" } }) as any
    ),
    "debe reabrirse"
  );
  await expectFailure(
    () => routeLifecycleService.changeStatus(
      { routeId: 17, action: "reopen", motivo: "Reabrir histórica", usuario: "Auditor" },
      new FakeClient({ route: { ...client.route, status: "finalizada", finalization_version: 0 } }) as any
    ),
    "histórica"
  );
  await expectFailure(
    () => routeLifecycleService.changeStatus(
      { routeId: 17, action: "finalize", motivo: "x", usuario: "Auditor" },
      new FakeClient() as any
    ),
    "al menos 3"
  );

  const failingClient = new FakeClient({ failUpdate: true });
  failingClient.begin();
  await expectFailure(
    () => routeLifecycleService.changeStatus(
      {
        routeId: 17,
        action: "finalize",
        motivo: "Prueba de rollback por falla posterior",
        usuario: "Auditor",
      },
      failingClient as any
    ),
    "falla simulada"
  );
  failingClient.rollback();
  assert(failingClient.route.status === "en curso", "El rollback no restauró el estado de la ruta.");
  assert(failingClient.history.length === 0, "El rollback dejó historial parcial.");
};

const runStaticAudit = () => {
  const migration = read("supabase/24_route_finalization_lifecycle.sql");
  for (const token of [
    "finalization_version",
    "finalized_at",
    "finalized_by",
    "finalization_reason",
    "finalized_from_status",
    "'finalize', 'cancel', 'reopen'",
  ]) {
    assert(migration.includes(token), `Falta ${token} en la migración 24.`);
  }

  const service = read("server/services/routeLifecycleService.ts");
  assert(service.includes('RouteLifecycleAction = "finalize" | "cancel" | "reopen"'), "El servicio no admite finalización auditada.");
  assert(service.includes("finalization_version = 1"), "La finalización nueva no queda marcada como reversible.");
  assert(service.includes("finalized_from_status"), "El servicio no conserva el estado anterior.");
  assert(service.includes("La ruta finalizada es histórica"), "El servicio no protege rutas finalizadas históricas.");
  assert(service.includes('await client.query("BEGIN")'), "El servicio no inicia transacción.");
  assert(service.includes('await client.query("ROLLBACK")'), "El servicio no revierte ante errores.");
  assert(service.includes("FOR UPDATE"), "El servicio no bloquea ruta e ítems.");

  const api = read("api/clientes.ts");
  assert(api.includes('action: z.enum(["finalize", "cancel", "reopen"])'), "Vercel no acepta finalización auditada.");
  assert(api.includes('status: z.enum(["planificada", "en curso", "pendiente"])'), "Vercel todavía permite finalización directa por status.");
  assert(api.includes("Ruta finalizada correctamente"), "Vercel no responde la finalización auditada.");
  assert(api.includes("finalization_version: toNumber(row.finalization_version)"), "Vercel no devuelve trazabilidad de finalización.");

  const express = read("server/routes/businessRouteRoutes.ts");
  assert(express.includes('router.post("/:id/finalize"'), "Express no expone finalización auditada.");
  assert(!express.includes('["planificada", "pendiente", "en curso", "finalizada"]'), "Express todavía permite finalizar con PATCH directo.");

  const ui = read("src/components/RouteModule.tsx");
  assert(ui.includes("type: 'finalize' | 'cancel' | 'reopen'"), "La interfaz no usa el ciclo de vida para finalizar.");
  assert(ui.includes("Se completó la jornada y se verificaron las visitas"), "La interfaz no solicita motivo de finalización.");
  assert(ui.includes("finalization_version"), "La interfaz no distingue rutas históricas.");
  assert(ui.includes("Ruta histórica sin trazabilidad suficiente para reabrir"), "La interfaz no protege finalizaciones históricas.");
  assert(!ui.includes("handleCompleteRoute"), "La interfaz conserva el PATCH directo de finalización.");

  const database = read("server/db.ts");
  assert(database.includes("finalization_version INTEGER NOT NULL DEFAULT 0"), "SQLite no guarda trazabilidad de finalización.");
  assert(database.includes("route_status_history_v2"), "SQLite no migra la restricción histórica para finalize.");
  assert(database.includes("CHECK(action IN ('finalize', 'cancel', 'reopen'))"), "SQLite no admite historial de finalización.");

  const packageJson = JSON.parse(read("package.json"));
  assert(packageJson.scripts["check:route-finalization-lifecycle"], "Falta la auditoría permanente de finalización de rutas.");
  assert(packageJson.scripts["validate:audit"].includes("check:route-finalization-lifecycle"), "La auditoría nueva no forma parte de validate:audit.");
};

await runSimulation();
runStaticAudit();
console.log("Finalización segura de rutas correcta: motivo, snapshot, reapertura, históricos, bloqueos y rollback verificados.");
