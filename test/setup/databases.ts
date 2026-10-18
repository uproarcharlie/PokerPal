/**
 * CREATE/DROP DATABASE helpers for test, e2e and seed databases. Each one
 * re-checks the name against the guard's pattern right before running, so a
 * bug upstream can never drop a database that is not a test database.
 */
import { fileURLToPath } from "node:url";
import pg from "pg";
import { applyMigrations, type MigrationLogger } from "../../server/db/migrate";
import { TEST_DB_NAME_PATTERN, UnsafeTestDatabaseError, withDatabase, type SafeTestDb } from "./db-guard";

export const MIGRATIONS_DIR: string = fileURLToPath(new URL("../../migrations", import.meta.url));

/** Postgres limits identifiers to 63 bytes; longer names are silently truncated. */
const MAX_IDENTIFIER_LENGTH = 63;

function quoteTestDbName(name: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(name) || !TEST_DB_NAME_PATTERN.test(name) || name.length > MAX_IDENTIFIER_LENGTH) {
    throw new UnsafeTestDatabaseError(`Refusing to create or drop ${JSON.stringify(name)}: not a test database name`);
  }
  return `"${name}"`;
}

/** Run `work` on a connection to the server's `postgres` maintenance database. */
export async function withMaintenanceClient<T>(target: SafeTestDb, work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: withDatabase(target.url, "postgres") });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

export async function dropDatabase(client: pg.Client, name: string): Promise<void> {
  await client.query(`DROP DATABASE IF EXISTS ${quoteTestDbName(name)} WITH (FORCE)`);
}

/** Drop `name` if it exists, then create it empty or as a copy of `template`. */
export async function recreateDatabase(client: pg.Client, name: string, template?: string): Promise<void> {
  await dropDatabase(client, name);
  const from = template ? ` TEMPLATE ${quoteTestDbName(template)}` : "";
  await client.query(`CREATE DATABASE ${quoteTestDbName(name)}${from}`);
}

export async function createDatabaseIfMissing(client: pg.Client, name: string): Promise<boolean> {
  const quoted = quoteTestDbName(name);
  const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
  if (rowCount) return false;
  await client.query(`CREATE DATABASE ${quoted}`);
  return true;
}

/** Test databases whose names start with `prefix`, e.g. every per-worker copy of a run. */
export async function listDatabases(client: pg.Client, prefix: string): Promise<string[]> {
  const { rows } = await client.query<{ datname: string }>(
    "SELECT datname FROM pg_database WHERE starts_with(datname, $1) ORDER BY datname",
    [prefix],
  );
  return rows.map((row) => row.datname).filter((name) => TEST_DB_NAME_PATTERN.test(name));
}

/** Prints warnings and errors only; the per-file progress lines are noise in a test run. */
export const quietMigrationLogger: MigrationLogger = {
  info: () => {},
  warn: (message) => console.warn(`[migrate] ${message}`),
  error: (message) => console.error(`[migrate] ${message}`),
};

/** Apply migrations/*.sql to `url` with the production runner (guard, advisory lock, transaction per file). */
export async function migrateDatabase(url: string, logger: MigrationLogger = quietMigrationLogger): Promise<void> {
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    await applyMigrations({ pool, dir: MIGRATIONS_DIR, logger });
  } finally {
    await pool.end();
  }
}
