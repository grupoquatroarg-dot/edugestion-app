import fs from "node:fs";
import path from "node:path";
import { bulkPriceReversalService } from "../server/services/bulkPriceReversalService.js";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const migration = read("supabase/20_bulk_price_reversal.sql");
const api = read("api/products.ts");
const localRoutes = read("server/routes/bulkUpdateRoutes.ts");
const service = read("server/services/bulkPriceReversalService.ts");
const ui = read("src/components/BulkPriceUpdate.tsx");
const database = read("server/db.ts");
const packageJson = JSON.parse(read("package.json"));

for (const token of [
  "reversion_version",
  "reverted_at",
  "reverted_by",
  "revert_reason",
  "reverted_count",
  "price_update_history_items",
  "previous_cost",
  "previous_sale_price",
  "new_cost",
  "new_sale_price",
  "idx_price_update_items_history",
]) {
  assert(migration.includes(token), `La migración 20 no contiene ${token}.`);
}

assert(api.includes('endpoint === "bulk-price-revert"'), "Vercel no expone bulk-price-revert.");
assert(api.includes("reversion_version\n        )\n        VALUES (?, ?, ?, ?, ?, 1)"), "SQLite no marca los cambios nuevos como reversibles.");
assert(api.includes("INSERT INTO price_update_history_items"), "La aplicación no registra valores por producto.");
assert(api.includes("expected_product_ids"), "La aplicación perdió la protección de vista previa.");
assert(localRoutes.includes('router.post("/:id/revert"'), "Express no expone la reversión local.");
assert(service.includes("FOR UPDATE OF pui, p"), "La reversión no bloquea productos e ítems.");
assert(service.includes("previous_cost"), "La reversión no restaura el costo exacto anterior.");
assert(service.includes("previous_sale_price"), "La reversión no restaura el precio exacto anterior.");
assert(service.includes('await client.query("ROLLBACK")'), "La reversión PostgreSQL no ejecuta rollback.");
assert(service.includes("cambiaron después de esta actualización"), "No se bloquean productos modificados posteriormente.");
assert(database.includes("CREATE TABLE IF NOT EXISTS price_update_history_items"), "SQLite no crea la trazabilidad de precios.");
assert(ui.includes("Revertir cambio"), "La interfaz no ofrece la reversión.");
assert(ui.includes("bulk-price-revert"), "La interfaz no llama al endpoint de reversión.");
assert(ui.includes("Motivo de la reversión"), "La interfaz no exige motivo.");
assert(packageJson.scripts?.["check:bulk-price-reversal"], "Falta el script check:bulk-price-reversal.");
assert(String(packageJson.scripts?.["validate:audit"] || "").includes("check:bulk-price-reversal"), "validate:audit no incluye la nueva auditoría.");

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

type State = {
  history: any;
  products: any[];
  items: any[];
  snapshots: State[];
};

class FakeClient {
  state: State;
  failProductId: number | null;

  constructor(state: State, failProductId: number | null = null) {
    this.state = state;
    this.failProductId = failProductId;
  }

  async query(text: string, params: any[] = []) {
    const sql = text.replace(/\s+/g, " ").trim();

    if (sql === "BEGIN") {
      this.state.snapshots.push(clone({ ...this.state, snapshots: [] }));
      return { rows: [], rowCount: null };
    }
    if (sql === "COMMIT") {
      this.state.snapshots.pop();
      return { rows: [], rowCount: null };
    }
    if (sql === "ROLLBACK") {
      const snapshot = this.state.snapshots.pop();
      if (snapshot) {
        this.state.history = snapshot.history;
        this.state.products = snapshot.products;
        this.state.items = snapshot.items;
      }
      return { rows: [], rowCount: null };
    }
    if (sql.startsWith("SELECT * FROM price_update_history")) {
      return { rows: this.state.history.id === params[0] ? [clone(this.state.history)] : [], rowCount: this.state.history.id === params[0] ? 1 : 0 };
    }
    if (sql.includes("FROM price_update_history_items pui") && sql.includes("JOIN products p")) {
      const rows = this.state.items
        .filter((item) => item.price_update_history_id === params[0])
        .map((item) => {
          const product = this.state.products.find((candidate) => candidate.id === item.product_id);
          return {
            ...clone(item),
            product_name: product?.name,
            current_cost: product?.cost,
            current_sale_price: product?.sale_price,
          };
        });
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith("UPDATE products SET cost")) {
      const product = this.state.products.find((candidate) => candidate.id === Number(params[2]));
      if (!product || this.failProductId === product.id) return { rows: [], rowCount: 0 };
      product.cost = Number(params[0]);
      product.sale_price = Number(params[1]);
      return { rows: [{ id: product.id, cost: product.cost, sale_price: product.sale_price }], rowCount: 1 };
    }
    if (sql.startsWith("UPDATE price_update_history_items")) {
      for (const item of this.state.items) {
        if (item.price_update_history_id === params[1] && !item.reverted_at) item.reverted_at = params[0];
      }
      return { rows: [], rowCount: this.state.items.length };
    }
    if (sql.startsWith("UPDATE price_update_history SET reverted_at")) {
      if (this.state.history.id !== params[4] || this.state.history.reverted_at) return { rows: [], rowCount: 0 };
      Object.assign(this.state.history, {
        reverted_at: params[0],
        reverted_by: params[1],
        revert_reason: params[2],
        reverted_count: params[3],
      });
      return { rows: [{ id: this.state.history.id }], rowCount: 1 };
    }

    throw new Error(`Consulta no simulada: ${sql}`);
  }
}

