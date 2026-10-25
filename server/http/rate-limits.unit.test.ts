import express, { type Express, type Request, type RequestHandler } from "express";
import { MemoryStore } from "express-rate-limit";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "./errors";
import {
  bodyEmail,
  clientIp,
  createRateLimiters,
  identifyVisitor,
  isCloudflareIp,
  isLiveApiRequest,
  isLiveOpsRequest,
  RATE_LIMIT_KEYS,
  RATE_LIMIT_WINDOWS,
  RATE_LIMITS,
  rateLimitsEnabled,
  rateLimitsFor,
  type RateLimiterName,
} from "./rate-limits";

const CLOUDFLARE_EDGE = "172.68.10.20";
const VISITOR = "203.0.113.7";
const OTHER_VISITOR = "198.51.100.9";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * A minimal app with `trust proxy 1`, as in production: the X-Forwarded-For entry plays the address
 * of the proxy in front of us (a Cloudflare edge, or a client hitting the origin directly).
 */
function appWith(...handlers: RequestHandler[]): Express {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.post("/ip", (req, res) => res.json({ ip: clientIp(req) }));
  const answer: RequestHandler = (req, res) => {
    const body = req.body as { fail?: boolean };
    res.status(body.fail ? 401 : 200).json({ ok: !body.fail });
  };
  app.post("/limited", ...handlers, answer);
  app.post("/limited/:id", ...handlers, answer);
  app.use(errorHandler);
  return app;
}

const viaCloudflare = (visitor: string) => ({ "X-Forwarded-For": CLOUDFLARE_EDGE, "CF-Connecting-IP": visitor });

describe("clientIp", () => {
  it("believes CF-Connecting-IP when the request came from a Cloudflare edge", async () => {
    const response = await request(appWith()).post("/ip").set(viaCloudflare(VISITOR));

    expect(response.body.ip).toBe(VISITOR);
  });

  it("ignores CF-Connecting-IP from anyone else, so a direct caller cannot choose its own key", async () => {
    const response = await request(appWith())
      .post("/ip")
      .set({ "X-Forwarded-For": OTHER_VISITOR, "CF-Connecting-IP": VISITOR });

    expect(response.body.ip).toBe(OTHER_VISITOR);
  });

  it("uses req.ip when there is no header, and unwraps IPv4-mapped addresses", () => {
    const req = (ip: string, header?: string) =>
      ({ ip, socket: {}, get: (name: string) => (name.toLowerCase() === "cf-connecting-ip" ? header : undefined) }) as unknown as Request;

    expect(clientIp(req(`::ffff:${VISITOR}`))).toBe(VISITOR);
    expect(clientIp(req(`::ffff:${CLOUDFLARE_EDGE}`, VISITOR))).toBe(VISITOR);
    expect(clientIp(req(CLOUDFLARE_EDGE, "not an address"))).toBe(CLOUDFLARE_EDGE);
  });

  describe("with CLOUDFLARE_ORIGIN_SECRET set (P2REV0-03)", () => {
    const SECRET = "zone-secret-0123456789";
    /** The app as createApp mounts it: identifyVisitor first, with the env's secret. */
    function zoneApp(env: { NODE_ENV: "test" | "production"; CLOUDFLARE_ORIGIN_SECRET?: string }) {
      const app = express();
      app.set("trust proxy", 1);
      app.use(identifyVisitor(env));
      app.get("/ip", (req, res) => res.json({ ip: clientIp(req) }));
      return app;
    }

    it("believes CF-Connecting-IP only from a request carrying the zone's secret, compared exactly", async () => {
      const app = zoneApp({ NODE_ENV: "test", CLOUDFLARE_ORIGIN_SECRET: SECRET });

      const throughZone = await request(app).get("/ip").set({ ...viaCloudflare(VISITOR), "X-Origin-Auth": SECRET });
      // Another Cloudflare customer's Worker calling the origin: a Cloudflare address, a header of its own choosing.
      const otherWorker = await request(app).get("/ip").set(viaCloudflare(VISITOR));
      const guessed = await request(app).get("/ip").set({ ...viaCloudflare(VISITOR), "X-Origin-Auth": `${SECRET}x` });

      expect(throughZone.body.ip).toBe(VISITOR);
      expect(otherWorker.body.ip).toBe(CLOUDFLARE_EDGE);
      expect(guessed.body.ip).toBe(CLOUDFLARE_EDGE);
    });

    it("still refuses the header from a peer outside Cloudflare, even with the secret", async () => {
      const app = zoneApp({ NODE_ENV: "test", CLOUDFLARE_ORIGIN_SECRET: SECRET });

      const response = await request(app).get("/ip").set({ "X-Forwarded-For": OTHER_VISITOR, "CF-Connecting-IP": VISITOR, "X-Origin-Auth": SECRET });

      expect(response.body.ip).toBe(OTHER_VISITOR);
    });

    it("says at a production boot when the secret is not set, and keeps the Cloudflare-address rule until it is", async () => {
      const warn = vi.mocked(console.warn);
      const app = zoneApp({ NODE_ENV: "production" });

      expect(warn).toHaveBeenCalledWith(expect.stringContaining("CLOUDFLARE_ORIGIN_SECRET is not set"));
      expect((await request(app).get("/ip").set(viaCloudflare(VISITOR))).body.ip).toBe(VISITOR);
    });
  });

  it("knows Cloudflare's IPv4 and IPv6 ranges", () => {
    expect(isCloudflareIp("104.16.0.1")).toBe(true);
    expect(isCloudflareIp("2606:4700::6810:84e5")).toBe(true);
    expect(isCloudflareIp(VISITOR)).toBe(false);
    expect(isCloudflareIp("2001:db8::1")).toBe(false);
    expect(isCloudflareIp("garbage")).toBe(false);
  });
});

