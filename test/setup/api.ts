/**
 * Setup for every file in the `api` project. Vitest's forks pool runs each test
 * file in a fresh process, so this clones the migrated template (see
 * global-db.ts) into this worker's own database, `<name>_w<VITEST_POOL_ID>`,
 * and points the server's env at it.
 */
import { afterAll, beforeAll, inject } from "vitest";
import { closeTestApp } from "../helpers/app";
import { derivedName } from "./database-names";
import { assertSafeTestDbUrl, withDatabase } from "./db-guard";
import { recreateDatabase, withMaintenanceClient } from "./databases";

const { url, base, template } = inject("testDatabase");
const name = derivedName.worker(base, process.env.VITEST_POOL_ID ?? "1");
const worker = assertSafeTestDbUrl(withDatabase(url, name), process.env);

// Server modules read the env lazily (on first DB use), so setting it here is early enough.
Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: worker.url,
  DB_POOL_MAX: "4",
  SESSION_SECRET: "test",
  USE_CLOUD_STORAGE: "false",
});

// Runs before the test file's own hooks.
beforeAll(() => withMaintenanceClient(worker, (client) => recreateDatabase(client, name, template)));
afterAll(closeTestApp);
