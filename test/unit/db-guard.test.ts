import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertSafeTestDb,
  assertSafeTestDbUrl,
  guardEnv,
  resolveTestDbUrl,
  UnsafeTestDatabaseError,
  withDatabase,
  type GuardEnv,
} from "../setup/db-guard";

const testEnv = (overrides: GuardEnv = {}): GuardEnv => ({ NODE_ENV: "test", ...overrides });

describe("resolveTestDbUrl", () => {
  it("uses TEST_DATABASE_URL as given", () => {
    const url = "postgres://postgres:postgres@localhost:5432/pokerpal_test";
    expect(resolveTestDbUrl({ TEST_DATABASE_URL: url, DATABASE_URL: "postgres://x@localhost/other" })).toBe(url);
  });

  it("otherwise takes the dev DATABASE_URL's server with the default test database name", () => {
    expect(resolveTestDbUrl({ DATABASE_URL: "postgresql://charlie@localhost:5432/pokerpal" })).toBe(
      "postgresql://charlie@localhost:5432/pokerpal_test",
    );
  });

  it("lets TEST_DB_NAME name the database on either route", () => {
    expect(resolveTestDbUrl({ DATABASE_URL: "postgresql://localhost/pokerpal", TEST_DB_NAME: "pokerpal_test_b" })).toBe(
      "postgresql://localhost/pokerpal_test_b",
    );
    expect(
      resolveTestDbUrl({ TEST_DATABASE_URL: "postgres://u:p@127.0.0.1:5433/pokerpal_test", TEST_DB_NAME: "pokerpal_test_c" }),
    ).toBe("postgres://u:p@127.0.0.1:5433/pokerpal_test_c");
  });

  it("keeps credentials and query parameters when swapping the database", () => {
    expect(withDatabase("postgres://u:s3cret@localhost:5432/pokerpal?sslmode=disable", "pokerpal_test")).toBe(
      "postgres://u:s3cret@localhost:5432/pokerpal_test?sslmode=disable",
    );
  });

  it("treats empty variables as unset", () => {
    expect(resolveTestDbUrl({ TEST_DATABASE_URL: "", TEST_DB_NAME: "", DATABASE_URL: "postgres://localhost/dev" })).toBe(
      "postgres://localhost/pokerpal_test",
    );
  });

  it("refuses when no database is configured at all", () => {
    expect(() => resolveTestDbUrl({})).toThrow(UnsafeTestDatabaseError);
  });

  it.each([
    ["another run's worker clone", { TEST_DB_NAME: "pokerpal_test_w2" }, /"_w2" is reserved/],
    ["a name inside a worker's namespace", { TEST_DB_NAME: "pokerpal_test_w2_mine" }, /"_w2" is reserved/],
    ["another run's template", { TEST_DB_NAME: "pokerpal_test_template" }, /"_template" is reserved/],
    ["another run's e2e database", { TEST_DB_NAME: "pokerpal_test_e2e" }, /"_e2e" is reserved/],
    ["a reserved name given whole in TEST_DATABASE_URL", { TEST_DATABASE_URL: "postgres://localhost/pokerpal_test_w1" }, /"_w1" is reserved/],
  ])("refuses as a run's name %s, which that run would drop", (_label, env, message) => {
    expect(() => resolveTestDbUrl({ DATABASE_URL: "postgres://localhost/pokerpal", ...env })).toThrow(message);
  });

  it.each(["pokerpal_test_web", "pokerpal_test_wave2", "pokerpal_test_w", "pokerpal_test_mine_e2e2"])(
    "accepts %s, which only looks like a derived name",
    (name) => {
      expect(resolveTestDbUrl({ DATABASE_URL: "postgres://localhost/pokerpal", TEST_DB_NAME: name })).toBe(`postgres://localhost/${name}`);
    },
  );
});