describe("createRateLimiters", () => {
  it("is off under NODE_ENV=test unless a test turns it on", async () => {
    const off = createRateLimiters({ NODE_ENV: "test" });
    const app = appWith(...Object.values(off));

    for (let i = 0; i < 10; i++) expect((await request(app).post("/limited").send({})).status).toBe(200);
  });

  it("defaults to limits sized for a full room on one venue Wi-Fi, with a separate, higher budget for live polling", () => {
    expect(RATE_LIMITS).toEqual({
      globalApi: 3000,
      auth: 10,
      authVisitor: 30,
      authAccount: 30,
      signUp: 5,
      publicWrite: 300,
      upload: 100,
      staffChange: 20,
      clubCreate: 5,
      clubCreateVisitor: 10,
      tournamentCreate: 30,
      tournamentCreateVisitor: 60,
      passwordVisitor: 60,
      signInAccount: 20,
      passwordChange: 10,
      live: 10_000,
      liveOps: 1_500,
    });
    const hour = 60 * 60 * 1000;
    expect(RATE_LIMIT_WINDOWS).toEqual({
      signUp: hour,
      clubCreate: hour,
      clubCreateVisitor: hour,
      tournamentCreate: hour,
      tournamentCreateVisitor: hour,
    });
  });

  it("takes RATE_LIMIT_PUBLIC_WRITE and RATE_LIMIT_LIVE from the env, below a test's own limits (P2-PROD-02)", () => {
    const env = { NODE_ENV: "production" as const, RATE_LIMIT_PUBLIC_WRITE: 900, RATE_LIMIT_LIVE: 20_000 };

    expect(rateLimitsFor(env)).toMatchObject({ publicWrite: 900, live: 20_000, auth: 10, globalApi: 3000 });
    expect(rateLimitsFor(env, { limits: { publicWrite: 2 } }).publicWrite).toBe(2);
    expect(rateLimitsFor({ NODE_ENV: "production" }).publicWrite).toBe(300);
  });

  it("is on outside NODE_ENV=test; RATE_LIMITS_ENABLED and the app's option override that", () => {
    expect(rateLimitsEnabled({ NODE_ENV: "production" })).toBe(true);
    expect(rateLimitsEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(rateLimitsEnabled({ NODE_ENV: "test" })).toBe(false);
    expect(rateLimitsEnabled({ NODE_ENV: "production", RATE_LIMITS_ENABLED: false })).toBe(false);
    expect(rateLimitsEnabled({ NODE_ENV: "test", RATE_LIMITS_ENABLED: true })).toBe(true);
    expect(rateLimitsEnabled({ NODE_ENV: "production", RATE_LIMITS_ENABLED: false }, { enabled: true })).toBe(true);
  });

  it("globalApi counts every request, failures included, per visitor", async () => {
    const { globalApi } = createRateLimiters({ NODE_ENV: "production" }, { limits: { globalApi: 2 } });
    const app = appWith(globalApi);

    await request(app).post("/limited").set(viaCloudflare(VISITOR)).send({ fail: true });
    await request(app).post("/limited").set(viaCloudflare(VISITOR)).send({});
    const third = await request(app).post("/limited").set(viaCloudflare(VISITOR)).send({});
    const otherVisitor = await request(app).post("/limited").set(viaCloudflare(OTHER_VISITOR)).send({});

    expect(third.status).toBe(429);
    expect(third.body).toEqual({ error: "Too many requests, please try again later.", code: "RATE_LIMITED" });
    expect(third.headers).toHaveProperty("retry-after");
    expect(otherVisitor.status).toBe(200);
  });

  it("auth counts only failures, per visitor and email (SEC-10)", async () => {
    const { auth } = createRateLimiters({ NODE_ENV: "production" }, { limits: { auth: 2 } });
    const app = appWith(auth);
    const attempt = (email: string, fail: boolean, visitor = VISITOR) =>
      request(app).post("/limited").set(viaCloudflare(visitor)).send({ email, fail });

    for (let i = 0; i < 5; i++) expect((await attempt("ok@example.test", false)).status).toBe(200);
    expect((await attempt("victim@example.test", true)).status).toBe(401);
    expect((await attempt(" Victim@Example.test ", true)).status).toBe(401);
    const blocked = await attempt("victim@example.test", false);

    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe("RATE_LIMITED");
    expect((await attempt("other@example.test", true)).status).toBe(401);
    expect((await attempt("victim@example.test", true, OTHER_VISITOR)).status).toBe(401);
  });

  it("authVisitor counts one visitor's failures whatever the email, so stuffing many accounts stops (SEC-P2-03)", async () => {
    const { auth, authVisitor } = createRateLimiters({ NODE_ENV: "production" }, { limits: { auth: 100, authVisitor: 3 } });
    const app = appWith(auth, authVisitor);
    const attempt = (n: number, visitor = VISITOR) =>
      request(app).post("/limited").set(viaCloudflare(visitor)).send({ email: `person${n}@example.test`, fail: true });

    for (let n = 0; n < 3; n++) expect((await attempt(n)).status).toBe(401);
    expect((await attempt(99)).status).toBe(429);
    expect((await attempt(100, OTHER_VISITOR)).status).toBe(401);
  });

  it("authAccount counts one email's failures from every address, so one account is never tried at will (SEC-P2-03)", async () => {
    const { auth, authAccount } = createRateLimiters({ NODE_ENV: "production" }, { limits: { auth: 100, authAccount: 3 } });
    const app = appWith(auth, authAccount);
    const attempt = (visitor: string, email = "victim@example.test", fail = true) =>
      request(app).post("/limited").set(viaCloudflare(visitor)).send({ email, fail });

    expect((await attempt("203.0.113.1")).status).toBe(401);
    expect((await attempt("203.0.113.2")).status).toBe(401);
    expect((await attempt("203.0.113.3", " VICTIM@example.test")).status).toBe(401);
    const blocked = await attempt("203.0.113.4", "victim@example.test", false);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/this account/);
    expect((await attempt("203.0.113.4", "someone.else@example.test")).status).toBe(401);
  });

  it("signUp counts every sign-up from a visitor, successful ones too (SEC-P2-03)", async () => {
    const { signUp } = createRateLimiters({ NODE_ENV: "production" }, { limits: { signUp: 2 } });
    const app = appWith(signUp);
    const signUpAs = (n: number, visitor = VISITOR) =>
      request(app).post("/limited").set(viaCloudflare(visitor)).send({ email: `new${n}@example.test` });

    expect((await signUpAs(1)).status).toBe(200);
    expect((await signUpAs(2)).status).toBe(200);
    expect((await signUpAs(3)).status).toBe(429);
    expect((await signUpAs(4, OTHER_VISITOR)).status).toBe(200);
  });

  it("publicWrite gives a signed-in user a bucket of their own instead of skipping them (SEC-P2-02)", async () => {
    const { publicWrite } = createRateLimiters({ NODE_ENV: "production" }, { limits: { publicWrite: 2 } });
    const signedIn: RequestHandler = (req, _res, next) => {
      const id = req.get("x-user");
      if (id) req.user = { id, email: `${id}@x`, name: id, role: "full_member" };
      next();
    };
    const app = appWith(signedIn, publicWrite);
    const write = (headers: Record<string, string> = {}) =>
      request(app).post("/limited").set({ ...viaCloudflare(VISITOR), ...headers }).send({});

    expect((await write()).status).toBe(200);
    expect((await write()).status).toBe(200);
    expect((await write()).status).toBe(429);
    expect((await write({ "x-user": "u1" })).status).toBe(200);
    expect((await write({ "x-user": "u1" })).status).toBe(200);
    expect((await write({ "x-user": "u1" })).status).toBe(429);
    expect((await write({ "x-user": "u2" })).status).toBe(200);
  });

  it("publicWrite counts each tournament's sign-ups and requests apart (TN-01)", async () => {
    const { publicWrite } = createRateLimiters({ NODE_ENV: "production" }, { limits: { publicWrite: 1 } });
    const app = appWith(publicWrite);
    const write = (path: string) => request(app).post(path).set(viaCloudflare(VISITOR)).send({});

    expect((await write("/limited/t1")).status).toBe(200);
    expect((await write("/limited/t1")).status).toBe(429);
    expect((await write("/limited/t2")).status).toBe(200);
    expect((await write("/limited")).status).toBe(200);
  });

  it("upload and staffChange count per signed-in user, else per visitor", async () => {
    const { upload, staffChange } = createRateLimiters({ NODE_ENV: "production" }, { limits: { upload: 1, staffChange: 1 } });
    for (const limiter of [upload, staffChange]) {
      const app = appWith(limiter);
      expect((await request(app).post("/limited").set(viaCloudflare(VISITOR)).send({})).status).toBe(200);
      expect((await request(app).post("/limited").set(viaCloudflare(VISITOR)).send({})).status).toBe(429);
    }
  });
});

