/**
 * The app-level wiring around the routes (server/app.ts): the JSON 404 for unknown API paths, the
 * global /api rate limiter and how the signed-in user is attached (loadUser) for the guards in server/http/authz.ts.
 */
import express from "express";
import session from "express-session";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { loadEnv } from "../../server/config/env";
import { loadUser } from "../../server/http/authz";
import { createUser } from "../factories";
import { getApp, UNKNOWN_ID } from "../helpers";

describe("unknown API paths", () => {
  it("answer a JSON 404, whatever the method (BUG-19)", async () => {
    const app = await getApp();

    for (const response of [
      await request(app).get("/api/no-such-endpoint"),
      await request(app).post("/api/clubs/some-id/no-such-action").send({}),
      await request(app).delete("/api/players"),
    ]) {
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: "No such API endpoint", code: "NOT_FOUND" });
    }
  });

  it("leave paths outside /api to whatever is mounted after the app (the client in production)", async () => {
    const response = await request(await getApp()).get("/some/client/route");

    expect(response.status).toBe(404);
    expect(response.headers["content-type"]).not.toMatch(/json/);
  });
});

describe("the global /api rate limiter", () => {
  const limitedApp = (globalApi: number) =>
    createApp({
      env: loadEnv(process.env),
      sessionStore: new session.MemoryStore(),
      rateLimits: { enabled: true, limits: { globalApi } },
    });

  it("counts every request, failures included, then answers 429 (SEC-10)", async () => {
    const app = await limitedApp(2);

    expect((await request(app).get("/api/no-such-endpoint")).status).toBe(404);
    expect((await request(app).get("/api/clubs")).status).toBe(200);
    const limited = await request(app).get("/api/clubs");

    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ error: "Too many requests, please try again later.", code: "RATE_LIMITED" });
  });

  it("never counts the health probe", async () => {
    const app = await limitedApp(1);

    for (let attempt = 0; attempt < 3; attempt++) expect((await request(app).get("/api/health")).status).toBe(200);
    expect((await request(app).get("/api/clubs")).status).toBe(200);
  });

  it("is off under NODE_ENV=test unless a test turns it on", async () => {
    const app = await getApp();

    const response = await request(app).get("/api/clubs");

    expect(response.headers["ratelimit-policy"]).toBeUndefined();
    expect(response.headers["ratelimit"]).toBeUndefined();
  });
});

describe("loadUser, as the app mounts it", () => {
  /** A session the test can point at any user id, then what loadUser made of it. */
  function probeApp() {
    const app = express();
    app.use(session({ secret: "test", resave: false, saveUninitialized: false, store: new session.MemoryStore() }));
    app.post("/session", express.json(), (req, res) => {
      Object.assign(req.session, req.body);
      res.sendStatus(204);
    });
    app.get("/probe", loadUser, (req, res) => {
      res.json({ user: req.user ?? null, impersonatorId: req.impersonatorId ?? null, sessionUserId: req.session?.userId ?? null });
    });
    return request.agent(app);
  }

  it("attaches an active user as id, email, name and role", async () => {
    const user = await createUser({ role: "admin" });
    const agent = probeApp();
    await agent.post("/session").send({ userId: user.id });

    const response = await agent.get("/probe");

    expect(response.body).toEqual({
      user: { id: user.id, email: user.email, name: user.name, role: "admin" },
      impersonatorId: null,
      sessionUserId: user.id,
    });
  });

  it("records the admin behind an impersonation", async () => {
    const admin = await createUser({ role: "admin" });
    const target = await createUser();
    const agent = probeApp();
    await agent.post("/session").send({ userId: target.id, originalAdminId: admin.id });

    const response = await agent.get("/probe");

    expect(response.body).toMatchObject({ user: { id: target.id }, impersonatorId: admin.id });
  });

  it("attaches nobody for a deactivated or missing user, and leaves their session alone", async () => {
    const disabled = await createUser({ isActive: false });

    for (const userId of [disabled.id, UNKNOWN_ID]) {
      const agent = probeApp();
      await agent.post("/session").send({ userId });

      const first = await agent.get("/probe");
      const second = await agent.get("/probe");

      expect(first.body).toEqual({ user: null, impersonatorId: null, sessionUserId: userId });
      expect(second.body).toEqual(first.body);
    }
  });

  it("attaches nobody without a session", async () => {
    const response = await probeApp().get("/probe");

    expect(response.body).toEqual({ user: null, impersonatorId: null, sessionUserId: null });
  });
});
