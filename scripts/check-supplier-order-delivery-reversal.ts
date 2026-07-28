import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { supplierOrderDeliveryReversalService } from "../server/services/supplierOrderDeliveryReversalService.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};

const migration = read("supabase/23_supplier_order_delivery_reversal.sql");
const api = read("api/sales.ts");
const routes = read("server/routes/supplierOrderRoutes.ts");
const service = read("server/services/supplierOrderDeliveryReversalService.ts");
const localCompletion = read("server/services/supplierOrderService.ts");
const ui = read("src/components/SupplierOrders.tsx");
const database = read("server/db.ts");
const packageJson = JSON.parse(read("package.json"));

for (const token of [
  "delivery_version",
  "supplier_order_deliveries",
  "supplier_order_delivery_items",
  "supplier_order_id",
  "sodi_ingress_movement_fkey",
  "idx_stock_movements_supplier_order",
]) {
  assert(migration.includes(token), `La migración 23 no contiene ${token}.`);
}

assert(api.includes('endpoint === "supplier-order-delivery-revert"'), "Vercel no expone la reversión de entrega.");
assert(api.includes("recordSupplierDelivery"), "La entrega nueva no registra trazabilidad.");
assert(api.includes("reversion_version\n            )\n            VALUES") || api.includes("reversion_version"), "Los ingresos de proveedor no se marcan como reversibles.");
assert(api.includes("supplier_order_id"), "Los movimientos no se vinculan al pedido a proveedor.");
assert(routes.includes("/:id/revert-delivery"), "Express no expone la reversión de entrega.");
assert(service.includes("Primero debe anularse la Venta"), "El servicio no protege ventas activas.");
assert(service.includes("stock_movement_cancellations"), "El servicio no audita los contramovimientos.");
assert(service.includes("FOR UPDATE"), "El servicio no bloquea registros críticos.");
assert(service.includes("reversed_movement_id"), "El servicio no vincula los contramovimientos.");
assert(localCompletion.includes("supplier_order_deliveries"), "La entrega local no registra trazabilidad.");
assert(ui.includes("Revertir entrega"), "La interfaz no ofrece reversión de entrega.");
assert(ui.includes("Primero debe anularse la venta vinculada"), "La interfaz no explica la protección por venta.");
assert(database.includes("CREATE TABLE IF NOT EXISTS supplier_order_deliveries"), "SQLite no contiene entregas auditadas.");
assert(packageJson.scripts["check:supplier-order-delivery-reversal"], "Falta el script permanente de auditoría.");
assert(packageJson.scripts["validate:audit"].includes("check:supplier-order-delivery-reversal"), "La auditoría nueva no está en validate:audit.");

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

type FakeState = {
  order: any;
  delivery: any;
  items: any[];
  products: Record<number, any>;
  existingSaleReversals: number[];
  newMovements: any[];
  cancellations: any[];
  customerNotes: string;
  nextMovementId: number;
  snapshot?: any;
};

const createState = (linkedSale = false): FakeState => ({
  order: {
    id: 41,
    numero_pedido: 700,
    estado: "entregado",
    stock_actualizado: 1,
    delivery_version: 1,
    delivery_reverted_at: null,
    sale_id: linkedSale ? 90 : null,
    sale_estado: linkedSale ? "Anulada" : null,
    numero_venta: linkedSale ? 1500 : null,
    customer_order_id: 55,
    customer_order_estado: "aprobado_pendiente_entrega",
    customer_order_notes: "Pedido aprobado",
  },
  delivery: {
    id: 61,
    supplier_order_id: 41,
    delivery_mode: linkedSale ? "linked_sale" : "stock_only",
    previous_status: "auditar_pedido",
    sale_id_before: linkedSale ? 90 : null,
    sale_id_after: linkedSale ? 90 : null,
    customer_order_id: 55,
    reverted_at: null,
  },
  items: [
    {
      id: 71,
      delivery_id: 61,
      product_id: 7,
      quantity: 4,
      unit_cost: 120,
      ingress_movement_id: 81,
      egress_movement_id: linkedSale ? 82 : null,
      movement_product_id: 7,
      movement_quantity: 4,
      movement_cost: 120,
      tipo_movimiento: "ingreso",
      movement_reason: "pedido_proveedor",
      movement_supplier_order_id: 41,
      movement_reversion_version: 1,
      movement_cancelled_at: null,
      reversed_movement_id: null,
      cantidad_restante: 4,
    },
  ],
  products: { 7: { id: 7, name: "Producto prueba", stock: 10, cost: 120 } },
  existingSaleReversals: linkedSale ? [82] : [],
  newMovements: [],
  cancellations: [],
  customerNotes: "Pedido aprobado",
  nextMovementId: 100,
});