/** A MemoryStore that remembers every key it was asked to count. */
class RecordingStore extends MemoryStore {
  readonly keys = new Set<string>();
  override async increment(key: string) {
    this.keys.add(key);
    return super.increment(key);
  }
}

function recordedLimiters(limits: Partial<Record<RateLimiterName, number>>) {
  const stores = new Map<RateLimiterName, RecordingStore>();
  const limiters = createRateLimiters(
    { NODE_ENV: "production" },
    {
      limits,
      storeFor: (name) => {
        const store = new RecordingStore();
        stores.set(name, store);
        return store;
      },
    },
  );
  const keysOf = (name: RateLimiterName) => Array.from(stores.get(name)?.keys ?? []);
  return { limiters, keysOf };
}

describe("limiter keys never hold text the caller chose (P2REV0-SEC-01)", () => {
  const HUGE_EMAIL = `${"a".repeat(95_000)}@example.test`;
  const requestWith = (body: unknown, params: Record<string, string> = {}) =>
    ({ ip: VISITOR, socket: {}, get: () => undefined, body, params }) as unknown as Request;

  it("keys an email by a short digest of its normal form, and one longer than any address as no email", () => {
    const key = RATE_LIMIT_KEYS.visitorAndEmail(requestWith({ email: " Someone@Example.test " }));

    expect(key).toBe(RATE_LIMIT_KEYS.visitorAndEmail(requestWith({ email: "someone@example.test" })));
    expect(key).not.toContain("someone");
    expect(key.length).toBeLessThan(80);
    expect(RATE_LIMIT_KEYS.email(requestWith({ email: "someone@example.test" }))).toMatch(/^email:[A-Za-z0-9_-]{43}$/);
    expect(RATE_LIMIT_KEYS.visitorAndEmail(requestWith({ email: HUGE_EMAIL }))).toBe(RATE_LIMIT_KEYS.visitorAndEmail(requestWith({})));
    expect(bodyEmail(requestWith({ email: HUGE_EMAIL }))).toBe("");
    expect(bodyEmail(requestWith({ email: `${"b".repeat(241)}@example.test` }))).toHaveLength(254);
  });

  it("adds the route's :id to a bucket only when it is a well-formed id", () => {
    expect(RATE_LIMIT_KEYS.userOrVisitorAndResource(requestWith({}, { id: "t-1_A" }))).toBe(`${VISITOR}|t-1_A`);
    expect(RATE_LIMIT_KEYS.userOrVisitorAndResource(requestWith({}, { id: "x".repeat(15_000) }))).toBe(`${VISITOR}|`);
    expect(RATE_LIMIT_KEYS.userOrVisitorAndResource(requestWith({}, { id: "../etc" }))).toBe(`${VISITOR}|`);
  });

  it("stores a bounded number of short keys however many huge, different emails one visitor sends", async () => {
    const { limiters, keysOf } = recordedLimiters({ authVisitor: 5, auth: 100, authAccount: 100 });
    // The sign-in route's order: the visitor's own budget, then per visitor and email, then per email.
    const app = appWith(limiters.authVisitor, limiters.auth, limiters.authAccount);

    const statuses: number[] = [];
    for (let n = 0; n < 20; n++) {
      const response = await request(app).post("/limited").set(viaCloudflare(VISITOR)).send({ email: `${n}${HUGE_EMAIL}`, fail: true });
      statuses.push(response.status);
    }

    expect(statuses).toEqual([...Array<number>(5).fill(401), ...Array<number>(15).fill(429)]);
    expect(keysOf("authVisitor")).toEqual([VISITOR]);
    expect(keysOf("auth")).toEqual([`${VISITOR}|`]);
    expect(keysOf("authAccount")).toEqual([]);
  });

  it("adds no per-email counter for a visitor who is already turned away", async () => {
    const { limiters, keysOf } = recordedLimiters({ authVisitor: 3, auth: 100, authAccount: 100 });
    const app = appWith(limiters.authVisitor, limiters.auth, limiters.authAccount);

    for (let n = 0; n < 10; n++) {
      await request(app).post("/limited").set(viaCloudflare(VISITOR)).send({ email: `guess${n}@example.test`, fail: true });
    }

    expect(keysOf("auth")).toHaveLength(3);
    expect(keysOf("authAccount")).toHaveLength(3);
    for (const key of [...keysOf("auth"), ...keysOf("authAccount")]) expect(key.length).toBeLessThan(80);
  });

  it("does not count against a visitor the attempts a later limiter turned away", async () => {
    const { authVisitor, auth } = createRateLimiters({ NODE_ENV: "production" }, { limits: { authVisitor: 3, auth: 2 } });
    const app = appWith(authVisitor, auth);
    const attempt = (email: string) => request(app).post("/limited").set(viaCloudflare(VISITOR)).send({ email, fail: true });

    expect((await attempt("victim@example.test")).status).toBe(401);
    expect((await attempt("victim@example.test")).status).toBe(401);
    for (let n = 0; n < 5; n++) expect((await attempt("victim@example.test")).body.code).toBe("RATE_LIMITED");

    expect((await attempt("me@example.test")).status).toBe(401);
    expect((await attempt("me-again@example.test")).status).toBe(429);
  });

  it("keys a per-tournament write by the visitor alone when the :id is not an id, before the route looks it up", async () => {
    const { limiters, keysOf } = recordedLimiters({ publicWrite: 100 });
    const app = appWith(limiters.publicWrite);

    for (let n = 0; n < 5; n++) await request(app).post(`/limited/${n}${"x".repeat(5_000)}`).set(viaCloudflare(VISITOR)).send({});

    expect(keysOf("publicWrite")).toEqual([`${VISITOR}|`]);
  });
});

