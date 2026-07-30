import fs from "node:fs";
import path from "node:path";
import { customerOrderContentLifecycleService } from "../server/services/customerOrderContentLifecycleService.js";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const assert = (condition: any, message: string) => {
  if (!condition) throw new Error(message);
};
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const migration = read("supabase/32_customer_order_content_lifecycle.sql");
const service = read("server/services/customerOrderContentLifecycleService.ts");
const approvalService = read("server/services/customerOrderApprovalService.ts");
const api = read("api/sales.ts");
const ui = read("src/components/CustomerOrdersAdmin.tsx");
const packageJson = read("package.json");

assert(typeof customerOrderContentLifecycleService.update === "function", "El servicio no exporta update.");

for (const token of [
  "BEGIN;",
  "content_version integer NOT NULL DEFAULT 0",
  "content_changed_at timestamp with time zone",
  "customer_order_content_history",
  "order_before_snapshot jsonb NOT NULL",
  "items_before_snapshot jsonb NOT NULL",
  "order_after_snapshot jsonb NOT NULL",
  "items_after_snapshot jsonb NOT NULL",
  "customer_order_content_history_unique_version",
  "idx_customer_order_content_history_order",
  "COMMIT;",
]) {
  assert(migration.includes(token), `La migración 32 no contiene ${token}.`);
}

for (const token of [
  "FOR UPDATE",
  "expectedContentVersion",
  "expectedApprovalVersion",
  "expectedRejectionVersion",
  "customer_order_content_history",
  "DELETE FROM customer_order_items",
  "INSERT INTO customer_order_items",
  "No se detectaron cambios",
  "pedido a proveedor activo",
  "ROLLBACK",
]) {
  assert(service.includes(token), `El servicio de contenido no contiene ${token}.`);
}

const updateStart = api.indexOf('if (endpoint === "customer-order-update"');
const approveStart = api.indexOf('if (endpoint === "customer-order-approve"', updateStart);
assert(updateStart >= 0 && approveStart > updateStart, "No se encontró el endpoint de edición.");
const updateBlock = api.slice(updateStart, approveStart);
assert(updateBlock.includes("customerOrderContentLifecycleService.update"), "Vercel no delega la edición al servicio auditado.");
assert(!updateBlock.includes("DELETE FROM customer_order_items"), "Vercel conserva el reemplazo directo de productos.");
assert(updateBlock.includes("expectedContentVersion"), "Vercel no valida la versión de contenido.");
assert(updateBlock.includes("expectedApprovalVersion"), "Vercel no valida la versión de aprobación.");
assert(updateBlock.includes("expectedRejectionVersion"), "Vercel no valida la versión de rechazo.");
assert(approvalService.includes("expectedContentVersion"), "La aprobación no se protege contra ediciones concurrentes.");
assert(ui.includes("Motivo obligatorio del cambio"), "La interfaz no solicita el motivo de edición.");
assert(ui.includes("expected_content_version: Number(order.content_version || 0)"), "La interfaz no envía la versión de contenido.");
assert(ui.includes("snapshots antes y después"), "La interfaz no informa la trazabilidad.");
assert(ui.includes("Contenido editado · versión"), "La interfaz no muestra la última edición auditada.");
assert(packageJson.includes("check:customer-order-content-lifecycle"), "package.json no registra la auditoría de la Fase 8.15.");

interface State {
  order: any;
  items: any[];
  products: any[];
  rejections: any[];
  supplierOrders: any[];
  history: any[];
  snapshot?: State;
}

