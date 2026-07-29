import fs from "node:fs";
import path from "node:path";
import { routeItemLifecycleService } from "../server/services/routeItemLifecycleService.js";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const assert = (condition: any, message: string) => { if (!condition) throw new Error(message); };

const migration = read("supabase/28_route_item_lifecycle.sql");
const service = read("server/services/routeItemLifecycleService.ts");
const api = read("api/clientes.ts");
const localRoute = read("server/routes/businessRouteRoutes.ts");
const db = read("server/db.ts");
const ui = read("src/components/RouteModule.tsx");
const packageJson = read("package.json");

for (const token of [
  "BEGIN;", "lifecycle_version integer NOT NULL DEFAULT 0", "route_item_status_history",
  "route_item_status_history_transition_check", "route_item_status_history_reason_check",
  "route_item_status_history_unique_version", "idx_route_item_status_history_item",
  "idx_route_item_status_history_route", "COMMIT;",
]) assert(migration.includes(token), `La migración 28 no contiene ${token}.`);

assert(service.includes("FOR UPDATE OF r, ri"), "El servicio no bloquea ruta y visita.");
assert(service.includes("COALESCE(lifecycle_version, 0) = $13"), "Falta protección contra pestañas antiguas.");
assert(service.includes("activeFinancialMovements"), "El snapshot no incluye movimientos vinculados.");
assert(service.includes("Primero debe anularse o revertirse la operación vinculada"), "Falta bloqueo de vínculos.");
assert(service.includes("La visita es histórica y no tiene trazabilidad suficiente"), "Falta protección histórica.");
assert(api.includes('action: z.enum(["visit", "omit", "reopen"])'), "La API acepta acciones arbitrarias.");
assert(api.includes("routeItemLifecycleService.changeStatus"), "La API no usa el servicio transaccional.");
assert(api.includes('"route-item-lifecycle"'), "La API no enruta el endpoint auditado.");
assert(api.includes("El cambio directo de estado e indicadores de la visita fue deshabilitado"), "La API conserva el PATCH libre.");
assert(localRoute.includes('router.post("/items/:id/lifecycle"'), "Express no expone el ciclo auditado.");
assert(localRoute.includes("routeItemLifecycleService.changeStatus"), "Express no usa el servicio auditado.");
assert(db.includes("CREATE TABLE IF NOT EXISTS route_item_status_history"), "SQLite no crea historial.");
assert(db.includes("ALTER TABLE route_items ADD COLUMN lifecycle_version"), "SQLite no migra la versión.");
assert(ui.includes("endpoint=route-item-lifecycle"), "La interfaz no usa el endpoint auditado.");
assert(ui.includes("Reabrir visita"), "La interfaz no exige motivo para reabrir.");
assert(ui.includes("Visita histórica sin trazabilidad suficiente para reabrir"), "La interfaz no protege históricos.");
assert(!ui.includes("handleUpdateItemStatus"), "La interfaz conserva el actualizador libre.");
assert(packageJson.includes("check:route-item-lifecycle"), "package.json no registra la auditoría.");

interface State { route: any; item: any; movements: any[]; history: any[]; snapshot?: any; }
const createState = (): State => ({
  route: { id: 9, status: "planificada" },
  item: {
    id: 81, route_id: 9, client_id: 4, status: "pendiente", visitado: 0,
    venta_registrada: 0, pedido_generado: 0, cobranza_realizada: 0,
    notes: null, visited_at: null, lifecycle_version: 0,
    status_changed_at: null, status_changed_by: null, status_changed_from: null,
    status_last_action: null, status_last_reason: null,
  },
  movements: [], history: [],
});