describe("isLiveApiRequest", () => {
  const live = (method: string, path: string) => isLiveApiRequest({ method, baseUrl: "/api", path });

  it("is the GETs the client polls", () => {
    for (const endpoint of [
      "registrations",
      "activity",
      "prize-pool",
      "pending-registrations",
      "confirmed-registrations",
      "pending-actions",
    ]) {
      expect(live("GET", `/tournaments/t1/${endpoint}`)).toBe(true);
    }
    expect(live("HEAD", "/tournaments/t1/registrations/")).toBe(true);
    expect(live("GET", "/Tournaments/t1/Activity")).toBe(true);
    // The public page polls the tournament itself too, for the TD's pool changes and the lock (MONEY-P2REV-02).
    expect(live("GET", "/tournaments/t1")).toBe(true);
  });

  it("is the Phase 4 live screens: the TV display, seating, the seat finder and the season leaderboard", () => {
    expect(live("GET", "/public/tournaments/t1/display")).toBe(true);
    expect(live("GET", "/public/tournaments/t1/seating")).toBe(true);
    expect(live("GET", "/public/seasons/s1/leaderboard")).toBe(true);
    expect(live("GET", "/tournaments/t1/seating")).toBe(true);
    // Round 6: the public page polls the pool the server works out for it.
    expect(live("GET", "/public/tournaments/t1/prizes")).toBe(true);
    expect(live("GET", "/public/tournaments/t1/players")).toBe(false);
    expect(live("GET", "/seasons/s1/leaderboard")).toBe(false);
  });

  it("is never a write, nor any other read", () => {
    expect(live("POST", "/tournaments/t1/registrations")).toBe(false);
    expect(live("POST", "/tournaments/t1/pending-actions")).toBe(false);
    expect(live("PUT", "/tournaments/t1")).toBe(false);
    expect(live("GET", "/tournaments")).toBe(false);
    expect(live("GET", "/tournaments/t1/registrations/extra")).toBe(false);
    expect(live("GET", "/clubs/c1/registrations")).toBe(false);
  });
});

