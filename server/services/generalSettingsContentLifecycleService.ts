import { getPostgresPool, isPostgresConfigured } from "../utils/postgres.js";
import { AppError } from "../utils/response.js";

export type GeneralSettingsContentInput = {
  settings: Record<string, unknown>;
  motivo: string;
  usuario: string;
  expectedContentVersion: number;
};

type TransactionClient = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

export const GENERAL_SETTINGS_KEYS = [
  "business_logo",
  "business_name",
  "business_razon_social",
  "business_cuit",
  "business_phone",
  "business_email",
  "business_address",
  "business_localidad",
  "system_currency",
  "default_iva",
  "default_markup",
  "customer_debt_alert_days",
  "default_credit_limit",
  "cost_calculation_method",
  "allow_negative_stock",
  "next_sale_number",
  "next_order_number",
  "next_payment_number",
  "billing_prefix",
] as const;

type GeneralSettingsKey = (typeof GENERAL_SETTINGS_KEYS)[number];

const DEFAULT_SETTINGS: Record<GeneralSettingsKey, string> = {
  business_logo: "",
  business_name: "",
  business_razon_social: "",
  business_cuit: "",
  business_phone: "",
  business_email: "",
  business_address: "",
  business_localidad: "",
  system_currency: "ARS",
  default_iva: "21",
  default_markup: "30",
  customer_debt_alert_days: "7",
  default_credit_limit: "0",
  cost_calculation_method: "PEPS",
  allow_negative_stock: "false",
  next_sale_number: "1",
  next_order_number: "1",
  next_payment_number: "1",
  billing_prefix: "0001",
};

const normalize = (value: unknown) => String(value ?? "").trim();
const toNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeInteger = (value: unknown, label: string, min: number, max: number) => {
  const text = normalize(value);
  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new AppError(`${label} debe ser un número entero entre ${min} y ${max}`, 400);
  }
  return String(parsed);
};

const normalizeDecimal = (value: unknown, label: string, min: number, max: number) => {
  const text = normalize(value).replace(",", ".");
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new AppError(`${label} debe estar entre ${min} y ${max}`, 400);
  }
  return String(parsed);
};

const assertTextLength = (value: string, label: string, max: number) => {
  if (value.length > max) throw new AppError(`${label} no puede superar los ${max} caracteres`, 400);
};

const buildSettings = (
  rows: Array<{ key: string; value: unknown }>,
  incoming?: Record<string, unknown>
): Record<GeneralSettingsKey, string> => {
  const current = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    if (GENERAL_SETTINGS_KEYS.includes(row.key as GeneralSettingsKey)) {
      current[row.key as GeneralSettingsKey] = String(row.value ?? "");
    }
  }

  if (!incoming) return current;
  const next = { ...current };
  for (const key of GENERAL_SETTINGS_KEYS) {
    if (Object.prototype.hasOwnProperty.call(incoming, key)) {
      next[key] = String(incoming[key] ?? "");
    }
  }
  return next;
};

