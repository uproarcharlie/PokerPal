import express, { type Express } from "express";
import type session from "express-session";
import helmet from "helmet";
import { appVersion, setEnv, type AppEnv } from "./config/env";
import { createSessionMiddleware } from "./config/auth";
import { getPool } from "./db";
import { getBootMigrationStatus } from "./db/migrate";
import { loadUser } from "./http/authz";
import { apiNotFound, errorHandler } from "./http/errors";
import { createRateLimiters, identifyVisitor, type RateLimiterOptions } from "./http/rate-limits";
import { requestLogger } from "./http/request-log";
import { securityHeaders } from "./http/security-headers";
import { createHealthRouter } from "./routes/health";
import { registerRoutes } from "./routes";
import { uploadsStatic } from "./routes/uploads-static";

export interface CreateAppOptions {
  env: AppEnv;
  /** Session store; defaults to the Postgres store on the shared pool. */
  sessionStore?: session.Store;
  /** Rate limiter settings. The limiters are off under NODE_ENV=test unless a test turns them on here. */
  rateLimits?: RateLimiterOptions;
}

/**
 * Build the Express app. It does not listen and does not serve the client: server/index.ts adds Vite
 * or the static build after it, so everything below answers first. In order:
 *
 * 1. security headers, then the health probe: never throttled, never touches a session;
 * 2. /uploads (local disk store): no rate limit, no session lookup per image;
 * 3. the `globalApi` limiter on /api, ahead of the session store so a flood never reaches it. It
 *    counts every request per visitor except live polling;
 * 4. the session, on /api only (nothing else reads it, so asset requests never query Postgres);
 * 5. the signed-in user, then the `live` limiter, which counts live polling per signed-in user (so a
 *    room of phones on the venue's address never throttles the TD) or else per visitor;
 * 6. the JSON body parser (100 kB). There is deliberately no urlencoded parser: the client only sends
 *    JSON and multipart, and a form-encoded body is what lets another site's HTML form sign a visitor
 *    in (CC-13);
 * 7. the routes, then a JSON 404 for any other /api path (never the SPA's index.html), then the
 *    central error handler, which answers every error as `{ error, code, details? }`.
 *
 * The limiters are off under NODE_ENV=test unless `rateLimits` turns them on.
 *
 * `env` also becomes the active config for the lazily-created DB pool and
 * cloud storage client (see `setEnv`).
 */
export async function createApp({ env, sessionStore, rateLimits }: CreateAppOptions): Promise<Express> {
  setEnv(env);

  const app = express();
  app.set("env", env.NODE_ENV);
  // Production is visitor → Cloudflare → Railway's edge → app. TRUST_PROXY (default 1) trusts Railway's
  // edge only, so req.ip and req.secure come from the hop Railway saw: a Cloudflare edge address over
  // https (or the visitor themselves on the *.up.railway.app URL, which bypasses Cloudflare). The
  // visitor's own address is CF-Connecting-IP, which the limiters believe only when req.ip is a
  // Cloudflare address carrying our zone's CLOUDFLARE_ORIGIN_SECRET, once that is set (clientIp in
  // server/http/rate-limits.ts). Keep it at 1: a higher hop count would
  // make req.ip whatever the client put in X-Forwarded-For.
  app.set("trust proxy", env.TRUST_PROXY);
  // The visitor's address, for the limiters and the audit log (rate-limits.ts: clientIp).
  app.use(identifyVisitor(env));

  app.use(helmet(securityHeaders(env)));
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
  app.use(uploadsStatic(env));

  const limiters = createRateLimiters(env, rateLimits);
  app.use("/api", limiters.globalApi);
  app.use("/api", createSessionMiddleware(env, sessionStore));
  app.use("/api", loadUser);
  app.use("/api", limiters.live);
  app.use(express.json());
  app.use(requestLogger);

  registerRoutes(app, { env, limiters });

  app.use("/api", apiNotFound);
  app.use(errorHandler);
  return app;
}
