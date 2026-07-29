import fs from "node:fs";
import path from "node:path";
import { supplierOrderContentLifecycleService } from "../server/services/supplierOrderContentLifecycleService.js";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const assert = (condition: any, message: string) => { if (!condition) throw new Error(message); };
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const migration = read("supabase/30_supplier_order_content_lifecycle.sql");
const service = read("server/services/supplierOrderContentLifecycleService.ts");
const api = read("api/sales.ts");
const localRoute = read("server/routes/supplierOrderRoutes.ts");
const db = read("server/db.ts");
const ui = read("src/components/SupplierOrders.tsx");
const packageJson = read("package.json");

for (const token of [
  "BEGIN;",
  "content_version integer NOT NULL DEFAULT 0",
  "supplier_order_content_history",
  "before_snapshot jsonb NOT NULL",
  "after_snapshot jsonb NOT NULL",
  "supplier_order_content_history_unique_version",
  "idx_supplier_order_content_history_order",
  "COMMIT;",
]) assert(migration.includes(token), `La migración 30 no contiene ${token}.`);

assert(service.includes("Solo se pueden modificar productos durante la etapa Auditar pedido"), "El servicio permite editar fuera de Auditoría.");
assert(service.includes("FOR UPDATE"), "El servicio no bloquea el pedido y sus productos.");
assert(service.includes("input.expectedContentVersion"), "Falta control de versión del contenido.");
assert(service.includes("input.expectedStatusVersion"), "Falta control de versión de la etapa.");
assert(service.includes("before_snapshot, after_snapshot"), "El historial no conserva snapshots antes y después.");
assert(service.includes("DELETE FROM supplier_order_items"), "El reemplazo atómico de productos no está centralizado.");
assert(service.includes("Uno o más productos no existen o están dados de baja"), "Falta validar productos activos.");
assert(service.includes("No se detectaron cambios en productos ni observaciones"), "Falta bloquear guardados vacíos.");

assert(api.includes("supplierOrderContentLifecycleService.update"), "Vercel no delega la edición al servicio auditado.");
assert(api.includes("expected_content_version"), "Vercel no exige versión del contenido.");
assert(api.includes("expected_status_version"), "Vercel no exige versión de la etapa.");
const apiBlock = api.slice(
  api.indexOf('if (endpoint === "supplier-order-items"'),
  api.indexOf('if (endpoint === "supplier-order" && req.method === "DELETE")')
);
assert(!/DELETE\s+FROM\s+supplier_order_items/i.test(apiBlock), "Vercel conserva el DELETE directo fuera del servicio.");
assert(!/UPDATE\s+supplier_orders/i.test(apiBlock), "Vercel conserva el UPDATE directo fuera del servicio.");
assert(localRoute.includes("supplierOrderContentLifecycleService.update"), "Express local no usa el servicio auditado.");
assert(localRoute.includes("router.put('/:id/items'"), "Express local no expone la edición segura.");
assert(db.includes("CREATE TABLE IF NOT EXISTS supplier_order_content_history"), "SQLite no crea historial de contenido.");
assert(db.includes("ALTER TABLE supplier_orders ADD COLUMN content_version"), "SQLite no migra la versión de contenido.");
assert(ui.includes("Motivo obligatorio del cambio"), "La interfaz no solicita el motivo.");
assert(ui.includes("expected_content_version: Number(editingOrder.content_version || 0)"), "La interfaz no envía la versión del contenido.");
assert(ui.includes("expected_status_version: Number(editingOrder.status_version || 0)"), "La interfaz no envía la versión de etapa.");
assert(ui.includes("snapshots antes y después"), "La interfaz no informa la trazabilidad.");
assert(packageJson.includes("check:supplier-order-content-lifecycle"), "package.json no registra la auditoría de la Fase 8.13.");

interface State {
  order: any;
  items: any[];
  products: any[];
  history: any[];
  snapshot?: State;
}