class FakeClient {
  private mutation = 0;
  constructor(public state: FakeState, private failAt = 0) {}

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

    if (sql.startsWith("SELECT so.*, s.estado AS sale_estado")) {
      return { rows: this.state.order?.id === Number(params[0]) ? [clone(this.state.order)] : [], rowCount: this.state.order?.id === Number(params[0]) ? 1 : 0 };
    }
    if (sql.startsWith("SELECT * FROM supplier_order_deliveries")) {
      const row = this.state.delivery?.supplier_order_id === Number(params[0]) && !this.state.delivery.reverted_at ? clone(this.state.delivery) : null;
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.startsWith("SELECT sodi.*, sm.product_id AS movement_product_id")) {
      const rows = this.state.items.filter(item => item.delivery_id === Number(params[0])).map(clone);
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith("SELECT reversed_movement_id FROM stock_movimientos")) {
      const requested = new Set((params[0] || []).map(Number));
      const rows = this.state.existingSaleReversals.filter(id => requested.has(id)).map(id => ({ reversed_movement_id: id }));
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith("SELECT id, name, stock, cost FROM products")) {
      const rows = (params[0] || []).map((id: number) => this.state.products[Number(id)]).filter(Boolean).map(clone);
      return { rows, rowCount: rows.length };
    }

    if (sql.startsWith("UPDATE products SET stock = COALESCE(stock, 0) - $1")) {
      this.mutate();
      this.state.products[Number(params[1])].stock -= Number(params[0]);
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("INSERT INTO stock_movimientos")) {
      this.mutate();
      const id = this.state.nextMovementId++;
      this.state.newMovements.push({
        id,
        product_id: Number(params[0]),
        cantidad: Number(params[1]),
        costo_unitario: Number(params[2]),
        descripcion: params[3],
        usuario: params[4],
        supplier_order_id: Number(params[5]),
        reversed_movement_id: Number(params[6]),
      });
      return { rows: [{ id }], rowCount: 1 };
    }
    if (sql.startsWith("UPDATE stock_movimientos SET anulada_at = now()")) {
      this.mutate();
      const item = this.state.items.find(row => row.ingress_movement_id === Number(params[2]));
      if (!item || item.movement_cancelled_at) return { rows: [], rowCount: 0 };
      item.movement_cancelled_at = "2026-07-28T12:00:00Z";
      item.cantidad_restante = 0;
      return { rows: [{ anulada_at: item.movement_cancelled_at }], rowCount: 1 };
    }
    if (sql.startsWith("INSERT INTO stock_movement_cancellations")) {
      this.mutate();
      this.state.cancellations.push({ params: clone(params) });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("UPDATE supplier_order_deliveries SET reverted_at = now()")) {
      this.mutate();
      if (this.state.delivery.reverted_at) return { rows: [], rowCount: 0 };
      this.state.delivery.reverted_at = "2026-07-28T12:00:00Z";
      this.state.delivery.reverted_by = params[0];
      this.state.delivery.revert_reason = params[1];
      return { rows: [{ reverted_at: this.state.delivery.reverted_at }], rowCount: 1 };
    }
    if (sql.startsWith("UPDATE supplier_orders SET estado = $1")) {
      this.mutate();
      this.state.order.estado = params[0];
      this.state.order.stock_actualizado = 0;
      this.state.order.sale_id = null;
      this.state.order.delivery_reverted_at = "2026-07-28T12:00:00Z";
      this.state.order.delivery_reverted_by = params[1];
      this.state.order.delivery_revert_reason = params[2];
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("UPDATE customer_orders SET admin_notes = $1")) {
      this.mutate();
      this.state.customerNotes = String(params[0]);
      return { rows: [], rowCount: 1 };
    }

