import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { manualExpenseCancellationService } from "../server/services/manualExpenseCancellationService.js";

const root = process.cwd();
const read = (relativePath: string) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const servicePath = "server/services/manualExpenseCancellationService.ts";
const service = read(servicePath);

for (const required of [
  'client.query("BEGIN")',
  'client.query("COMMIT")',
  'client.query("ROLLBACK")',
  "FOR UPDATE OF mf",
  "financial_movement_cancellations",
  "anulacion_egreso_manual",
  "reversed_movement_id",
  "financial_movement_cancellation_id",
  "SET estado = 'Anulado'",
  "entregado_proveedor",
  "El motivo de anulación no puede superar los 500 caracteres",
  "Solo pueden anularse egresos manuales",
  "antes de habilitar la trazabilidad",
]) {
  assert(service.includes(required), `Falta protección de egreso manual: ${required}`);
}

assert(
  !/DELETE\s+FROM\s+movimientos_financieros/i.test(service),
  "La anulación no debe borrar movimientos financieros."
);
assert(
  !/DELETE\s+FROM\s+cheques/i.test(service),
  "La anulación no debe borrar cheques."
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
          `Consulta de egreso con parámetros incorrectos: ${maximum}/${params.elements.length}.`
        );
      }
    }
  }
  ts.forEachChild(node, visit);
};
visit(sourceFile);
assert(
  parameterizedQueries >= 10,
  `No se auditaron suficientes consultas de egresos (${parameterizedQueries}/10).`
);

const api = read("api/finanzas.ts");
for (const required of [
  'endpoint === "manual-expense-cancel"',
  'requireCurrentAccountsPermission(req, res, "delete")',
  "manualExpenseCancellationService.cancelManualExpense",
]) {
  assert(api.includes(required), `Falta integración API de egresos: ${required}`);
}

const expressRoute = read("server/routes/financeRoutes.ts");
for (const required of [
  "'/movimientos/:id/cancel'",
  "requirePermission('current_accounts', 'delete')",
  "manualExpenseCancellationService.cancelManualExpense",
]) {
  assert(expressRoute.includes(required), `Falta integración Express de egresos: ${required}`);
}

const repository = read("server/repositories/financeRepository.ts");
assert(
  repository.includes("estado, reversion_version") && repository.includes("'Activo',\n            1"),
  "Los egresos nuevos no quedan trazados con versión 1."
);

const ui = read("src/components/FinanceModule.tsx");
for (const required of [
  "Anular egreso manual",
  "Confirmar anulación",
  "Motivo obligatorio",
  "manual-expense-cancel",
  "Egreso histórico sin trazabilidad",
  "hasPermission('current_accounts', 'delete')",
  "anulacion_egreso_manual",
]) {
  assert(ui.includes(required), `Falta interfaz de egresos: ${required}`);
}

const migration = read("supabase/08_manual_expense_cancellation.sql");
for (const required of [
  "financial_movement_cancellations",
  "reversion_version",
  "financial_movement_cancellation_id",
  "anulada_at",
  "anulada_por",
  "anulacion_motivo",
]) {
  assert(migration.includes(required), `Falta migración de egresos: ${required}`);
}

for (const file of [
  "api/dashboard/[endpoint].ts",
  "server/routes/reportRoutes.ts",
  "src/components/FinanceModule.tsx",
]) {
  const content = read(file);
  assert(
    content.includes("anulacion_egreso_manual"),
    `${file} no excluye contramovimientos de egresos en sus métricas.`
  );
}

type FakeState = {
  movement: any;
  cheque: any;
  cancellation: any;
  reversal: any;
  paymentNumber: number;
  committed: boolean;
  rolledBack: boolean;
};

const baseMovement = {
  id: 40,
  tipo: "egreso",
  origen: "egreso_manual",
  descripcion: "Alquiler del depósito",
  categoria: "Servicios",
  forma_pago: "transferencia",
  monto: 250000,
  usuario: "Administrador",
  numero_pago: 80,
  cheque_id: null,
  estado: "Activo",
  reversion_version: 1,
  anulada_at: null,
  venta_id: null,
  purchase_invoice_id: null,
  sale_cancellation_id: null,
  purchase_invoice_cancellation_id: null,
  reversed_movement_id: null,
  financial_movement_cancellation_id: null,
};

