import fs from "node:fs";
import path from "node:path";
import { customerOrderApprovalService } from "../server/services/customerOrderApprovalService.js";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const assert = (condition: any, message: string) => {
  if (!condition) throw new Error(message);
};
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const migration = read("supabase/31_customer_order_approval_lifecycle.sql");
const service = read("server/services/customerOrderApprovalService.ts");
const api = read("api/sales.ts");
const ui = read("src/components/CustomerOrdersAdmin.tsx");
const packageJson = read("package.json");

assert(typeof customerOrderApprovalService.approve === "function", "El servicio de aprobación no exporta approve.");

for (const token of [
  "BEGIN;",
  "approval_version integer NOT NULL DEFAULT 0",
  "customer_order_approvals",
  "order_snapshot jsonb NOT NULL",
  "items_snapshot jsonb NOT NULL",
  "shortages_snapshot jsonb NOT NULL",
  "customer_order_approvals_unique_version",
  "idx_customer_order_approvals_supplier_order",
  "COMMIT;",
]) {
  assert(migration.includes(token), `La migración 31 no contiene ${token}.`);
}

for (const token of [
  "FOR UPDATE OF co",
  "FOR UPDATE OF coi, p",
  "expectedApprovalVersion",
  "expectedRejectionVersion",
  "expectedContentVersion",
  "El pedido ya tiene un pedido a proveedor activo",
  "FROM supplier_orders",
  "estado <> 'cancelado'",
  "customer_order_approvals",
  "shortages_snapshot",
  "INSERT INTO supplier_orders",
  "INSERT INTO supplier_order_items",
  "FOR UPDATE",
  "ROLLBACK",
]) {
  assert(service.includes(token), `El servicio de aprobación no contiene ${token}.`);
}

assert(!service.includes("DELETE FROM supplier_order_items"), "La aprobación todavía borra productos de pedidos a proveedor existentes.");
assert(!service.includes("UPDATE supplier_orders\n"), "La aprobación todavía modifica pedidos a proveedor existentes.");
assert(api.includes("customerOrderApprovalService.approve"), "Vercel no delega la aprobación al servicio seguro.");
assert(api.includes("expected_approval_version"), "Vercel no exige la versión de aprobación.");
assert(api.includes("expected_rejection_version"), "Vercel no exige la versión de rechazo.");
assert(api.includes("expected_content_version"), "Vercel no exige la versión de contenido.");
assert(!api.includes("ensureSupplierOrderForCustomerOrder"), "Vercel conserva el helper que sobrescribía pedidos a proveedor.");
assert(!api.includes("getCustomerOrderShortages"), "Vercel conserva la generación directa anterior de faltantes.");
assert(ui.includes("expected_approval_version: Number(order.approval_version || 0)"), "La interfaz no envía la versión de aprobación.");
assert(ui.includes("expected_rejection_version: Number(order.rejection_version || 0)"), "La interfaz no envía la versión de rechazo.");
assert(ui.includes("expected_content_version: Number(order.content_version || 0)"), "La interfaz no envía la versión de contenido.");
assert(ui.includes("Aprobación auditada · versión"), "La interfaz no muestra la trazabilidad de aprobación.");
assert(packageJson.includes("check:customer-order-approval-lifecycle"), "package.json no registra la auditoría de la Fase 8.14.");

type Product = {
  id: number;
  name: string;
  stock: number;
  active: boolean;
};

type OrderItem = {
  id: number;
  product_id: number;
  cantidad: number;
  precio_unitario: number;
};

type State = {
  order: any;
  items: OrderItem[];
  products: Product[];
  supplierOrders: any[];
  supplierItems: any[];
  approvals: any[];
  nextSupplierOrderNumber: number;
};

const baseState = (): State => ({
  order: {
    id: 71,
    numero_pedido: 940,
    cliente_id: 5,
    cliente: "Cliente de prueba",
    estado: "pendiente_aprobacion",
    subtotal: 2000,
    descuento_tipo: "none",
    descuento_valor: 0,
    descuento_monto: 0,
    total_final: 2000,
    admin_notes: null,
    sale_id: null,
    cancelled_at: null,
    entregado_at: null,
    rejected_at: null,
    rejection_version: 0,
    approval_version: 0,
    content_version: 0,
  },
  items: [
    { id: 1, product_id: 10, cantidad: 3, precio_unitario: 500 },
    { id: 2, product_id: 11, cantidad: 1, precio_unitario: 500 },
  ],
  products: [
    { id: 10, name: "Producto A", stock: 1, active: true },
    { id: 11, name: "Producto B", stock: 5, active: true },
  ],
  supplierOrders: [],
  supplierItems: [],
  approvals: [],
  nextSupplierOrderNumber: 301,
});