const createState = (): State => ({
  order: {
    id: 81,
    numero_pedido: 1301,
    cliente_id: 9,
    estado: "pendiente_aprobacion",
    subtotal: 2000,
    descuento_tipo: "none",
    descuento_valor: 0,
    descuento_monto: 0,
    total_final: 2000,
    admin_notes: "Pedido web",
    sale_id: null,
    cancelled_at: null,
    entregado_at: null,
    rejected_at: null,
    aprobado_at: null,
    content_version: 0,
    approval_version: 0,
    rejection_version: 0,
  },
  items: [
    { id: 1, order_id: 81, product_id: 10, cantidad: 3, precio_unitario: 500, importe: 1500, product_name: "Producto A", product_code: "A-1" },
    { id: 2, order_id: 81, product_id: 11, cantidad: 1, precio_unitario: 500, importe: 500, product_name: "Producto B", product_code: "B-1" },
  ],
  products: [
    { id: 10, name: "Producto A", product_code: "A-1", sale_price: 500, eliminado: 0, product_status: "activo" },
    { id: 11, name: "Producto B", product_code: "B-1", sale_price: 500, eliminado: 0, product_status: "activo" },
    { id: 12, name: "Producto C", product_code: "C-1", sale_price: 750, eliminado: 0, product_status: "activo" },
  ],
  rejections: [],
  supplierOrders: [],
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
        products: this.state.products,
        rejections: this.state.rejections,
        supplierOrders: this.state.supplierOrders,
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
        this.state.products = restored.products;
        this.state.rejections = restored.rejections;
        this.state.supplierOrders = restored.supplierOrders;
        this.state.history = restored.history;
        delete this.state.snapshot;
      }
      return { rows: [], rowCount: null };
    }

    if (sql.startsWith("SELECT * FROM customer_orders")) {
      const row = this.state.order.id === Number(params[0]) ? clone(this.state.order) : null;
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.includes("FROM customer_order_rejections")) {
      const rows = this.state.rejections.filter((row) => row.customer_order_id === Number(params[0]) && !row.reopened_at).map(clone);
      return { rows, rowCount: rows.length };
    }
    if (sql.includes("FROM supplier_orders") && sql.includes("estado <> 'cancelado'")) {
      const rows = this.state.supplierOrders.filter((row) => row.customer_order_id === Number(params[0]) && row.estado !== "cancelado").map(clone);
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith("SELECT coi.id, coi.order_id, coi.product_id") && sql.includes("FOR UPDATE OF coi, p")) {
      const rows = this.state.items.filter((item) => item.order_id === Number(params[0])).map(clone);
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith("SELECT id, name, COALESCE(codigo_unico")) {
      const ids = (params[0] || []).map(Number);
      const rows = this.state.products.filter((product) => ids.includes(product.id)).map(clone);
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith("INSERT INTO customer_order_content_history")) {
      this.mutate();
      const row = {
        id: this.state.history.length + 1,
        customer_order_id: Number(params[0]),
        version: Number(params[1]),
        status_at_change: params[2],
        reason: params[3],
        changed_by: params[4],
        changed_at: "2026-07-30T14:00:00.000Z",
        order_before_snapshot: JSON.parse(params[5]),
        items_before_snapshot: JSON.parse(params[6]),
        order_after_snapshot: JSON.parse(params[7]),
        items_after_snapshot: JSON.parse(params[8]),
      };
      this.state.history.push(row);
      return { rows: [{ id: row.id, changed_at: row.changed_at }], rowCount: 1 };
    }
    if (sql.startsWith("UPDATE customer_orders SET subtotal = $1")) {
      this.mutate();
      if (
        this.state.order.id !== Number(params[10])
        || this.state.order.estado !== "pendiente_aprobacion"
        || Number(this.state.order.content_version || 0) !== Number(params[11])
        || Number(this.state.order.approval_version || 0) !== Number(params[12])
        || Number(this.state.order.rejection_version || 0) !== Number(params[13])
      ) return { rows: [], rowCount: 0 };

      this.state.order = {
        ...this.state.order,
        subtotal: params[0],
        descuento_tipo: params[1],
        descuento_valor: params[2],
        descuento_monto: params[3],
        total_final: params[4],
        admin_notes: params[5],
        content_version: params[6],
        content_changed_at: params[7],
        content_changed_by: params[8],
        content_change_reason: params[9],
      };
      return { rows: [clone(this.state.order)], rowCount: 1 };
    }
    if (sql.startsWith("DELETE FROM customer_order_items")) {
      this.mutate();
      this.state.items = this.state.items.filter((item) => item.order_id !== Number(params[0]));
      return { rows: [], rowCount: null };
    }
    if (sql.startsWith("INSERT INTO customer_order_items")) {
      this.mutate();
      const product = this.state.products.find((entry) => entry.id === Number(params[1]));
      this.state.items.push({
        id: 100 + this.state.items.length,
        order_id: Number(params[0]),
        product_id: Number(params[1]),
        cantidad: Number(params[2]),
        precio_unitario: Number(params[3]),
        importe: Number(params[2]) * Number(params[3]),
        product_name: product?.name || "",
        product_code: product?.product_code || "",
      });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("SELECT coi.id, coi.order_id, coi.product_id") && !sql.includes("FOR UPDATE")) {
      const rows = this.state.items.filter((item) => item.order_id === Number(params[0])).map(clone);
      return { rows, rowCount: rows.length };
    }

    throw new Error(`Consulta no simulada: ${sql}`);
  }
}

