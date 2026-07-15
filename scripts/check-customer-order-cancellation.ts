import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { customerOrderCancellationService } from "../server/services/customerOrderCancellationService.js";

const root = process.cwd();
const read = (relativePath: string) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const servicePath = "server/services/customerOrderCancellationService.ts";
const service = read(servicePath);

for (const required of [
  'client.query("BEGIN")',
  'client.query("COMMIT")',
  'client.query("ROLLBACK")',
  "FOR UPDATE OF co",
  "customer_order_cancellations",
  "SET estado = 'cancelado'",
  "El motivo de anulación no puede superar los 500 caracteres",
  "ya fue cancelado",
  "Primero debe anularse esa venta",
  "Solo podés cancelar pedidos pendientes de aprobación desde el portal",
  "customer_order_cancellation",
  "cancelled_supplier_order_ids",
]) {
  assert(service.includes(required), `Falta protección de pedido de cliente: ${required}`);
}

assert(!/DELETE\s+FROM\s+customer_orders/i.test(service), "La anulación no debe borrar el pedido.");
assert(!/DELETE\s+FROM\s+customer_order_items/i.test(service), "La anulación no debe borrar los productos.");

const sourceFile = ts.createSourceFile(
  servicePath,
  service,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS
);

let parameterizedQueries = 0;
const getSqlText = (node: ts.Expression) => {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
};

const visit = (node: ts.Node) => {
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "query" &&
    node.arguments.length >= 2
  ) {
    const sql = getSqlText(node.arguments[0]);
    const params = node.arguments[1];
    if (sql && ts.isArrayLiteralExpression(params)) {
      const placeholders = [...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
      const maximum = placeholders.length ? Math.max(...placeholders) : 0;
      if (maximum > 0) {
        parameterizedQueries += 1;
        assert(
          maximum === params.elements.length,
          `Consulta de anulación de pedido de cliente con parámetros incorrectos: ${maximum}/${params.elements.length}.`
        );
      }
    }
  }
  ts.forEachChild(node, visit);
};
visit(sourceFile);
assert(parameterizedQueries >= 6, `No se auditaron suficientes consultas (${parameterizedQueries}/6).`);

const salesApi = read("api/sales.ts");
for (const required of [
  'endpoint === "customer-order-cancel"',
  '? "delete"',
  "customerOrderCancellationService.cancelCustomerOrder",
  'source: "manual"',
  "cancelled_by",
  "cancellation_source",
]) {
  assert(salesApi.includes(required), `Falta integración de administrador: ${required}`);
}

const portalApi = read("api/clientes.ts");
for (const required of [
  'endpoint === "portal-order-cancel"',
  "customerOrderCancellationService.cancelCustomerOrder",
  'source: "customer_portal"',
  "customerId: clienteId",
]) {
  assert(portalApi.includes(required), `Falta integración del portal: ${required}`);
}

const adminUi = read("src/components/CustomerOrdersAdmin.tsx");
for (const required of [
  "Anular pedido",
  "Confirmar anulación",
  "Motivo obligatorio",
  "customer-order-cancel",
  "hasPermission('sales', 'delete')",
  "cancelled_by",
]) {
  assert(adminUi.includes(required), `Falta interfaz administrativa: ${required}`);
}

const portalUi = read("src/components/CustomerPortal.tsx");
for (const required of [
  "portal-order-cancel-reason",
  "Motivo obligatorio",
  "cancelReason.trim().length < 3",
  "body: JSON.stringify({ motivo: reason })",
]) {
  assert(portalUi.includes(required), `Falta interfaz del portal: ${required}`);
}

const pdf = read("src/utils/customerOrderPdf.ts");
for (const required of [
  "PEDIDO DE CLIENTE - ANULADO",
  "_ANULADO",
  "Motivo de anulación",
  "cancelled_by",
]) {
  assert(pdf.includes(required), `Falta identificación en PDF: ${required}`);
}

const migration = read("supabase/07_customer_order_cancellation.sql");
for (const required of [
  "customer_order_cancellations",
  "cancelled_at",
  "cancelled_by",
  "cancel_reason",
  "cancellation_source",
  "cancelled_from_status",
]) {
  assert(migration.includes(required), `Falta migración de pedidos de cliente: ${required}`);
}

const saleCancellation = read("server/services/saleCancellationService.ts");
assert(saleCancellation.includes("customer_order_cancellations"), "Anular venta no audita el pedido de cliente.");
assert(saleCancellation.includes("'sale_cancellation'"), "Anular venta no registra el origen del cierre.");

