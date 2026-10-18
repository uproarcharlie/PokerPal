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

const positiveInt = (defaultValue: number) =>
  z.preprocess(
    (value) => (value === "" || value === undefined ? undefined : Number(value)),
    z.number().int().positive().default(defaultValue),
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
  // Cloud storage is used in production, or anywhere USE_CLOUD_STORAGE is exactly "true".
  USE_CLOUD_STORAGE: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  R2_ACCOUNT_ID: optionalString,
  R2_ACCESS_KEY_ID: optionalString,
  R2_SECRET_ACCESS_KEY: optionalString,
  R2_BUCKET_NAME: optionalString,
  R2_PUBLIC_URL: optionalString,
  MIGRATE_ON_BOOT: flag(true),
  RAILWAY_GIT_COMMIT_SHA: optionalString,
});

/** Every variable the server reads; .env.example documents each one (server/config/env.unit.test.ts). */
export const ENV_VARIABLES: readonly string[] = Object.keys(envVariables.shape);

const envSchema = envVariables.superRefine((env, ctx) => {
  if (env.NODE_ENV === "production" && !env.SESSION_SECRET) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["SESSION_SECRET"],
      message: "SESSION_SECRET is required in production",
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
