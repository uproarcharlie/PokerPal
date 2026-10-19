/**
 * The platform around the routes, through the real createApp (server/app.ts): what runs before the
 * session and what never touches it, how visitors are told apart behind Cloudflare, the separate
 * budget for live polling, which bodies are parsed, and the error shape of what the platform refuses.
 */
import type { Express } from "express";
import session from "express-session";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../server/app";
import { loadEnv } from "../../server/config/env";
import type { RateLimiterName } from "../../server/http/rate-limits";
import { createClub, createTournament, createUser, FACTORY_PASSWORD } from "../factories";

/** A Cloudflare edge address, as Railway's edge reports the hop in front of it (trust proxy 1). */
const CLOUDFLARE_EDGE = "172.68.10.20";
const VISITOR = "203.0.113.7";
const OTHER_VISITOR = "198.51.100.9";
const viaCloudflare = (visitor: string) => ({ "X-Forwarded-For": CLOUDFLARE_EDGE, "CF-Connecting-IP": visitor });

/** A session store that counts reads, to see which requests look a session up. */
class CountingStore extends session.MemoryStore {
  reads = 0;

  override get(sid: string, callback: (err: unknown, session?: session.SessionData | null) => void): void {
    this.reads++;
    super.get(sid, callback);
  }
}

function appWith(options: { store?: session.Store; limits?: Partial<Record<RateLimiterName, number>> } = {}) {
  return createApp({
    env: loadEnv(process.env),
    sessionStore: options.store ?? new session.MemoryStore(),
    rateLimits: options.limits ? { enabled: true, limits: options.limits } : undefined,
  });
}

/** An agent on `app` with a session cookie for a new factory user. */
async function signedInAgent(app: Express, headers: Record<string, string> = {}) {
  const user = await createUser();
  const agent = request.agent(app);
  const login = await agent.post("/api/auth/login").set(headers).send({ email: user.email, password: FACTORY_PASSWORD });
  expect(login.status).toBe(200);
  return agent;
}

beforeEach(() => {
  // The error handler's one line per refused request; asserted where it matters.
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("what runs before the session", () => {
  it("the health probe, /uploads and the client's own paths never look a session up; /api does", async () => {
    const store = new CountingStore();
    const app = await appWith({ store });
    const agent = await signedInAgent(app);
    store.reads = 0;

    expect((await agent.get("/api/health")).status).toBe(200);
    expect((await agent.get("/uploads/players/no-such-photo.webp")).status).toBe(404);
    await agent.get("/some/client/route");
    expect(store.reads).toBe(0);

    expect((await agent.get("/api/no-such-endpoint")).status).toBe(404);
    expect(store.reads).toBe(1);
  });

  it("a missing upload is a 404, never the client's index.html served after the app (img-06)", async () => {
    const app = await appWith();
    // What server/vite.ts's serveStatic mounts after createApp in production.
    app.use("*", (_req, res) => {
      res.status(200).type("html").send("<!doctype html><div id=root></div>");
    });

    const response = await request(app).get("/uploads/players/no-such-photo.webp");

    expect(response.status).toBe(404);
    expect(response.text).not.toContain("<div id=root>");
  });
});

describe("visitors behind Cloudflare", () => {
  it("are told apart by CF-Connecting-IP, which only a Cloudflare edge is believed about (CC-04)", async () => {
    const app = await appWith({ limits: { globalApi: 1 } });

    expect((await request(app).get("/api/clubs").set(viaCloudflare(VISITOR))).status).toBe(200);
    const limited = await request(app).get("/api/clubs").set(viaCloudflare(VISITOR));
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ error: "Too many requests, please try again later.", code: "RATE_LIMITED" });
    expect(limited.headers).toHaveProperty("retry-after");

    // Another visitor through Cloudflare has a budget of their own...
    expect((await request(app).get("/api/clubs").set(viaCloudflare(OTHER_VISITOR))).status).toBe(200);
    // ...but a caller reaching the origin directly is keyed by its own address, whatever header it sends.
    const direct = { "X-Forwarded-For": OTHER_VISITOR, "CF-Connecting-IP": "192.0.2.50" };
    expect((await request(app).get("/api/clubs").set(direct)).status).toBe(429);
  });

  it("once CLOUDFLARE_ORIGIN_SECRET is set, cannot pick a fresh key per request from someone else's Cloudflare Worker (P2REV0-03)", async () => {
    const secret = "zone-secret-0123456789";
    const app = await createApp({
      env: loadEnv({ ...process.env, CLOUDFLARE_ORIGIN_SECRET: secret }),
      sessionStore: new session.MemoryStore(),
      rateLimits: { enabled: true, limits: { globalApi: 1 } },
    });
    const throughZone = (visitor: string) => ({ ...viaCloudflare(visitor), "X-Origin-Auth": secret });

    expect((await request(app).get("/api/clubs").set(throughZone(VISITOR))).status).toBe(200);
    expect((await request(app).get("/api/clubs").set(throughZone(OTHER_VISITOR))).status).toBe(200);
    // A Worker elsewhere: a Cloudflare address, a new CF-Connecting-IP each time, no secret. All one bucket: the edge's.
    expect((await request(app).get("/api/clubs").set(viaCloudflare("192.0.2.1"))).status).toBe(200);
    expect((await request(app).get("/api/clubs").set(viaCloudflare("192.0.2.2"))).status).toBe(429);
  });
});

