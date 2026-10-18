import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ENV_VARIABLES, loadEnv } from "./env";

const repoFile = (name: string) => fs.readFileSync(fileURLToPath(new URL(`../../${name}`, import.meta.url)), "utf8");

const DATABASE_URL = "postgres://app:s3cret@localhost:5432/pokerpal";

describe("loadEnv", () => {
  it("defaults as the code it replaced did", () => {
    expect(loadEnv({ DATABASE_URL })).toMatchObject({
      NODE_ENV: "development",
      PORT: 5000,
      DB_POOL_MAX: 10,
      TRUST_PROXY: 1,
      USE_CLOUD_STORAGE: false,
      MIGRATE_ON_BOOT: true,
    });
  });

  it("treats empty variables as unset", () => {
    expect(loadEnv({ DATABASE_URL, PORT: "", NODE_ENV: "", R2_BUCKET_NAME: "" })).toMatchObject({
      NODE_ENV: "development",
      PORT: 5000,
      R2_BUCKET_NAME: undefined,
    });
  });

  it("never fails over a variable the app does not read", () => {
    const env = loadEnv({ DATABASE_URL, PUBLIC_APP_URL: "lovepoker.club", SOME_OTHER_SETTING: "x" });

    expect(Object.keys(env)).not.toContain("PUBLIC_APP_URL");
    expect(Object.keys(env)).not.toContain("SOME_OTHER_SETTING");
  });

  it("requires SESSION_SECRET in production", () => {
    expect(() => loadEnv({ DATABASE_URL, NODE_ENV: "production" })).toThrow(/SESSION_SECRET: SESSION_SECRET is required in production/);
    expect(loadEnv({ DATABASE_URL, NODE_ENV: "production", SESSION_SECRET: "x" }).NODE_ENV).toBe("production");
  });

  it("lists every invalid variable without echoing any value", () => {
    const attempt = () => loadEnv({ DATABASE_URL, PORT: "abc", DB_POOL_MAX: "0", MIGRATE_ON_BOOT: "yes" });

    expect(attempt).toThrow(/PORT: [\s\S]*DB_POOL_MAX: [\s\S]*MIGRATE_ON_BOOT: /);
    expect(attempt).not.toThrow(/s3cret/);
  });
});

describe("the documented configuration", () => {
  it("lists every variable the server reads in .env.example, apart from those Railway sets itself", () => {
    const example = repoFile(".env.example");
    const undocumented = ENV_VARIABLES.filter((name) => !name.startsWith("RAILWAY_") && !new RegExp(`^#? ?${name}=`, "m").test(example));

    expect(undocumented).toEqual([]);
  });

  it("has the DEPLOYMENT.md section a failed boot points to, with its way out", () => {
    const section = /^#### When a boot migration fails\n([\s\S]*?)(?=^#{1,4} )/m.exec(repoFile("DEPLOYMENT.md"))?.[1] ?? "";

    expect(section).toContain("`MIGRATE_ON_BOOT=false`");
    expect(section).toContain("npm run db:migrate -- --dry-run --yes");
  });
});
