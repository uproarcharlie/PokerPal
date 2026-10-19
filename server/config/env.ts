import { z } from "zod";

/**
 * The single source of runtime configuration. Only this module and the
 * bootstrap in server/index.ts may read `process.env`; everything else receives
 * an `AppEnv` (via createApp) or calls `getEnv()`.
 */

type RawEnv = Record<string, string | undefined>;

// Unset and empty variables are treated alike, matching the `process.env.X || default`
// reads this module replaced.
const optionalString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().optional(),
);

const flag = (defaultValue: boolean) =>
  z.preprocess(
    (value) => (value === "" ? undefined : value),
    z
      .enum(["true", "false", "1", "0"])
      .optional()
      .transform((value) => (value === undefined ? defaultValue : value === "true" || value === "1")),
  );

/** A true/false switch that stays undefined when unset, so the code reading it can choose the default. */
const optionalFlag = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true" || value === "1")),
);

const positiveInt = (defaultValue: number) =>
  z.preprocess(
    (value) => (value === "" || value === undefined ? undefined : Number(value)),
    z.number().int().positive().default(defaultValue),
  );

/** A whole number above 0 that stays undefined when unset, so the code reading it can choose the default. */
const optionalPositiveInt = z.preprocess(
  (value) => (value === "" || value === undefined ? undefined : Number(value)),
  z.number().int().positive().optional(),
);

/** Express `trust proxy` setting: a hop count, a boolean, or a comma list of addresses/subnets. */
export type TrustProxy = number | boolean | string;

const trustProxy = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z
    .string()
    .optional()
    .transform((value): TrustProxy => {
      if (value === undefined) return 1;
      if (value === "true") return true;
      if (value === "false") return false;
      if (/^\d+$/.test(value)) return Number(value);
      return value;
    }),
);

/** The R2 S3 API host only answers signed requests, so it can never be where browsers load images from. */
const R2_API_HOST = /(^|\.)r2\.cloudflarestorage\.com$/i;

// The public base of stored images, without trailing slashes (a key is appended after one `/`).
const publicBaseUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z
    .string()
    .optional()
    .superRefine((value, ctx) => {
      if (value === undefined) return;
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "must be an absolute URL, such as https://images.example.com" });
        return;
      }
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "must be an http(s) URL" });
      } else if (R2_API_HOST.test(url.hostname)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "is the R2 S3 API host, which never serves public images; use the bucket's r2.dev URL or a custom domain",
        });
      } else if (url.search || url.hash) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "must not have a query or fragment" });
      }
    })
    .transform((value) => value?.replace(/\/+$/, "")),
);

const envVariables = z.object({
  NODE_ENV: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.enum(["development", "test", "production"]).default("development"),
  ),
  PORT: positiveInt(5000),
  DATABASE_URL: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string({ required_error: "DATABASE_URL must be set. Did you forget to provision a database?" }),
  ),
  DB_POOL_MAX: positiveInt(10),
  SESSION_SECRET: optionalString,
  TRUST_PROXY: trustProxy,
  // The secret our Cloudflare zone sends in X-Origin-Auth (a Transform Rule); with it set, the rate
  // limits believe CF-Connecting-IP only from requests that went through the zone (rate-limits.ts).
  CLOUDFLARE_ORIGIN_SECRET: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(16, "must be at least 16 characters").optional(),
  ),
  // Images go to Cloudflare R2 in production, or anywhere USE_CLOUD_STORAGE is exactly "true"
  // (see server/services/images/store.ts for the whole rule).
  USE_CLOUD_STORAGE: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  R2_ACCOUNT_ID: optionalString,
  R2_ACCESS_KEY_ID: optionalString,
  R2_SECRET_ACCESS_KEY: optionalString,
  R2_BUCKET_NAME: optionalString,
  R2_PUBLIC_URL: publicBaseUrl,
  // The local-disk image store's directory (default ./uploads). In production it is also the explicit
  // opt-in to storing images on local disk without R2, which only makes sense on a persistent volume.
  UPLOAD_DIR: optionalString,
  MIGRATE_ON_BOOT: flag(true),
  // Unset: rate limits are on except under NODE_ENV=test (server/http/rate-limits.ts).
  RATE_LIMITS_ENABLED: optionalFlag,
  // Per-limit overrides of RATE_LIMITS (requests per visitor per 15 minutes), e.g. for a big night at
  // one venue, without turning the sign-in throttle off.
  RATE_LIMIT_PUBLIC_WRITE: optionalPositiveInt,
  RATE_LIMIT_LIVE: optionalPositiveInt,
  RAILWAY_GIT_COMMIT_SHA: optionalString,
});