describe("live polling", () => {
  /** An app with the two limiters the app itself mounts on /api, in its order; x-user signs a request in. */
  function pollingApp(limits: { globalApi: number; live: number }) {
    const { globalApi, live } = createRateLimiters({ NODE_ENV: "production" }, { limits });
    const app = express();
    app.set("trust proxy", 1);
    app.use("/api", globalApi);
    app.use("/api", (req, _res, next) => {
      const id = req.get("x-user");
      if (id) req.user = { id, email: `${id}@x`, name: id, role: "full_member" };
      next();
    });
    app.use("/api", live);
    app.get("/api/tournaments/:id/registrations", (_req, res) => res.json([]));
    app.get("/api/tournaments/:id", (_req, res) => res.json({}));
    app.get("/api/clubs/:id", (_req, res) => res.json({}));
    app.use(errorHandler);
    return app;
  }
  const poll = (app: Express, headers: Record<string, string> = {}) =>
    request(app).get("/api/tournaments/t1/registrations").set({ ...viaCloudflare(VISITOR), ...headers });

  it("never uses up the budget page loads and sign-ups draw on", async () => {
    const app = pollingApp({ globalApi: 1, live: 100 });

    for (let i = 0; i < 5; i++) expect((await poll(app)).status).toBe(200);
    for (let i = 0; i < 5; i++) expect((await request(app).get("/api/tournaments/t1").set(viaCloudflare(VISITOR))).status).toBe(200);
    expect((await request(app).get("/api/clubs/c1").set(viaCloudflare(VISITOR))).status).toBe(200);
    expect((await request(app).get("/api/clubs/c1").set(viaCloudflare(VISITOR))).status).toBe(429);
  });

  it("has its own limit per visitor, and a signed-in user's own bucket beside the venue's", async () => {
    const app = pollingApp({ globalApi: 100, live: 2 });

    expect((await poll(app)).status).toBe(200);
    expect((await poll(app)).status).toBe(200);
    const limited = await poll(app);
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe("RATE_LIMITED");

    expect((await poll(app, { "x-user": "td" })).status).toBe(200);
    expect((await poll(app, { "CF-Connecting-IP": OTHER_VISITOR })).status).toBe(200);
  });

  it("logs the first refusal per key and window, not every refused request", async () => {
    const warn = vi.mocked(console.warn);
    const app = pollingApp({ globalApi: 100, live: 1 });

    for (let i = 0; i < 4; i++) await poll(app);

    const refusals = warn.mock.calls.filter(([line]) => String(line).startsWith('Rate limit "live"'));
    expect(refusals).toEqual([[`Rate limit "live" reached by ${VISITOR} (GET /api/tournaments/t1/registrations)`]]);
  });
});


