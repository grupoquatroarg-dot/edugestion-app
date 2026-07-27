import fs from "node:fs";
import path from "node:path";
import { inventoryMovementCancellationService } from "../server/services/inventoryMovementCancellationService.js";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const migration = read("supabase/21_inventory_movement_cancellation.sql");
const vercelApi = read("api/products/[id].ts");
const expressRoutes = read("server/routes/productRoutes.ts");
const stockRoutes = read("server/routes/stockRoutes.ts");
const inventoryHelpers = read("server/services/vercel/productInventoryApiHelpers.ts");
const service = read("server/services/inventoryMovementCancellationService.ts");
const ui = read("src/components/ProductModule.tsx");
const database = read("server/db.ts");
const packageJson = JSON.parse(read("package.json"));

for (const token of [
  "reversion_version",
  "anulada_at",
  "anulada_por",
  "anulacion_motivo",
  "stock_movement_cancellations",
  "smc_stock_movement_id_fkey",
  "smc_reversal_movement_id_fkey",
  "idx_stock_movements_product_date",
]) {
  assert(migration.includes(token), `La migración 21 no contiene ${token}.`);
}

assert(vercelApi.includes('action === "inventory-history"'), "Vercel no expone el historial de inventario.");
assert(vercelApi.includes('action === "inventory-revert"'), "Vercel no expone la anulación de movimientos.");
assert(expressRoutes.includes('router.get("/:id/inventory-history"'), "Express no expone el historial de inventario.");
assert(expressRoutes.includes('inventory-movements/:movementId/revert'), "Express no expone la anulación de movimientos.");
assert(stockRoutes.includes("La carga directa de movimientos está deshabilitada"), "El endpoint local arbitrario de stock sigue habilitado.");
assert(inventoryHelpers.includes("reversion_version"), "Los movimientos nuevos no se marcan como reversibles.");
assert(inventoryHelpers.includes('"carga_stock"'), "La carga de stock no usa un origen normalizado.");
assert(inventoryHelpers.includes('"merma"'), "La merma no usa un origen normalizado.");
assert(service.includes("FOR UPDATE"), "El servicio no bloquea movimientos y productos.");
assert(service.includes("stock_movement_cancellations"), "El servicio no registra auditoría de la anulación.");
assert(service.includes("reversed_movement_id"), "El servicio no vincula el contramovimiento.");
assert(service.includes("cantidad_restante"), "El servicio no protege cargas consumidas.");
assert(ui.includes("Historial de inventario"), "Productos no muestra el historial de inventario.");
assert(ui.includes("Confirmar anulación"), "Productos no confirma la anulación.");
assert(database.includes("CREATE TABLE IF NOT EXISTS stock_movement_cancellations"), "SQLite no contiene la auditoría de movimientos.");
assert(packageJson.scripts["check:inventory-movement-cancellation"], "Falta el script permanente de auditoría.");
assert(packageJson.scripts["validate:audit"].includes("check:inventory-movement-cancellation"), "La auditoría nueva no está en validate:audit.");

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

type FakeState = {
  product: any;
  movement: any;
  movements: any[];
  cancellations: any[];
  nextMovementId: number;
  nextCancellationId: number;
  snapshot?: any;
};

const createState = (reason: "carga_stock" | "merma" = "carga_stock"): FakeState => ({
  product: { id: 7, name: "Producto prueba", stock: reason === "carga_stock" ? 20 : 10, cost: 150, estado: "activo" },
  movement: {
    id: 31,
    product_id: 7,
    cantidad: reason === "carga_stock" ? 10 : 3,
    costo_unitario: 150,
    cantidad_restante: reason === "carga_stock" ? 10 : 0,
    descripcion: reason === "carga_stock" ? "Carga manual" : "Merma manual",
    tipo_movimiento: reason === "carga_stock" ? "ingreso" : "egreso",
    motivo: reason,
    usuario: "Operador",
    reversion_version: 1,
    anulada_at: null,
    anulada_por: null,
    anulacion_motivo: null,
    reversed_movement_id: null,
    sale_id: null,
    purchase_invoice_id: null,
    purchase_invoice_item_id: null,
  },
  movements: [],
  cancellations: [],
  nextMovementId: 100,
  nextCancellationId: 200,
});

class FakeClient {
  constructor(public state: FakeState, private failAt = 0) {}
  private mutation = 0;

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

    if (sql.startsWith("SELECT * FROM stock_movimientos WHERE id = $1")) {
      return { rows: this.state.movement?.id === Number(params[0]) ? [clone(this.state.movement)] : [], rowCount: this.state.movement?.id === Number(params[0]) ? 1 : 0 };
    }
    if (sql.startsWith("SELECT * FROM products WHERE id = $1")) {
      return { rows: this.state.product?.id === Number(params[0]) ? [clone(this.state.product)] : [], rowCount: this.state.product?.id === Number(params[0]) ? 1 : 0 };
    }

    const mutate = () => {
      this.mutation += 1;
      if (this.failAt && this.mutation === this.failAt) throw new Error("Falla simulada");
    };

