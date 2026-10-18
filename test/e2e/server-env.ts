import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GuardEnv } from "../setup/db-guard";

export const DEFAULT_E2E_PORT = 4710;

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/**
 * The e2e server's working directory, `tmp/e2e/<e2e database>` (gitignored),
 * emptied on every run. Local-disk uploads are written to and served from
 * `uploads/` under the working directory, so this keeps them out of the repo's
 * own uploads/, and apart between runs with different TEST_DB_NAMEs.
 */
export function e2eWorkDir(databaseName: string): string {
  return path.join(REPO_ROOT, "tmp", "e2e", databaseName);
}

/** The e2e server's port: E2E_PORT, so parallel runs can each have their own, or 4710. */
export function e2ePort(env: GuardEnv): number {
  const value = env.E2E_PORT;
  if (value === undefined || value === "") return DEFAULT_E2E_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`E2E_PORT must be a port number (it is ${JSON.stringify(value)})`);
  return port;
}

/**
 * The variables the e2e server (`node dist/index.js`) starts with, on top of
 * the developer's shell. NODE_ENV=production switches cloud storage on
 * whenever R2 credentials exist, and the server's `import "dotenv/config"`
 * fills in whatever a `.env` in its working directory holds. Setting each one
 * to "" stops both, because dotenv never overrides a variable that is set and
 * the app treats "" as unset, so uploads always stay on local disk.
 */
export function e2eServerEnv({ port, databaseUrl }: { port: number; databaseUrl: string }): Record<string, string> {
  return {
    NODE_ENV: "production",
    PORT: String(port),
    DATABASE_URL: databaseUrl,
    SESSION_SECRET: "e2e-session-secret",
    USE_CLOUD_STORAGE: "",
    R2_ACCOUNT_ID: "",
    R2_ACCESS_KEY_ID: "",
    R2_SECRET_ACCESS_KEY: "",
    R2_BUCKET_NAME: "",
    R2_PUBLIC_URL: "",
  };
}
