/**
 * An exclusive claim on a test database name for the length of a run. Two runs
 * that share a name (two agents without TEST_DB_NAME, or `npm run test:watch`
 * beside `npm test`) would otherwise drop and recreate each other's databases
 * mid-test and fail with errors that look like product bugs; with the claim,
 * the second run stops at once and says why.
 *
 * It is a session-level advisory lock on the server's `postgres` maintenance
 * database, which every run on that server connects to. Postgres releases it
 * when the connection closes, so a run that crashes or is killed never leaves
 * it behind.
 */
import pg from "pg";
import { withDatabase, type SafeTestDb } from "./db-guard";

/** First key of the two-part advisory lock; the second is hashtext(<database name>). */
export const TEST_RUN_LOCK_NAMESPACE = 727275;

export class TestRunConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TestRunConflictError";
  }
}

export interface TestRunClaim {
  /** Release the claim and close its connection. Safe to call more than once. */
  release(): Promise<void>;
}

/** Who holds the claim on `name`, for the error message. */
async function describeHolder(client: pg.Client, name: string): Promise<string> {
  const { rows } = await client.query<{ pid: number; application_name: string | null; seconds: number | null }>(
    `SELECT a.pid, a.application_name, extract(epoch FROM now() - a.backend_start)::int AS seconds
       FROM pg_locks l
       JOIN pg_stat_activity a ON a.pid = l.pid
      WHERE l.locktype = 'advisory' AND l.granted AND l.objsubid = 2
        AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
        AND l.classid = $1::int::oid AND l.objid = hashtext($2)::oid`,
    [TEST_RUN_LOCK_NAMESPACE, name],
  );
  const holder = rows[0];
  if (!holder) return "a run that has just finished";
  const startedAgo = holder.seconds == null ? "" : `, started ${holder.seconds}s ago`;
  return `pid ${holder.pid} (${holder.application_name || "unnamed"}${startedAgo})`;
}

/**
 * Claim `name` (a test database, or the base name of a run's databases) on
 * `target`'s server until `release()`. Rejects with TestRunConflictError,
 * without waiting, if another run holds it.
 */
export async function claimTestDatabaseName(target: SafeTestDb, name: string): Promise<TestRunClaim> {
  const client = new pg.Client({
    connectionString: withDatabase(target.url, "postgres"),
    application_name: `pokerpal test run: ${name}`,
  });
  // The connection sits idle for the whole run; a Postgres restart must not crash the runner with an unhandled 'error'.
  client.on("error", (error) => console.warn(`[test] lost the connection holding the claim on ${name}: ${error.message}`));
  await client.connect();

  try {
    const { rows } = await client.query<{ claimed: boolean }>("SELECT pg_try_advisory_lock($1, hashtext($2)) AS claimed", [
      TEST_RUN_LOCK_NAMESPACE,
      name,
    ]);
    if (!rows[0]?.claimed) {
      throw new TestRunConflictError(
        `Another test run is using ${name}, held by ${await describeHolder(client, name)}. ` +
          "Wait for it to finish, or give this run databases of its own with a different TEST_DB_NAME " +
          "(any name ending in _test or _test_<suffix>, e.g. TEST_DB_NAME=pokerpal_test_mybranch).",
      );
    }
  } catch (error) {
    await client.end().catch(() => undefined);
    throw error;
  }

  let released = false;
  return {
    async release() {
      if (released) return;
      released = true;
      // Closing the connection releases the lock even if the explicit unlock fails.
      await client.query("SELECT pg_advisory_unlock($1, hashtext($2))", [TEST_RUN_LOCK_NAMESPACE, name]).catch(() => undefined);
      await client.end().catch(() => undefined);
    },
  };
}