describe("isLiveOpsRequest", () => {
  const ops = (method: string, path: string) => isLiveOpsRequest({ method, baseUrl: "/api", path });

  it("is the TD's live writes: clock, tables, seating and early birds", () => {
    expect(ops("POST", "/tournaments/t1/clock/actions")).toBe(true);
    expect(ops("PUT", "/tournaments/t1/clock")).toBe(true);
    expect(ops("DELETE", "/tournaments/t1/clock")).toBe(true);
    expect(ops("PATCH", "/tournaments/t1/clock/display")).toBe(true);
    expect(ops("POST", "/tournaments/t1/clock/key")).toBe(true);
    expect(ops("DELETE", "/tournaments/t1/clock/key")).toBe(true);
    expect(ops("POST", "/tournaments/t1/tables")).toBe(true);
    expect(ops("PATCH", "/tournaments/t1/tables/tb1")).toBe(true);
    expect(ops("DELETE", "/tournaments/t1/tables/tb1")).toBe(true);
    expect(ops("POST", "/tournaments/t1/tables/tb1/break")).toBe(true);
    for (const action of ["setup", "draw", "assign", "unseat", "balance", "final-table", "undo", "open-table"]) {
      expect(ops("POST", `/tournaments/t1/seating/${action}`)).toBe(true);
    }
    expect(ops("POST", "/tournaments/t1/early-birds")).toBe(true);
  });

  it("is never a read, nor any other write", () => {
    expect(ops("GET", "/tournaments/t1/seating")).toBe(false);
    expect(ops("GET", "/tournaments/t1/clock")).toBe(false);
    expect(ops("PUT", "/tournaments/t1")).toBe(false);
    expect(ops("PUT", "/tournaments/t1/prize-pool/adjustment")).toBe(false);
    expect(ops("POST", "/tournaments/t1/registrations")).toBe(false);
    expect(ops("POST", "/tournaments/t1/seating/explode")).toBe(false);
    expect(ops("OPTIONS", "/tournaments/t1/clock/actions")).toBe(false);
  });
});