const run = async (
  state: State,
  overrides: Partial<Parameters<typeof customerOrderContentLifecycleService.update>[0]> = {},
  failAt = 0
) => {
  const client = new FakeClient(state, failAt);
  await client.query("BEGIN");
  try {
    const result = await customerOrderContentLifecycleService.update({
      customerOrderId: 81,
      items: [
        { product_id: 10, cantidad: 4 },
        { product_id: 12, cantidad: 2 },
      ],
      discountType: "percentage",
      discountValue: 10,
      adminNotes: "Cantidades confirmadas con el cliente",
      motivo: "Corrección solicitada por el cliente",
      usuario: "Auditor",
      expectedContentVersion: 0,
      expectedApprovalVersion: 0,
      expectedRejectionVersion: 0,
      ...overrides,
    }, client as any);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
};

const success = createState();
const result = await run(success);
assert(result.version === 1, "La edición no incrementó la versión.");
assert(success.order.content_version === 1, "El pedido no conservó la nueva versión.");
assert(success.items.length === 2 && success.items.some((item) => item.product_id === 12), "Los productos no se reemplazaron correctamente.");
assert(success.order.subtotal === 3500 && success.order.total_final === 3150, "Los importes no se recalcularon en backend.");
assert(success.history.length === 1, "No se guardó el historial.");
assert(success.history[0].items_before_snapshot.length === 2, "El snapshot anterior no conserva los productos.");
assert(success.history[0].items_after_snapshot.some((item: any) => item.product_id === 12), "El snapshot posterior no conserva los productos nuevos.");

await run(createState(), { motivo: "" }).then(
  () => { throw new Error("Debía exigir motivo."); },
  (error) => assert(String(error.message).includes("motivo del cambio"), "Mensaje incorrecto para motivo faltante.")
);

const wrongStatus = createState();
wrongStatus.order.estado = "aprobado_pendiente_entrega";
await run(wrongStatus).then(
  () => { throw new Error("Debía bloquear la edición después de aprobar."); },
  (error) => assert(String(error.message).includes("pendientes de aprobación"), "Mensaje incorrecto para estado inválido.")
);

await run(createState(), { expectedContentVersion: 2 }).then(
  () => { throw new Error("Debía bloquear una pestaña antigua."); },
  (error) => assert(String(error.message).includes("contenido del pedido cambió"), "Mensaje incorrecto para versión antigua.")
);

const linked = createState();
linked.supplierOrders.push({ id: 90, customer_order_id: 81, estado: "pendiente" });
await run(linked).then(
  () => { throw new Error("Debía bloquear un pedido con reposición activa."); },
  (error) => assert(String(error.message).includes("pedido a proveedor activo"), "Mensaje incorrecto para reposición activa.")
);

await run(createState(), {
  items: [
    { product_id: 10, cantidad: 3 },
    { product_id: 11, cantidad: 1 },
  ],
  discountType: "none",
  discountValue: 0,
  adminNotes: "Pedido web",
}).then(
  () => { throw new Error("Debía bloquear un guardado sin cambios."); },
  (error) => assert(String(error.message).includes("No se detectaron cambios"), "Mensaje incorrecto para guardado vacío.")
);

await run(createState(), {
  items: [
    { product_id: 10, cantidad: 1 },
    { product_id: 10, cantidad: 2 },
  ],
}).then(
  () => { throw new Error("Debía bloquear productos duplicados."); },
  (error) => assert(String(error.message).includes("no puede repetirse"), "Mensaje incorrecto para producto duplicado.")
);

const rollback = createState();
await run(rollback, {}, 4).then(
  () => { throw new Error("La prueba de rollback debía fallar."); },
  () => undefined
);
assert(rollback.order.content_version === 0, "El rollback alteró la versión.");
assert(rollback.items.length === 2 && rollback.items[0].product_id === 10 && rollback.items[1].product_id === 11, "El rollback alteró los productos.");
assert(rollback.history.length === 0, "El rollback dejó historial parcial.");

console.log(
  "Edición auditada de pedidos de clientes correcta: motivo, snapshots, importes, versiones, vínculos, concurrencia y rollback verificados."
);
