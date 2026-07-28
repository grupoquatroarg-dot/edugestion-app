import fs from "node:fs";
import path from "node:path";
import { customerOrderRejectionLifecycleService } from "../server/services/customerOrderRejectionLifecycleService.js";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const assert = (condition: any, message: string) => {
  if (!condition) throw new Error(message);
};

const migration = read("supabase/26_customer_order_rejection_lifecycle.sql");
const api = read("api/sales.ts");
const service = read("server/services/customerOrderRejectionLifecycleService.ts");
const ui = read("src/components/CustomerOrdersAdmin.tsx");
const packageJson = JSON.parse(read("package.json"));

assert(migration.includes("customer_order_rejections"), "Falta la tabla de rechazos auditados.");
assert(migration.includes("rejection_version"), "Falta la versión de rechazo.");
assert(migration.includes("idx_customer_order_rejections_active"), "Falta el índice de rechazo activo.");
assert(migration.includes("WHERE reopened_at IS NULL"), "No se protege un único rechazo activo.");
assert(api.includes("customerOrderRejectionLifecycleService.reject"), "El rechazo no usa el servicio transaccional.");
assert(api.includes("customerOrderRejectionLifecycleService.reopen"), "La reapertura no usa el servicio transaccional.");
assert(api.includes('"customer-order-reopen"'), "Falta el endpoint de reapertura.");
assert(!api.includes("SET estado = 'rechazado',\n           rejection_reason = $1"), "Permanece el rechazo directo anterior.");
assert(service.includes("FOR UPDATE"), "El ciclo de rechazo no bloquea registros críticos.");
assert(service.includes("JSON.stringify(snapshot)"), "El rechazo no guarda snapshot.");
assert(service.includes("anterior a la trazabilidad"), "No se protegen rechazos históricos.");
assert(service.includes("pedidos a proveedor activos"), "La reapertura no bloquea vínculos incompatibles.");
assert(service.includes("El contenido del pedido cambió"), "La reapertura no detecta cambios posteriores.");
assert(ui.includes("Reabrir pedido"), "La interfaz no ofrece reapertura.");
assert(ui.includes("customer-order-reopen-reason"), "Falta el motivo obligatorio de reapertura.");
assert(packageJson.scripts["check:customer-order-rejection-lifecycle"], "Falta la auditoría permanente.");
assert(packageJson.scripts["validate:audit"].includes("check:customer-order-rejection-lifecycle"), "La auditoría nueva no está en validate:audit.");

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

type State = {
  order: any;
  items: any[];
  traces: any[];
  supplierOrders: any[];
  snapshot?: any;
};

