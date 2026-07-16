import { getPostgresPool, isPostgresConfigured } from "../utils/postgres.js";
import { AppError } from "../utils/response.js";

type Queryable = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

const aliasMap: Record<string, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  mercado_pago: "Mercado Pago",
  "mercado pago": "Mercado Pago",
  cheque: "Cheque",
  cheque_en_cartera: "Cheque",
  "cheque en cartera": "Cheque",
  "cta cte": "Cta Cte",
};

export const normalizePaymentMethodLookup = (value: unknown) => {
  const raw = String(value ?? "").trim();
  return aliasMap[raw.toLowerCase()] || raw;
};

export const assertPaymentMethodActive = async (value: unknown, executor?: Queryable) => {
  const name = normalizePaymentMethodLookup(value);
  if (!name) throw new AppError("La forma de pago es requerida", 400);

  if (!isPostgresConfigured() && !executor) {
    const { default: db } = await import("../db.js");
    const row = db.prepare(
      "SELECT id, name FROM payment_methods WHERE LOWER(name) = LOWER(?) AND COALESCE(activo, 1) = 1 LIMIT 1"
    ).get(name) as any;
    if (!row) throw new AppError(`La forma de pago ${name} está inactiva o no existe`, 409);
    return row;
  }

  const queryable = executor || getPostgresPool();
  const result = await queryable.query(
    "SELECT id, name FROM payment_methods WHERE LOWER(name) = LOWER($1) AND COALESCE(activo, 1) = 1 LIMIT 1",
    [name]
  );
  if (!result.rowCount) throw new AppError(`La forma de pago ${name} está inactiva o no existe`, 409);
  return result.rows[0];
};
export type ActivePaymentMethod = {
  id: number;
  name: string;
  tipo: string;
};

export const listActivePaymentMethods = async (executor?: Queryable): Promise<ActivePaymentMethod[]> => {
  if (!isPostgresConfigured() && !executor) {
    const { default: db } = await import("../db.js");
    return (db.prepare(
      "SELECT id, name, tipo FROM payment_methods WHERE COALESCE(activo, 1) = 1 ORDER BY name ASC"
    ).all() as any[]).map((row) => ({
      id: Number(row.id),
      name: String(row.name || ""),
      tipo: String(row.tipo || "Efectivo"),
    }));
  }

  const queryable = executor || getPostgresPool();
  const result = await queryable.query(
    "SELECT id, name, tipo FROM payment_methods WHERE COALESCE(activo, 1) = 1 ORDER BY name ASC"
  );

  return result.rows.map((row) => ({
    id: Number(row.id),
    name: String(row.name || ""),
    tipo: String(row.tipo || "Efectivo"),
  }));
};

