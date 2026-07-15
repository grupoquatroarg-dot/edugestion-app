import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { supplierOrderCancellationService } from "../server/services/supplierOrderCancellationService.js";

const root = process.cwd();
const read = (relativePath: string) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const servicePath = "server/services/supplierOrderCancellationService.ts";
const service = read(servicePath);

for (const required of [
  'client.query("BEGIN")',
  'client.query("COMMIT")',
  'client.query("ROLLBACK")',
  "FOR UPDATE OF so",
  "supplier_order_cancellations",
  "SET estado = 'cancelado'",
  "El motivo de anulación no puede superar los 500 caracteres",
  "ya fue anulado",
  "ya actualizó stock",
  "venta activa",
  "pedido de cliente activo",
]) {
  assert(service.includes(required), `Falta protección de pedido a proveedor: ${required}`);
}

assert(
  !/DELETE\s+FROM\s+supplier_orders/i.test(service),
  "La anulación no debe borrar el pedido."
);
assert(
  !/DELETE\s+FROM\s+supplier_order_items/i.test(service),
  "La anulación no debe borrar los productos del pedido."
);

const sourceFile = ts.createSourceFile(
  servicePath,
  service,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS
);

let parameterizedQueries = 0;
const getSqlText = (node: ts.Expression) => {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
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
      const placeholders = [...sql.matchAll(/\$(\d+)/g)].map((match) =>
        Number(match[1])
      );
      const maximum = placeholders.length ? Math.max(...placeholders) : 0;

      if (maximum > 0) {
        parameterizedQueries += 1;
        assert(
          maximum === params.elements.length,
          `Consulta de anulación de pedido con parámetros incorrectos: ${maximum}/${params.elements.length}.`
        );
      }
    }
  }

  ts.forEachChild(node, visit);
};

visit(sourceFile);
assert(
  parameterizedQueries >= 5,
  `No se auditaron suficientes consultas de anulación de pedido (${parameterizedQueries}/5).`
);

const api = read("api/sales.ts");
for (const required of [
  'endpoint === "supplier-order-cancel"',
  '"suppliers", "delete"',
  "supplierOrderCancellationService.cancelSupplierOrder",
  "Los pedidos ya no se eliminan",
  "cancelled_at",
  "cancel_reason",
  "sale_estado",
  "customer_order_estado",
]) {
  assert(api.includes(required), `Falta integración API de pedido a proveedor: ${required}`);
}

const expressRoute = read("server/routes/supplierOrderRoutes.ts");
for (const required of [
  "router.post('/:id/cancel'",
  "requirePermission('suppliers', 'delete')",
  "supplierOrderCancellationService.cancelSupplierOrder",
]) {
  assert(expressRoute.includes(required), `Falta integración Express de pedido a proveedor: ${required}`);
}

const ui = read("src/components/SupplierOrders.tsx");
for (const required of [
  "Anular pedido",
  "Confirmar anulación",
  "Motivo obligatorio",
  "supplier-order-cancel",
  "Pedido anulado",
  "_ANULADO",
  "hasPermission('suppliers', 'delete')",
  "getCancelProtectionReason",
]) {
  assert(ui.includes(required), `Falta interfaz de anulación de pedido: ${required}`);
}

const migration = read("supabase/06_supplier_order_cancellation.sql");
for (const required of [
  "supplier_order_cancellations",
  "cancelled_at",
  "cancelled_by",
  "cancel_reason",
  "cancellation_source",
  "cancelled_from_status",
]) {
  assert(migration.includes(required), `Falta migración de pedidos: ${required}`);
}

const saleCancellation = read("server/services/saleCancellationService.ts");
assert(
  saleCancellation.includes("supplier_order_cancellations"),
  "Anular venta no registra la anulación del pedido vinculado."
);
assert(
  saleCancellation.includes("'sale_cancellation'"),
  "Anular venta no identifica el origen de la cancelación del pedido."
);

type FakeState = {
  order: any;
  items: any[];
  cancellation: any;
  committed: boolean;
  rolledBack: boolean;
};

const baseOrder = {
  id: 50,
  numero_pedido: 150,
  cliente: "Cliente prueba",
  cliente_id: null,
  sale_id: null,
  customer_order_id: null,
  estado: "pendiente",
  stock_actualizado: 0,
  notes: "Pedido de prueba",
  cancelled_at: null,
  sale_estado: null,
  customer_order_estado: null,
};

