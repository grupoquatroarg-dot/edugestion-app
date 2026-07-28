import fs from "node:fs";
import path from "node:path";
import { supplierOrderStatusLifecycleService } from "../server/services/supplierOrderStatusLifecycleService.js";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const assert = (condition: any, message: string) => {
  if (!condition) throw new Error(message);
};
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const migration = read("supabase/27_supplier_order_status_lifecycle.sql");
const service = read("server/services/supplierOrderStatusLifecycleService.ts");
const api = read("api/sales.ts");
const localRoute = read("server/routes/supplierOrderRoutes.ts");
const repository = read("server/repositories/supplierOrderRepository.ts");
const db = read("server/db.ts");
const ui = read("src/components/SupplierOrders.tsx");
const packageJson = read("package.json");

for (const token of [
  "BEGIN;",
  "status_version integer NOT NULL DEFAULT 0",
  "supplier_order_status_history",
  "supplier_order_status_history_transition_check",
  "reason IS NOT NULL",
  "supplier_order_status_history_unique_version",
  "idx_supplier_order_status_history_order",
  "COMMIT;",
]) {
  assert(migration.includes(token), `La migración 27 no contiene ${token}.`);
}
assert(service.includes("FOR UPDATE"), "El servicio no bloquea el pedido durante la transición.");
assert(service.includes("COALESCE(status_version, 0) = $10"), "El servicio no protege contra pestañas antiguas.");
assert(service.includes("JSON.stringify({ order, items"), "El servicio no guarda snapshot del pedido y sus productos.");
assert(service.includes('pendiente: "pedido_realizado"'), "Falta la transición Pendiente → Pedido realizado.");
assert(service.includes('pedido_realizado: "auditar_pedido"'), "Falta la transición Pedido realizado → Auditoría.");
assert(service.includes('auditar_pedido: "pedido_realizado"'), "Falta la reapertura Auditoría → Pedido realizado.");
assert(api.includes('action: z.enum(["advance", "reopen"])'), "La API todavía acepta estados arbitrarios.");
assert(api.includes("supplierOrderStatusLifecycleService.changeStatus"), "La API no delega al servicio auditado.");
const apiStatusBlock = api.slice(
  api.indexOf('if (endpoint === "supplier-order-status"'),
  api.indexOf('if (endpoint === "supplier-order-items"')
);
assert(!/UPDATE\s+supplier_orders/i.test(apiStatusBlock), "La API conserva una actualización directa del estado.");
assert(localRoute.includes("supplierOrderStatusLifecycleService.changeStatus"), "Express local no usa el servicio auditado.");
assert(repository.includes("El cambio directo de estado fue deshabilitado"), "El repositorio local todavía permite cambios directos.");
assert(db.includes("CREATE TABLE IF NOT EXISTS supplier_order_status_history"), "SQLite no crea el historial de estados.");
assert(db.includes("ALTER TABLE supplier_orders ADD COLUMN status_version"), "SQLite no migra status_version.");
assert(!ui.includes("Estado manual"), "La interfaz todavía muestra el selector manual de estados.");
assert(ui.includes("Etapa controlada"), "La interfaz no identifica el nuevo ciclo controlado.");
assert(ui.includes("reopen-status"), "La interfaz no permite una reapertura auditada.");
assert(ui.includes("JSON.stringify({ action: 'advance' })"), "La interfaz no usa la acción segura para avanzar.");
assert(ui.includes("JSON.stringify({ action: 'reopen', motivo: normalizedReason })"), "La interfaz no envía el motivo de reapertura.");
assert(packageJson.includes("check:supplier-order-status-lifecycle"), "package.json no registra la nueva auditoría.");

interface State {
  order: any;
  items: any[];
  history: any[];
  snapshot?: State;
}

const createState = (): State => ({
  order: {
    id: 31,
    numero_pedido: 205,
    estado: "pendiente",
    status_version: 0,
    stock_actualizado: 0,
    delivered_at: null,
    cancelled_at: null,
    sale_id: null,
    status_changed_at: null,
    status_changed_by: null,
    status_changed_from: null,
    status_last_action: null,
    status_last_reason: null,
  },
  items: [
    { id: 401, order_id: 31, product_id: 7, cantidad: 4 },
    { id: 402, order_id: 31, product_id: 8, cantidad: 2 },
  ],
  history: [],
});

class FakeClient {
  private mutation = 0;
  constructor(public state: State, private failAt = 0) {}

  private mutate() {
    this.mutation += 1;
    if (this.failAt && this.mutation === this.failAt) throw new Error("Falla simulada");
  }

