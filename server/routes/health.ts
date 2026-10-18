import { Router } from "express";

export interface HealthRouteOptions {
  /** Short build identifier reported as `version`. */
  version: string;
  /** Resolves when the database answers; rejects (or exceeds the timeout) when it does not. */
  pingDb: () => Promise<unknown>;
  /**
   * Extension point for further readiness checks (e.g. applied migrations), run
   * after the DB ping. Returned fields are merged into the healthy body; a
   * rejection reports 503 with `db: "ok"`.
   */
  extraChecks?: () => Promise<Record<string, unknown>>;
  /** Upper bound for each check, so a hung connection fails fast. */
  timeoutMs?: number;
}

// Connection failures surface as an AggregateError with an empty message but a `code` (e.g. ECONNREFUSED).
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const code = (error as NodeJS.ErrnoException).code;
  return error.message || code || error.name;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`health check timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Public liveness/readiness probe used by the Railway healthcheck. Mounted ahead
 * of the session middleware and rate limiter, so it never touches the session
 * table and cannot be throttled. Responses carry no configuration or secrets.
 */
export function createHealthRouter({
  version,
  pingDb,
  extraChecks,
  timeoutMs = 5_000,
}: HealthRouteOptions): Router {
  const router = Router();

  router.get("/api/health", async (_req, res) => {
    res.set("Cache-Control", "no-store");
    let dbOk = false;
    try {
      await withTimeout(pingDb(), timeoutMs);
      dbOk = true;
      const extra = extraChecks ? await withTimeout(extraChecks(), timeoutMs) : {};
      res.json({
        status: "ok",
        db: "ok",
        version,
        uptimeSec: Math.round(process.uptime()),
        ...extra,
      });
    } catch (error) {
      console.error("Health check failed:", describeError(error));
      res.status(503).json({ status: "error", db: dbOk ? "ok" : "error" });
    }
  });

  return router;
}