const supplierService = read("server/services/supplierOrderCancellationService.ts");
assert(supplierService.includes("const ownsTransaction = !executor"), "El servicio de proveedor no soporta una transacción compartida.");
assert(supplierService.includes("customer_order_cancellation"), "El pedido a proveedor no identifica el origen pedido cliente.");

type FakeState = {
  order: any;
  items: any[];
  cancellation: any;
  supplierOrders: any[];
  supplierItems: Record<number, any[]>;
  supplierCancellations: Record<number, any>;
  committed: boolean;
  rolledBack: boolean;
};

const baseOrder = {
  id: 70,
  numero_pedido: 270,
  cliente_id: 15,
  estado: "aprobado_pendiente_entrega",
  sale_id: null,
  sale_estado: null,
  numero_venta: null,
  admin_notes: "",
  cancelled_at: null,
};

const createFakeClient = (
  orderOverrides: Record<string, unknown> = {},
  supplierOverrides: Record<string, unknown> | null = {}
) => {
  const supplierOrders = supplierOverrides === null
    ? []
    : [{
        id: 90,
        numero_pedido: 390,
        customer_order_id: 70,
        sale_id: null,
        estado: "pendiente",
        stock_actualizado: 0,
        notes: "Faltante del pedido",
        cancelled_at: null,
        customer_order_estado: "aprobado_pendiente_entrega",
        sale_estado: null,
        ...supplierOverrides,
      }];

  const state: FakeState = {
    order: { ...baseOrder, ...orderOverrides },
    items: [{ id: 1, product_id: 5, cantidad: 2, precio_unitario: 100, product_name: "Producto", product_code: "P-5" }],
    cancellation: null,
    supplierOrders,
    supplierItems: { 90: [{ id: 2, product_id: 5, cantidad: 1, product_name: "Producto", product_code: "P-5" }] },
    supplierCancellations: {},
    committed: false,
    rolledBack: false,
  };
  const snapshot = structuredClone(state);

  return {
    state,
    async query(text: string, params: any[] = []) {
      const sql = text.replace(/\s+/g, " ").trim();
      if (sql === "BEGIN") return { rows: [], rowCount: null };
      if (sql === "COMMIT") { state.committed = true; return { rows: [], rowCount: null }; }
      if (sql === "ROLLBACK") {
        const restored = structuredClone(snapshot);
        Object.assign(state, restored, { rolledBack: true });
        return { rows: [], rowCount: null };
      }

      if (sql.startsWith("SELECT co.*, s.estado AS sale_estado")) {
        return state.order ? { rows: [{ ...state.order }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (sql.startsWith("SELECT id FROM customer_order_cancellations")) {
        return state.cancellation ? { rows: [{ id: state.cancellation.id }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (sql.startsWith("SELECT coi.id, coi.product_id")) {
        return { rows: structuredClone(state.items), rowCount: state.items.length };
      }
      if (sql.startsWith("SELECT id, numero_pedido, estado, stock_actualizado, notes FROM supplier_orders")) {
        return { rows: structuredClone(state.supplierOrders), rowCount: state.supplierOrders.length };
      }
      if (sql.startsWith("INSERT INTO customer_order_cancellations")) {
        state.cancellation = { id: 800, customer_order_id: params[0], motivo: params[1], source: params[4] };
        return { rows: [{ id: 800, cancelado_at: "2026-07-15T15:00:00.000Z" }], rowCount: 1 };
      }
      if (sql.startsWith("UPDATE customer_orders SET estado = 'cancelado'")) {
        state.order.estado = "cancelado";
        state.order.cancelled_at = params[0];
        state.order.cancelled_by = params[1];
        state.order.cancel_reason = params[2];
        state.order.cancellation_source = params[3];
        state.order.cancelled_from_status = params[4];
        state.order.admin_notes = params[5];
        return { rows: [], rowCount: 1 };
      }

      if (sql.startsWith("SELECT so.*, s.estado AS sale_estado")) {
        const supplier = state.supplierOrders.find((item) => Number(item.id) === Number(params[0]));
        return supplier
          ? { rows: [{ ...supplier, customer_order_estado: state.order.estado }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (sql.startsWith("SELECT id FROM supplier_order_cancellations")) {
        const existing = state.supplierCancellations[Number(params[0])];
        return existing ? { rows: [{ id: existing.id }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (sql.startsWith("SELECT soi.id, soi.product_id")) {
        const rows = state.supplierItems[Number(params[0])] || [];
        return { rows: structuredClone(rows), rowCount: rows.length };
      }
      if (sql.startsWith("INSERT INTO supplier_order_cancellations")) {
        state.supplierCancellations[Number(params[0])] = { id: 900, motivo: params[1], source: params[4] };
        return { rows: [{ id: 900, cancelado_at: "2026-07-15T15:00:01.000Z" }], rowCount: 1 };
      }
      if (sql.startsWith("UPDATE supplier_orders SET estado = 'cancelado'")) {
        const supplier = state.supplierOrders.find((item) => Number(item.id) === Number(params[5]));
        if (supplier) {
          supplier.estado = "cancelado";
          supplier.cancelled_at = params[0];
          supplier.cancelled_by = params[1];
          supplier.cancel_reason = params[2];
          supplier.cancellation_source = params[3];
          supplier.cancelled_from_status = params[4];
        }
        return { rows: [], rowCount: supplier ? 1 : 0 };
      }

      throw new Error(`Consulta no contemplada por la prueba: ${sql}`);
    },
  };
};

const runSuccess = async (
  orderOverrides: Record<string, unknown> = {},
  supplierOverrides: Record<string, unknown> | null = {}
) => {
  const client = createFakeClient(orderOverrides, supplierOverrides);
  await client.query("BEGIN");
  const result = await customerOrderCancellationService.cancelCustomerOrder(
    {
      customerOrderId: 70,
      motivo: "Cliente desistió del pedido",
      usuario: "Auditor",
      source: "manual",
    },
    client
  );
  await client.query("COMMIT");
  return { client, result };
};

const success = await runSuccess();
assert(success.client.state.committed, "La transacción simulada no confirmó la anulación.");
assert(success.client.state.order.estado === "cancelado", "El pedido no quedó cancelado.");
assert(success.client.state.supplierOrders[0].estado === "cancelado", "El pedido a proveedor vinculado no quedó cancelado.");
assert(success.result.cancelled_supplier_order_ids.length === 1, "La respuesta no informa el pedido a proveedor cancelado.");

const portalClient = createFakeClient({ estado: "pendiente_aprobacion" }, null);
await portalClient.query("BEGIN");
await customerOrderCancellationService.cancelCustomerOrder(
  {
    customerOrderId: 70,
    motivo: "Ya no necesito los productos",
    usuario: "Cliente #15",
    source: "customer_portal",
    customerId: 15,
  },
  portalClient
);
await portalClient.query("COMMIT");
assert(portalClient.state.order.cancellation_source === "customer_portal", "El portal no registra su origen.");

const deliveredCancelledSale = await runSuccess(
  { estado: "entregado", sale_id: 44, sale_estado: "Anulada", numero_venta: 144 },
  null
);
assert(deliveredCancelledSale.client.state.order.estado === "cancelado", "Una venta anulada debe permitir cerrar su pedido.");

const deliveredSupplier = await runSuccess(
  {},
  { estado: "entregado", stock_actualizado: 1 }
);
assert(
  deliveredSupplier.client.state.supplierOrders[0].estado === "entregado",
  "Un pedido a proveedor ya entregado debe conservarse como historial sin impedir cancelar el pedido del cliente."
);

for (const [name, orderOverrides, supplierOverrides, expectedText, source] of [
  ["portal aprobado", { estado: "aprobado_pendiente_entrega" }, null, "pendientes de aprobación", "customer_portal"],
  ["venta activa", { estado: "entregado", sale_id: 44, sale_estado: "Pagada", numero_venta: 144 }, null, "Primero debe anularse", "manual"],
  ["pedido rechazado", { estado: "rechazado" }, null, "rechazado", "manual"],
  ["doble anulación", { estado: "cancelado", cancelled_at: "2026-07-15" }, null, "ya fue cancelado", "manual"],
] as const) {
  const client = createFakeClient(orderOverrides, supplierOverrides);
  await client.query("BEGIN");
  let message = "";
  try {
    await customerOrderCancellationService.cancelCustomerOrder(
      {
        customerOrderId: 70,
        motivo: "Prueba de bloqueo",
        usuario: "Auditor",
        source,
        customerId: source === "customer_portal" ? 15 : null,
      },
      client
    );
    await client.query("COMMIT");
  } catch (error: any) {
    message = String(error?.message || "");
    await client.query("ROLLBACK");
  }

  assert(message.toLowerCase().includes(expectedText.toLowerCase()), `Bloqueo incorrecto: ${name}.`);
  assert(client.state.rolledBack, `No se ejecutó rollback: ${name}.`);
  assert(!client.state.committed, `Se confirmó una operación bloqueada: ${name}.`);
}

console.log(
  `Anular pedido de cliente correcto: transacción, portal, permisos, ${parameterizedQueries} consultas, proveedor vinculado, venta, PDF, bloqueos y rollback verificados.`
);
