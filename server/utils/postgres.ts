import pg from "pg";

const { Pool } = pg;

let pool: pg.Pool | null = null;

export const isPostgresConfigured = () => {
  return !!process.env.DATABASE_URL?.trim();
};

export const getPostgresPool = () => {
  if (!isPostgresConfigured()) {
    throw new Error("DATABASE_URL no configurado");
  }

  if (!pool) {
    const useSsl = (process.env.DATABASE_SSL || "true").toLowerCase() !== "false";

    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: useSsl ? { rejectUnauthorized: false } : false,
    });
  }

  return pool;
};