  async query(text: string, params: any[] = []) {
    const sql = text.replace(/\s+/g, " ").trim();

    if (sql === "BEGIN") {
      this.state.snapshot = clone({
        order: this.state.order,
        items: this.state.items,
        history: this.state.history,
      } as State);
      return { rows: [], rowCount: null };
    }
    if (sql === "COMMIT") {
      delete this.state.snapshot;
      return { rows: [], rowCount: null };
    }
    if (sql === "ROLLBACK") {
      if (this.state.snapshot) {
        const restored = clone(this.state.snapshot);
        this.state.order = restored.order;
        this.state.items = restored.items;
        this.state.history = restored.history;
        delete this.state.snapshot;
      }
      return { rows: [], rowCount: null };
    }

    if (sql.startsWith("SELECT * FROM supplier_orders")) {
      const row = this.state.order.id === Number(params[0]) ? clone(this.state.order) : null;
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.startsWith("SELECT id, product_id, cantidad FROM supplier_order_items")) {
      const rows = this.state.items
        .filter((item) => item.order_id === Number(params[0]))
        .map(clone);
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith("INSERT INTO supplier_order_status_history")) {
      this.mutate();
      const row = {
        id: this.state.history.length + 1,
        supplier_order_id: Number(params[0]),
        version: Number(params[1]),
        action: params[2],
        from_status: params[3],
        to_status: params[4],
        reason: params[5],
        changed_by: params[6],
        changed_at: `2026-07-28T1${this.state.history.length}:00:00Z`,
        snapshot: JSON.parse(params[7]),
      };
      this.state.history.push(row);
      return { rows: [{ id: row.id, changed_at: row.changed_at }], rowCount: 1 };
    }
    if (sql.startsWith("UPDATE supplier_orders SET estado = $1")) {
      this.mutate();
      if (
        this.state.order.id !== Number(params[7])
        || this.state.order.estado !== params[8]
        || Number(this.state.order.status_version || 0) !== Number(params[9])
      ) {
        return { rows: [], rowCount: 0 };
      }
      this.state.order.estado = params[0];
      this.state.order.status_version = Number(params[1]);
      this.state.order.status_changed_at = params[2];
      this.state.order.status_changed_by = params[3];
      this.state.order.status_changed_from = params[4];
      this.state.order.status_last_action = params[5];
      this.state.order.status_last_reason = params[6];
      return { rows: [clone(this.state.order)], rowCount: 1 };
    }

    throw new Error(`Consulta no simulada: ${sql}`);
  }
}

const run = async (state: State, action: "advance" | "reopen", motivo?: string, failAt = 0) => {
  const client = new FakeClient(state, failAt);
  await client.query("BEGIN");
  try {
    const result = await supplierOrderStatusLifecycleService.changeStatus(
      {
        supplierOrderId: 31,
        action,
        motivo,
        usuario: "Auditor",
      },
      client as any
    );
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
};

const success = createState();
const firstAdvance = await run(success, "advance");
assert(firstAdvance.newStatus === "pedido_realizado", "El primer avance no llegó a Pedido realizado.");
assert(success.order.status_version === 1, "El primer avance no incrementó la versión.");
assert(success.history[0].snapshot.items.length === 2, "El snapshot no incluyó los productos.");

const secondAdvance = await run(success, "advance");
assert(secondAdvance.newStatus === "auditar_pedido", "El segundo avance no llegó a Auditoría.");
assert(success.order.status_version === 2, "El segundo avance no incrementó la versión.");

const firstReopen = await run(success, "reopen", "Se debe corregir el costo informado");
assert(firstReopen.newStatus === "pedido_realizado", "La primera reapertura no volvió a Pedido realizado.");
assert(success.order.status_last_reason === "Se debe corregir el costo informado", "No se conservó el motivo de reapertura.");

const secondReopen = await run(success, "reopen", "El proveedor aún no confirmó el pedido");
assert(secondReopen.newStatus === "pendiente", "La segunda reapertura no volvió a Pendiente.");
assert(success.history.length === 4, "No se guardaron todas las transiciones.");

await run(success, "reopen", "Intento duplicado").then(
  () => { throw new Error("Debía bloquear la reapertura desde Pendiente."); },
  (error) => assert(String(error.message).includes("pueda reabrirse"), "Mensaje incorrecto para reapertura inválida.")
);
assert(success.history.length === 4, "La reapertura inválida creó historial.");

const delivered = createState();
delivered.order.estado = "entregado";
delivered.order.stock_actualizado = 1;
await run(delivered, "advance").then(
  () => { throw new Error("Debía bloquear un pedido entregado."); },
  (error) => assert(String(error.message).includes("cerrado"), "Mensaje incorrecto para pedido entregado.")
);

const linkedSale = createState();
linkedSale.order.sale_id = 99;
await run(linkedSale, "advance").then(
  () => { throw new Error("Debía bloquear un pedido vinculado a una venta."); },
  (error) => assert(String(error.message).includes("vinculado a una venta"), "Mensaje incorrecto para venta vinculada.")
);

const missingReason = createState();
missingReason.order.estado = "pedido_realizado";
await run(missingReason, "reopen", "").then(
  () => { throw new Error("Debía exigir motivo de reapertura."); },
  (error) => assert(String(error.message).includes("motivo de reapertura"), "Mensaje incorrecto para motivo faltante.")
);

const rollback = createState();
await run(rollback, "advance", undefined, 2).then(
  () => { throw new Error("La prueba de rollback debía fallar."); },
  () => undefined
);
assert(rollback.order.estado === "pendiente", "El rollback alteró el estado del pedido.");
assert(rollback.order.status_version === 0, "El rollback alteró la versión.");
assert(rollback.history.length === 0, "El rollback dejó historial parcial.");

console.log(
  "Ciclo auditado de pedidos a proveedor correcto: avances, reaperturas, motivo, snapshot, concurrencia, bloqueos y rollback verificados."
);
