import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { populate } from "dotenv";
import { describe, expect, it } from "vitest";
import { loadEnv, setEnv } from "../../server/config/env";
import { isCloudStorageEnabled } from "../../server/services/storage";
import { e2eDatabaseUrl } from "../e2e/database";
import { DEFAULT_E2E_PORT, e2ePort, e2eServerEnv, e2eWorkDir } from "../e2e/server-env";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

const R2_CREDENTIALS = {
  R2_ACCOUNT_ID: "account",
  R2_ACCESS_KEY_ID: "key-id",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_BUCKET_NAME: "pokerpal-images",
  R2_PUBLIC_URL: "https://images.example.com",
};

/** The environment `node dist/index.js` ends up with: Playwright's merge of shell and config, then `import "dotenv/config"`. */
function serverEnvironment(shell: Record<string, string>, dotEnvFile: Record<string, string>, configured: Record<string, string>) {
  const processEnv: Record<string, string> = { ...shell, ...configured };
  populate(processEnv, dotEnvFile);
  return processEnv;
}

const configured = e2eServerEnv({ port: 4710, databaseUrl: "postgres://localhost:5432/pokerpal_test_e2e" });

describe("the e2e server's environment", () => {
  it("never reaches cloud storage, even with R2 credentials in the shell and in .env", () => {
    setEnv(loadEnv(serverEnvironment({ ...R2_CREDENTIALS, USE_CLOUD_STORAGE: "true" }, R2_CREDENTIALS, configured)));

    expect(isCloudStorageEnabled()).toBe(false);
  });

  it("would, without those blanks: production turns cloud storage on whenever credentials exist", () => {
    const withoutBlanks = Object.fromEntries(Object.entries(configured).filter(([key]) => !key.startsWith("R2_")));

    setEnv(loadEnv(serverEnvironment({}, R2_CREDENTIALS, { ...withoutBlanks, USE_CLOUD_STORAGE: "false" })));

    expect(isCloudStorageEnabled()).toBe(true);
  });

  it("runs the production build", () => {
    expect(loadEnv(configured)).toMatchObject({ NODE_ENV: "production", PORT: 4710 });
  });
});

describe("e2eWorkDir", () => {
  it("is a git-ignored directory of its own per e2e database, so uploads never land in the repo's uploads/", () => {
    const dir = e2eWorkDir("pokerpal_test_mine_e2e");

    expect(path.relative(REPO_ROOT, dir)).toBe(path.join("tmp", "e2e", "pokerpal_test_mine_e2e"));
    expect(path.relative(path.join(REPO_ROOT, "uploads"), path.join(dir, "uploads")).startsWith("..")).toBe(true);
    const ignored = execFileSync("git", ["check-ignore", path.join(dir, "uploads", "players", "image.webp")], { cwd: REPO_ROOT });
    expect(ignored.toString().trim()).not.toBe("");
  });
});

describe("e2eDatabaseUrl", () => {
  it("adds _e2e to the test database, so TEST_DB_NAME keeps parallel runs apart", () => {
    expect(e2eDatabaseUrl({ DATABASE_URL: "postgresql://me@localhost:5432/pokerpal" })).toBe(
      "postgresql://me@localhost:5432/pokerpal_test_e2e",
    );
    expect(e2eDatabaseUrl({ DATABASE_URL: "postgresql://me@localhost:5432/pokerpal", TEST_DB_NAME: "pokerpal_test_mine" })).toBe(
      "postgresql://me@localhost:5432/pokerpal_test_mine_e2e",
    );
    expect(e2eDatabaseUrl({ TEST_DATABASE_URL: "postgres://u:p@127.0.0.1:5433/pokerpal_test" })).toBe(
      "postgres://u:p@127.0.0.1:5433/pokerpal_test_e2e",
    );
  });
});

describe("e2ePort", () => {
  it("defaults to 4710 and honours E2E_PORT", () => {
    expect(e2ePort({})).toBe(DEFAULT_E2E_PORT);
    expect(e2ePort({ E2E_PORT: "" })).toBe(4710);
    expect(e2ePort({ E2E_PORT: "4722" })).toBe(4722);
  });

  it.each(["abc", "0", "70000", "47.5"])("refuses E2E_PORT=%s", (value) => {
    expect(() => e2ePort({ E2E_PORT: value })).toThrow(/E2E_PORT must be a port number/);
  });
});