type ApprovalOptions = {
  expectedApprovalVersion?: number;
  expectedRejectionVersion?: number;
  expectedContentVersion?: number;
  discountType?: "none" | "percentage" | "fixed";
  discountValue?: number;
  failAfterSupplierOrder?: boolean;
};

const approveModel = (state: State, options: ApprovalOptions = {}) => {
  const before = clone(state);

  try {
    if (state.order.estado !== "pendiente_aprobacion") {
      throw new Error("Solo se pueden aprobar pedidos pendientes");
    }
    if (state.order.sale_id || state.order.cancelled_at || state.order.entregado_at || state.order.rejected_at) {
      throw new Error("Vínculos incompatibles");
    }

    const expectedApprovalVersion = options.expectedApprovalVersion ?? 0;
    const expectedRejectionVersion = options.expectedRejectionVersion ?? 0;
    const expectedContentVersion = options.expectedContentVersion ?? 0;
    if (state.order.approval_version !== expectedApprovalVersion) {
      throw new Error("Versión de aprobación desactualizada");
    }
    if (state.order.rejection_version !== expectedRejectionVersion) {
      throw new Error("Versión de rechazo desactualizada");
    }
    if (state.order.content_version !== expectedContentVersion) {
      throw new Error("Versión de contenido desactualizada");
    }

    const activeSupplierOrders = state.supplierOrders.filter((order) => order.estado !== "cancelado");
    if (activeSupplierOrders.length) {
      throw new Error("Pedido a proveedor activo");
    }

    const productMap = new Map(state.products.map((product) => [product.id, product]));
    const grouped = new Map<number, { product_id: number; cantidad: number; stock: number }>();
    let subtotal = 0;

    for (const item of state.items) {
      const product = productMap.get(item.product_id);
      if (!product || !product.active) throw new Error("Producto dado de baja");
      if (!Number.isInteger(item.cantidad) || item.cantidad <= 0) throw new Error("Cantidad inválida");
      subtotal += item.cantidad * item.precio_unitario;

      const current = grouped.get(item.product_id) || {
        product_id: item.product_id,
        cantidad: 0,
        stock: product.stock,
      };
      current.cantidad += item.cantidad;
      grouped.set(item.product_id, current);
    }

    const shortages = Array.from(grouped.values())
      .map((item) => ({
        product_id: item.product_id,
        cantidad: Math.max(0, item.cantidad - item.stock),
      }))
      .filter((item) => item.cantidad > 0);

    let supplierOrderId: number | null = null;
    if (shortages.length) {
      supplierOrderId = 900 + state.supplierOrders.length;
      state.supplierOrders.push({
        id: supplierOrderId,
        numero_pedido: state.nextSupplierOrderNumber++,
        customer_order_id: state.order.id,
        estado: "pendiente",
      });
      for (const shortage of shortages) {
        state.supplierItems.push({
          order_id: supplierOrderId,
          product_id: shortage.product_id,
          cantidad: shortage.cantidad,
        });
      }
    }

    if (options.failAfterSupplierOrder) {
      throw new Error("Falla simulada posterior a la creación del pedido a proveedor");
    }

    const discountType = options.discountType || "none";
    const discountValue = options.discountValue || 0;
    const discountAmount = discountType === "percentage"
      ? subtotal * discountValue / 100
      : discountType === "fixed"
        ? discountValue
        : 0;
    const nextVersion = state.order.approval_version + 1;

    state.approvals.push({
      customer_order_id: state.order.id,
      version: nextVersion,
      supplier_order_id: supplierOrderId,
      order_snapshot: clone(before.order),
      items_snapshot: clone(before.items),
      shortages_snapshot: clone(shortages),
    });
    state.order.estado = "aprobado_pendiente_entrega";
    state.order.subtotal = subtotal;
    state.order.descuento_tipo = discountType;
    state.order.descuento_valor = discountValue;
    state.order.descuento_monto = discountAmount;
    state.order.total_final = Math.max(0, subtotal - discountAmount);
    state.order.approval_version = nextVersion;
    state.order.approved_by = "Auditor";
    state.order.aprobado_at = "2026-07-29T22:00:00.000Z";

    return { supplierOrderId, shortages };
  } catch (error) {
    Object.assign(state, before);
    throw error;
  }
};

