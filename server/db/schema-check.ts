/**
 * Whether the database has the schema this build queries: every table shared/schema.ts declares, with
 * every column. drizzle's `select().from(table)` names every declared column, so a single missing one
 * makes each read of that table fail with 42703 (undefined column), and the site answers 500 behind a
 * green healthcheck. The boot refuses to start instead, so the previous deployment keeps serving
 * (P2REV3-PRODSAFE-01).
 *
 * It checks the schema rather than the migration ledger: MIGRATE_ON_BOOT=false is the escape hatch for
 * a newest migration that fails while the code does not use what it adds yet (DEPLOYMENT.md), and that
 * file is still pending in the ledger. Only what the code really needs is required.
 */
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import type { Pool } from "pg";
import * as schema from "@shared/schema";

/** Every table shared/schema.ts declares, with its column names. */
export function declaredSchema(): Map<string, string[]> {
  const tables = new Map<string, string[]>();
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const config = getTableConfig(value);
    tables.set(config.name, config.columns.map((column) => column.name));
  }
  return tables;
}

/**
 * What the database lacks of `declaredSchema()`, in its current schema: "table" for a missing table,
 * "table.column" for a missing column, sorted. Empty when it has everything (more is fine).
 */
export async function missingSchema(pool: Pick<Pool, "query">): Promise<string[]> {
  const { rows } = await pool.query<{ table_name: string; column_name: string }>(
    "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema()",
  );
  const present = new Map<string, Set<string>>();
  for (const { table_name: table, column_name: column } of rows) {
    const columns = present.get(table) ?? new Set<string>();
    columns.add(column);
    present.set(table, columns);
  }
  const missing: string[] = [];
  for (const [table, columns] of Array.from(declaredSchema())) {
    const found = present.get(table);
    if (!found) missing.push(table);
    else for (const column of columns) if (!found.has(column)) missing.push(`${table}.${column}`);
  }
  return missing.sort();
}

export class SchemaBehindError extends Error {
  constructor(readonly missing: readonly string[]) {
    const listed = missing.slice(0, 10).join(", ") + (missing.length > 10 ? ` and ${missing.length - 10} more` : "");
    super(`The database lacks what this build queries: ${listed}`);
    this.name = "SchemaBehindError";
  }
}

/** Rejects with SchemaBehindError when the database lacks any table or column this build declares. */
export async function assertSchemaCurrent(pool: Pick<Pool, "query">): Promise<void> {
  const missing = await missingSchema(pool);
  if (missing.length > 0) throw new SchemaBehindError(missing);
}