const validateSettings = (settings: Record<GeneralSettingsKey, string>) => {
  const next = { ...settings };

  for (const key of [
    "business_name",
    "business_razon_social",
    "business_cuit",
    "business_phone",
    "business_email",
    "business_address",
    "business_localidad",
  ] as GeneralSettingsKey[]) {
    next[key] = normalize(next[key]);
  }

  assertTextLength(next.business_name, "El nombre del negocio", 200);
  assertTextLength(next.business_razon_social, "La razón social", 250);
  assertTextLength(next.business_cuit, "El CUIT", 30);
  assertTextLength(next.business_phone, "El teléfono", 60);
  assertTextLength(next.business_email, "El email", 200);
  assertTextLength(next.business_address, "La dirección", 300);
  assertTextLength(next.business_localidad, "La localidad", 150);

  if (next.business_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.business_email)) {
    throw new AppError("El email del negocio no es válido", 400);
  }

  const logo = String(next.business_logo || "");
  if (logo.length > 3_000_000) {
    throw new AppError("El logo supera el tamaño máximo permitido", 400);
  }
  if (logo && !/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(logo)) {
    throw new AppError("El logo debe ser una imagen PNG, JPG o WEBP válida", 400);
  }
  next.business_logo = logo;

  next.system_currency = normalize(next.system_currency).toUpperCase();
  if (!["ARS", "USD"].includes(next.system_currency)) {
    throw new AppError("La moneda del sistema no es válida", 400);
  }

  next.cost_calculation_method = normalize(next.cost_calculation_method).toUpperCase();
  if (!["PEPS", "PPP", "UEPS"].includes(next.cost_calculation_method)) {
    throw new AppError("El método de cálculo de costo no es válido", 400);
  }

  const negativeStock = normalize(next.allow_negative_stock).toLowerCase();
  if (!["true", "false"].includes(negativeStock)) {
    throw new AppError("La configuración de stock negativo no es válida", 400);
  }
  next.allow_negative_stock = negativeStock;

  next.default_iva = normalizeDecimal(next.default_iva, "El IVA predeterminado", 0, 100);
  next.default_markup = normalizeDecimal(next.default_markup, "El margen sugerido", 0, 10000);
  next.default_credit_limit = normalizeDecimal(next.default_credit_limit, "El límite de crédito", 0, 1_000_000_000);
  next.customer_debt_alert_days = normalizeInteger(
    next.customer_debt_alert_days,
    "Los días para alerta de deuda",
    0,
    3650
  );
  next.next_sale_number = normalizeInteger(next.next_sale_number, "La próxima venta", 1, 2_000_000_000);
  next.next_order_number = normalizeInteger(next.next_order_number, "El próximo pedido", 1, 2_000_000_000);
  next.next_payment_number = normalizeInteger(next.next_payment_number, "El próximo pago", 1, 2_000_000_000);

  next.billing_prefix = normalize(next.billing_prefix);
  if (!/^[A-Za-z0-9-]{1,20}$/.test(next.billing_prefix)) {
    throw new AppError("El prefijo de facturación debe tener entre 1 y 20 letras, números o guiones", 400);
  }

  return next;
};

const validateInput = (input: GeneralSettingsContentInput) => {
  if (!Number.isInteger(input.expectedContentVersion) || input.expectedContentVersion < 0) {
    throw new AppError("Versión de configuración inválida", 400);
  }

  const reason = normalize(input.motivo);
  if (reason.length < 3) {
    throw new AppError("El motivo del cambio es obligatorio y debe tener al menos 3 caracteres", 400);
  }
  if (reason.length > 500) {
    throw new AppError("El motivo no puede superar los 500 caracteres", 400);
  }

  if (!input.settings || typeof input.settings !== "object" || Array.isArray(input.settings)) {
    throw new AppError("La configuración enviada no es válida", 400);
  }

  return {
    reason,
    user: normalize(input.usuario) || "Sistema",
  };
};

const metadataFrom = (row: any) => ({
  content_version: toNumber(row?.content_version),
  content_changed_at: row?.content_changed_at ?? null,
  content_changed_by: row?.content_changed_by ?? null,
  content_change_reason: row?.content_change_reason ?? null,
});

const responseMap = (settings: Record<GeneralSettingsKey, string>, state: any) => ({
  ...settings,
  settings_content_version: String(toNumber(state?.content_version)),
  settings_content_changed_at: state?.content_changed_at ?? "",
  settings_content_changed_by: state?.content_changed_by ?? "",
  settings_content_change_reason: state?.content_change_reason ?? "",
});

const readSqlite = async () => {
  const { default: db } = await import("../db.js");
  db.prepare(
    `INSERT OR IGNORE INTO general_settings_content_state (id, content_version)
     VALUES (1, 0)`
  ).run();
  const rows = db.prepare(
    `SELECT key, value FROM settings
     WHERE key IN (${GENERAL_SETTINGS_KEYS.map(() => "?").join(", ")})`
  ).all(...GENERAL_SETTINGS_KEYS) as Array<{ key: string; value: unknown }>;
  const state = db.prepare(
    "SELECT * FROM general_settings_content_state WHERE id = 1 LIMIT 1"
  ).get() as any;
  const settings = buildSettings(rows);
  return { settings, metadata: metadataFrom(state), response: responseMap(settings, state) };
};