{
  const state = baseState();
  const result = approveModel(state, { discountType: "percentage", discountValue: 10 });
  assert(state.order.estado === "aprobado_pendiente_entrega", "La aprobación no cambió el estado.");
  assert(state.order.approval_version === 1, "La aprobación no incrementó la versión.");
  assert(state.approvals.length === 1, "La aprobación no creó historial.");
  assert(result.shortages.length === 1 && result.shortages[0].cantidad === 2, "El faltante no se calculó producto por producto.");
  assert(state.supplierOrders.length === 1, "No se creó el pedido a proveedor por faltantes.");
  assert(state.supplierItems.length === 1 && state.supplierItems[0].cantidad === 2, "El pedido a proveedor no conserva la cantidad faltante.");
}

{
  const state = baseState();
  state.products[0].stock = 10;
  const result = approveModel(state);
  assert(result.supplierOrderId === null, "Se creó un pedido a proveedor sin faltantes.");
  assert(state.supplierOrders.length === 0, "Se generó reposición innecesaria.");
}

{
  const state = baseState();
  state.supplierOrders.push({ id: 8, estado: "auditar_pedido", customer_order_id: state.order.id });
  const before = clone(state);
  let blocked = false;
  try {
    approveModel(state);
  } catch {
    blocked = true;
  }
  assert(blocked, "No se bloqueó la aprobación con un pedido a proveedor activo.");
  assert(JSON.stringify(state) === JSON.stringify(before), "El bloqueo modificó datos parcialmente.");
}

{
  const state = baseState();
  state.supplierOrders.push({ id: 8, estado: "cancelado", customer_order_id: state.order.id });
  approveModel(state);
  assert(state.supplierOrders.length === 2, "El pedido cancelado histórico fue sobrescrito en lugar de crear uno nuevo.");
  assert(state.supplierOrders[0].estado === "cancelado", "Se alteró el pedido a proveedor cancelado.");
}

{
  const state = baseState();
  state.order.rejection_version = 2;
  const before = clone(state);
  let blocked = false;
  try {
    approveModel(state, { expectedRejectionVersion: 1 });
  } catch {
    blocked = true;
  }
  assert(blocked, "Una pestaña antigua pudo aprobar después de cambiar el ciclo de rechazo.");
  assert(JSON.stringify(state) === JSON.stringify(before), "El bloqueo por versión dejó cambios parciales.");
}

{
  const state = baseState();
  state.order.content_version = 2;
  const before = clone(state);
  let blocked = false;
  try {
    approveModel(state, { expectedContentVersion: 1 });
  } catch {
    blocked = true;
  }
  assert(blocked, "Una pestaña antigua pudo aprobar después de editar el contenido.");
  assert(JSON.stringify(state) === JSON.stringify(before), "El bloqueo por contenido dejó cambios parciales.");
}

{
  const state = baseState();
  state.products[0].active = false;
  const before = clone(state);
  let blocked = false;
  try {
    approveModel(state);
  } catch {
    blocked = true;
  }
  assert(blocked, "Se aprobó un pedido con un producto dado de baja.");
  assert(JSON.stringify(state) === JSON.stringify(before), "El producto inactivo dejó cambios parciales.");
}

{
  const state = baseState();
  const before = clone(state);
  let blocked = false;
  try {
    approveModel(state, { failAfterSupplierOrder: true });
  } catch {
    blocked = true;
  }
  assert(blocked, "La falla simulada no interrumpió la aprobación.");
  assert(JSON.stringify(state) === JSON.stringify(before), "El rollback dejó un pedido a proveedor huérfano.");
}

{
  const state = baseState();
  approveModel(state);
  const beforeSecond = clone(state);
  let blocked = false;
  try {
    approveModel(state, { expectedApprovalVersion: 1 });
  } catch {
    blocked = true;
  }
  assert(blocked, "La doble aprobación no fue bloqueada.");
  assert(JSON.stringify(state) === JSON.stringify(beforeSecond), "La doble aprobación modificó datos.");
}


class FakeApprovalClient {
  order: any = {
    id: 91,
    numero_pedido: 1201,
    cliente_id: 6,
    cliente: "Cliente integración",
    cliente_telefono: "3410000000",
    estado: "pendiente_aprobacion",
    subtotal: 2000,
    descuento_tipo: "none",
    descuento_valor: 0,
    descuento_monto: 0,
    total_final: 2000,
    admin_notes: null,
    sale_id: null,
    cancelled_at: null,
    entregado_at: null,
    rejected_at: null,
    rejection_version: 0,
    approval_version: 0,
    content_version: 0,
  };
  items = [
    {
      id: 31,
      product_id: 101,
      cantidad: 4,
      precio_unitario: 500,
      product_name: "Producto integración",
      product_code: "INT-101",
      stock_actual: 1,
      eliminado: 0,
      product_status: "activo",
    },
  ];
  supplierOrders: any[] = [];
  supplierItems: any[] = [];
  approvals: any[] = [];
  settingValue = 700;