/** Every variable the server reads; .env.example documents each one (server/config/env.unit.test.ts). */
export const ENV_VARIABLES: readonly string[] = Object.keys(envVariables.shape);

/** Everything the R2 image store needs; it is used only when all of them are set. */
const R2_VARIABLES = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "R2_PUBLIC_URL",
] as const;

/** The R2 variables that are not set (names only: never print their values). */
function missingR2Variables(env: Readonly<Partial<Record<(typeof R2_VARIABLES)[number], string>>>): string[] {
  return R2_VARIABLES.filter((name) => !env[name]);
}

/**
 * The SESSION_SECRET values .env.example and .env.production.example ship with. Anyone can read them,
 * so a production server signing its session cookies with one would accept forged cookies (SEC-12).
 */
export const PLACEHOLDER_SESSION_SECRETS: readonly string[] = [
  "your_session_secret_here_change_in_production",
  "your_production_session_secret_here_change_this",
];

const envSchema = envVariables.superRefine((env, ctx) => {
  if (env.NODE_ENV === "production" && !env.SESSION_SECRET) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["SESSION_SECRET"],
      message: "SESSION_SECRET is required in production",
    });
  } else if (env.NODE_ENV === "production" && PLACEHOLDER_SESSION_SECRETS.includes(env.SESSION_SECRET ?? "")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["SESSION_SECRET"],
      message: "SESSION_SECRET is still the example placeholder; generate a random secret for production",
    });
  }

  // Half an R2 configuration used to mean uploads quietly landing on a disk that every redeploy wipes
  // (img-01). Asking for cloud storage, or configuring part of it in production, must be complete.
  const missing = missingR2Variables(env);
  if (env.USE_CLOUD_STORAGE && missing.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["USE_CLOUD_STORAGE"],
      message: `USE_CLOUD_STORAGE=true needs every R2 variable; missing ${missing.join(", ")}`,
    });
  } else if (env.NODE_ENV === "production" && missing.length > 0 && missing.length < R2_VARIABLES.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["R2_*"],
      message: `R2 is only partly configured; set every R2 variable (missing ${missing.join(", ")}) or none`,
    });
  }
});

export type AppEnv = Readonly<z.infer<typeof envSchema>>;

/**
 * Parse and validate configuration. Throws one error listing every invalid
 * variable. Only enum values (NODE_ENV, MIGRATE_ON_BOOT) are ever echoed in
 * the message, so secrets cannot leak into logs.
 */
export function loadEnv(source: RawEnv = process.env): AppEnv {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  ${issue.path.join(".") || "(env)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return Object.freeze(result.data);
}

let activeEnv: AppEnv | undefined;

/** Make `env` the configuration seen by lazily-initialised singletons (DB pool, cloud storage). */
export function setEnv(env: AppEnv): void {
  activeEnv = env;
}

/** The active configuration; loads it from `process.env` on first use if nothing was set. */
export function getEnv(): AppEnv {
  activeEnv ??= loadEnv();
  return activeEnv;
}

/** Short build identifier for diagnostics: the deployed commit, or "dev" locally. */
export function appVersion(env: AppEnv): string {
  return env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev";
}