const createState = (): State => ({
  order: {
    id: 44,
    numero_pedido: 801,
    estado: "pendiente_aprobacion",
    admin_notes: "Observación original",
    rejection_reason: null,
    rejected_at: null,
    rejected_by: null,
    rejected_from_status: null,
    rejection_version: 0,
    reopened_at: null,
    reopened_by: null,
    reopen_reason: null,
    sale_id: null,
    cancelled_at: null,
    entregado_at: null,
  },
  items: [
    { id: 71, order_id: 44, product_id: 7, cantidad: 4, precio_unitario: 1200 },
    { id: 72, order_id: 44, product_id: 8, cantidad: 2, precio_unitario: 900 },
  ],
  traces: [],
  supplierOrders: [],
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
      this.state.snapshot = clone(this.state);
      return { rows: [], rowCount: null };
    }
    if (sql === "COMMIT") {
      delete this.state.snapshot;
      return { rows: [], rowCount: null };
    }
    if (sql === "ROLLBACK") {
      if (this.state.snapshot) {
        const restored = clone(this.state.snapshot);
        Object.assign(this.state, restored);
        delete this.state.snapshot;
      }
      return { rows: [], rowCount: null };
    }

    if (sql.startsWith("SELECT co.* FROM customer_orders")) {
      const row = this.state.order.id === Number(params[0]) ? clone(this.state.order) : null;
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.startsWith("SELECT id FROM customer_order_rejections")) {
      const row = this.state.traces.find(
        (trace) => trace.customer_order_id === Number(params[0]) && !trace.reopened_at
      );
      return { rows: row ? [{ id: row.id }] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.startsWith("SELECT id, product_id, cantidad, precio_unitario FROM customer_order_items")) {
      const rows = this.state.items.filter((item) => item.order_id === Number(params[0])).map(clone);
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith("INSERT INTO customer_order_rejections")) {
      this.mutate();
      const trace = {
        id: this.state.traces.length + 1,
        customer_order_id: Number(params[0]),
        version: Number(params[1]),
        estado_anterior: params[2],
        motivo: params[3],
        admin_notes_before: params[4],
        admin_notes_after: params[5],
        rejected_by: params[6],
        rejected_at: "2026-07-28T13:00:00Z",
        reopened_at: null,
        reopened_by: null,
        reopen_reason: null,
        snapshot: JSON.parse(params[7]),
      };
      this.state.traces.push(trace);
      return { rows: [{ id: trace.id, rejected_at: trace.rejected_at }], rowCount: 1 };
    }
    if (sql.startsWith("UPDATE customer_orders SET estado = 'rechazado'")) {
      this.mutate();
      if (this.state.order.estado !== "pendiente_aprobacion" || this.state.order.id !== Number(params[6])) {
        return { rows: [], rowCount: 0 };
      }
      this.state.order.estado = "rechazado";
      this.state.order.rejection_reason = params[0];
      this.state.order.admin_notes = params[1];
      this.state.order.rejected_at = params[2];
      this.state.order.rejected_by = params[3];
      this.state.order.rejected_from_status = params[4];
      this.state.order.rejection_version = Number(params[5]);
      this.state.order.reopened_at = null;
      this.state.order.reopened_by = null;
      this.state.order.reopen_reason = null;
      return { rows: [clone(this.state.order)], rowCount: 1 };
    }
    if (sql.startsWith("SELECT * FROM customer_order_rejections")) {
      const row = this.state.traces.find(
        (trace) => trace.customer_order_id === Number(params[0])
          && trace.version === Number(params[1])
          && !trace.reopened_at
      );
      return { rows: row ? [clone(row)] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.startsWith("SELECT id, estado FROM supplier_orders")) {
      const rows = this.state.supplierOrders.filter(
        (order) => order.customer_order_id === Number(params[0]) && order.estado !== "cancelado"
      ).map(clone);
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith("UPDATE customer_order_rejections SET reopened_at = now()")) {
      this.mutate();
      const trace = this.state.traces.find((item) => item.id === Number(params[2]) && !item.reopened_at);
      if (!trace) return { rows: [], rowCount: 0 };
      trace.reopened_at = "2026-07-28T14:00:00Z";
      trace.reopened_by = params[0];
      trace.reopen_reason = params[1];
      return { rows: [{ reopened_at: trace.reopened_at }], rowCount: 1 };
    }
    if (sql.startsWith("UPDATE customer_orders SET estado = 'pendiente_aprobacion'")) {
      this.mutate();
      if (
        this.state.order.id !== Number(params[4])
        || this.state.order.estado !== "rechazado"
        || this.state.order.rejection_version !== Number(params[5])
      ) {
        return { rows: [], rowCount: 0 };
      }
      this.state.order.estado = "pendiente_aprobacion";
      this.state.order.rejection_reason = null;
      this.state.order.rejected_at = null;
      this.state.order.rejected_by = null;
      this.state.order.rejected_from_status = null;
      this.state.order.admin_notes = params[0];
      this.state.order.reopened_at = params[1];
      this.state.order.reopened_by = params[2];
      this.state.order.reopen_reason = params[3];
      return { rows: [clone(this.state.order)], rowCount: 1 };
    }

    throw new Error(`Consulta no simulada: ${sql}`);
  }
}

const reject = async (state: State, failAt = 0) => {
  const client = new FakeClient(state, failAt);
  await client.query("BEGIN");
  try {
    const result = await customerOrderRejectionLifecycleService.reject(
      {
        customerOrderId: 44,
        motivo: "Cliente solicitó revisar el pedido",
        adminNotes: "Pedido rechazado para revisión",
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

const reopen = async (state: State, failAt = 0) => {
  const client = new FakeClient(state, failAt);
  await client.query("BEGIN");
  try {
    const result = await customerOrderRejectionLifecycleService.reopen(
      {
        customerOrderId: 44,
        motivo: "Cliente confirmó que desea continuar",
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
const rejected = await reject(success);
assert(rejected.rejection_version === 1, "El rechazo no incrementó la versión.");
assert(success.order.estado === "rechazado", "El pedido no quedó rechazado.");
assert(success.traces.length === 1, "No se creó la trazabilidad del rechazo.");
assert(success.traces[0].snapshot.items.length === 2, "El snapshot no guardó los productos.");
const reopened = await reopen(success);
assert(reopened.rejection_version === 1, "La reapertura no informó la versión correcta.");
assert(success.order.estado === "pendiente_aprobacion", "El pedido no volvió a pendiente de aprobación.");
assert(success.order.admin_notes === "Observación original", "No se restauró la observación anterior.");
assert(success.order.rejection_reason === null, "La reapertura dejó el motivo activo.");
assert(Boolean(success.traces[0].reopened_at), "La trazabilidad no quedó marcada como reabierta.");

const duplicate = createState();
await reject(duplicate);
await reject(duplicate).then(
  () => { throw new Error("Debía bloquear el doble rechazo."); },
  (error) => assert(String(error.message).includes("ya está rechazado"), "Mensaje incorrecto para doble rechazo.")
);
assert(duplicate.traces.length === 1, "El doble rechazo creó trazabilidad adicional.");

const historical = createState();
historical.order.estado = "rechazado";
historical.order.rejection_reason = "Histórico";
historical.order.rejected_at = "2026-06-01T10:00:00Z";
await reopen(historical).then(
  () => { throw new Error("Debía bloquear un rechazo histórico."); },
  (error) => assert(String(error.message).includes("anterior a la trazabilidad"), "Mensaje histórico incorrecto.")
);

const changedItems = createState();
await reject(changedItems);
changedItems.items[0].cantidad = 9;
await reopen(changedItems).then(
  () => { throw new Error("Debía bloquear productos modificados."); },
  (error) => assert(String(error.message).includes("contenido del pedido cambió"), "Mensaje incorrecto para productos modificados.")
);
assert(changedItems.order.estado === "rechazado", "El bloqueo por cambios modificó el estado.");

const linkedSupplier = createState();
await reject(linkedSupplier);
linkedSupplier.supplierOrders.push({ id: 90, customer_order_id: 44, estado: "pendiente" });
await reopen(linkedSupplier).then(
  () => { throw new Error("Debía bloquear un pedido a proveedor activo."); },
  (error) => assert(String(error.message).includes("pedidos a proveedor activos"), "Mensaje incorrecto para vínculo activo.")
);

const rejectRollback = createState();
await reject(rejectRollback, 2).then(
  () => { throw new Error("La prueba de rollback de rechazo debía fallar."); },
  () => undefined
);
assert(rejectRollback.order.estado === "pendiente_aprobacion", "El rollback del rechazo alteró el pedido.");
assert(rejectRollback.traces.length === 0, "El rollback del rechazo dejó trazabilidad parcial.");

const reopenRollback = createState();
await reject(reopenRollback);
await reopen(reopenRollback, 2).then(
  () => { throw new Error("La prueba de rollback de reapertura debía fallar."); },
  () => undefined
);
assert(reopenRollback.order.estado === "rechazado", "El rollback de reapertura alteró el pedido.");
assert(!reopenRollback.traces[0].reopened_at, "El rollback dejó la trazabilidad reabierta.");

console.log("Ciclo seguro de rechazo de pedidos de clientes correcto: motivo, snapshot, reapertura, históricos, bloqueos y rollback verificados.");