    if (sql.startsWith("UPDATE products SET stock = $1")) {
      mutate();
      this.state.product.stock = Number(params[0]);
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("INSERT INTO stock_movimientos")) {
      mutate();
      const id = this.state.nextMovementId++;
      this.state.movements.push({
        id,
        product_id: Number(params[0]),
        cantidad: Number(params[1]),
        costo_unitario: Number(params[2]),
        cantidad_restante: Number(params[3]),
        descripcion: params[4],
        tipo_movimiento: params[5],
        motivo: params[6],
        usuario: params[7],
        reversed_movement_id: Number(params[8]),
      });
      return { rows: [{ id, fecha_ingreso: "2026-07-26T12:00:00Z" }], rowCount: 1 };
    }
    if (sql.startsWith("UPDATE stock_movimientos SET anulada_at = now()")) {
      mutate();
      if (this.state.movement.anulada_at) return { rows: [], rowCount: 0 };
      this.state.movement.anulada_at = "2026-07-26T12:00:00Z";
      this.state.movement.anulada_por = params[0];
      this.state.movement.anulacion_motivo = params[1];
      if (this.state.movement.motivo === "carga_stock") this.state.movement.cantidad_restante = 0;
      return { rows: [{ anulada_at: this.state.movement.anulada_at }], rowCount: 1 };
    }
    if (sql.startsWith("INSERT INTO stock_movement_cancellations")) {
      mutate();
      const id = this.state.nextCancellationId++;
      this.state.cancellations.push({ id, params: clone(params) });
      return { rows: [{ id, anulada_at: "2026-07-26T12:00:00Z" }], rowCount: 1 };
    }

    throw new Error(`Consulta no simulada: ${sql}`);
  }
}

const cancelWithTransaction = async (state: FakeState, failAt = 0) => {
  const client = new FakeClient(state, failAt);
  await client.query("BEGIN");
  try {
    const result = await inventoryMovementCancellationService.cancel(
      { productId: 7, movementId: 31, motivo: "Movimiento registrado por error", usuario: "Auditor" },
      client as any
    );
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
};

const loadState = createState("carga_stock");
const loadResult = await cancelWithTransaction(loadState);
assert(loadResult.stockBefore === 20 && loadResult.stockAfter === 10, "La carga no restauró el stock exacto.");
assert(loadState.product.stock === 10, "El producto no descontó la carga anulada.");
assert(loadState.movements[0]?.cantidad === -10, "El contramovimiento de carga tiene cantidad incorrecta.");
assert(loadState.movements[0]?.motivo === "anulacion_carga_stock", "El contramovimiento de carga tiene origen incorrecto.");
assert(Boolean(loadState.movement.anulada_at), "La carga original no quedó anulada.");
assert(loadState.cancellations.length === 1, "No se registró la auditoría de carga.");

const wasteState = createState("merma");
const wasteResult = await cancelWithTransaction(wasteState);
assert(wasteResult.stockBefore === 10 && wasteResult.stockAfter === 13, "La merma no restauró el stock exacto.");
assert(wasteState.product.stock === 13, "El producto no recuperó la merma.");
assert(wasteState.movements[0]?.cantidad === 3 && wasteState.movements[0]?.cantidad_restante === 3, "El contramovimiento de merma no repuso el lote.");
assert(wasteState.movements[0]?.motivo === "anulacion_merma", "El contramovimiento de merma tiene origen incorrecto.");

const insufficient = createState("carga_stock");
insufficient.product.stock = 5;
await cancelWithTransaction(insufficient).then(
  () => { throw new Error("Debía bloquear stock insuficiente."); },
  (error) => assert(String(error.message).includes("stock actual es insuficiente"), "Mensaje incorrecto para stock insuficiente.")
);
assert(insufficient.product.stock === 5 && insufficient.movements.length === 0, "El bloqueo de stock dejó cambios parciales.");

const consumed = createState("carga_stock");
consumed.movement.cantidad_restante = 4;
await cancelWithTransaction(consumed).then(
  () => { throw new Error("Debía bloquear una carga consumida."); },
  (error) => assert(String(error.message).includes("consumida"), "Mensaje incorrecto para carga consumida.")
);

const historical = createState("merma");
historical.movement.reversion_version = 0;
await cancelWithTransaction(historical).then(
  () => { throw new Error("Debía bloquear un movimiento histórico."); },
  (error) => assert(String(error.message).includes("anterior a la trazabilidad"), "Mensaje histórico incorrecto.")
);

const rollback = createState("carga_stock");
await cancelWithTransaction(rollback, 2).then(
  () => { throw new Error("La prueba de rollback debía fallar."); },
  () => undefined
);
assert(rollback.product.stock === 20, "El rollback no restauró el stock.");
assert(!rollback.movement.anulada_at, "El rollback dejó el movimiento anulado.");
assert(rollback.movements.length === 0 && rollback.cancellations.length === 0, "El rollback dejó trazabilidad parcial.");

console.log("Anulación segura de movimientos de inventario correcta: cargas, mermas, bloqueos, auditoría y rollback verificados.");
