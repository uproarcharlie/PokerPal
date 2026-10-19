/**
 * Apply migrations/*.sql to DATABASE_URL (from the environment or .env) exactly
 * as the server does at boot: destructive-SQL guard, advisory lock, one
 * transaction per file, then the boot data seeds (never on a dry run). Prints
 * the target (never credentials) first.
 *
 *   npm run db:migrate                 # a local database
 *   npm run db:migrate -- --dry-run    # guard check + plan only; executes nothing
 *   npm run db:migrate -- --yes        # required for any host other than localhost
 */
import "dotenv/config";
import path from "node:path";
import { parseArgs } from "node:util";
import { Pool } from "pg";
import { loadEnv } from "../server/config/env";
import { applyMigrations, describeDatabaseTarget, MigrationError } from "../server/db/migrate";
import { runBootSeeds } from "../server/db/seeds";

const USAGE = `Usage: npm run db:migrate -- [--dry-run] [--yes]
  --dry-run  check every file against the guard and show what would run; executes nothing
  --yes      confirm a database that is not on localhost`;

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      "dry-run": { type: "boolean", default: false },
      yes: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }

  const env = loadEnv(process.env);
  const dryRun = values["dry-run"];
  const target = describeDatabaseTarget(env.DATABASE_URL);
  console.log(`Target database: ${target.label}${dryRun ? " (dry run)" : ""}`);
  if (!target.isLocal && !values.yes) {
    console.error(`Refusing to touch a database that is not on localhost without --yes.\n${USAGE}`);
    return 1;
  }

  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 1 });
  try {
    await applyMigrations({
      pool,
      dir: path.resolve(import.meta.dirname, "..", "migrations"),
      logger: console,
      dryRun,
    });
    // As the boot does: a database migrated by hand gets the same data fixes (P2REV3-PROD-03).
    if (!dryRun) await runBootSeeds(pool);
    return 0;
  } finally {
    await pool.end();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof MigrationError ? error.message : error);
    process.exitCode = 1;
  },
);