const createState = (): State => ({
  order: {
    id: 41,
    numero_pedido: 302,
    estado: "auditar_pedido",
    notes: "Remito pendiente",
    stock_actualizado: 0,
    sale_id: null,
    cancelled_at: null,
    delivered_at: null,
    delivery_reverted_at: null,
    status_version: 2,
    content_version: 0,
  },
  items: [
    { id: 501, order_id: 41, product_id: 7, cantidad: 4, product_name: "Producto A", product_code: "A-1" },
    { id: 502, order_id: 41, product_id: 8, cantidad: 2, product_name: "Producto B", product_code: "B-1" },
  ],
  products: [
    { id: 7, name: "Producto A", product_code: "A-1", eliminado: 0 },
    { id: 8, name: "Producto B", product_code: "B-1", eliminado: 0 },
    { id: 9, name: "Producto C", product_code: "C-1", eliminado: 0 },
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
        products: this.state.products,
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
        this.state.history = restored.history;
        delete this.state.snapshot;
      }
      return { rows: [], rowCount: null };
    }

    if (sql.startsWith("SELECT * FROM supplier_orders")) {
      const row = this.state.order.id === Number(params[0]) ? clone(this.state.order) : null;
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.startsWith("SELECT soi.id, soi.product_id, soi.cantidad")) {
      const rows = this.state.items
        .filter((item) => item.order_id === Number(params[0]))
        .map(clone);
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith("SELECT id, name, COALESCE(codigo_unico")) {
      const ids = (params[0] || []).map(Number);
      const rows = this.state.products.filter((product) => ids.includes(product.id) && !product.eliminado).map(clone);
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith("INSERT INTO supplier_order_content_history")) {
      this.mutate();
      const row = {
        id: this.state.history.length + 1,
        supplier_order_id: Number(params[0]),
        version: Number(params[1]),
        status_at_change: params[2],
        reason: params[3],
        changed_by: params[4],
        changed_at: `2026-07-29T1${this.state.history.length}:00:00Z`,
        before_snapshot: JSON.parse(params[5]),
        after_snapshot: JSON.parse(params[6]),
      };
      this.state.history.push(row);
      return { rows: [{ id: row.id, changed_at: row.changed_at }], rowCount: 1 };
    }
    if (sql.startsWith("UPDATE supplier_orders SET notes = $1")) {
      this.mutate();
      if (
        this.state.order.id !== Number(params[5])
        || this.state.order.estado !== "auditar_pedido"
        || Number(this.state.order.content_version || 0) !== Number(params[6])
        || Number(this.state.order.status_version || 0) !== Number(params[7])
      ) return { rows: [], rowCount: 0 };

      this.state.order.notes = params[0];
      this.state.order.content_version = Number(params[1]);
      this.state.order.content_changed_at = params[2];
      this.state.order.content_changed_by = params[3];
      this.state.order.content_change_reason = params[4];
      return { rows: [clone(this.state.order)], rowCount: 1 };
    }
    if (sql.startsWith("DELETE FROM supplier_order_items")) {
      this.mutate();
      this.state.items = this.state.items.filter((item) => item.order_id !== Number(params[0]));
      return { rows: [], rowCount: null };
    }
    if (sql.startsWith("INSERT INTO supplier_order_items")) {
      this.mutate();
      this.state.items.push({
        id: 600 + this.state.items.length,
        order_id: Number(params[0]),
        product_id: Number(params[1]),
        cantidad: Number(params[2]),
      });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("SELECT soi.id, soi.order_id, soi.product_id")) {
      const rows = this.state.items
        .filter((item) => item.order_id === Number(params[0]))
        .map((item) => {
          const product = this.state.products.find((entry) => entry.id === item.product_id);
          return { ...clone(item), product_name: product?.name || "", product_code: product?.product_code || "" };
        });
      return { rows, rowCount: rows.length };
    }

    throw new Error(`Consulta no simulada: ${sql}`);
  }
}

const run = async (state: State, overrides: Partial<Parameters<typeof supplierOrderContentLifecycleService.update>[0]> = {}, failAt = 0) => {
  const client = new FakeClient(state, failAt);
  await client.query("BEGIN");
  try {
    const result = await supplierOrderContentLifecycleService.update({
      supplierOrderId: 41,
      items: [
        { product_id: 7, cantidad: 5 },
        { product_id: 9, cantidad: 1 },
      ],
      notes: "Cantidades verificadas contra remito",
      motivo: "Ajuste según mercadería efectivamente recibida",
      usuario: "Auditor",
      expectedContentVersion: 0,
      expectedStatusVersion: 2,
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
assert(success.items.length === 2 && success.items.some((item) => item.product_id === 9), "Los productos no se reemplazaron correctamente.");
assert(success.history.length === 1, "No se guardó el historial de edición.");
assert(success.history[0].before_snapshot.items.length === 2, "El snapshot anterior no conserva los productos.");
assert(success.history[0].after_snapshot.items.some((item: any) => item.product_id === 9), "El snapshot posterior no conserva los productos nuevos.");

await run(createState(), { motivo: "" }).then(
  () => { throw new Error("Debía exigir motivo."); },
  (error) => assert(String(error.message).includes("motivo del cambio"), "Mensaje incorrecto para motivo faltante.")
);

const wrongStatus = createState();
wrongStatus.order.estado = "pedido_realizado";
await run(wrongStatus).then(
  () => { throw new Error("Debía bloquear la edición fuera de Auditoría."); },
  (error) => assert(String(error.message).includes("Auditar pedido"), "Mensaje incorrecto para etapa inválida.")
);

await run(createState(), { expectedContentVersion: 3 }).then(
  () => { throw new Error("Debía bloquear una pestaña antigua."); },
  (error) => assert(String(error.message).includes("contenido del pedido cambió"), "Mensaje incorrecto para versión antigua.")
);

await run(createState(), {
  items: [
    { product_id: 7, cantidad: 4 },
    { product_id: 8, cantidad: 2 },
  ],
  notes: "Remito pendiente",
}).then(
  () => { throw new Error("Debía bloquear un guardado sin cambios."); },
  (error) => assert(String(error.message).includes("No se detectaron cambios"), "Mensaje incorrecto para guardado vacío.")
);

await run(createState(), {
  items: [
    { product_id: 7, cantidad: 1 },
    { product_id: 7, cantidad: 2 },
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
assert(rollback.order.content_version === 0, "El rollback alteró la versión del pedido.");
assert(rollback.items.length === 2 && rollback.items[0].product_id === 7 && rollback.items[1].product_id === 8, "El rollback alteró los productos.");
assert(rollback.history.length === 0, "El rollback dejó historial parcial.");

console.log(
  "Edición auditada de pedidos a proveedor correcta: motivo, snapshots, versiones, productos activos, concurrencia y rollback verificados."
);