const createFakeClient = (
  movementOverrides: Record<string, unknown> = {},
  chequeOverrides: Record<string, unknown> | null = null
) => {
  const state: FakeState = {
    movement: { ...baseMovement, ...movementOverrides },
    cheque: chequeOverrides
      ? {
          id: 12,
          numero_cheque: "CH-12",
          banco: "Banco Prueba",
          estado: "entregado_proveedor",
          proveedor_id: 5,
          fecha_entrega: "2026-07-15",
          ...chequeOverrides,
        }
      : null,
    cancellation: null,
    reversal: null,
    paymentNumber: 100,
    committed: false,
    rolledBack: false,
  };
  const initial = structuredClone(state);

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
        Object.assign(state, structuredClone(initial), { rolledBack: true });
        return { rows: [], rowCount: null };
      }
      if (sql.startsWith("SELECT mf.* FROM movimientos_financieros mf")) {
        return state.movement
          ? { rows: [structuredClone(state.movement)], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (sql.startsWith("SELECT id FROM financial_movement_cancellations")) {
        return state.cancellation
          ? { rows: [{ id: state.cancellation.id }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (sql.startsWith("SELECT * FROM cheques")) {
        return state.cheque
          ? { rows: [structuredClone(state.cheque)], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (sql.startsWith("SELECT id FROM movimientos_financieros WHERE cheque_id")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.startsWith("INSERT INTO financial_movement_cancellations")) {
        state.cancellation = {
          id: 700,
          movimiento_financiero_id: params[0],
          motivo: params[1],
          anulada_por: params[2],
        };
        return {
          rows: [{ id: 700, anulada_at: "2026-07-15T18:00:00.000Z" }],
          rowCount: 1,
        };
      }
      if (sql.startsWith("INSERT INTO settings")) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("SELECT value FROM settings")) {
        return { rows: [{ value: String(state.paymentNumber) }], rowCount: 1 };
      }
      if (sql.startsWith("UPDATE settings SET value")) {
        state.paymentNumber = Number(params[1]);
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("INSERT INTO movimientos_financieros")) {
        state.reversal = {
          id: 900,
          tipo: params[0],
          origen: params[1],
          monto: params[5],
          reversed_movement_id: params[10],
          financial_movement_cancellation_id: params[11],
        };
        return { rows: [{ id: 900 }], rowCount: 1 };
      }
      if (sql.startsWith("UPDATE movimientos_financieros SET estado = 'Anulado'")) {
        state.movement.estado = "Anulado";
        state.movement.anulada_at = params[0];
        state.movement.anulada_por = params[1];
        state.movement.anulacion_motivo = params[2];
        state.movement.financial_movement_cancellation_id = params[3];
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("UPDATE cheques SET estado = 'en_cartera'")) {
        state.cheque.estado = "en_cartera";
        state.cheque.proveedor_id = null;
        state.cheque.fecha_entrega = null;
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Consulta no contemplada: ${sql}`);
    },
  };
};

const successClient = createFakeClient();
await successClient.query("BEGIN");
const success = await manualExpenseCancellationService.cancelManualExpense(
  {
    movementId: 40,
    motivo: "Egreso cargado por duplicado",
    usuario: "Auditor",
  },
  successClient
);
await successClient.query("COMMIT");
assert(successClient.state.committed, "No se confirmó la transacción.");
assert(successClient.state.movement.estado === "Anulado", "El egreso no quedó anulado.");
assert(successClient.state.reversal?.origen === "anulacion_egreso_manual", "No se creó el contramovimiento.");
assert(successClient.state.reversal?.monto === 250000, "El contramovimiento tiene un monto incorrecto.");
assert(success.reversal_movement_id === 900, "La respuesta no devuelve el contramovimiento.");

const chequeClient = createFakeClient(
  { forma_pago: "cheque_en_cartera", cheque_id: 12 },
  {}
);
await chequeClient.query("BEGIN");
await manualExpenseCancellationService.cancelManualExpense(
  { movementId: 40, motivo: "Pago registrado por error", usuario: "Auditor" },
  chequeClient
);
await chequeClient.query("COMMIT");
assert(chequeClient.state.cheque.estado === "en_cartera", "El cheque no volvió a cartera.");
assert(chequeClient.state.cheque.proveedor_id === null, "El proveedor no fue retirado del cheque.");

for (const [name, movementPatch, chequePatch, expectedText] of [
  ["histórico", { reversion_version: 0 }, null, "antes de habilitar"],
  ["movimiento automático", { origen: "compra" }, null, "Solo pueden anularse"],
  ["doble anulación", { estado: "Anulado", anulada_at: "2026-07-15" }, null, "ya fue anulado"],
  [
    "cheque procesado",
    { forma_pago: "cheque_en_cartera", cheque_id: 12 },
    { estado: "cobrado" },
    "está cobrado",
  ],
] as const) {
  const client = createFakeClient(movementPatch, chequePatch as any);
  const before = structuredClone(client.state);
  let message = "";
  await client.query("BEGIN");
  try {
    await manualExpenseCancellationService.cancelManualExpense(
      { movementId: 40, motivo: "Prueba de bloqueo", usuario: "Auditor" },
      client
    );
    await client.query("COMMIT");
  } catch (error: any) {
    message = error?.message || String(error);
    await client.query("ROLLBACK");
  }
  assert(message.includes(expectedText), `No se bloqueó correctamente: ${name}.`);
  assert(client.state.rolledBack, `No hubo rollback para: ${name}.`);
  assert(client.state.movement.estado === before.movement.estado, `Hubo cambio parcial en: ${name}.`);
}

console.log(
  `Anular egreso manual correcto: ${parameterizedQueries} consultas, permisos, trazabilidad, contramovimiento, cheque, métricas y rollback verificados.`
);
