import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

/**
 * For drizzle-kit by hand (studio, a throwaway push), never for changing a real
 * schema: the server applies the hand-written, guarded migrations/*.sql at
 * boot (server/db/migrate.ts), so drizzle-kit must never write there, and it
 * must leave alone the tables shared/schema.ts does not model.
 */
export default defineConfig({
  // Drafts only: migrations/ is applied at boot, and generated SQL is neither re-runnable nor guard-safe.
  out: "./drizzle",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  // connect-pg-simple's sessions and the migration ledger: a push would otherwise drop both.
  tablesFilter: ["!session", "!_app_migrations"],
  // Show every statement and ask before running it.
  strict: true,
  verbose: true,
});
