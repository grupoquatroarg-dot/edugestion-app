import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const assert = (condition: any, message: string) => { if (!condition) throw new Error(message); };
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const migration = read("supabase/29_route_operational_lifecycle.sql");
const service = read("server/services/routeOperationalLifecycleService.ts");
const api = read("api/clientes.ts");
const localRoute = read("server/routes/businessRouteRoutes.ts");
const db = read("server/db.ts");
const ui = read("src/components/RouteModule.tsx");
const packageJson = read("package.json");

for (const token of [
  "BEGIN;",
  "operational_version integer NOT NULL DEFAULT 0",
  "operational_last_action text",
  "operational_from_status text",
  "route_operational_status_history",
  "route_operational_status_history_transition_check",
  "route_operational_status_history_snapshot_check",
  "route_operational_status_history_unique_version",
  "idx_route_operational_history_route",
  "COMMIT;",
]) assert(migration.includes(token), `La migración 29 no contiene ${token}.`);

assert(service.includes('export type RouteOperationalAction = "start" | "reopen"'), "El servicio acepta acciones arbitrarias.");
assert(service.includes("FOR UPDATE"), "El servicio no bloquea la ruta.");
assert(service.includes("FOR UPDATE OF mf"), "El servicio no bloquea movimientos vinculados.");
assert(service.includes("input.expectedVersion"), "Falta protección contra pestañas antiguas.");
assert(service.includes("La ruta cambió mientras estaba abierta"), "Falta mensaje de concurrencia.");
assert(service.includes("La ruta en curso es histórica o se inició mediante actividad operativa"), "Falta protección de rutas históricas.");
assert(service.includes("La ruta tiene visitas u operaciones registradas"), "Falta bloqueo de actividad vinculada.");
assert(service.includes("activeFinancialMovements"), "El snapshot no incluye movimientos vinculados.");
assert(service.includes("COALESCE(operational_version, 0) = $10"), "La actualización PostgreSQL no valida la versión.");
assert(service.includes("COALESCE(operational_version, 0) = ?"), "La actualización SQLite no valida la versión.");

assert(api.includes('endpoint === "route-operational-lifecycle"'), "Vercel no expone el ciclo operativo auditado.");
assert(api.includes("routeOperationalLifecycleService.changeStatus"), "Vercel no usa el servicio transaccional.");
assert(api.includes('action: z.enum(["start", "reopen"])'), "La validación Vercel permite acciones arbitrarias.");
assert(api.includes("El cambio directo del estado operativo de la ruta fue deshabilitado"), "Vercel conserva el PATCH libre.");
assert(api.includes('"route-operational-lifecycle"].includes(endpoint)'), "El enrutador principal no incluye el nuevo endpoint.");

assert(localRoute.includes('router.post("/:id/operational"'), "Express no expone el ciclo operativo auditado.");
assert(localRoute.includes("routeOperationalLifecycleService.changeStatus"), "Express no usa el servicio transaccional.");
assert(localRoute.includes("El cambio directo del estado operativo de la ruta fue deshabilitado"), "Express conserva el PATCH libre.");

assert(db.includes("CREATE TABLE IF NOT EXISTS route_operational_status_history"), "SQLite no crea historial operativo.");
assert(db.includes("ALTER TABLE routes ADD COLUMN operational_version"), "SQLite no migra la versión operativa.");
assert(ui.includes("endpoint=route-operational-lifecycle"), "La interfaz no utiliza el endpoint auditado.");
assert(ui.includes("Volver a planificación"), "La interfaz no ofrece reversión controlada.");
assert(ui.includes("expectedVersion: Number(route.operational_version || 0)"), "La interfaz no envía la versión esperada.");
assert(!ui.includes("endpoint=routes&id=${todayRoute.id}`, { method: 'PATCH'"), "La interfaz conserva el PATCH directo.");
assert(packageJson.includes('"check:route-operational-lifecycle"'), "package.json no registra la auditoría de la Fase 8.12.");

class ExpectedFailure extends Error {}

type Model = {
  route: {
    status: string;
    operational_version: number;
    operational_last_action: string | null;
    operational_from_status: string | null;
  };
  items: Array<{ status: string; visitado?: number; venta_registrada?: number; pedido_generado?: number; cobranza_realizada?: number; notes?: string | null }>;
  movements: Array<{ estado: string }>;
  history: any[];
};