const readPostgres = async (executor?: TransactionClient) => {
  const client = executor || getPostgresPool();
  await client.query(
    `INSERT INTO general_settings_content_state (id, content_version)
     VALUES (1, 0)
     ON CONFLICT (id) DO NOTHING`
  );
  const rowsResult = await client.query(
    `SELECT key, value FROM settings WHERE key = ANY($1::text[])`,
    [GENERAL_SETTINGS_KEYS]
  );
  const stateResult = await client.query(
    `SELECT * FROM general_settings_content_state WHERE id = 1 LIMIT 1`
  );
  const state = stateResult.rows[0] || { content_version: 0 };
  const settings = buildSettings(rowsResult.rows as Array<{ key: string; value: unknown }>);
  return { settings, metadata: metadataFrom(state), response: responseMap(settings, state) };
};

const handleSqlite = async (input: GeneralSettingsContentInput) => {
  const validated = validateInput(input);
  const { default: db } = await import("../db.js");

  return db.transaction(() => {
    db.prepare(
      `INSERT OR IGNORE INTO general_settings_content_state (id, content_version)
       VALUES (1, 0)`
    ).run();

    const state = db.prepare(
      "SELECT * FROM general_settings_content_state WHERE id = 1 LIMIT 1"
    ).get() as any;
    if (toNumber(state?.content_version) !== input.expectedContentVersion) {
      throw new AppError(
        "La configuración general cambió mientras estaba abierta. Actualizá la pantalla e intentá nuevamente",
        409
      );
    }

    const rows = db.prepare(
      `SELECT key, value FROM settings
       WHERE key IN (${GENERAL_SETTINGS_KEYS.map(() => "?").join(", ")})`
    ).all(...GENERAL_SETTINGS_KEYS) as Array<{ key: string; value: unknown }>;

    const beforeSettings = validateSettings(buildSettings(rows));
    const afterSettings = validateSettings(buildSettings(rows, input.settings));
    if (JSON.stringify(beforeSettings) === JSON.stringify(afterSettings)) {
      throw new AppError("No se detectaron cambios para guardar", 409);
    }

    const nextVersion = input.expectedContentVersion + 1;
    const before = { content_version: input.expectedContentVersion, settings: beforeSettings };
    const after = { content_version: nextVersion, settings: afterSettings };

    const history = db.prepare(
      `INSERT INTO general_settings_content_history (
         version, reason, changed_by, before_snapshot, after_snapshot
       ) VALUES (?, ?, ?, ?, ?)`
    ).run(
      nextVersion,
      validated.reason,
      validated.user,
      JSON.stringify(before),
      JSON.stringify(after)
    );
    const historyRow = db.prepare(
      "SELECT id, changed_at FROM general_settings_content_history WHERE id = ?"
    ).get(Number(history.lastInsertRowid)) as any;
    const changedAt = historyRow?.changed_at || new Date().toISOString();

    const upsert = db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    );
    for (const key of GENERAL_SETTINGS_KEYS) upsert.run(key, afterSettings[key]);

    const update = db.prepare(
      `UPDATE general_settings_content_state
       SET content_version = ?, content_changed_at = ?, content_changed_by = ?, content_change_reason = ?
       WHERE id = 1 AND content_version = ?`
    ).run(nextVersion, changedAt, validated.user, validated.reason, input.expectedContentVersion);

    if (Number(update.changes) !== 1) {
      throw new AppError(
        "La configuración general cambió mientras se guardaba. Actualizá la pantalla e intentá nuevamente",
        409
      );
    }

    const stateAfter = {
      content_version: nextVersion,
      content_changed_at: changedAt,
      content_changed_by: validated.user,
      content_change_reason: validated.reason,
    };

    return {
      settings: afterSettings,
      metadata: stateAfter,
      response: responseMap(afterSettings, stateAfter),
      history: historyRow,
      version: nextVersion,
    };
  })();
};

