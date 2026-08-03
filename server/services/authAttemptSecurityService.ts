import crypto from "node:crypto";
import { getSessionSecret } from "../utils/securityConfig.js";
import { getPostgresPool, isPostgresConfigured } from "../utils/postgres.js";

export type AuthAttemptScope = "staff" | "customer_portal";

export type AuthAttemptInput = {
  scope: AuthAttemptScope;
  identifier: string;
  clientAddress?: string | null;
};

export type AuthAttemptDecision = {
  allowed: boolean;
  retryAfterSeconds: number;
  accountFailures: number;
  addressFailures: number;
};

type TransactionClient = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

type AttemptStats = {
  accountCount: number;
  accountLatest: unknown;
  addressCount: number;
  addressLatest: unknown;
};

const WINDOW_SECONDS = 15 * 60;
const LOCK_SECONDS = 15 * 60;
const ACCOUNT_FAILURE_LIMIT = 5;
const ADDRESS_FAILURE_LIMIT = 30;
const RETENTION_DAYS = 7;

const normalizeIdentifier = (value: unknown) =>
  String(value ?? "").trim().toLowerCase().slice(0, 320);

const normalizeAddress = (value: unknown) => {
  const normalized = String(value ?? "").trim().toLowerCase().slice(0, 200);
  return normalized || "unknown";
};

const hashValue = (scope: AuthAttemptScope, kind: "identifier" | "address", value: string) =>
  crypto
    .createHmac("sha256", getSessionSecret())
    .update(`${scope}:${kind}:${value}`)
    .digest("hex");

const buildHashes = (input: AuthAttemptInput) => {
  const identifier = normalizeIdentifier(input.identifier);
  if (!identifier) {
    throw new Error("El identificador de acceso es obligatorio");
  }

  return {
    identifierHash: hashValue(input.scope, "identifier", identifier),
    addressHash: hashValue(input.scope, "address", normalizeAddress(input.clientAddress)),
  };
};

const parseDate = (value: unknown) => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const raw = String(value);
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
    ? `${raw.replace(" ", "T")}Z`
    : raw;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const remainingSeconds = (latest: unknown) => {
  const date = parseDate(latest);
  if (!date) return 0;
  return Math.max(0, Math.ceil((date.getTime() + LOCK_SECONDS * 1000 - Date.now()) / 1000));
};

const buildDecision = (stats: AttemptStats): AuthAttemptDecision => {
  const accountRetry = stats.accountCount >= ACCOUNT_FAILURE_LIMIT
    ? remainingSeconds(stats.accountLatest)
    : 0;
  const addressRetry = stats.addressCount >= ADDRESS_FAILURE_LIMIT
    ? remainingSeconds(stats.addressLatest)
    : 0;
  const retryAfterSeconds = Math.max(accountRetry, addressRetry);

  return {
    allowed: retryAfterSeconds <= 0,
    retryAfterSeconds,
    accountFailures: stats.accountCount,
    addressFailures: stats.addressCount,
  };
};

const mapStats = (row: any): AttemptStats => ({
  accountCount: Number(row?.account_count || 0),
  accountLatest: row?.account_latest ?? null,
  addressCount: Number(row?.address_count || 0),
  addressLatest: row?.address_latest ?? null,
});

const getPostgresStats = async (
  executor: TransactionClient,
  scope: AuthAttemptScope,
  identifierHash: string,
  addressHash: string
) => {
  const result = await executor.query(
    `SELECT
       COUNT(*) FILTER (WHERE identifier_hash = $2)::int AS account_count,
       MAX(attempted_at) FILTER (WHERE identifier_hash = $2) AS account_latest,
       COUNT(*) FILTER (WHERE address_hash = $3)::int AS address_count,
       MAX(attempted_at) FILTER (WHERE address_hash = $3) AS address_latest
     FROM auth_failed_login_attempts
     WHERE scope = $1
       AND attempted_at >= now() - make_interval(secs => $4)
       AND (identifier_hash = $2 OR address_hash = $3)`,
    [scope, identifierHash, addressHash, WINDOW_SECONDS]
  );
  return mapStats(result.rows[0]);
};

