import { pushSchema } from "drizzle-kit/api";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";
import { derivedName } from "../setup/database-names";
import { assertSafeTestDbUrl, withDatabase, type SafeTestDb } from "../setup/db-guard";
import { dropDatabase, recreateDatabase, withMaintenanceClient } from "../setup/databases";

export interface ScratchDatabase extends SafeTestDb {
  pool: pg.Pool;
}

/**
 * A new, empty database for one test file, named `<worker database>_<suffix>`
 * so it passes the guard and never meets another worker's. Calling it again
 * with the same suffix starts over with an empty one. The api project's global
 * teardown drops any that a file leaves behind; `dropScratchDatabase` does it sooner.
 */
export async function createScratchDatabase(suffix: string): Promise<ScratchDatabase> {
  const worker = assertSafeTestDbUrl(process.env.DATABASE_URL ?? "", process.env);
  const target = assertSafeTestDbUrl(withDatabase(worker.url, derivedName.scratch(worker.database, suffix)), process.env);
  await withMaintenanceClient(target, (client) => recreateDatabase(client, target.database));
  return { ...target, pool: new pg.Pool({ connectionString: target.url, max: 3 }) };
}

export async function dropScratchDatabase(scratch: ScratchDatabase | undefined): Promise<void> {
  if (!scratch) return;
  await scratch.pool.end();
  await withMaintenanceClient(scratch, (client) => dropDatabase(client, scratch.database));
}

/** Run `work` with stdout muted: drizzle-kit draws a progress spinner while it introspects. */
export async function withoutStdout<T>(work: () => Promise<T>): Promise<T> {
  const write = process.stdout.write;
  process.stdout.write = (() => true) as typeof process.stdout.write;
  try {
    return await work();
  } finally {
    process.stdout.write = write;
  }
}

/**
 * drizzle-kit's push of shared/schema.ts, as the old `npm run db:push` did (no
 * table filter unless `tablesFilter` is given); returns the DDL it would run
 * (and ran, with `apply`).
 */
export async function pushAppSchema(
  pool: pg.Pool,
  { apply = false, tablesFilter }: { apply?: boolean; tablesFilter?: string[] } = {},
): Promise<string[]> {
  return withoutStdout(async () => {
    const push = await pushSchema(schema, drizzle(pool) as unknown as Parameters<typeof pushSchema>[1], ["public"], tablesFilter);
    if (apply) await push.apply();
    return push.statementsToExecute.map((statement) => statement.trim());
  });
}