const handlePostgres = async (
  input: GeneralSettingsContentInput,
  executor?: TransactionClient
) => {
  const validated = validateInput(input);
  const ownsTransaction = !executor;
  const client: any = executor || await getPostgresPool().connect();

  try {
    if (ownsTransaction) await client.query("BEGIN");
    await client.query(
      `INSERT INTO general_settings_content_state (id, content_version)
       VALUES (1, 0)
       ON CONFLICT (id) DO NOTHING`
    );

    const stateResult = await client.query(
      `SELECT * FROM general_settings_content_state
       WHERE id = 1
       LIMIT 1
       FOR UPDATE`
    );
    const state = stateResult.rows[0];
    if (toNumber(state?.content_version) !== input.expectedContentVersion) {
      throw new AppError(
        "La configuración general cambió mientras estaba abierta. Actualizá la pantalla e intentá nuevamente",
        409
      );
    }

    const rowsResult = await client.query(
      `SELECT key, value FROM settings WHERE key = ANY($1::text[])`,
      [GENERAL_SETTINGS_KEYS]
    );
    const beforeSettings = validateSettings(buildSettings(rowsResult.rows, undefined));
    const afterSettings = validateSettings(buildSettings(rowsResult.rows, input.settings));
    if (JSON.stringify(beforeSettings) === JSON.stringify(afterSettings)) {
      throw new AppError("No se detectaron cambios para guardar", 409);
    }

    const nextVersion = input.expectedContentVersion + 1;
    const before = { content_version: input.expectedContentVersion, settings: beforeSettings };
    const after = { content_version: nextVersion, settings: afterSettings };

    const historyResult = await client.query(
      `INSERT INTO general_settings_content_history (
         version, reason, changed_by, before_snapshot, after_snapshot
       )
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
       RETURNING id, changed_at`,
      [
        nextVersion,
        validated.reason,
        validated.user,
        JSON.stringify(before),
        JSON.stringify(after),
      ]
    );
    const changedAt = historyResult.rows[0]?.changed_at || new Date().toISOString();

    for (const key of GENERAL_SETTINGS_KEYS) {
      await client.query(
        `INSERT INTO settings (key, value)
         VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [key, afterSettings[key]]
      );
    }

    const stateUpdate = await client.query(
      `UPDATE general_settings_content_state
       SET content_version = $1,
           content_changed_at = $2,
           content_changed_by = $3,
           content_change_reason = $4
       WHERE id = 1 AND content_version = $5
       RETURNING *`,
      [
        nextVersion,
        changedAt,
        validated.user,
        validated.reason,
        input.expectedContentVersion,
      ]
    );

    if (stateUpdate.rowCount !== 1) {
      throw new AppError(
        "La configuración general cambió mientras se guardaba. Actualizá la pantalla e intentá nuevamente",
        409
      );
    }

    if (ownsTransaction) await client.query("COMMIT");
    return {
      settings: afterSettings,
      metadata: metadataFrom(stateUpdate.rows[0]),
      response: responseMap(afterSettings, stateUpdate.rows[0]),
      history: historyResult.rows[0],
      version: nextVersion,
    };
  } catch (error) {
    if (ownsTransaction) await client.query("ROLLBACK");
    throw error;
  } finally {
    if (ownsTransaction && "release" in client && typeof client.release === "function") {
      client.release();
    }
  }
};

export const generalSettingsContentLifecycleService = {
  async get(executor?: TransactionClient) {
    if (executor || isPostgresConfigured()) return readPostgres(executor);
    return readSqlite();
  },

  async update(input: GeneralSettingsContentInput, executor?: TransactionClient) {
    if (executor || isPostgresConfigured()) return handlePostgres(input, executor);
    return handleSqlite(input);
  },
};