describe("live polling", () => {
  async function registrationsUrl() {
    const tournament = await createTournament({ clubId: (await createClub()).id });
    return `/api/tournaments/${tournament.id}/registrations`;
  }

  it("has its own budget, so phones polling a tournament never use up page loads and sign-ups", async () => {
    const app = await appWith({ limits: { globalApi: 1, live: 3 } });
    const poll = await registrationsUrl();

    for (let i = 0; i < 3; i++) expect((await request(app).get(poll).set(viaCloudflare(VISITOR))).status).toBe(200);
    expect((await request(app).get("/api/clubs").set(viaCloudflare(VISITOR))).status).toBe(200);

    expect((await request(app).get(poll).set(viaCloudflare(VISITOR))).status).toBe(429);
    expect((await request(app).get("/api/clubs").set(viaCloudflare(VISITOR))).status).toBe(429);
  });

  it("gives a signed-in user a bucket of their own beside the venue's shared address", async () => {
    const app = await appWith({ limits: { live: 2 } });
    const poll = await registrationsUrl();
    const td = await signedInAgent(app, viaCloudflare(VISITOR));

    for (let i = 0; i < 2; i++) expect((await request(app).get(poll).set(viaCloudflare(VISITOR))).status).toBe(200);
    expect((await request(app).get(poll).set(viaCloudflare(VISITOR))).status).toBe(429);

    expect((await td.get(poll).set(viaCloudflare(VISITOR))).status).toBe(200);
  });
});

describe("request bodies", () => {
  it("are parsed as JSON only: a form-encoded or text/plain sign-in signs no one in (CC-13)", async () => {
    const app = await appWith();
    const user = await createUser();
    const credentials = { email: user.email, password: FACTORY_PASSWORD };

    for (const response of [
      await request(app).post("/api/auth/login").type("form").send(credentials),
      await request(app).post("/api/auth/login").type("text/plain").send(JSON.stringify(credentials)),
    ]) {
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
      expect(response.headers["set-cookie"]).toBeUndefined();
      expect(response.body).toEqual(expect.objectContaining({ error: expect.any(String), code: expect.any(String) }));
    }
  });

  it("answers malformed JSON with 400 BAD_JSON on any /api path, before any route runs", async () => {
    const app = await appWith();

    for (const path of ["/api/clubs", "/api/no-such-endpoint"]) {
      const response = await request(app).post(path).set("Content-Type", "application/json").send('{"name": ');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "The request body is not valid JSON", code: "BAD_JSON" });
    }
  });

  it("answers a JSON body over 100 kB with 413", async () => {
    const response = await request(await appWith())
      .post("/api/auth/login")
      .send({ email: "someone@example.test", password: "x".repeat(150_000) });

    expect(response.status).toBe(413);
    expect(response.body).toEqual({ error: "The request body is too large", code: "PAYLOAD_TOO_LARGE" });
  });
});

describe("what the platform refuses", () => {
  it("answers a malformed URL with 400 in the usual error shape, not a 500", async () => {
    const response = await request(await appWith()).get("/api/clubs/%E0%A4%A");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "The URL is malformed", code: "VALIDATION" });
  });

  it("answers a NUL byte (%00) in a path id or a search with 400, not a logged 500 (P2REV0-07)", async () => {
    const app = await appWith();
    const tournament = await createTournament({ clubId: (await createClub()).id });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const responses = [
      await request(app).get("/api/clubs/%00"),
      await request(app).get("/api/clubs/slug/%00"),
      await request(app).get("/api/tournaments/abc%00def/registrations"),
      await request(app).get(`/api/public/tournaments/${tournament.id}/players?q=%00`),
    ];

    for (const response of responses) {
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "A value contains characters that are not allowed", code: "VALIDATION" });
    }
    expect(error).not.toHaveBeenCalled();
  });

  it("sends the security headers on every response, errors and the health probe included", async () => {
    const app = await appWith();

    for (const response of [
      await request(app).get("/api/health"),
      await request(app).get("/api/no-such-endpoint"),
      await request(app).post("/api/clubs").set("Content-Type", "application/json").send("{"),
    ]) {
      expect(response.headers).toMatchObject({
        "x-content-type-options": "nosniff",
        "x-frame-options": "SAMEORIGIN",
        "strict-transport-security": expect.stringContaining("max-age="),
      });
      expect(response.headers).not.toHaveProperty("x-powered-by");
    }
  });
});