describe("the TD's live writes", () => {
  /** The app's three /api limiters in its order; x-user signs a request in. */
  function opsApp(limits: { globalApi: number; live: number; liveOps: number }) {
    const { globalApi, live, liveOps } = createRateLimiters({ NODE_ENV: "production" }, { limits });
    const app = express();
    app.set("trust proxy", 1);
    app.use("/api", globalApi);
    app.use("/api", (req, _res, next) => {
      const id = req.get("x-user");
      if (id) req.user = { id, email: `${id}@x`, name: id, role: "full_member" };
      next();
    });
    app.use("/api", live, liveOps);
    app.post("/api/tournaments/:id/clock/actions", (_req, res) => res.json({}));
    app.get("/api/clubs/:id", (_req, res) => res.json({}));
    app.use(errorHandler);
    return app;
  }
  const pause = (app: Express, headers: Record<string, string> = {}) =>
    request(app).post("/api/tournaments/t1/clock/actions").set({ ...viaCloudflare(VISITOR), ...headers }).send({ action: "pause" });

  it("still go through when the venue's shared budget is spent", async () => {
    const app = opsApp({ globalApi: 1, live: 100, liveOps: 100 });

    expect((await request(app).get("/api/clubs/c1").set(viaCloudflare(VISITOR))).status).toBe(200);
    expect((await request(app).get("/api/clubs/c1").set(viaCloudflare(VISITOR))).status).toBe(429);
    for (let i = 0; i < 3; i++) expect((await pause(app, { "x-user": "td" })).status).toBe(200);
  });

  it("have their own limit per signed-in user, apart from the venue's address", async () => {
    const app = opsApp({ globalApi: 100, live: 100, liveOps: 1 });

    expect((await pause(app, { "x-user": "td" })).status).toBe(200);
    const limited = await pause(app, { "x-user": "td" });
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe("RATE_LIMITED");
    expect((await pause(app, { "x-user": "manager" })).status).toBe(200);
    expect((await pause(app)).status).toBe(200);
    expect((await pause(app)).status).toBe(429);
  });
});