  async query(text: string, params: any[] = []) {
    const sql = text.replace(/\s+/g, " ").trim();

    if (sql.includes("FROM customer_orders co") && sql.includes("FOR UPDATE OF co")) {
      return { rows: [clone(this.order)], rowCount: 1 };
    }
    if (sql.includes("FROM customer_order_rejections")) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("FROM supplier_orders") && sql.includes("estado <> 'cancelado'")) {
      const active = this.supplierOrders.filter((order) => order.estado !== "cancelado");
      return { rows: clone(active), rowCount: active.length };
    }
    if (sql.includes("FROM customer_order_items coi") && sql.includes("FOR UPDATE OF coi, p")) {
      return { rows: clone(this.items), rowCount: this.items.length };
    }
    if (sql.startsWith("INSERT INTO settings")) {
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("SELECT value FROM settings")) {
      return { rows: [{ value: String(this.settingValue) }], rowCount: 1 };
    }
    if (sql.startsWith("UPDATE settings")) {
      this.settingValue = Number(params[1]);
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("INSERT INTO supplier_orders")) {
      const created = {
        id: 501,
        numero_pedido: params[0],
        cliente: params[1],
        cliente_id: params[2],
        customer_order_id: params[3],
        estado: "pendiente",
      };
      this.supplierOrders.push(created);
      return { rows: [{ id: created.id }], rowCount: 1 };
    }
    if (sql.startsWith("INSERT INTO supplier_order_items")) {
      this.supplierItems.push({
        order_id: params[0],
        product_id: params[1],
        cantidad: params[2],
      });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("INSERT INTO customer_order_approvals")) {
      const created = {
        id: 601,
        customer_order_id: params[0],
        version: params[1],
        supplier_order_id: params[9],
        approved_at: "2026-07-29T22:30:00.000Z",
      };
      this.approvals.push(created);
      return { rows: [{ id: created.id, approved_at: created.approved_at }], rowCount: 1 };
    }
    if (sql.startsWith("UPDATE customer_orders")) {
      if (
        this.order.estado !== "pendiente_aprobacion"
        || this.order.approval_version !== params[11]
        || this.order.rejection_version !== params[12]
        || this.order.content_version !== params[13]
      ) {
        return { rows: [], rowCount: 0 };
      }
      this.order = {
        ...this.order,
        estado: "aprobado_pendiente_entrega",
        subtotal: params[0],
        descuento_tipo: params[1],
        descuento_valor: params[2],
        descuento_monto: params[3],
        total_final: params[4],
        admin_notes: params[5],
        aprobado_at: params[6],
        approved_by: params[7],
        approved_from_status: params[8],
        approval_version: params[9],
      };
      return { rows: [clone(this.order)], rowCount: 1 };
    }

    throw new Error(`Consulta no simulada: ${sql}`);
  }
}

{
  const fake = new FakeApprovalClient();
  const result = await customerOrderApprovalService.approve(
    {
      customerOrderId: 91,
      discountType: "fixed",
      discountValue: 250,
      adminNotes: "Aprobado en prueba",
      usuario: "Auditor integración",
      expectedApprovalVersion: 0,
      expectedRejectionVersion: 0,
      expectedContentVersion: 0,
    },
    fake
  );

  assert(result.supplierOrderGenerated === true, "El servicio real no informó el pedido a proveedor generado.");
  assert(result.supplierOrderNumber === 700, "El servicio real no reservó correctamente el número de pedido.");
  assert(result.shortageItems.length === 1 && result.shortageItems[0].cantidad === 3, "El servicio real calculó mal el faltante.");
  assert(fake.order.estado === "aprobado_pendiente_entrega", "El servicio real no aprobó el pedido.");
  assert(fake.order.approval_version === 1, "El servicio real no incrementó la versión.");
  assert(fake.approvals.length === 1, "El servicio real no registró el historial.");
  assert(fake.supplierItems.length === 1 && fake.supplierItems[0].cantidad === 3, "El servicio real no registró la reposición correcta.");
}

console.log(
  "Aprobación segura de pedidos de clientes correcta: bloqueo, versiones, faltantes, historial, pedido a proveedor nuevo y rollback verificados."
);