    throw new Error(`Consulta no simulada: ${sql}`);
  }
}

const runReversal = async (state: FakeState, failAt = 0) => {
  const client = new FakeClient(state, failAt);
  await client.query("BEGIN");
  try {
    const result = await supplierOrderDeliveryReversalService.revert(
      { supplierOrderId: 41, motivo: "Entrega confirmada por error", usuario: "Auditor" },
      client as any
    );
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
};

const stockOnly = createState(false);
const stockOnlyResult = await runReversal(stockOnly);
assert(stockOnlyResult.restoredUnits === 4, "La reversión no informó las unidades exactas.");
assert(stockOnly.products[7].stock === 6, "La reversión no retiró el stock incorporado.");
assert(stockOnly.newMovements[0]?.cantidad === -4, "El contramovimiento tiene cantidad incorrecta.");
assert(stockOnly.newMovements[0]?.reversed_movement_id === 81, "El contramovimiento no está vinculado al ingreso.");
assert(stockOnly.order.estado === "auditar_pedido" && stockOnly.order.stock_actualizado === 0, "El pedido no volvió a Auditoría.");
assert(stockOnly.order.sale_id === null, "La venta no fue desvinculada.");
assert(Boolean(stockOnly.delivery.reverted_at), "La entrega no quedó marcada como revertida.");
assert(stockOnly.cancellations.length === 1, "No se creó la auditoría de stock.");
assert(stockOnly.customerNotes.includes("revertida"), "No se informó la reversión en el pedido de cliente.");

const linked = createState(true);
await runReversal(linked);
assert(linked.products[7].stock === 6, "La entrega con venta anulada no se revirtió.");

const activeSale = createState(true);
activeSale.order.sale_estado = "Pagada";
await runReversal(activeSale).then(
  () => { throw new Error("Debía bloquear una venta activa."); },
  error => assert(String(error.message).includes("Primero debe anularse"), "Mensaje incorrecto para venta activa.")
);
assert(activeSale.products[7].stock === 10, "El bloqueo por venta activa dejó cambios parciales.");

const missingSaleStockReversal = createState(true);
missingSaleStockReversal.existingSaleReversals = [];
await runReversal(missingSaleStockReversal).then(
  () => { throw new Error("Debía bloquear una venta sin contramovimientos."); },
  error => assert(String(error.message).includes("todavía no restauró"), "Mensaje incorrecto para venta sin stock restaurado.")
);

const historical = createState(false);
historical.order.delivery_version = 0;
await runReversal(historical).then(
  () => { throw new Error("Debía bloquear una entrega histórica."); },
  error => assert(String(error.message).includes("anterior a la trazabilidad"), "Mensaje histórico incorrecto.")
);

const insufficient = createState(false);
insufficient.products[7].stock = 2;
await runReversal(insufficient).then(
  () => { throw new Error("Debía bloquear stock insuficiente."); },
  error => assert(String(error.message).includes("insuficiente"), "Mensaje incorrecto para stock insuficiente.")
);
assert(insufficient.products[7].stock === 2 && insufficient.newMovements.length === 0, "El bloqueo de stock dejó cambios parciales.");

const duplicate = createState(false);
duplicate.order.delivery_reverted_at = "2026-07-28T10:00:00Z";
await runReversal(duplicate).then(
  () => { throw new Error("Debía bloquear doble reversión."); },
  error => assert(String(error.message).includes("ya fue revertida"), "Mensaje incorrecto para doble reversión.")
);

const rollback = createState(false);
await runReversal(rollback, 2).then(
  () => { throw new Error("La prueba de rollback debía fallar."); },
  () => undefined
);
assert(rollback.products[7].stock === 10, "El rollback no restauró el stock.");
assert(rollback.newMovements.length === 0 && rollback.cancellations.length === 0, "El rollback dejó movimientos parciales.");
assert(!rollback.delivery.reverted_at && rollback.order.estado === "entregado", "El rollback alteró la entrega.");

console.log("Reversión segura de entregas a proveedor correcta: trazabilidad, venta previa, stock, auditoría, bloqueos y rollback verificados.");
