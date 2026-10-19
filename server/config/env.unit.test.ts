import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ENV_VARIABLES, loadEnv, PLACEHOLDER_SESSION_SECRETS } from "./env";

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

  it("refuses, in production only, the SESSION_SECRET placeholders the example env files ship with (SEC-12)", () => {
    const shipped = [".env.example", ".env.production.example"].map(
      (file) => /^SESSION_SECRET=(.*)$/m.exec(repoFile(file))?.[1] ?? `no SESSION_SECRET line in ${file}`,
    );

    for (const SESSION_SECRET of shipped) {
      expect(PLACEHOLDER_SESSION_SECRETS).toContain(SESSION_SECRET);
      expect(() => loadEnv({ DATABASE_URL, NODE_ENV: "production", SESSION_SECRET })).toThrow(
        /SESSION_SECRET: SESSION_SECRET is still the example placeholder/,
      );
      expect(loadEnv({ DATABASE_URL, SESSION_SECRET }).SESSION_SECRET).toBe(SESSION_SECRET);
    }
  });

  it("reads RATE_LIMITS_ENABLED as on, off, or unset (left to the limiters' NODE_ENV default)", () => {
    expect(loadEnv({ DATABASE_URL }).RATE_LIMITS_ENABLED).toBeUndefined();
    expect(loadEnv({ DATABASE_URL, RATE_LIMITS_ENABLED: "" }).RATE_LIMITS_ENABLED).toBeUndefined();
    for (const on of ["true", "1"]) expect(loadEnv({ DATABASE_URL, RATE_LIMITS_ENABLED: on }).RATE_LIMITS_ENABLED).toBe(true);
    for (const off of ["false", "0"]) expect(loadEnv({ DATABASE_URL, RATE_LIMITS_ENABLED: off }).RATE_LIMITS_ENABLED).toBe(false);
    expect(() => loadEnv({ DATABASE_URL, RATE_LIMITS_ENABLED: "yes" })).toThrow(/RATE_LIMITS_ENABLED: /);
  });

  it("lists every invalid variable without echoing any value", () => {
    const attempt = () => loadEnv({ DATABASE_URL, PORT: "abc", DB_POOL_MAX: "0", MIGRATE_ON_BOOT: "yes" });

    expect(attempt).toThrow(/PORT: [\s\S]*DB_POOL_MAX: [\s\S]*MIGRATE_ON_BOOT: /);
    expect(attempt).not.toThrow(/s3cret/);
  });
});

describe("image storage settings", () => {
  const R2 = {
    R2_ACCOUNT_ID: "acct",
    R2_ACCESS_KEY_ID: "key-id",
    R2_SECRET_ACCESS_KEY: "very-secret-value",
    R2_BUCKET_NAME: "pokerpal-images",
    R2_PUBLIC_URL: "https://images.example.com",
  };
  const PRODUCTION = { DATABASE_URL, NODE_ENV: "production", SESSION_SECRET: "x" };

  it("accepts production with every R2 variable, or with none", () => {
    expect(loadEnv({ ...PRODUCTION, ...R2 }).R2_BUCKET_NAME).toBe("pokerpal-images");
    expect(loadEnv(PRODUCTION).R2_BUCKET_NAME).toBeUndefined();
  });

  it("refuses to start production with R2 only partly configured, naming what is missing but no value", () => {
    const attempt = () => loadEnv({ ...PRODUCTION, ...R2, R2_PUBLIC_URL: "", R2_BUCKET_NAME: "" });

    expect(attempt).toThrow(/R2 is only partly configured; set every R2 variable \(missing R2_BUCKET_NAME, R2_PUBLIC_URL\) or none/);
    expect(attempt).not.toThrow(/very-secret-value|key-id/);
  });

  it("refuses USE_CLOUD_STORAGE=true without every R2 variable, in any environment", () => {
    for (const NODE_ENV of ["development", "production"]) {
      expect(() => loadEnv({ ...PRODUCTION, NODE_ENV, USE_CLOUD_STORAGE: "true", R2_ACCOUNT_ID: "acct" })).toThrow(
        /USE_CLOUD_STORAGE: USE_CLOUD_STORAGE=true needs every R2 variable; missing R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL/,
      );
    }
    expect(loadEnv({ DATABASE_URL, USE_CLOUD_STORAGE: "true", ...R2 }).USE_CLOUD_STORAGE).toBe(true);
  });

  it("leaves a partial R2 configuration alone outside production when cloud storage is not asked for", () => {
    expect(loadEnv({ DATABASE_URL, R2_ACCOUNT_ID: "acct" }).R2_ACCOUNT_ID).toBe("acct");
  });

  it("keeps R2_PUBLIC_URL as a base without trailing slashes, so keys never get a double slash", () => {
    expect(loadEnv({ DATABASE_URL, R2_PUBLIC_URL: "https://pub-abc.r2.dev/" }).R2_PUBLIC_URL).toBe("https://pub-abc.r2.dev");
    expect(loadEnv({ DATABASE_URL, R2_PUBLIC_URL: "https://cdn.example.com/images//" }).R2_PUBLIC_URL).toBe("https://cdn.example.com/images");
  });

  it.each([
    ["images.example.com", /R2_PUBLIC_URL: must be an absolute URL/],
    ["ftp://images.example.com", /R2_PUBLIC_URL: must be an http\(s\) URL/],
    ["https://pokerpal.acct.r2.cloudflarestorage.com", /R2_PUBLIC_URL: is the R2 S3 API host, which never serves public images/],
    ["https://images.example.com/?v=1", /R2_PUBLIC_URL: must not have a query or fragment/],
  ])("refuses R2_PUBLIC_URL=%s", (value, message) => {
    expect(() => loadEnv({ DATABASE_URL, R2_PUBLIC_URL: value })).toThrow(message);
  });

  it("reads UPLOAD_DIR as given (resolved against the working directory by the image store)", () => {
    expect(loadEnv({ DATABASE_URL, UPLOAD_DIR: "/data/uploads" }).UPLOAD_DIR).toBe("/data/uploads");
    expect(loadEnv({ DATABASE_URL, UPLOAD_DIR: "" }).UPLOAD_DIR).toBeUndefined();
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
