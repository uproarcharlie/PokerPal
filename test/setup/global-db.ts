/**
 * Vitest globalSetup for the `api` project, run once per test run in the main
 * process. After the guard passes it claims the run's database name for the
 * whole run (test/setup/run-lock.ts), so a second run with the same name stops
 * at once instead of dropping this run's databases. It then rebuilds
 * `<name>_template` with the real boot migration runner, so the API tests run
 * against exactly the schema production gets. Each test file then clones the
 * template into its worker's own database (test/setup/api.ts). Teardown drops
 * the clones, any scratch databases tests left beside them, and the template,
 * then releases the claim.
 */
import type pg from "pg";
import type { TestProject } from "vitest/node";
import { derivedName, isWorkerDatabaseOf } from "./database-names";
import { assertSafeTestDb, assertSafeTestDbUrl, guardEnv, withDatabase } from "./db-guard";
import { dropDatabase, listDatabases, migrateDatabase, recreateDatabase, withMaintenanceClient } from "./databases";
import { claimTestDatabaseName } from "./run-lock";

export interface ProvidedTestDatabase {
  /** Guarded connection string of the run's base test database (it is never created itself). */
  url: string;
  /** The base database's name, which the run's other databases are named after (./database-names.ts). */
  base: string;
  /** Database each worker clones. */
  template: string;
}

declare module "vitest" {
  export interface ProvidedContext {
    testDatabase: ProvidedTestDatabase;
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const env = guardEnv();
  const target = assertSafeTestDb(env);
  const base = target.database;
  const template = derivedName.template(base);
  const templateUrl = assertSafeTestDbUrl(withDatabase(target.url, template), env).url;

  // This run's worker clones and the scratch databases tests made beside them. No other run's database can
  // match: the guard refuses a base name that a derived name could start with (e.g. pokerpal_test_w2).
  const workerClones = async (client: pg.Client) =>
    (await listDatabases(client, derivedName.worker(base, ""))).filter((name) => isWorkerDatabaseOf(base, name));

  const claim = await claimTestDatabaseName(target, target.database);
  try {
    await withMaintenanceClient(target, async (client) => {
      // Clones left by an interrupted run would otherwise linger forever.
      for (const stale of await workerClones(client)) await dropDatabase(client, stale);
      await recreateDatabase(client, template);
    });
    await migrateDatabase(templateUrl);
  } catch (error) {
    await claim.release();
    throw error;
  }

  project.provide("testDatabase", { url: target.url, base, template });

  return async function teardown() {
    try {
      await withMaintenanceClient(target, async (client) => {
        for (const clone of await workerClones(client)) await dropDatabase(client, clone);
        await dropDatabase(client, template);
      });
    } finally {
      await claim.release();
    }
  };
}