const getSqliteStats = async (
  scope: AuthAttemptScope,
  identifierHash: string,
  addressHash: string
) => {
  const { default: db } = await import("../db.js");
  const row = db.prepare(
    `SELECT
       SUM(CASE WHEN identifier_hash = ? THEN 1 ELSE 0 END) AS account_count,
       MAX(CASE WHEN identifier_hash = ? THEN attempted_at END) AS account_latest,
       SUM(CASE WHEN address_hash = ? THEN 1 ELSE 0 END) AS address_count,
       MAX(CASE WHEN address_hash = ? THEN attempted_at END) AS address_latest
     FROM auth_failed_login_attempts
     WHERE scope = ?
       AND attempted_at >= datetime('now', ?)
       AND (identifier_hash = ? OR address_hash = ?)`
  ).get(
    identifierHash,
    identifierHash,
    addressHash,
    addressHash,
    scope,
    `-${WINDOW_SECONDS} seconds`,
    identifierHash,
    addressHash
  ) as any;
  return mapStats(row);
};

const checkPostgres = async (input: AuthAttemptInput, executor?: TransactionClient) => {
  const hashes = buildHashes(input);
  const client = executor || getPostgresPool();
  return buildDecision(
    await getPostgresStats(client, input.scope, hashes.identifierHash, hashes.addressHash)
  );
};

const checkSqlite = async (input: AuthAttemptInput) => {
  const hashes = buildHashes(input);
  return buildDecision(
    await getSqliteStats(input.scope, hashes.identifierHash, hashes.addressHash)
  );
};

const recordPostgresFailure = async (
  input: AuthAttemptInput,
  executor?: TransactionClient
) => {
  const hashes = buildHashes(input);
  const client: any = executor || await getPostgresPool().connect();
  const ownsClient = !executor;

  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
      [input.scope, hashes.identifierHash]
    );
    await client.query(
      `DELETE FROM auth_failed_login_attempts
       WHERE attempted_at < now() - make_interval(days => $1)`,
      [RETENTION_DAYS]
    );

    const before = buildDecision(
      await getPostgresStats(client, input.scope, hashes.identifierHash, hashes.addressHash)
    );
    if (!before.allowed) {
      await client.query("COMMIT");
      return before;
    }

    await client.query(
      `INSERT INTO auth_failed_login_attempts (
         scope, identifier_hash, address_hash
       ) VALUES ($1, $2, $3)`,
      [input.scope, hashes.identifierHash, hashes.addressHash]
    );

    const after = buildDecision(
      await getPostgresStats(client, input.scope, hashes.identifierHash, hashes.addressHash)
    );
    await client.query("COMMIT");
    return after;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    if (ownsClient && typeof client.release === "function") {
      client.release();
    }
  }
};

