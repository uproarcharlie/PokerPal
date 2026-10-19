import pg from "pg";
import { assertSafeTestDbUrl, guardEnv } from "../../setup/db-guard";
import { e2eDatabaseUrl } from "../database";

/**
 * Runs `work` on the e2e server's own database (test/e2e/database.ts), through the same guard as
 * everything else: a local server and a `*_test…_e2e` name only. The Playwright runner is a test run
 * whatever NODE_ENV the shell has (CI does not set one), so it is passed as "test" here, exactly as the
 * webServer command does for start-server.ts.
 */
export async function withE2eDatabase<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const env = { ...guardEnv(), NODE_ENV: "test" };
  const target = assertSafeTestDbUrl(e2eDatabaseUrl(env), env);
  const client = new pg.Client({ connectionString: target.url });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/**
 * Makes the account a platform admin, as an operator would on a new deployment (there is no UI for
 * the first admin). The server reads the role from the database on every request, so it applies to
 * the account's open sessions at once; the client sees it on its next /api/auth/me.
 */
export async function promoteToAdmin(email: string): Promise<void> {
  const updated = await withE2eDatabase((client) =>
    client.query("UPDATE users SET role = 'admin' WHERE lower(email) = lower($1)", [email]),
  );
  if (updated.rowCount !== 1) throw new Error(`Expected exactly one account for ${email}, found ${updated.rowCount}`);
}
