/**
 * Database access for the demo seed scripts. They write data and leave it
 * behind, so they go through the same guard as the test suites: only a local
 * `*_test` database (TEST_DATABASE_URL, or the dev server with TEST_DB_NAME,
 * default pokerpal_test).
 */
import pg from "pg";
import { assertSafeTestDb, guardEnv, type SafeTestDb } from "../../test/setup/db-guard";
import { createDatabaseIfMissing, migrateDatabase, withMaintenanceClient } from "../../test/setup/databases";

/** The seed target, or an UnsafeTestDatabaseError. Every seed script calls this first. */
export function guardSeedDatabase(): SafeTestDb {
  return assertSafeTestDb(guardEnv());
}

/** Create the target if it is missing, bring it up to date with the real migrations, and connect. */
export async function connectSeedDatabase(target: SafeTestDb): Promise<pg.Pool> {
  await withMaintenanceClient(target, (client) => createDatabaseIfMissing(client, target.database));
  await migrateDatabase(target.url);
  console.log(`Seeding ${target.host}:${target.port}/${target.database}`);
  return new pg.Pool({ connectionString: target.url, max: 2 });
}