const recordSqliteFailure = async (input: AuthAttemptInput) => {
  const hashes = buildHashes(input);
  const { default: db } = await import("../db.js");

  return db.transaction(() => {
    db.prepare(
      "DELETE FROM auth_failed_login_attempts WHERE attempted_at < datetime('now', ?)"
    ).run(`-${RETENTION_DAYS} days`);

    const beforeRow = db.prepare(
      `SELECT
         SUM(CASE WHEN identifier_hash = ? THEN 1 ELSE 0 END) AS account_count,
         MAX(CASE WHEN identifier_hash = ? THEN attempted_at END) AS account_latest,
         SUM(CASE WHEN address_hash = ? THEN 1 ELSE 0 END) AS address_count,
         MAX(CASE WHEN address_hash = ? THEN attempted_at END) AS address_latest
       FROM auth_failed_login_attempts
       WHERE scope = ?
         AND attempted_at >= datetime('now', ?)
         AND (identifier_hash = ? OR address_hash = ?)`
    ).get(
      hashes.identifierHash,
      hashes.identifierHash,
      hashes.addressHash,
      hashes.addressHash,
      input.scope,
      `-${WINDOW_SECONDS} seconds`,
      hashes.identifierHash,
      hashes.addressHash
    ) as any;

    const before = buildDecision(mapStats(beforeRow));
    if (!before.allowed) return before;

    db.prepare(
      `INSERT INTO auth_failed_login_attempts (
         scope, identifier_hash, address_hash
       ) VALUES (?, ?, ?)`
    ).run(input.scope, hashes.identifierHash, hashes.addressHash);

    const afterRow = db.prepare(
      `SELECT
         SUM(CASE WHEN identifier_hash = ? THEN 1 ELSE 0 END) AS account_count,
         MAX(CASE WHEN identifier_hash = ? THEN attempted_at END) AS account_latest,
         SUM(CASE WHEN address_hash = ? THEN 1 ELSE 0 END) AS address_count,
         MAX(CASE WHEN address_hash = ? THEN attempted_at END) AS address_latest
       FROM auth_failed_login_attempts
       WHERE scope = ?
         AND attempted_at >= datetime('now', ?)
         AND (identifier_hash = ? OR address_hash = ?)`
    ).get(
      hashes.identifierHash,
      hashes.identifierHash,
      hashes.addressHash,
      hashes.addressHash,
      input.scope,
      `-${WINDOW_SECONDS} seconds`,
      hashes.identifierHash,
      hashes.addressHash
    ) as any;

    return buildDecision(mapStats(afterRow));
  })();
};

const clearPostgres = async (input: AuthAttemptInput, executor?: TransactionClient) => {
  const hashes = buildHashes(input);
  const client = executor || getPostgresPool();
  await client.query(
    `DELETE FROM auth_failed_login_attempts
     WHERE scope = $1 AND identifier_hash = $2`,
    [input.scope, hashes.identifierHash]
  );
};

const clearSqlite = async (input: AuthAttemptInput) => {
  const hashes = buildHashes(input);
  const { default: db } = await import("../db.js");
  db.prepare(
    "DELETE FROM auth_failed_login_attempts WHERE scope = ? AND identifier_hash = ?"
  ).run(input.scope, hashes.identifierHash);
};

export const getRequestClientAddress = (req: any) => {
  const forwarded = req?.headers?.["x-forwarded-for"];
  const forwardedValue = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const firstForwarded = typeof forwardedValue === "string"
    ? forwardedValue.split(",")[0]?.trim()
    : "";

  return (
    firstForwarded ||
    req?.headers?.["x-real-ip"] ||
    req?.ip ||
    req?.socket?.remoteAddress ||
    req?.connection?.remoteAddress ||
    "unknown"
  );
};

export const setRetryAfterHeader = (res: any, decision: AuthAttemptDecision) => {
  if (!decision.allowed && decision.retryAfterSeconds > 0) {
    res.setHeader("Retry-After", String(decision.retryAfterSeconds));
  }
};

export const getLockoutMessage = (decision: AuthAttemptDecision) => {
  const minutes = Math.max(1, Math.ceil(decision.retryAfterSeconds / 60));
  return `Demasiados intentos fallidos. Esperá ${minutes} minuto${minutes === 1 ? "" : "s"} antes de volver a intentar`;
};

export const authAttemptSecurityService = {
  async check(input: AuthAttemptInput, executor?: TransactionClient) {
    if (executor || isPostgresConfigured()) return checkPostgres(input, executor);
    return checkSqlite(input);
  },

  async recordFailure(input: AuthAttemptInput, executor?: TransactionClient) {
    if (executor || isPostgresConfigured()) return recordPostgresFailure(input, executor);
    return recordSqliteFailure(input);
  },

  async clearFailures(input: AuthAttemptInput, executor?: TransactionClient) {
    if (executor || isPostgresConfigured()) return clearPostgres(input, executor);
    return clearSqlite(input);
  },
};

export const AUTH_ATTEMPT_LIMITS = {
  windowSeconds: WINDOW_SECONDS,
  lockSeconds: LOCK_SECONDS,
  accountFailureLimit: ACCOUNT_FAILURE_LIMIT,
  addressFailureLimit: ADDRESS_FAILURE_LIMIT,
};
