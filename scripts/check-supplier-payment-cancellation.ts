import fs from "node:fs";
import path from "node:path";
import { supplierPaymentCancellationService } from "../server/services/supplierPaymentCancellationService.js";

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const migration = read("supabase/17_supplier_payment_cancellation.sql");
[
  "supplier_payment_cancellations",
  "supplier_payment_cancellation_id",
  "purchase_invoice_payment_allocations_estado_check",
  "reversal_movement_id",
  "cheque_estado_original",
].forEach((token) => assert(migration.includes(token), `La migración no contiene ${token}.`));

const service = read("server/services/supplierPaymentCancellationService.ts");
[
  "FOR UPDATE OF mf, pia, pi",
  "allocation_type = 'supplier_payment'",
  "reversion_version",
  "anulacion_pago_proveedor",
  "UPDATE purchase_invoices",
  "UPDATE purchase_invoice_payment_allocations",
  "estado = 'en_cartera'",
  "ROLLBACK",
].forEach((token) => assert(service.includes(token), `El servicio no contiene ${token}.`));

const purchaseService = read("server/services/purchaseInvoiceService.ts");
assert(purchaseService.includes("listAvailablePurchaseCheques"), "No se exponen cheques en cartera.");
assert(purchaseService.includes("reversionVersion: 1"), "Los pagos nuevos no quedan habilitados para reversión.");
assert(purchaseService.includes("estado = 'entregado_proveedor'"), "El pago con cheque no entrega el cheque al proveedor.");
assert(purchaseService.includes("El importe del cheque debe coincidir exactamente"), "Falta validar el importe del cheque.");
assert(purchaseService.includes("const chequeId = chequePayment ? rawChequeId : null"), "Un pago que no es cheque podría conservar un cheque_id incompatible.");
assert(purchaseService.includes("registrá primero la factura en Cta Cte"), "La compra inicial con cheque no está protegida.");

const api = read("api/purchase-invoices/index.ts");
assert(api.includes('endpoint === "cancel-payment"'), "Falta endpoint Vercel para anular pagos.");
assert(api.includes('endpoint === "available-cheques"'), "Falta endpoint Vercel para cheques disponibles.");
assert(api.includes("supplierPaymentCancellationService.cancelSupplierPayment"), "La API no utiliza el servicio transaccional.");

const expressRoutes = read("server/routes/purchaseInvoiceRoutes.ts");
assert(expressRoutes.includes('String(req.query.endpoint || "") !== "cancel-payment"'), "Express no soporta la anulación de pagos.");
assert(expressRoutes.includes("payPurchaseInvoice"), "Express no soporta registrar pagos de proveedor.");

const ui = read("src/components/PurchaseInvoiceModule.tsx");
[
  "Anular pago",
  "handleCancelSupplierPayment",
  "available-cheques",
  "Cheque en cartera",
  "supplier_payment_movement_id",
].forEach((token) => assert(ui.includes(token), `La interfaz no contiene ${token}.`));

for (const metricFile of [
  "src/components/FinanceModule.tsx",
  "api/dashboard/[endpoint].ts",
  "server/routes/reportRoutes.ts",
]) {
  assert(
    read(metricFile).includes("anulacion_pago_proveedor"),
    `${metricFile} no excluye el contramovimiento de las métricas.`
  );
}

type FakeState = {
  movement: any;
  invoice: any;
  allocation: any;
  cheque: any | null;
  cancellations: any[];
  reversals: any[];
  settings: Record<string, string>;
  failOnReversal: boolean;
};

const clone = <T,>(value: T): T => structuredClone(value);