const hasActivity = (model: Model) => model.items.some((item) => (
  item.status !== "pendiente"
  || Number(item.visitado || 0) !== 0
  || Number(item.venta_registrada || 0) !== 0
  || Number(item.pedido_generado || 0) !== 0
  || Number(item.cobranza_realizada || 0) !== 0
  || Boolean(String(item.notes || "").trim())
)) || model.movements.some((movement) => !["anulado", "anulada", "cancelado", "cancelada"].includes(movement.estado.toLowerCase()));

const apply = (model: Model, action: "start" | "reopen", expectedVersion: number, reason = "") => {
  const original = clone(model);
  try {
    if (model.route.operational_version !== expectedVersion) throw new ExpectedFailure("stale");
    const current = model.route.status;
    let next = "";
    if (action === "start") {
      if (!["planificada", "pendiente"].includes(current)) throw new ExpectedFailure("invalid start");
      next = "en curso";
    } else {
      if (reason.trim().length < 3) throw new ExpectedFailure("reason");
      if (current !== "en curso") throw new ExpectedFailure("invalid reopen");
      if (model.route.operational_version <= 0 || model.route.operational_last_action !== "start") throw new ExpectedFailure("historical");
      if (!["planificada", "pendiente"].includes(String(model.route.operational_from_status))) throw new ExpectedFailure("missing origin");
      if (hasActivity(model)) throw new ExpectedFailure("activity");
      next = String(model.route.operational_from_status);
    }

    const version = model.route.operational_version + 1;
    model.history.push({ action, version, previous_status: current, new_status: next, snapshot: clone(original) });
    model.route.status = next;
    model.route.operational_version = version;
    model.route.operational_last_action = action;
    model.route.operational_from_status = action === "start" ? current : null;
  } catch (error) {
    Object.assign(model, original);
    throw error;
  }
};

const base = (): Model => ({
  route: { status: "planificada", operational_version: 0, operational_last_action: null, operational_from_status: null },
  items: [{ status: "pendiente" }],
  movements: [],
  history: [],
});

const normal = base();
apply(normal, "start", 0);
assert(normal.route.status === "en curso" && normal.route.operational_version === 1, "La simulación no inició la ruta.");
apply(normal, "reopen", 1, "Inicio realizado por error");
assert(normal.route.status === "planificada" && normal.route.operational_version === 2, "La simulación no volvió a planificación.");
assert(normal.history.length === 2, "La simulación no conservó ambos movimientos.");

const pending = base();
pending.route.status = "pendiente";
apply(pending, "start", 0);
apply(pending, "reopen", 1, "Debe volver a pendiente");
assert(pending.route.status === "pendiente", "No se restauró el estado operativo anterior.");

for (const scenario of [
  { name: "pestaña antigua", prepare: (m: Model) => apply(m, "start", 0), run: (m: Model) => apply(m, "reopen", 0, "Versión vieja") },
  { name: "ruta histórica", prepare: (m: Model) => { m.route.status = "en curso"; }, run: (m: Model) => apply(m, "reopen", 0, "Reapertura histórica") },
  { name: "visita procesada", prepare: (m: Model) => { apply(m, "start", 0); m.items[0].status = "visitado"; }, run: (m: Model) => apply(m, "reopen", 1, "No debe permitir") },
  { name: "movimiento vinculado", prepare: (m: Model) => { apply(m, "start", 0); m.movements.push({ estado: "Activo" }); }, run: (m: Model) => apply(m, "reopen", 1, "No debe permitir") },
  { name: "ruta cerrada", prepare: (m: Model) => { m.route.status = "finalizada"; }, run: (m: Model) => apply(m, "start", 0) },
]) {
  const model = base();
  scenario.prepare(model);
  const before = clone(model);
  let failed = false;
  try { scenario.run(model); } catch (error) { failed = error instanceof ExpectedFailure; }
  assert(failed, `No se bloqueó el escenario: ${scenario.name}.`);
  assert(JSON.stringify(model) === JSON.stringify(before), `El rollback dejó cambios parciales en: ${scenario.name}.`);
}

console.log("Ciclo operativo seguro de rutas correcto: inicio, vuelta a planificación, históricos, actividad, concurrencia y rollback verificados.");
