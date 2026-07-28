import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { customerOrderDeliveryReversalService } from "../server/services/customerOrderDeliveryReversalService.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};

const migration = read("supabase/25_customer_order_delivery_reversal.sql");
const api = read("api/sales.ts");
const deliveryService = read("server/services/customerOrderDeliveryService.ts");
const reversalService = read("server/services/customerOrderDeliveryReversalService.ts");
const salesService = read("server/services/salesService.ts");
const saleCancellation = read("server/services/saleCancellationService.ts");
const ui = read("src/components/CustomerOrdersAdmin.tsx");
const packageJson = JSON.parse(read("package.json"));

for (const token of [
  "delivery_version",
  "customer_order_deliveries",
  "customer_order_delivery_items",
  "uidx_cod_active_order",
  "codi_sale_item_id_fkey",
]) {
  assert(migration.includes(token), `La migración 25 no contiene ${token}.`);
}

assert(api.includes('endpoint === "customer-order-delivery-revert"'), "Vercel no expone la reversión de entrega.");
assert(api.includes("customerOrderDeliveryService.deliver"), "La entrega no utiliza el servicio transaccional.");
assert(api.includes("customerOrderDeliveryReversalService.revert"), "La API no utiliza el servicio de reversión.");
assert(deliveryService.includes("allow_shortage: false"), "La entrega permite faltantes de stock.");
assert(deliveryService.includes("customer_order_deliveries"), "La entrega no registra historial.");
assert(deliveryService.includes("customer_order_delivery_items"), "La entrega no registra productos trazables.");
assert(deliveryService.includes("salesService.createSale"), "La entrega no crea la venta trazable.");
assert(salesService.includes("async createSale(saleData: any, executor?: TransactionClient)"), "Ventas no admite una transacción externa.");
assert(salesService.includes("if (ownsTransaction) await client.query('COMMIT')"), "Ventas no respeta el propietario de la transacción.");
assert(salesService.includes("if (!allow_shortage && shortageItems.length > 0)"), "Ventas no bloquea faltantes cuando la entrega lo exige.");
assert(saleCancellation.includes("pendingCustomerOrderDeliveryReversalIds"), "Anular venta no conserva el pedido para revertir la entrega.");
assert(saleCancellation.includes("active_traced_delivery"), "Anular venta no detecta entregas trazables.");
assert(reversalService.includes("La anulación de la venta todavía no restauró todo el stock"), "La reversión no verifica el stock restaurado.");
assert(reversalService.includes("FOR UPDATE"), "La reversión no bloquea registros críticos.");
assert(ui.includes("Revertir entrega"), "La interfaz no ofrece reversión de entrega.");
assert(ui.includes("primero anulá la Venta"), "La interfaz no explica la protección por venta activa.");
assert(packageJson.scripts["check:customer-order-delivery-reversal"], "Falta la auditoría permanente.");
assert(packageJson.scripts["validate:audit"].includes("check:customer-order-delivery-reversal"), "La nueva auditoría no está en validate:audit.");

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

type State = {
  order: any;
  delivery: any;
  items: any[];
  allocations: any[];
  movements: any[];
  reversals: any[];
  cancellation: any;
  snapshot?: any;
};

