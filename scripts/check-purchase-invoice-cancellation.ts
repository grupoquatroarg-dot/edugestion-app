import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { purchaseInvoiceCancellationService } from "../server/services/purchaseInvoiceCancellationService.js";

const root = process.cwd();
const read = (relativePath: string) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const servicePath = "server/services/purchaseInvoiceCancellationService.ts";
const service = read(servicePath);

for (const required of [
  'client.query("BEGIN")',
  'client.query("COMMIT")',
  'client.query("ROLLBACK")',
  "FOR UPDATE",
  "purchase_invoice_cancellations",
  "purchase_invoice_payment_allocations",
  "reversed_movement_id",
  "purchase_invoice_cancellation_id",
  '"anulacion_compra"',
  "SET estado = 'Anulada'",
  "cantidad_restante = 0",
  "El motivo de anulación no puede superar los 500 caracteres",
  "ya consumió",
  "tiene una compra posterior",
  '["en_cartera", "anulado"]',
]) {
  assert(service.includes(required), `Falta protección de anulación de compra: ${required}`);
}

assert(
  !/DELETE\s+FROM\s+purchase_invoices/i.test(service),
  "La anulación no debe borrar la factura."
);
assert(
  !/DELETE\s+FROM\s+purchase_invoice_items/i.test(service),
  "La anulación no debe borrar los productos de la factura."
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
          `Consulta de anulación de compra con parámetros incorrectos: ${maximum}/${params.elements.length}.`
        );
      }
    }
  }

  ts.forEachChild(node, visit);
};

visit(sourceFile);
assert(
  parameterizedQueries >= 20,
  `No se auditaron suficientes consultas de anulación de compra (${parameterizedQueries}/20).`
);

const api = read("api/purchase-invoices/index.ts");
assert(
  api.includes('endpoint === "cancel"'),
  "Falta endpoint de anulación de factura."
);
assert(
  api.includes('"delete"'),
  "Falta permiso delete en la API de facturas."
);
assert(
  api.includes("purchaseInvoiceCancellationService.cancelPurchaseInvoice"),
  "La API no ejecuta el servicio transaccional."
);

const expressRoutes = read("server/routes/purchaseInvoiceRoutes.ts");
assert(
  expressRoutes.includes('router.post("/:id/cancel"'),
  "Falta ruta Express de anulación."
);
assert(
  expressRoutes.includes('requirePermission("suppliers", "delete")'),
  "Falta permiso suppliers/delete."
);

const helper = read("server/services/vercel/purchaseInvoiceApiHelpers.ts");
assert(helper.includes('"delete"'), "El helper Vercel no admite permiso delete.");
assert(helper.includes('"can_delete"'), "El helper Vercel no valida can_delete.");

const ui = read("src/components/PurchaseInvoiceModule.tsx");
for (const required of [
  "Confirmar anulación",
  "Sin trazabilidad",
  "Factura anulada",
  "Anular factura",
  "endpoint=cancel",
  "Motivo obligatorio",
  "Anuladas",
  "hasPermission('suppliers', 'delete')",
]) {
  assert(ui.includes(required), `Falta interfaz de anulación de compra: ${required}`);
}

const finance = read("src/components/FinanceModule.tsx");
assert(
  finance.includes("anulacion_compra"),
  "Finanzas no representa contramovimientos de compras."
);

const dashboardFiles: Array<[string, number]> = [
  ["api/dashboard/[endpoint].ts", 1],
  ["server/services/vercel/dashboardApiHelpers.ts", 1],
  ["server/routes/dashboardRoutes.ts", 4],
];

for (const [file, minimum] of dashboardFiles) {
  const content = read(file);
  const purchaseStateFilters = (
    content.match(/purchase_invoices[\s\S]{0,350}?Anulada/g) || []
  ).length;
  assert(
    purchaseStateFilters >= minimum,
    `${file} no excluye facturas anuladas en todas las métricas (${purchaseStateFilters}/${minimum}).`
  );
}

type SimulatedInvoice = {
  estado: "Activa" | "Anulada";
  reversionVersion: number;
  quantity: number;
  remaining: number;
  productStock: number;
  currentCost: number;
  invoiceCost: number;
  previousCost: number;
  paidAmount: number;
  allocatedAmount: number;
  hasLaterPurchase: boolean;
  chequeStatus?: string;
  cancellationExists?: boolean;
};

