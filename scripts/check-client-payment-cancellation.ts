import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { clientPaymentCancellationService } from "../server/services/clientPaymentCancellationService.js";

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const servicePath = "server/services/clientPaymentCancellationService.ts";
const service = read(servicePath);

for (const required of [
  'client.query("BEGIN")',
  'client.query("COMMIT")',
  'client.query("ROLLBACK")',
  "FOR UPDATE OF mf",
  "client_payment_cancellations",
  "sale_payment_allocations",
  "COALESCE(spa.estado, 'Activo') = 'Activo'",
  "anulacion_cobranza",
  "reversed_movement_id",
  "client_payment_cancellation_id",
  "SET estado = 'Anulado'",
  "La trazabilidad de la cobranza no coincide con su importe",
  "Esta cobranza fue creada sin trazabilidad completa",
  "El motivo de anulación no puede superar los 500 caracteres",
  "route_item_id",
  "El ítem de ruta posee otra cobranza activa",
  "SET cobranza_realizada = 0",
  "Cobranza anulada:",
]) {
  assert(service.includes(required), `Falta protección de cobranza: ${required}`);
}

assert(!/DELETE\s+FROM\s+movimientos_financieros/i.test(service), "No se deben borrar movimientos financieros.");
assert(!/DELETE\s+FROM\s+sale_payment_allocations/i.test(service), "No se deben borrar asignaciones de pagos.");
assert(!/DELETE\s+FROM\s+sales/i.test(service), "No se deben borrar ventas.");

const sourceFile = ts.createSourceFile(servicePath, service, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
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
        assert(maximum === params.elements.length, `Consulta de cobranza con parámetros incorrectos: ${maximum}/${params.elements.length}.`);
      }
    }
  }
  ts.forEachChild(node, visit);
};
visit(sourceFile);
assert(parameterizedQueries >= 15, `No se auditaron suficientes consultas de cobranza (${parameterizedQueries}/15).`);

const migration = read("supabase/14_client_payment_cancellation.sql");
for (const required of [
  "client_payment_cancellations",
  "client_payment_cancellation_id",
  "sale_payment_allocations",
  "anulada_at",
  "anulada_por",
  "anulacion_motivo",
  "route_item_id",
  "movimientos_financieros_route_item_id_fkey",
  "Las cobranzas históricas conservan reversion_version = 0",
]) {
  assert(migration.includes(required), `Falta migración de cobranza: ${required}`);
}
assert(!/UPDATE\s+public\.movimientos_financieros[\s\S]*SET\s+reversion_version\s*=\s*1/i.test(migration), "No se deben habilitar cobranzas históricas sin vínculo seguro con rutas.");

const api = read("api/finanzas.ts");
for (const required of [
  'endpoint === "client-payment-cancel"',
  'requireCurrentAccountsPermission(req, res, "delete")',
  "clientPaymentCancellationService.cancelClientPayment",
]) {
  assert(api.includes(required), `Falta integración Vercel de cobranza: ${required}`);
}

const expressRoute = read("server/routes/financeRoutes.ts");
for (const required of [
  "'/movimientos/:id/cancel-client-payment'",
  "'client-payment-cancel'",
  "requirePermission('current_accounts', 'delete')",
  "clientPaymentCancellationService.cancelClientPayment",
]) {
  assert(expressRoute.includes(required), `Falta integración Express de cobranza: ${required}`);
}

const financeUi = read("src/components/FinanceModule.tsx");
const dashboardApi = read("api/dashboard/[endpoint].ts");
const reportRoutes = read("server/routes/reportRoutes.ts");

assert(
  financeUi.includes("'anulacion_cobranza'") && financeUi.includes("NON_METRIC_REVERSAL_ORIGINS"),
  "Caja todavía contabiliza el contramovimiento de una cobranza cuyo ingreso original ya quedó anulado."
);
for (const [label, source] of [
  ["Dashboard", dashboardApi],
  ["Reportes", reportRoutes],
] as const) {
  const matches = source.match(/NOT IN \('anulacion_egreso_manual', 'anulacion_cobranza'(?:, 'anulacion_cheque_rechazado')?\)/g) || [];
  assert(matches.length >= 3, `${label} todavía duplica el efecto financiero de las cobranzas anuladas.`);
}

for (const required of [
  "Anular cobranza",
  "Cobranza histórica sin trazabilidad completa",
  "client-payment-cancel",
  "canCancelClientPayment",
  "hasPermission('current_accounts', 'delete')",
  "La cobranza permanecerá como historial",
]) {
  assert(financeUi.includes(required), `Falta interfaz de cobranza: ${required}`);
}