const createState = (): State => ({
  history: {
    id: 41,
    productos_afectados: 2,
    reversion_version: 1,
    reverted_at: null,
  },
  products: [
    { id: 1, name: "Producto A", cost: 120, sale_price: 240 },
    { id: 2, name: "Producto B", cost: 180, sale_price: 360 },
  ],
  items: [
    { price_update_history_id: 41, product_id: 1, previous_cost: 100, previous_sale_price: 200, new_cost: 120, new_sale_price: 240, reverted_at: null },
    { price_update_history_id: 41, product_id: 2, previous_cost: 150, previous_sale_price: 300, new_cost: 180, new_sale_price: 360, reverted_at: null },
  ],
  snapshots: [],
});

const success = createState();
const successResult = await bulkPriceReversalService.revert(
  { historyId: 41, motivo: "Porcentaje aplicado incorrectamente", usuario: "Auditor" },
  new FakeClient(success) as any
);
assert(successResult.revertedCount === 2, "La reversión no informó dos productos.");
assert(success.products[0].cost === 100 && success.products[0].sale_price === 200, "No se restauró el producto A.");
assert(success.products[1].cost === 150 && success.products[1].sale_price === 300, "No se restauró el producto B.");
assert(Boolean(success.history.reverted_at), "El historial no quedó marcado como revertido.");
assert(success.items.every((item) => item.reverted_at), "Los ítems no quedaron marcados como revertidos.");

const changed = createState();
changed.products[1].sale_price = 370;
await bulkPriceReversalService.revert(
  { historyId: 41, motivo: "Intento con cambio posterior", usuario: "Auditor" },
  new FakeClient(changed) as any
).then(
  () => { throw new Error("Debía bloquear un producto modificado después."); },
  (error) => assert(String(error.message).includes("cambiaron después"), "Mensaje incorrecto para cambio posterior.")
);
assert(changed.products[0].cost === 120, "El bloqueo dejó una reversión parcial.");

const historical = createState();
historical.history.reversion_version = 0;
await bulkPriceReversalService.revert(
  { historyId: 41, motivo: "Registro histórico", usuario: "Auditor" },
  new FakeClient(historical) as any
).then(
  () => { throw new Error("Debía bloquear un registro histórico."); },
  (error) => assert(String(error.message).includes("anterior a la trazabilidad"), "Mensaje histórico incorrecto.")
);

const rollback = createState();
const rollbackClient = new FakeClient(rollback, 2);
await rollbackClient.query("BEGIN");
try {
  await bulkPriceReversalService.revert(
    { historyId: 41, motivo: "Forzar rollback", usuario: "Auditor" },
    rollbackClient as any
  );
  throw new Error("La prueba de rollback debía fallar.");
} catch {
  await rollbackClient.query("ROLLBACK");
}
assert(rollback.products[0].cost === 120 && rollback.products[1].cost === 180, "El rollback no restauró los productos.");
assert(!rollback.history.reverted_at, "El rollback dejó el historial revertido.");

console.log("Reversión segura de cambios masivos correcta: trazabilidad, bloqueo por cambios posteriores, historial y rollback verificados.");
