import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import dotenv from 'dotenv';
import pg from 'pg';

const projectRoot = process.cwd();

for (const envFile of ['.env.local', '.env']) {
  dotenv.config({ path: path.join(projectRoot, envFile), override: false, quiet: true });
}

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  throw new Error(
    'No se encontró DATABASE_URL. Configurala en .env.local o .env antes de instalar la mejora.'
  );
}

try {
  const connectionUrl = new URL(connectionString);
  if (!connectionUrl.password) {
    throw new Error('DATABASE_URL no contiene una contraseña válida para PostgreSQL.');
  }
} catch (error) {
  if (error instanceof Error && error.message.includes('contraseña válida')) throw error;
  throw new Error('DATABASE_URL no tiene un formato de conexión PostgreSQL válido.');
}

const migrationPath = path.join(projectRoot, 'supabase', '47_weighted_product_sales.sql');
const migrationSql = await readFile(migrationPath, 'utf8');
const useSsl = (process.env.DATABASE_SSL || 'true').toLowerCase() !== 'false';
const client = new pg.Client({
  connectionString,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
  options: '-c timezone=America/Argentina/Buenos_Aires',
  connectionTimeoutMillis: 15_000,
});

try {
  await client.connect();
  await client.query(migrationSql);

  const verification = await client.query(`
    select
      exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'products'
          and column_name = 'price_reference_quantity'
      ) as has_reference_quantity,
      exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'sale_items'
          and column_name = 'measurement_unit'
      ) as has_sale_unit,
      exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'products'
          and column_name = 'stock' and data_type = 'numeric'
      ) as has_decimal_stock
  `);

  const result = verification.rows[0];
  if (!result?.has_reference_quantity || !result?.has_sale_unit || !result?.has_decimal_stock) {
    throw new Error('La base respondió, pero no quedaron todas las columnas decimales esperadas.');
  }

  console.log('Migración 47 aplicada y verificada correctamente.');
} catch (error) {
  try {
    await client.query('rollback');
  } catch {
    // La migración SQL ya administra su propia transacción; este rollback es defensivo.
  }
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