const simulateCancellation = (state: SimulatedInvoice) => {
  if (state.estado === "Anulada" || state.cancellationExists) {
    throw new Error("doble_anulacion");
  }
  if (state.reversionVersion !== 1) throw new Error("sin_trazabilidad");
  if (state.remaining < state.quantity) throw new Error("lote_consumido");
  if (state.hasLaterPurchase) throw new Error("compra_posterior");
  if (state.productStock < state.quantity) throw new Error("stock_insuficiente");
  if (Math.abs(state.currentCost - state.invoiceCost) > 0.01) {
    throw new Error("costo_modificado");
  }
  if (Math.abs(state.paidAmount - state.allocatedAmount) > 0.01) {
    throw new Error("pago_incompleto");
  }
  if (
    state.chequeStatus &&
    !["en_cartera", "anulado"].includes(state.chequeStatus)
  ) {
    throw new Error("cheque_procesado");
  }

  return {
    estado: "Anulada" as const,
    productStock: state.productStock - state.quantity,
    productCost: state.previousCost,
    remaining: 0,
    financialReversal: state.allocatedAmount,
    chequeStatus:
      state.chequeStatus === "en_cartera" ? "anulado" : state.chequeStatus,
  };
};

const base: SimulatedInvoice = {
  estado: "Activa",
  reversionVersion: 1,
  quantity: 10,
  remaining: 10,
  productStock: 25,
  currentCost: 500,
  invoiceCost: 500,
  previousCost: 420,
  paidAmount: 5000,
  allocatedAmount: 5000,
  hasLaterPurchase: false,
  chequeStatus: "en_cartera",
};

const success = simulateCancellation(base);
assert(success.estado === "Anulada", "La simulación no anuló la factura.");
assert(success.productStock === 15, "La simulación no revirtió el stock.");
assert(success.productCost === 420, "La simulación no restauró el costo.");
assert(success.remaining === 0, "La simulación no retiró el lote FIFO.");
assert(success.financialReversal === 5000, "La simulación no revirtió el pago.");
assert(success.chequeStatus === "anulado", "La simulación no anuló el cheque en cartera.");

for (const [name, patch, expected] of [
  ["lote consumido", { remaining: 9 }, "lote_consumido"],
  ["compra posterior", { hasLaterPurchase: true }, "compra_posterior"],
  ["cheque procesado", { chequeStatus: "entregado_proveedor" }, "cheque_procesado"],
  ["doble anulación", { estado: "Anulada" as const }, "doble_anulacion"],
  ["venta histórica", { reversionVersion: 0 }, "sin_trazabilidad"],
] as const) {
  let error = "";
  try {
    simulateCancellation({ ...base, ...patch });
  } catch (caught: any) {
    error = caught?.message || String(caught);
  }
  assert(error === expected, `La simulación no bloqueó correctamente: ${name}.`);
}

console.log(
  `Anular factura de compra correcto: transacción, permisos, ${parameterizedQueries} consultas, stock, FIFO, costos, pagos, cheques, UI y métricas verificados.`
);

type FakeState = {
  invoice: any;
  item: any;
  product: any;
  stockMovement: any;
  paymentAllocation: any;
  cheque: any;
  cancellation: any;
  laterPurchase: boolean;
  stockReversals: any[];
  financialReversals: any[];
  committed: boolean;
  rolledBack: boolean;
  nextPaymentNumber: number;
};