const createState = (): State => ({
  order: {
    id: 44,
    numero_pedido: 801,
    estado: "entregado",
    sale_id: 90,
    sale_estado: "Anulada",
    numero_venta: 1501,
    sale_cancelled_at: "2026-07-28T12:00:00Z",
    delivery_version: 1,
    delivery_reverted_at: null,
    cancelled_at: null,
    admin_notes: "Pedido entregado",
  },
  delivery: {
    id: 61,
    customer_order_id: 44,
    sale_id: 90,
    previous_status: "aprobado_pendiente_entrega",
    reverted_at: null,
  },
  items: [
    {
      id: 71,
      delivery_id: 61,
      customer_order_item_id: 51,
      product_id: 7,
      quantity: 4,
      sale_item_id: 91,
      order_id: 44,
      order_product_id: 7,
      order_quantity: 4,
      sale_id: 90,
      sale_product_id: 7,
      sale_quantity: 4,
    },
  ],
  allocations: [{ id: 1, stock_movement_id: 81, product_id: 7, cantidad: 4 }],
  movements: [{ id: 81, product_id: 7, cantidad: -4, sale_id: 90, tipo_movimiento: "egreso" }],
  reversals: [{ id: 101, reversed_movement_id: 81, product_id: 7, cantidad: 4 }],
  cancellation: { id: 99, sale_id: 90 },
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
    if (sql.startsWith("SELECT id, estado, numero_venta, anulada_at FROM sales")) {
      const row = this.state.order.sale_id === Number(params[0])
        ? {
            id: this.state.order.sale_id,
            estado: this.state.order.sale_estado,
            numero_venta: this.state.order.numero_venta,
            anulada_at: this.state.order.sale_cancelled_at,
          }
        : null;
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.startsWith("SELECT * FROM customer_order_deliveries")) {
      const row = this.state.delivery.customer_order_id === Number(params[0]) && !this.state.delivery.reverted_at
        ? clone(this.state.delivery)
        : null;
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.startsWith("SELECT id FROM sale_cancellations")) {
      const row = this.state.cancellation?.sale_id === Number(params[0]) ? clone(this.state.cancellation) : null;
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.startsWith("SELECT codi.*, coi.order_id")) {
      const rows = this.state.items.filter(item => item.delivery_id === Number(params[0])).map(clone);
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith("SELECT id, stock_movement_id, product_id")) {
      const rows = this.state.allocations.map(clone);
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith("SELECT id, product_id, cantidad, sale_id")) {
      const requested = new Set((params[0] || []).map(Number));
      const rows = this.state.movements.filter(item => requested.has(Number(item.id))).map(clone);
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith("SELECT id, reversed_movement_id, product_id")) {
      const requested = new Set((params[0] || []).map(Number));
      const rows = this.state.reversals.filter(item => requested.has(Number(item.reversed_movement_id))).map(clone);
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith("UPDATE customer_order_deliveries SET reverted_at = now()")) {
      this.mutate();
      if (this.state.delivery.reverted_at) return { rows: [], rowCount: 0 };
      this.state.delivery.reverted_at = "2026-07-28T13:00:00Z";
      this.state.delivery.reverted_by = params[0];
      this.state.delivery.revert_reason = params[1];
      return { rows: [{ reverted_at: this.state.delivery.reverted_at }], rowCount: 1 };
    }
    if (sql.startsWith("UPDATE customer_orders SET estado = $1")) {
      this.mutate();
      if (this.state.order.estado !== "entregado" || this.state.order.sale_id !== Number(params[6])) {
        return { rows: [], rowCount: 0 };
      }
      this.state.order.estado = params[0];
      this.state.order.sale_id = null;
      this.state.order.entregado_at = null;
      this.state.order.delivery_reverted_at = params[1];
      this.state.order.delivery_reverted_by = params[2];
      this.state.order.delivery_revert_reason = params[3];
      this.state.order.admin_notes = params[4];
      return { rows: [clone(this.state.order)], rowCount: 1 };
    }

    throw new Error(`Consulta no simulada: ${sql}`);
  }
}

const run = async (state: State, failAt = 0) => {
  const client = new FakeClient(state, failAt);
  await client.query("BEGIN");
  try {
    const result = await customerOrderDeliveryReversalService.revert(
      { customerOrderId: 44, motivo: "Entrega confirmada por error", usuario: "Auditor" },
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
const result = await run(success);
assert(result.restored_units === 4, "La reversión no informó las unidades restauradas.");
assert(success.order.estado === "aprobado_pendiente_entrega", "El pedido no volvió a estar listo para entregar.");
assert(success.order.sale_id === null, "La venta anulada no fue desvinculada.");
assert(Boolean(success.delivery.reverted_at), "La entrega no quedó marcada como revertida.");
assert(success.order.admin_notes.includes("Entrega del pedido revertida"), "No se guardó la nota de auditoría.");

const activeSale = createState();
activeSale.order.sale_estado = "Pendiente";
activeSale.order.sale_cancelled_at = null;
await run(activeSale).then(
  () => { throw new Error("Debía bloquear una venta activa."); },
  error => assert(String(error.message).includes("Primero debe anularse"), "Mensaje incorrecto para venta activa.")
);
assert(activeSale.order.estado === "entregado" && !activeSale.delivery.reverted_at, "El bloqueo por venta activa dejó cambios.");

const historical = createState();
historical.order.delivery_version = 0;
await run(historical).then(
  () => { throw new Error("Debía bloquear una entrega histórica."); },
  error => assert(String(error.message).includes("anterior a la trazabilidad"), "Mensaje histórico incorrecto.")
);

const missingReversal = createState();
missingReversal.reversals = [];
await run(missingReversal).then(
  () => { throw new Error("Debía bloquear una venta sin stock restaurado."); },
  error => assert(String(error.message).includes("todavía no restauró"), "Mensaje incorrecto para stock no restaurado.")
);
assert(missingReversal.order.estado === "entregado", "El bloqueo de stock dejó cambios parciales.");

const duplicate = createState();
duplicate.order.delivery_reverted_at = "2026-07-28T11:00:00Z";
await run(duplicate).then(
  () => { throw new Error("Debía bloquear doble reversión."); },
  error => assert(String(error.message).includes("ya fue revertida"), "Mensaje incorrecto para doble reversión.")
);

const rollback = createState();
await run(rollback, 2).then(
  () => { throw new Error("La prueba de rollback debía fallar."); },
  () => undefined
);
assert(rollback.order.estado === "entregado" && rollback.order.sale_id === 90, "El rollback alteró el pedido.");
assert(!rollback.delivery.reverted_at, "El rollback dejó la entrega revertida.");

console.log("Reversión segura de entregas de pedidos de clientes correcta: venta previa, stock restaurado, trazabilidad, bloqueos y rollback verificados.");