const salesService = read("server/services/salesService.ts");
const salesApi = read("api/sales.ts");
assert(salesService.includes("cliente_id, venta_id, route_item_id, estado, reversion_version"), "Las cobranzas generales nuevas no quedan trazadas.");
assert(salesService.includes("SET cobranza_realizada = 1"), "La cobranza de ruta no se marca dentro de la misma transacción.");
assert(salesService.includes("SET status = 'en curso'"), "La cobranza de ruta no inicia la ruta dentro de la misma transacción.");
assert(salesService.includes("Pago registrado: $"), "La ruta no conserva una nota auditable del cobro.");
assert(salesService.includes("El ítem de ruta ya tiene una cobranza activa"), "No se bloquean cobranzas duplicadas en una ruta.");
assert(salesApi.includes("cliente_id, venta_id, estado, reversion_version"), "Las cobranzas de pedidos nuevas no quedan trazadas.");
assert(salesApi.includes("route_item_id: z.number().int().positive().optional()"), "La API de cobranzas no acepta el vínculo de ruta.");

const routeUi = read("src/components/RouteModule.tsx");
assert(routeUi.includes("route_item_id: selectedItemForAction.id"), "La cobranza rápida de ruta no envía su vínculo trazable.");
assert(!routeUi.includes("{ cobranza_realizada: 1 }"), "La ruta todavía marca la cobranza fuera de la transacción financiera.");

const saleTrace = read("server/services/saleTraceService.ts");
assert(saleTrace.includes("allocation_type,\n           estado"), "Las asignaciones nuevas no quedan activas explícitamente.");

const saleCancellation = read("server/services/saleCancellationService.ts");
assert(saleCancellation.includes("COALESCE(spa.estado, 'Activo') = 'Activo'"), "Anular una venta todavía incluye asignaciones de cobranzas anuladas.");

const customerApi = read("api/clientes.ts");
assert(customerApi.includes("mf.client_payment_cancellation_id"), "La cuenta corriente no informa anulaciones de cobranzas.");
assert(customerApi.includes('payment_status: String(row.estado || "Activo").toLowerCase() === "anulado" ? "cancelled" : "paid"'), "La cuenta corriente no distingue pagos anulados.");

const portalUi = read("src/components/CustomerPortal.tsx");
assert(portalUi.includes("movement.anulacion_motivo"), "El Portal no muestra el motivo de la cobranza anulada.");
assert(portalUi.includes("String(movement.estado || 'Activo').toLowerCase() !== 'anulado'"), "El Portal permite descargar recibos anulados.");

type FakeState = {
  movement: any;
  customer: any;
  allocations: any[];
  cancellation: any;
  reversal: any;
  cheque: any;
  routeItem: any;
  otherRoutePayment: boolean;
  paymentNumber: number;
};

