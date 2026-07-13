import pg from "pg";

const { Pool } = pg;

let pool: pg.Pool | null = null;

const isServerlessRuntime = Boolean(
  process.env.VERCEL ||
  process.env.AWS_LAMBDA_FUNCTION_NAME ||
  process.env.LAMBDA_TASK_ROOT
);

const readPositiveInteger = (name: string, fallback: number) => {
  const rawValue = process.env[name]?.trim();
  if (!rawValue) return fallback;

  const parsedValue = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
};

const getConnectionString = () => {
  const rawConnectionString = process.env.DATABASE_URL?.trim();
  if (!rawConnectionString) return "";

  if (!isServerlessRuntime) {
    return rawConnectionString;
  }

  try {
    const connectionUrl = new URL(rawConnectionString);
    const isSupabaseSharedPooler = connectionUrl.hostname.endsWith(".pooler.supabase.com");
    const isSessionMode = !connectionUrl.port || connectionUrl.port === "5432";

    if (isSupabaseSharedPooler && isSessionMode) {
      connectionUrl.port = "6543";
    }

    return connectionUrl.toString();
  } catch {
    return rawConnectionString;
  }
};

export const isPostgresConfigured = () => {
  return Boolean(process.env.DATABASE_URL?.trim());
};

export const getPostgresPool = () => {
  if (!isPostgresConfigured()) {
    throw new Error("DATABASE_URL no configurado");
  }

  if (!pool) {
    const useSsl = (process.env.DATABASE_SSL || "true").toLowerCase() !== "false";
    const maxConnections = readPositiveInteger(
      "DATABASE_POOL_MAX",
      isServerlessRuntime ? 1 : 10
    );
    const idleTimeoutMillis = readPositiveInteger(
      "DATABASE_POOL_IDLE_TIMEOUT_MS",
      isServerlessRuntime ? 5_000 : 30_000
    );
    const connectionTimeoutMillis = readPositiveInteger(
      "DATABASE_POOL_CONNECTION_TIMEOUT_MS",
      10_000
    );

    pool = new Pool({
      connectionString: getConnectionString(),
      ssl: useSsl ? { rejectUnauthorized: false } : false,
      options: "-c timezone=America/Argentina/Buenos_Aires",
      max: maxConnections,
      min: 0,
      idleTimeoutMillis,
      connectionTimeoutMillis,
      allowExitOnIdle: isServerlessRuntime,
    });

    pool.on("error", (error) => {
      console.error("[database] Error en una conexión PostgreSQL inactiva:", error.message);
    });
  }

  return pool;
};
