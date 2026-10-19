import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import { getEnv } from "./config/env";

export type Database = NodePgDatabase<typeof schema>;
/** The `tx` a `db.transaction(async (tx) => ...)` callback receives. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** What repository functions take, so a service can run several of them in one transaction. */
export type Executor = Database | Transaction;

let pool: Pool | undefined;
let database: Database | undefined;

/**
 * The shared connection pool, created from the active env on first use. Apart
 * from `max` (default 10, pg's own default) it keeps pg's defaults, as before
 * the env refactor: when every connection is busy a query waits for one rather
 * than failing after a connect timeout.
 */
export function getPool(): Pool {
  if (!pool) {
    const env = getEnv();
    pool = new Pool({ connectionString: env.DATABASE_URL, max: env.DB_POOL_MAX });
    // An idle client losing its connection (DB restart, network blip) emits here;
    // without a listener Node treats it as an unhandled error and exits.
    pool.on("error", (err) => {
      console.error("Postgres pool error on idle client:", err.message);
    });
  }
  return pool;
}

export function getDb(): Database {
  database ??= drizzle(getPool(), { schema });
  return database;
}

/**
 * `db` for existing call sites (storage, services). Every access is forwarded
 * to `getDb()`, so importing this module never opens a connection. The
 * prototype is forwarded too, so drizzle's `is(db, PgDatabase)` checks still pass.
 */
export const db: Database = new Proxy({} as Database, {
  get(_target, property) {
    const instance = getDb();
    const value = Reflect.get(instance, property, instance);
    return typeof value === "function" && property !== "constructor" ? value.bind(instance) : value;
  },
  has: (_target, property) => Reflect.has(getDb(), property),
  getPrototypeOf: () => Reflect.getPrototypeOf(getDb()),
});

/** Drain and close the pool (graceful shutdown, test teardown). Safe to call when unused. */
export async function closePool(): Promise<void> {
  const current = pool;
  pool = undefined;
  database = undefined;
  await current?.end();
}
