import { derivedName } from "../setup/database-names";
import { resolveTestDbUrl, withDatabase, type GuardEnv } from "../setup/db-guard";

/**
 * The e2e server's database: `<test database>_e2e` on the test database
 * server, e.g. pokerpal_test_e2e, or pokerpal_test_mybranch_e2e with
 * TEST_DB_NAME=pokerpal_test_mybranch, so parallel runs keep apart.
 */
export function e2eDatabaseUrl(env: GuardEnv): string {
  const base = resolveTestDbUrl(env);
  const name = decodeURIComponent(new URL(base).pathname.slice(1));
  return withDatabase(base, derivedName.e2e(name));
}

/** The name of the e2e server's database (see e2eDatabaseUrl). */
export function e2eDatabaseName(env: GuardEnv): string {
  return decodeURIComponent(new URL(e2eDatabaseUrl(env)).pathname.slice(1));
}