const createState = (options: Partial<FakeState> = {}): FakeState => ({
  movement: {
    id: 700,
    tipo: "egreso",
    origen: "compra",
    descripcion: "Pago Factura Compra #FC-30 - Proveedor",
    categoria: "Compras",
    forma_pago: "cheque_en_cartera",
    monto: 1000,
    cheque_id: 20,
    purchase_invoice_id: 30,
    estado: "Activo",
    reversion_version: 1,
    anulada_at: null,
    sale_cancellation_id: null,
    purchase_invoice_cancellation_id: null,
    financial_movement_cancellation_id: null,
    client_payment_cancellation_id: null,
    supplier_payment_cancellation_id: null,
    reversed_movement_id: null,
  },
  invoice: {
    id: 30,
    proveedor_id: 7,
    numero_factura: "FC-30",
    total: 1000,
    metodo_pago: "Cta Cte",
    estado_pago: "pagado",
    monto_pagado: 1000,
    fecha_pago: "2026-07-25",
    metodo_pago_real: "cheque_en_cartera",
    estado: "Activa",
    reversion_version: 1,
    proveedor: "Proveedor prueba",
  },
  allocation: {
    id: 90,
    purchase_invoice_id: 30,
    movimiento_financiero_id: 700,
    monto: 1000,
    allocation_type: "supplier_payment",
    estado: "Activo",
    supplier_payment_cancellation_id: null,
  },
  cheque: {
    id: 20,
    numero_cheque: "CH-20",
    banco: "Banco prueba",
    importe: 1000,
    estado: "entregado_proveedor",
    proveedor_id: 7,
    purchase_invoice_id: 30,
    fecha_entrega: "2026-07-25",
    observaciones: "Entregado como pago",
  },
  cancellations: [],
  reversals: [],
  settings: { next_payment_number: "50" },
  failOnReversal: false,
  ...options,
});

class FakeClient {
  state: FakeState;
  private beforeTransaction: FakeState | null = null;

  constructor(state: FakeState) {
    this.state = state;
  }