describe("assertSafeTestDbUrl", () => {
  it.each([
    ["localhost", "postgres://postgres:postgres@localhost:5432/pokerpal_test"],
    ["127.0.0.1 with a suffixed name", "postgres://127.0.0.1:5433/pokerpal_test_b"],
    ["IPv6 loopback, per-worker clone", "postgres://[::1]:5432/pokerpal_test_b_w3"],
    ["template database", "postgres://localhost/pokerpal_test_template"],
  ])("accepts %s", (_label, url) => {
    expect(assertSafeTestDbUrl(url, testEnv()).url).toBe(url);
  });

  it("reports where it will connect", () => {
    expect(assertSafeTestDbUrl("postgres://u:p@[::1]:6543/pokerpal_test_e2e", testEnv())).toEqual({
      url: "postgres://u:p@[::1]:6543/pokerpal_test_e2e",
      host: "::1",
      port: "6543",
      database: "pokerpal_test_e2e",
    });
  });

  it.each([
    ["a remote host", "postgres://u:p@db.railway.internal:5432/pokerpal_test", /host must be localhost/],
    ["a public hostname", "postgres://u:p@monorail.proxy.rlwy.net:41234/railway_test", /host must be localhost/],
    ["a ?host= override pointing elsewhere", "postgres://localhost/pokerpal_test?host=prod.example.com", /"prod\.example\.com"/],
    ["a Unix socket directory", "postgres://localhost/pokerpal_test?host=/tmp", /host must be localhost/],
    ["no host", "postgres:///pokerpal_test", /host must be localhost/],
    ["the dev database", "postgres://localhost:5432/pokerpal", /database name must end in _test/],
    ["a name that merely contains _test", "postgres://localhost/pokerpal_testing", /database name/],
    ["an upper-case name", "postgres://localhost/Pokerpal_test", /database name/],
    ["a name with a dash", "postgres://localhost/pokerpal_test-1", /database name/],
    ["no database", "postgres://localhost:5432", /database name/],
    ["an unparseable string", "not a url", /could not be parsed|host must be/],
  ])("refuses %s", (_label, url, problem) => {
    expect(() => assertSafeTestDbUrl(url, testEnv())).toThrow(problem);
  });

  it.each([undefined, "development", "production", ""])("refuses NODE_ENV=%s", (nodeEnv) => {
    expect(() => assertSafeTestDbUrl("postgres://localhost/pokerpal_test", { NODE_ENV: nodeEnv })).toThrow(
      /NODE_ENV must be "test"/,
    );
  });

  it("refuses when any RAILWAY_* variable is present", () => {
    expect(() =>
      assertSafeTestDbUrl("postgres://localhost/pokerpal_test", testEnv({ RAILWAY_ENVIRONMENT_NAME: "production" })),
    ).toThrow(/RAILWAY_ENVIRONMENT_NAME/);
  });

  it("lists every problem at once and never echoes the password", () => {
    const attempt = () =>
      assertSafeTestDbUrl("postgres://admin:hunter2@prod.example.com:5432/pokerpal", { NODE_ENV: "production" });

    expect(attempt).toThrow(UnsafeTestDatabaseError);
    expect(attempt).toThrow(/NODE_ENV[\s\S]*host must be[\s\S]*database name/);
    expect(attempt).not.toThrow(/hunter2/);
  });
});

describe("assertSafeTestDb", () => {
  it("resolves and validates in one step", () => {
    expect(assertSafeTestDb(testEnv({ DATABASE_URL: "postgres://localhost/pokerpal", TEST_DB_NAME: "pokerpal_test_x" })).database).toBe(
      "pokerpal_test_x",
    );
  });

  it("refuses a dev DATABASE_URL on another machine even with a test name", () => {
    expect(() => assertSafeTestDb(testEnv({ DATABASE_URL: "postgres://u:p@ep-cool.neon.tech/neondb" }))).toThrow(
      /host must be localhost/,
    );
  });
});

describe("guardEnv", () => {
  const dirs: string[] = [];
  const dotEnv = (contents: string) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "db-guard-"));
    dirs.push(dir);
    const file = path.join(dir, ".env");
    fs.writeFileSync(file, contents);
    return file;
  };
  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("takes only the database settings from .env, never NODE_ENV or secrets", () => {
    const file = dotEnv("DATABASE_URL=postgres://localhost/pokerpal\nNODE_ENV=development\nSESSION_SECRET=s\nTEST_DB_NAME=pokerpal_test_z\n");

    expect(guardEnv({ NODE_ENV: "test" }, file)).toEqual({
      NODE_ENV: "test",
      DATABASE_URL: "postgres://localhost/pokerpal",
      TEST_DB_NAME: "pokerpal_test_z",
    });
  });

  it("lets the process environment win over .env", () => {
    const file = dotEnv("DATABASE_URL=postgres://localhost/from_file\n");

    expect(guardEnv({ DATABASE_URL: "postgres://localhost/from_shell" }, file).DATABASE_URL).toBe(
      "postgres://localhost/from_shell",
    );
  });

  it("returns the process environment unchanged when there is no .env", () => {
    const env = { NODE_ENV: "test" };
    expect(guardEnv(env, path.join(os.tmpdir(), "does-not-exist", ".env"))).toBe(env);
  });
});