const createFakeClient = (options: {
  movement?: Record<string, unknown>;
  customer?: Record<string, unknown>;
  allocations?: any[];
  existingCancellation?: boolean;
  existingReversal?: boolean;
  cheque?: any;
  routeItem?: any;
  otherRoutePayment?: boolean;
} = {}) => {
  const state: FakeState = {
    movement: {
      id: 50,
      tipo: "ingreso",
      origen: "cobranza",
      descripcion: "Cobranza cliente de prueba",
      categoria: "Cobranzas",
      forma_pago: "transferencia",
      monto: 150,
      fecha: "2026-07-16T15:00:00.000Z",
      usuario: "Administrador",
      numero_pago: 90,
      cheque_id: null,
      cliente_id: 3,
      venta_id: null,
      estado: "Activo",
      reversion_version: 1,
      anulada_at: null,
      sale_cancellation_id: null,
      purchase_invoice_cancellation_id: null,
      financial_movement_cancellation_id: null,
      client_payment_cancellation_id: null,
      reversed_movement_id: null,
      route_item_id: options.routeItem === undefined ? null : 99,
      ...options.movement,
    },
    customer: {
      id: 3,
      nombre_apellido: "Cliente de prueba",
      saldo_cta_cte: 200,
      ...options.customer,
    },
    allocations: options.allocations || [
      {
        id: 1,
        sale_id: 10,
        monto: 100,
        allocation_type: "client_payment",
        allocation_state: "Activo",
        numero_venta: 10,
        cliente_id: 3,
        total: 100,
        monto_pagado: 100,
        monto_pendiente: 0,
        sale_state: "Pagada",
      },
      {
        id: 2,
        sale_id: 11,
        monto: 50,
        allocation_type: "client_payment",
        allocation_state: "Activo",
        numero_venta: 11,
        cliente_id: 3,
        total: 100,
        monto_pagado: 50,
        monto_pendiente: 50,
        sale_state: "Pendiente",
      },
    ],
    cancellation: options.existingCancellation ? { id: 700 } : null,
    reversal: options.existingReversal ? { id: 800 } : null,
    cheque: options.cheque || null,
    routeItem: options.routeItem === undefined ? null : ({ id: 99, route_id: 5, client_id: 3, cobranza_realizada: 1, status: "visitado", ...(options.routeItem || {}) }),
    otherRoutePayment: Boolean(options.otherRoutePayment),
    paymentNumber: 100,
  };

  return {
    state,
    async query(text: string, params: any[] = []) {
      const sql = text.replace(/\s+/g, " ").trim();
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [], rowCount: null };
      if (sql.startsWith("SELECT mf.* FROM movimientos_financieros mf")) {
        return state.movement ? { rows: [structuredClone(state.movement)], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (sql.startsWith("SELECT id FROM client_payment_cancellations")) {
        return state.cancellation ? { rows: [{ id: state.cancellation.id }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (sql.startsWith("SELECT id FROM movimientos_financieros WHERE reversed_movement_id")) {
        return state.reversal ? { rows: [{ id: state.reversal.id }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (sql.startsWith("SELECT id, nombre_apellido, saldo_cta_cte FROM clientes")) {
        return state.customer ? { rows: [structuredClone(state.customer)], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (sql.startsWith("SELECT ri.id, ri.route_id, ri.client_id")) {
        return state.routeItem ? { rows: [structuredClone(state.routeItem)], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (sql.startsWith("SELECT id FROM movimientos_financieros WHERE route_item_id")) {
        return state.otherRoutePayment ? { rows: [{ id: 51 }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (sql.startsWith("SELECT spa.id, spa.sale_id")) {
        return { rows: structuredClone(state.allocations), rowCount: state.allocations.length };
      }
      if (sql.startsWith("SELECT * FROM cheques")) {
        return state.cheque ? { rows: [structuredClone(state.cheque)], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (sql.startsWith("INSERT INTO client_payment_cancellations")) {
        state.cancellation = { id: 700, movimiento_financiero_id: params[0], cliente_id: params[1], motivo: params[2] };
        return { rows: [{ id: 700, anulada_at: "2026-07-16T18:00:00.000Z" }], rowCount: 1 };
      }
      if (sql.startsWith("UPDATE sales SET monto_pagado")) {
        const sale = state.allocations.find((item) => Number(item.sale_id) === Number(params[3]));
        if (sale) {
          sale.monto_pagado = params[0];
          sale.monto_pendiente = params[1];
          sale.sale_state = params[2];
        }
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("UPDATE clientes SET saldo_cta_cte")) {
        state.customer.saldo_cta_cte = Number(state.customer.saldo_cta_cte) + Number(params[0]);
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("UPDATE sale_payment_allocations SET estado = 'Anulado'")) {
        state.allocations = state.allocations.map((item) => ({
          ...item,
          allocation_state: "Anulado",
          anulada_at: params[0],
          anulada_por: params[1],
          anulacion_motivo: params[2],
          client_payment_cancellation_id: params[3],
        }));
        return { rows: [], rowCount: state.allocations.length };
      }
      if (sql.startsWith("UPDATE route_items SET cobranza_realizada = 0")) {
        if (state.routeItem) state.routeItem.cobranza_realizada = 0;
        return { rows: [], rowCount: state.routeItem ? 1 : 0 };
      }
      if (sql.startsWith("INSERT INTO settings")) return { rows: [], rowCount: 1 };
      if (sql.startsWith("SELECT value FROM settings")) return { rows: [{ value: String(state.paymentNumber) }], rowCount: 1 };
      if (sql.startsWith("UPDATE settings SET value")) {
        state.paymentNumber = Number(params[1]);
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("INSERT INTO movimientos_financieros")) {
        state.reversal = {
          id: 800,
          tipo: params[0],
          origen: params[1],
          monto: params[5],
          cliente_id: params[10],
          route_item_id: params[11],
          reversed_movement_id: params[12],
          client_payment_cancellation_id: params[13],
        };
        return { rows: [{ id: 800 }], rowCount: 1 };
      }
      if (sql.startsWith("UPDATE client_payment_cancellations SET reversal_movement_id")) {
        state.cancellation.reversal_movement_id = params[0];
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("UPDATE movimientos_financieros SET estado = 'Anulado'")) {
        state.movement.estado = "Anulado";
        state.movement.anulada_at = params[0];
        state.movement.anulada_por = params[1];
        state.movement.anulacion_motivo = params[2];
        state.movement.client_payment_cancellation_id = params[3];
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("UPDATE cheques SET estado = 'anulado'")) {
        state.cheque.estado = "anulado";
        state.cheque.observaciones = params[0];
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Consulta no simulada: ${sql}`);
    },
  };
};

const expectFailure = async (client: any, expected: string) => {
  try {
    await clientPaymentCancellationService.cancelClientPayment(
      { movementId: 50, motivo: "Cobranza cargada por error", usuario: "Auditor" },
      client
    );
    throw new Error(`Se esperaba un bloqueo que contuviera: ${expected}`);
  } catch (error: any) {
    assert(String(error?.message || error).toLowerCase().includes(expected.toLowerCase()), `Mensaje inesperado: ${error?.message || String(error)}`);
  }
};

const successClient = createFakeClient({ routeItem: {} });
const result = await clientPaymentCancellationService.cancelClientPayment(
  { movementId: 50, motivo: "Cobranza cargada por duplicado", usuario: "Auditor" },
  successClient as any
);
assert(successClient.state.movement.estado === "Anulado", "La cobranza original no quedó anulada.");
assert(successClient.state.customer.saldo_cta_cte === 350, "No se restauró el saldo del cliente.");
assert(successClient.state.allocations.every((item) => item.allocation_state === "Anulado"), "No se anularon las asignaciones.");
assert(successClient.state.allocations[0].monto_pagado === 0 && successClient.state.allocations[0].monto_pendiente === 100, "La primera venta no recuperó su saldo.");
assert(successClient.state.allocations[1].monto_pagado === 0 && successClient.state.allocations[1].monto_pendiente === 100, "La segunda venta no recuperó su saldo.");
assert(successClient.state.reversal?.origen === "anulacion_cobranza", "No se creó el contramovimiento de cobranza.");
assert(successClient.state.reversal?.monto === 150, "El contramovimiento tiene un importe incorrecto.");
assert(result.customer_balance_after === 350, "La respuesta no informa el saldo restaurado.");
assert(result.affected_sales === 2, "La respuesta no informa las ventas afectadas.");
assert(successClient.state.routeItem?.cobranza_realizada === 0, "No se restauró el estado de cobranza del ítem de ruta.");
assert(result.route_item_reset === true, "La respuesta no informa la restauración de la ruta.");

const chequeClient = createFakeClient({
  movement: { cheque_id: 77 },
  cheque: { id: 77, numero_cheque: "TEST-77", estado: "en_cartera", observaciones: null },
});
const chequeResult = await clientPaymentCancellationService.cancelClientPayment(
  { movementId: 50, motivo: "Cobranza con cheque cargada por error", usuario: "Auditor" },
  chequeClient as any
);
assert(chequeClient.state.cheque?.estado === "anulado", "El cheque en cartera no quedó anulado.");
assert(chequeResult.cheque_cancelled === true, "La respuesta no informa la anulación del cheque.");

await expectFailure(createFakeClient({ movement: { estado: "Anulado", anulada_at: "2026-07-16" } }) as any, "ya fue anulada");
await expectFailure(createFakeClient({ movement: { reversion_version: 0 } }) as any, "sin trazabilidad completa");
await expectFailure(createFakeClient({ existingReversal: true }) as any, "ya posee un contramovimiento");
await expectFailure(createFakeClient({ allocations: [{ ...createFakeClient().state.allocations[0], monto: 90 }] }) as any, "no coincide con su importe");
await expectFailure(createFakeClient({ allocations: createFakeClient().state.allocations.map((item) => ({ ...item, sale_state: "Anulada" })) }) as any, "está anulada");
await expectFailure(createFakeClient({ routeItem: { id: 99, route_id: 5, client_id: 4, cobranza_realizada: 1, status: "visitado" } }) as any, "no pertenece al cliente");
await expectFailure(createFakeClient({ routeItem: { id: 99, route_id: 5, client_id: 3, cobranza_realizada: 0, status: "visitado" } }) as any, "no refleja una cobranza activa");
await expectFailure(createFakeClient({ routeItem: {}, otherRoutePayment: true }) as any, "otra cobranza activa");
await expectFailure(createFakeClient({ movement: { cheque_id: 77 }, cheque: { id: 77, numero_cheque: "TEST-77", estado: "depositado" } }) as any, "está depositado");

console.log("Anulación segura de cobranzas correcta: auditoría estática y simulaciones superadas.");