  async query(text: string, params: any[] = []) {
    const sql = text.replace(/\s+/g, " ").trim();

    if (sql === "BEGIN") {
      this.beforeTransaction = clone(this.state);
      return { rows: [], rowCount: 0 };
    }
    if (sql === "COMMIT") {
      this.beforeTransaction = null;
      return { rows: [], rowCount: 0 };
    }
    if (sql === "ROLLBACK") {
      if (this.beforeTransaction) this.state = clone(this.beforeTransaction);
      this.beforeTransaction = null;
      return { rows: [], rowCount: 0 };
    }

    if (sql.startsWith("SELECT mf.*, pia.id AS allocation_id")) {
      if (Number(params[0]) !== Number(this.state.movement.id)) return { rows: [], rowCount: 0 };
      return {
        rows: [{
          ...clone(this.state.movement),
          allocation_id: this.state.allocation.id,
          allocation_amount: this.state.allocation.monto,
          allocation_type: this.state.allocation.allocation_type,
          allocation_state: this.state.allocation.estado,
          allocation_cancellation_id: this.state.allocation.supplier_payment_cancellation_id,
          proveedor_id: this.state.invoice.proveedor_id,
          numero_factura: this.state.invoice.numero_factura,
          invoice_total: this.state.invoice.total,
          invoice_payment_method: this.state.invoice.metodo_pago,
          invoice_payment_state: this.state.invoice.estado_pago,
          invoice_paid_amount: this.state.invoice.monto_pagado,
          invoice_payment_date: this.state.invoice.fecha_pago,
          invoice_real_payment_method: this.state.invoice.metodo_pago_real,
          invoice_state: this.state.invoice.estado,
          invoice_reversion_version: this.state.invoice.reversion_version,
          proveedor: this.state.invoice.proveedor,
        }],
        rowCount: 1,
      };
    }

    if (sql.startsWith("SELECT id FROM supplier_payment_cancellations")) {
      const row = this.state.cancellations.find((item) => item.movimiento_financiero_id === Number(params[0]));
      return { rows: row ? [clone(row)] : [], rowCount: row ? 1 : 0 };
    }

    if (sql.startsWith("SELECT id FROM movimientos_financieros WHERE reversed_movement_id")) {
      const row = this.state.reversals.find((item) => item.reversed_movement_id === Number(params[0]));
      return { rows: row ? [clone(row)] : [], rowCount: row ? 1 : 0 };
    }

    if (sql.startsWith("SELECT pia.id, pia.movimiento_financiero_id")) {
      if (this.state.allocation.estado !== "Activo" || this.state.movement.estado === "Anulado") {
        return { rows: [], rowCount: 0 };
      }
      return {
        rows: [{
          id: this.state.allocation.id,
          movimiento_financiero_id: this.state.allocation.movimiento_financiero_id,
          monto: this.state.allocation.monto,
          allocation_type: this.state.allocation.allocation_type,
          estado: this.state.allocation.estado,
          forma_pago: this.state.movement.forma_pago,
          fecha: "2026-07-25",
          movement_state: this.state.movement.estado,
        }],
        rowCount: 1,
      };
    }

    if (sql.startsWith("SELECT * FROM cheques")) {
      return this.state.cheque
        ? { rows: [clone(this.state.cheque)], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }

    if (sql.startsWith("INSERT INTO supplier_payment_cancellations")) {
      const cancellation = {
        id: 500,
        movimiento_financiero_id: Number(params[0]),
        purchase_invoice_id: Number(params[1]),
        motivo: params[2],
        anulada_por: params[3],
        monto_original: Number(params[4]),
        monto_pagado_original: Number(params[5]),
        estado_pago_original: params[6],
        cheque_id: params[7],
        cheque_estado_original: params[8],
        snapshot: params[9],
        anulada_at: "2026-07-26T12:00:00.000Z",
        reversal_movement_id: null,
      };
      this.state.cancellations.push(cancellation);
      return { rows: [{ id: cancellation.id, anulada_at: cancellation.anulada_at }], rowCount: 1 };
    }

    if (sql.startsWith("UPDATE purchase_invoices SET monto_pagado")) {
      this.state.invoice.monto_pagado = Number(params[0]);
      this.state.invoice.estado_pago = params[1];
      this.state.invoice.fecha_pago = params[2];
      this.state.invoice.metodo_pago_real = params[3];
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith("UPDATE purchase_invoice_payment_allocations SET estado = 'Anulado'")) {
      this.state.allocation.estado = "Anulado";
      this.state.allocation.supplier_payment_cancellation_id = Number(params[3]);
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith("INSERT INTO settings")) {
      if (!(params[0] in this.state.settings)) this.state.settings[String(params[0])] = String(params[1]);
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("SELECT value FROM settings")) {
      return { rows: [{ value: this.state.settings[String(params[0])] || "1" }], rowCount: 1 };
    }
    if (sql.startsWith("UPDATE settings SET value")) {
      this.state.settings[String(params[0])] = String(params[1]);
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith("INSERT INTO movimientos_financieros")) {
      if (this.state.failOnReversal) throw new Error("Falla simulada al crear contramovimiento");
      const reversal = {
        id: 800,
        tipo: params[0],
        origen: params[1],
        monto: Number(params[5]),
        cheque_id: params[9],
        purchase_invoice_id: params[10],
        reversed_movement_id: params[11],
        supplier_payment_cancellation_id: params[12],
        estado: params[13],
      };
      this.state.reversals.push(reversal);
      return { rows: [{ id: reversal.id }], rowCount: 1 };
    }

    if (sql.startsWith("UPDATE supplier_payment_cancellations SET reversal_movement_id")) {
      const cancellation = this.state.cancellations.find((item) => item.id === Number(params[1]));
      if (cancellation) cancellation.reversal_movement_id = Number(params[0]);
      return { rows: [], rowCount: cancellation ? 1 : 0 };
    }

    if (sql.startsWith("UPDATE movimientos_financieros SET estado = 'Anulado'")) {
      this.state.movement.estado = "Anulado";
      this.state.movement.supplier_payment_cancellation_id = Number(params[3]);
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith("UPDATE cheques SET estado = 'en_cartera'")) {
      if (this.state.cheque) {
        this.state.cheque.estado = "en_cartera";
        this.state.cheque.proveedor_id = null;
        this.state.cheque.purchase_invoice_id = null;
        this.state.cheque.fecha_entrega = null;
        this.state.cheque.observaciones = params[0];
      }
      return { rows: [], rowCount: this.state.cheque ? 1 : 0 };
    }

    throw new Error(`Consulta no simulada: ${sql}`);
  }
}

const runCancellation = async (state: FakeState) => {
  const client = new FakeClient(state);
  await client.query("BEGIN");
  try {
    const result = await supplierPaymentCancellationService.cancelSupplierPayment(
      { movementId: 700, motivo: "Pago cargado por error", usuario: "Auditor" },
      client as any
    );
    await client.query("COMMIT");
    return { client, result };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
};

const success = await runCancellation(createState());
assert(success.client.state.invoice.monto_pagado === 0, "La factura no restauró el monto pagado.");
assert(success.client.state.invoice.estado_pago === "pendiente", "La factura no volvió a pendiente.");
assert(success.client.state.allocation.estado === "Anulado", "La asignación no quedó anulada.");
assert(success.client.state.movement.estado === "Anulado", "El egreso original no quedó anulado.");
assert(success.client.state.reversals.length === 1, "No se creó exactamente un contramovimiento.");
assert(success.client.state.reversals[0].origen === "anulacion_pago_proveedor", "El contramovimiento tiene un origen incorrecto.");
assert(success.client.state.cheque?.estado === "en_cartera", "El cheque no volvió a cartera.");
assert(success.result.cheque_restored === true, "La respuesta no informa la restauración del cheque.");

const cashState = createState({
  movement: { ...createState().movement, forma_pago: "transferencia", cheque_id: null },
  cheque: null,
});
const cash = await runCancellation(cashState);
assert(cash.result.cheque_restored === false, "Un pago sin cheque no debe informar restauración.");

for (const [name, state, expected] of [
  ["histórico", createState({ movement: { ...createState().movement, reversion_version: 0 } }), "sin trazabilidad completa"],
  ["doble anulación", createState({ movement: { ...createState().movement, estado: "Anulado" } }), "ya fue anulado"],
  ["cheque procesado", createState({ cheque: { ...createState().cheque, estado: "depositado" } }), "No se puede anular el pago"],
] as Array<[string, FakeState, string]>) {
  try {
    await runCancellation(state);
    throw new Error(`La prueba ${name} debía fallar.`);
  } catch (error: any) {
    assert(String(error?.message || error).includes(expected), `La prueba ${name} devolvió un error inesperado: ${error?.message}`);
  }
}

const rollbackState = createState({ failOnReversal: true });
const rollbackClient = new FakeClient(rollbackState);
await rollbackClient.query("BEGIN");
try {
  await supplierPaymentCancellationService.cancelSupplierPayment(
    { movementId: 700, motivo: "Forzar rollback", usuario: "Auditor" },
    rollbackClient as any
  );
  throw new Error("La prueba de rollback debía fallar.");
} catch (error: any) {
  await rollbackClient.query("ROLLBACK");
  assert(String(error?.message || error).includes("Falla simulada"), "La falla simulada no llegó al llamador.");
  assert(rollbackClient.state.invoice.monto_pagado === 1000, "El rollback no restauró la factura.");
  assert(rollbackClient.state.allocation.estado === "Activo", "El rollback no restauró la asignación.");
  assert(rollbackClient.state.movement.estado === "Activo", "El rollback no restauró el movimiento.");
  assert(rollbackClient.state.cancellations.length === 0, "El rollback dejó una anulación parcial.");
}

console.log("Anulación segura de pagos a proveedores correcta: trazabilidad, cheque, métricas, bloqueos y rollback verificados.");
