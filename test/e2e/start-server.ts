/**
 * The Playwright webServer command (playwright.config.ts). It
 *
 * 1. claims the e2e database's name for as long as it runs (test/setup/run-lock.ts),
 *    so a second run with the same name stops instead of dropping this run's database;
 * 2. after the guard, recreates that database (test/e2e/database.ts) empty; the
 *    server's own boot migrations then build the schema, exactly as on a fresh deploy;
 * 3. empties the server's working directory (e2eWorkDir), so its uploads land
 *    there and never in the repo's own uploads/;
 * 4. builds, unless E2E_SKIP_BUILD=1, then runs `node dist/index.js` from that
 *    directory and stays alive, holding the claim, until the server exits.
 *
 * Playwright starts the webServer before any globalSetup, so none of this can be
 * one. When Playwright stops the server it kills this whole process group, and
 * Postgres drops the claim with the connection. The database and directory are
 * left in place afterwards for debugging.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertSafeTestDbUrl, guardEnv } from "../setup/db-guard";
import { recreateDatabase, withMaintenanceClient } from "../setup/databases";
import { claimTestDatabaseName } from "../setup/run-lock";
import { e2eDatabaseUrl } from "./database";
import { e2ePort, e2eServerEnv, e2eWorkDir } from "./server-env";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Run a child process with this one's output, passing on SIGINT/SIGTERM; resolves with its exit code. */
function run(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: "inherit" });
    const forward = (signal: NodeJS.Signals) => child.kill(signal);
    process.on("SIGINT", forward);
    process.on("SIGTERM", forward);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      process.off("SIGINT", forward);
      process.off("SIGTERM", forward);
      resolve(code ?? 128 + (signal ? os.constants.signals[signal] : 0));
    });
  });
}

async function main(): Promise<number> {
  const env = guardEnv();
  const target = assertSafeTestDbUrl(e2eDatabaseUrl(env), env);
  const claim = await claimTestDatabaseName(target, target.database);
  try {
    await withMaintenanceClient(target, (client) => recreateDatabase(client, target.database));
    console.log(`[e2e] recreated ${target.host}:${target.port}/${target.database}`);

    const workDir = e2eWorkDir(target.database);
    fs.rmSync(workDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(workDir, "uploads"), { recursive: true });

    const serverEnv = { ...process.env, ...e2eServerEnv({ port: e2ePort(env), databaseUrl: target.url }) };
    // CI downloads the build job's dist/ instead of building again.
    if (process.env.E2E_SKIP_BUILD !== "1") {
      const built = await run("npm", ["run", "build"], { cwd: REPO_ROOT, env: serverEnv });
      if (built !== 0) return built;
    }
    return await run(process.execPath, [path.join(REPO_ROOT, "dist", "index.js")], { cwd: workDir, env: serverEnv });
  } finally {
    await claim.release();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  },
);