const createFakeClient = (overrides: Partial<FakeState> = {}) => {
  const state: FakeState = {
    invoice: {
      id: 100,
      proveedor_id: 7,
      proveedor: "Proveedor prueba",
      numero_factura: "FC-100",
      total: 5000,
      metodo_pago: "efectivo",
      estado_pago: "pagado",
      monto_pagado: 5000,
      estado: "Activa",
      reversion_version: 1,
      anulada_at: null,
    },
    item: {
      id: 501,
      invoice_id: 100,
      product_id: 20,
      cantidad: 10,
      cantidad_restante: 10,
      costo_unitario: 500,
      previous_product_cost: 420,
      product_was_created: false,
      stock_movement_id: 701,
      product_name: "Producto prueba",
      product_stock: 25,
      product_cost: 500,
    },
    product: { id: 20, name: "Producto prueba", stock: 25, cost: 500 },
    stockMovement: {
      id: 701,
      product_id: 20,
      cantidad: 10,
      costo_unitario: 500,
      tipo_movimiento: "ingreso",
      motivo: "compra",
      purchase_invoice_id: 100,
      purchase_invoice_item_id: 501,
    },
    paymentAllocation: {
      id: 801,
      purchase_invoice_id: 100,
      movimiento_financiero_id: 901,
      monto: 5000,
      allocation_type: "initial_payment",
      tipo: "egreso",
      origen: "compra",
      forma_pago: "efectivo",
      movimiento_monto: 5000,
      cheque_id: 1001,
    },
    cheque: {
      id: 1001,
      numero_cheque: "CH-1001",
      estado: "en_cartera",
      observaciones: "Cheque de prueba",
      purchase_invoice_id: 100,
    },
    cancellation: null,
    laterPurchase: false,
    stockReversals: [],
    financialReversals: [],
    committed: false,
    rolledBack: false,
    nextPaymentNumber: 10,
    ...overrides,
  };

  const snapshot = structuredClone(state);

  const client = {
    state,
    async query(text: string, params: any[] = []) {
      const sql = text.replace(/\s+/g, " ").trim();

      if (sql === "BEGIN") return { rows: [], rowCount: null };
      if (sql === "COMMIT") {
        state.committed = true;
        return { rows: [], rowCount: null };
      }
      if (sql === "ROLLBACK") {
        const rolledBack = true;
        Object.assign(state, structuredClone(snapshot), { rolledBack });
        return { rows: [], rowCount: null };
      }

      if (sql.startsWith("SELECT pi.*, p.nombre AS proveedor FROM purchase_invoices")) {
        return state.invoice
          ? { rows: [{ ...state.invoice }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }

      if (sql.startsWith("SELECT id FROM purchase_invoice_cancellations")) {
        return state.cancellation
          ? { rows: [{ id: state.cancellation.id }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }

      if (sql.startsWith("SELECT id, product_id FROM purchase_invoice_items")) {
        return { rows: [{ id: state.item.id, product_id: state.item.product_id }], rowCount: 1 };
      }

      if (sql.startsWith("SELECT id, name, stock, cost FROM products")) {
        return { rows: [{ ...state.product }], rowCount: 1 };
      }

      if (sql.startsWith("SELECT pii.*, p.name AS product_name")) {
        return {
          rows: [{
            ...state.item,
            product_stock: state.product.stock,
            product_cost: state.product.cost,
          }],
          rowCount: 1,
        };
      }

      if (sql.startsWith("SELECT pii.id, pii.product_id, pi.numero_factura")) {
        return state.laterPurchase
          ? { rows: [{ id: state.item.id + 1, product_id: state.item.product_id, numero_factura: "FC-POSTERIOR" }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }

      if (sql.startsWith("SELECT id, product_id, cantidad, costo_unitario, tipo_movimiento")) {
        return { rows: [{ ...state.stockMovement }], rowCount: 1 };
      }

      if (sql.startsWith("SELECT id FROM stock_movimientos WHERE reversed_movement_id")) {
        return state.stockReversals.length
          ? { rows: [{ id: state.stockReversals[0].id }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }

      if (sql.startsWith("SELECT pia.*, mf.tipo")) {
        return state.paymentAllocation
          ? { rows: [{ ...state.paymentAllocation }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }

      if (sql.startsWith("SELECT id FROM movimientos_financieros WHERE reversed_movement_id")) {
        return state.financialReversals.length
          ? { rows: [{ id: state.financialReversals[0].id }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }

      if (sql.startsWith("SELECT * FROM cheques")) {
        return state.cheque
          ? { rows: [{ ...state.cheque }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }

      if (sql.startsWith("INSERT INTO purchase_invoice_cancellations")) {
        state.cancellation = {
          id: 1101,
          purchase_invoice_id: params[0],
          motivo: params[1],
          anulada_por: params[2],
        };
        return {
          rows: [{ id: 1101, anulada_at: "2026-07-15T12:00:00.000Z" }],
          rowCount: 1,
        };
      }

      if (sql.startsWith("UPDATE products SET stock = COALESCE")) {
        state.product.stock -= Number(params[0]);
        state.product.cost = Number(params[1]);
        return { rows: [], rowCount: 1 };
      }

      if (sql.startsWith("UPDATE purchase_invoice_items SET cantidad_restante = 0")) {
        state.item.cantidad_restante = 0;
        return { rows: [], rowCount: 1 };
      }

      if (sql.startsWith("INSERT INTO stock_movimientos")) {
        const row = { id: 1201, params };
        state.stockReversals.push(row);
        return { rows: [{ id: row.id }], rowCount: 1 };
      }

      if (sql.startsWith("INSERT INTO settings")) {
        return { rows: [], rowCount: 1 };
      }

      if (sql.startsWith("SELECT value FROM settings")) {
        return { rows: [{ value: String(state.nextPaymentNumber) }], rowCount: 1 };
      }

      if (sql.startsWith("UPDATE settings SET value")) {
        state.nextPaymentNumber = Number(params[1]);
        return { rows: [], rowCount: 1 };
      }

      if (sql.startsWith("INSERT INTO movimientos_financieros")) {
        const row = { id: 1301, params };
        state.financialReversals.push(row);
        return { rows: [{ id: row.id }], rowCount: 1 };
      }

      if (sql.startsWith("UPDATE cheques SET estado = 'anulado'")) {
        state.cheque.estado = "anulado";
        state.cheque.observaciones = params[0];
        return { rows: [], rowCount: 1 };
      }

      if (sql.startsWith("UPDATE purchase_invoices SET estado = 'Anulada'")) {
        state.invoice.estado = "Anulada";
        state.invoice.estado_pago = "anulada";
        state.invoice.anulada_at = params[0];
        state.invoice.anulada_por = params[1];
        state.invoice.anulacion_motivo = params[2];
        return { rows: [], rowCount: 1 };
      }

      throw new Error(`Consulta no contemplada por la prueba: ${sql}`);
    },
  };

  return client;
};

const successClient = createFakeClient();
const actualSuccess = await purchaseInvoiceCancellationService.cancelPurchaseInvoice(
  { purchaseInvoiceId: 100, motivo: "Factura duplicada", usuario: "Auditor" },
  successClient
);
assert(successClient.state.committed, "El servicio real no confirmó la transacción.");
assert(!successClient.state.rolledBack, "El servicio real hizo rollback inesperado.");
assert(successClient.state.product.stock === 15, "El servicio real no descontó el stock.");
assert(successClient.state.product.cost === 420, "El servicio real no restauró el costo.");
assert(successClient.state.item.cantidad_restante === 0, "El servicio real no retiró el lote.");
assert(successClient.state.stockReversals.length === 1, "El servicio real no creó contramovimiento de stock.");
assert(successClient.state.financialReversals.length === 1, "El servicio real no creó contramovimiento financiero.");
assert(successClient.state.cheque.estado === "anulado", "El servicio real no anuló el cheque.");
assert(actualSuccess.invoice.estado === "Anulada", "La respuesta real no identifica la factura anulada.");

for (const [name, client, expectedText] of [
  [
    "lote consumido",
    createFakeClient({ item: { ...createFakeClient().state.item, cantidad_restante: 9 } }),
    "ya consumió",
  ],
  [
    "compra posterior",
    createFakeClient({ laterPurchase: true }),
    "compra posterior",
  ],
  [
    "cheque procesado",
    createFakeClient({ cheque: { ...createFakeClient().state.cheque, estado: "entregado_proveedor" } }),
    "cheque",
  ],
  [
    "doble anulación",
    createFakeClient({ invoice: { ...createFakeClient().state.invoice, estado: "Anulada" } }),
    "ya fue anulada",
  ],
] as const) {
  let message = "";
  try {
    await purchaseInvoiceCancellationService.cancelPurchaseInvoice(
      { purchaseInvoiceId: 100, motivo: "Prueba de bloqueo", usuario: "Auditor" },
      client
    );
  } catch (error: any) {
    message = String(error?.message || "");
  }

  assert(message.toLowerCase().includes(expectedText.toLowerCase()), `El servicio real no bloqueó: ${name}.`);
  assert(client.state.rolledBack, `El servicio real no hizo rollback: ${name}.`);
  assert(!client.state.committed, `El servicio real confirmó una operación bloqueada: ${name}.`);
}

console.log("Servicio transaccional real probado con stock, costo, pago, cheque, bloqueos y rollback.");

