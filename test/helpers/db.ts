import { getDb, getPool, type Database } from "../../server/db";
import { TEST_DB_NAME_PATTERN, UnsafeTestDatabaseError } from "../setup/db-guard";

/** The drizzle instance the app under test uses (the worker's database). */
export function testDb(): Database {
  return getDb();
}

let truncateStatement: string | undefined;

/**
 * Empty every table except the migration ledger and restart identities. Call
 * it in `beforeEach` when tests in a file must not see each other's rows.
 */
export async function resetDb(): Promise<void> {
  const pool = getPool();
  if (truncateStatement === undefined) {
    const { rows } = await pool.query<{ database: string; tables: string[] }>(`
      SELECT current_database() AS database,
             coalesce(array_agg(quote_ident(tablename) ORDER BY tablename), '{}') AS tables
        FROM pg_tables
       WHERE schemaname = 'public' AND tablename <> '_app_migrations'`);
    const [{ database, tables }] = rows;
    // Belt and braces: the guard already vetted DATABASE_URL, but TRUNCATE is destructive.
    if (!TEST_DB_NAME_PATTERN.test(database)) {
      throw new UnsafeTestDatabaseError(`Refusing to truncate tables in ${JSON.stringify(database)}`);
    }
    truncateStatement = tables.length > 0 ? `TRUNCATE ${tables.join(", ")} RESTART IDENTITY CASCADE` : "";
  }
  if (truncateStatement) await pool.query(truncateStatement);
}