class FakeClient {
  private mutation = 0;
  constructor(public state: State, private failAt = 0, private stale = false) {}
  private mutate() { this.mutation += 1; if (this.failAt === this.mutation) throw new Error("Falla simulada"); }
  async query(text: string, params: any[] = []) {
    const sql = text.replace(/\s+/g, " ").trim();
    if (sql === "BEGIN") { this.state.snapshot = clone({ route: this.state.route, item: this.state.item, movements: this.state.movements, history: this.state.history }); return { rows: [], rowCount: null }; }
    if (sql === "COMMIT") { delete this.state.snapshot; return { rows: [], rowCount: null }; }
    if (sql === "ROLLBACK") { if (this.state.snapshot) Object.assign(this.state, clone(this.state.snapshot)); delete this.state.snapshot; return { rows: [], rowCount: null }; }
    if (sql.startsWith("SELECT ri.*, r.status AS route_status FROM route_items")) return { rows: this.state.item.id === Number(params[0]) ? [{ ...clone(this.state.item), route_status: this.state.route.status }] : [], rowCount: this.state.item.id === Number(params[0]) ? 1 : 0 };
    if (sql.startsWith("SELECT id, tipo, origen, estado, venta_id, cheque_id FROM movimientos_financieros")) {
      const rows = this.state.movements.filter((m) => m.route_item_id === Number(params[0]) && !["anulado", "anulada", "cancelado", "cancelada"].includes(String(m.estado || "activo").toLowerCase())).map(clone);
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith("INSERT INTO route_item_status_history")) {
      this.mutate();
      const row = { id: this.state.history.length + 1, route_item_id: Number(params[0]), route_id: Number(params[1]), version: Number(params[2]), action: params[3], from_status: params[4], to_status: params[5], reason: params[6], changed_by: params[7], changed_at: `2026-07-29T1${this.state.history.length}:00:00Z`, snapshot: JSON.parse(params[8]) };
      this.state.history.push(row); return { rows: [{ id: row.id, changed_at: row.changed_at }], rowCount: 1 };
    }
    if (sql.startsWith("UPDATE route_items SET status = $1")) {
      this.mutate();
      if (this.stale || this.state.item.id !== Number(params[10]) || this.state.item.status !== params[11] || Number(this.state.item.lifecycle_version || 0) !== Number(params[12])) return { rows: [], rowCount: 0 };
      Object.assign(this.state.item, { status: params[0], visitado: Number(params[1]), visited_at: params[2], lifecycle_version: Number(params[4]), status_changed_at: params[5], status_changed_by: params[6], status_changed_from: params[7], status_last_action: params[8], status_last_reason: params[9] });
      if (params[3] !== null && params[3] !== undefined) this.state.item.notes = params[3];
      return { rows: [clone(this.state.item)], rowCount: 1 };
    }
    if (sql.startsWith("UPDATE routes SET status = 'en curso'")) { this.mutate(); if (["planificada", "pendiente"].includes(this.state.route.status)) this.state.route.status = "en curso"; return { rows: [], rowCount: 1 }; }
    throw new Error(`Consulta no simulada: ${sql}`);
  }
}

const run = async (state: State, action: "visit" | "omit" | "reopen", motivo?: string, failAt = 0, stale = false) => {
  const client = new FakeClient(state, failAt, stale); await client.query("BEGIN");
  try { const result = await routeItemLifecycleService.changeStatus({ routeItemId: 81, action, motivo, usuario: "Auditor" }, client as any); await client.query("COMMIT"); return result; }
  catch (error) { await client.query("ROLLBACK"); throw error; }
};

const state = createState();
await run(state, "visit");
assert(state.item.status === "visitado" && state.item.visitado === 1 && state.item.lifecycle_version === 1, "La visita no quedó auditada.");
assert(state.route.status === "en curso", "La visita no inició la ruta.");
assert(state.history[0].snapshot.routeItem.status === "pendiente", "El snapshot no conserva el estado anterior.");
await run(state, "reopen", "Se marcó por error");
assert(state.item.status === "pendiente" && state.item.visitado === 0 && state.item.visited_at === null, "La reapertura no restauró la visita.");
await run(state, "omit");
assert(state.item.status === "omitido" && state.item.lifecycle_version === 3, "La omisión no quedó auditada.");
await run(state, "reopen", "El cliente pidió reprogramar");
assert(state.history.length === 4, "No se guardaron todas las transiciones.");

const linked = createState(); linked.item.status = "visitado"; linked.item.lifecycle_version = 1; linked.item.status_last_action = "visit"; linked.item.cobranza_realizada = 1; linked.movements.push({ id: 1, route_item_id: 81, estado: "Activo" });
await run(linked, "reopen", "Intento inválido").then(() => { throw new Error("Debía bloquear el vínculo."); }, (e) => assert(String(e.message).includes("operación vinculada"), "Mensaje incorrecto para vínculo."));
const historical = createState(); historical.item.status = "visitado"; historical.item.visitado = 1;
await run(historical, "reopen", "Intento histórico").then(() => { throw new Error("Debía bloquear el histórico."); }, (e) => assert(String(e.message).includes("histórica"), "Mensaje incorrecto para histórico."));
const closed = createState(); closed.route.status = "finalizada";
await run(closed, "visit").then(() => { throw new Error("Debía bloquear la ruta cerrada."); }, (e) => assert(String(e.message).includes("finalizada"), "Mensaje incorrecto para ruta cerrada."));
const stale = createState();
await run(stale, "visit", undefined, 0, true).then(() => { throw new Error("Debía bloquear concurrencia."); }, (e) => assert(String(e.message).includes("cambió mientras"), "Mensaje incorrecto para concurrencia."));
assert(stale.history.length === 0 && stale.item.status === "pendiente", "La concurrencia dejó cambios parciales.");
const rollback = createState();
await run(rollback, "visit", undefined, 2).then(() => { throw new Error("Debía fallar el rollback."); }, () => undefined);
assert(rollback.history.length === 0 && rollback.item.status === "pendiente" && rollback.route.status === "planificada", "El rollback dejó cambios parciales.");

console.log("Ciclo seguro de visitas de ruta correcto: visita, omisión, reapertura, vínculos, históricos, concurrencia y rollback verificados.");