const createFakeClient = (orderOverrides: Record<string, unknown> = {}) => {
  const state: FakeState = {
    order: { ...baseOrder, ...orderOverrides },
    items: [
      {
        id: 101,
        product_id: 20,
        cantidad: 3,
        product_name: "Producto prueba",
        product_code: "PR-20",
      },
    ],
    cancellation: null,
    committed: false,
    rolledBack: false,
  };

  const snapshot = structuredClone(state);

  return {
    state,
    async query(text: string, params: any[] = []) {
      const sql = text.replace(/\s+/g, " ").trim();

      if (sql === "BEGIN") return { rows: [], rowCount: null };
      if (sql === "COMMIT") {
        state.committed = true;
        return { rows: [], rowCount: null };
      }
      if (sql === "ROLLBACK") {
        Object.assign(state, structuredClone(snapshot), { rolledBack: true });
        return { rows: [], rowCount: null };
      }

      if (sql.startsWith("SELECT so.*, s.estado AS sale_estado")) {
        return state.order
          ? { rows: [{ ...state.order }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }

      if (sql.startsWith("SELECT id FROM supplier_order_cancellations")) {
        return state.cancellation
          ? { rows: [{ id: state.cancellation.id }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }

      if (sql.startsWith("SELECT soi.id, soi.product_id")) {
        return { rows: structuredClone(state.items), rowCount: state.items.length };
      }

      if (sql.startsWith("INSERT INTO supplier_order_cancellations")) {
        state.cancellation = {
          id: 900,
          supplier_order_id: params[0],
          motivo: params[1],
          cancelado_por: params[2],
          estado_original: params[3],
          cancellation_source: params[4],
        };
        return {
          rows: [{ id: 900, cancelado_at: "2026-07-15T15:00:00.000Z" }],
          rowCount: 1,
        };
      }

      if (sql.startsWith("UPDATE supplier_orders SET estado = 'cancelado'")) {
        state.order.estado = "cancelado";
        state.order.cancelled_at = params[0];
        state.order.cancelled_by = params[1];
        state.order.cancel_reason = params[2];
        state.order.cancellation_source = "manual";
        state.order.cancelled_from_status = params[3];
        return { rows: [], rowCount: 1 };
      }

      throw new Error(`Consulta no contemplada por la prueba: ${sql}`);
    },
  };
};

const successClient = createFakeClient();
const success = await supplierOrderCancellationService.cancelSupplierOrder(
  {
    supplierOrderId: 50,
    motivo: "Proveedor sin disponibilidad",
    usuario: "Auditor",
  },
  successClient
);

assert(successClient.state.committed, "El servicio real no confirmó la transacción.");
assert(!successClient.state.rolledBack, "El servicio real hizo rollback inesperado.");
assert(successClient.state.order.estado === "cancelado", "El pedido no quedó cancelado.");
assert(
  successClient.state.order.cancel_reason === "Proveedor sin disponibilidad",
  "El motivo no quedó registrado."
);
assert(success.order.cancellation_source === "manual", "La respuesta no identifica el origen.");

for (const [name, overrides, expectedText] of [
  ["pedido entregado", { estado: "entregado" }, "entregado"],
  ["stock actualizado", { stock_actualizado: 1 }, "actualizó stock"],
  ["venta activa", { sale_id: 10, sale_estado: "Pagada" }, "venta activa"],
  [
    "pedido cliente activo",
    { customer_order_id: 30, customer_order_estado: "aprobado_pendiente_entrega" },
    "pedido de cliente activo",
  ],
  ["doble anulación", { estado: "cancelado" }, "ya fue anulado"],
] as const) {
  const client = createFakeClient(overrides);
  let message = "";

  try {
    await supplierOrderCancellationService.cancelSupplierOrder(
      {
        supplierOrderId: 50,
        motivo: "Prueba de bloqueo",
        usuario: "Auditor",
      },
      client
    );
  } catch (error: any) {
    message = String(error?.message || "");
  }

  assert(
    message.toLowerCase().includes(expectedText.toLowerCase()),
    `El servicio real no bloqueó correctamente: ${name}.`
  );
  assert(client.state.rolledBack, `El servicio real no hizo rollback: ${name}.`);
  assert(!client.state.committed, `El servicio real confirmó una operación bloqueada: ${name}.`);
}

for (const overrides of [
  { sale_id: 10, sale_estado: "Anulada" },
  { customer_order_id: 30, customer_order_estado: "cancelado" },
  { customer_order_id: 30, customer_order_estado: "rechazado" },
]) {
  const client = createFakeClient(overrides);
  await supplierOrderCancellationService.cancelSupplierOrder(
    {
      supplierOrderId: 50,
      motivo: "Origen ya cancelado",
      usuario: "Auditor",
    },
    client
  );
  assert(client.state.committed, "Un origen ya cancelado debería permitir cerrar el pedido pendiente.");
}

console.log(
  `Anular pedido a proveedor correcto: transacción, permisos, ${parameterizedQueries} consultas, motivo, historial, PDF, vínculos, bloqueos y rollback verificados.`
);
