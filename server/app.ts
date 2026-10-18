import express, { type Express } from "express";
import type session from "express-session";
import helmet, { type HelmetOptions } from "helmet";
import rateLimit from "express-rate-limit";
import { appVersion, setEnv, type AppEnv } from "./config/env";
import { createSessionMiddleware } from "./config/auth";
import { getPool } from "./db";
import { getBootMigrationStatus } from "./db/migrate";
import { errorHandler } from "./http/errors";
import { requestLogger } from "./http/request-log";
import { createHealthRouter } from "./routes/health";
import { registerRoutes } from "./routes";

export interface CreateAppOptions {
  env: AppEnv;
  /** Session store; defaults to the Postgres store on the shared pool. */
  sessionStore?: session.Store;
}

function securityHeaders(env: AppEnv): HelmetOptions {
  return {
    contentSecurityPolicy:
      env.NODE_ENV === "production"
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'", "'unsafe-inline'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: [
                "'self'",
                "data:",
                "blob:",
                "https://*.r2.dev",
                "https://*.r2.cloudflarestorage.com",
                "https://maps.googleapis.com",
                "https://maps.gstatic.com",
              ],
              connectSrc: ["'self'"],
              fontSrc: ["'self'", "data:"],
              objectSrc: ["'none'"],
              mediaSrc: ["'self'"],
              frameSrc: ["'self'"],
            },
          }
        : false,
    crossOriginEmbedderPolicy: false,
  };
}

const apiRateLimiter = () =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    message: "Too many requests from this IP, please try again later.",
    standardHeaders: true,
    legacyHeaders: false,
    skipFailedRequests: true,
  });

/**
 * Build the Express app: security headers, health probe, rate limiting,
 * sessions, body parsing, uploads and the API routes. It does not listen and
 * does not serve the client (server/index.ts adds Vite or the static build).
 *
 * `env` also becomes the active config for the lazily-created DB pool and
 * cloud storage client (see `setEnv`).
 */
export async function createApp({ env, sessionStore }: CreateAppOptions): Promise<Express> {
  setEnv(env);

  const app = express();
  app.set("env", env.NODE_ENV);
  // Railway (and Cloudflare in front of it) terminate TLS and forward the client IP.
  app.set("trust proxy", env.TRUST_PROXY);

  app.use(helmet(securityHeaders(env)));

  // Ahead of the rate limiter and sessions: probes are never throttled and never touch the session table.
  app.use(
    createHealthRouter({
      version: appVersion(env),
      pingDb: () => getPool().query("SELECT 1"),
      // What this process applied at boot (absent when the app was built without booting, e.g. in tests).
      extraChecks: async () => {
        const migrations = getBootMigrationStatus();
        return migrations ? { migrations } : {};
      },
    }),
  );

  app.use("/api/", apiRateLimiter());
  app.use(createSessionMiddleware(env, sessionStore));
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use("/uploads", express.static("uploads"));
  app.use(requestLogger);

  registerRoutes(app);

  app.use(errorHandler);
  return app;
}
