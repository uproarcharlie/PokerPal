import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHealthRouter } from "../../server/routes/health";
import { getApp } from "../helpers";

describe("GET /api/health", () => {
  it("reports a healthy app and database", async () => {
    const response = await request(await getApp()).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual({
      status: "ok",
      db: "ok",
      version: "dev",
      uptimeSec: expect.any(Number),
    });
  });

  it("answers before the session middleware, so probes never create sessions", async () => {
    const response = await request(await getApp()).get("/api/health");

    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("reveals no configuration or secrets", async () => {
    const response = await request(await getApp()).get("/api/health");
    const body = JSON.stringify(response.body);
    const databaseName = new URL(process.env.DATABASE_URL ?? "").pathname.slice(1);

    expect(body).not.toMatch(/postgres(ql)?:\/\//);
    expect(body).not.toContain(databaseName);
    expect(body).not.toContain(process.env.SESSION_SECRET ?? "unset");
    expect(Object.keys(response.body).sort()).toEqual(["db", "status", "uptimeSec", "version"]);
  });
});

describe("createHealthRouter", () => {
  const appWith = (options: Parameters<typeof createHealthRouter>[0]) => express().use(createHealthRouter(options));
  // Failed checks are logged server-side; keep that out of the test output.
  const consoleError = () => vi.spyOn(console, "error").mockImplementation(() => {});
  afterEach(() => vi.restoreAllMocks());

  it("returns 503 without details when the database does not answer", async () => {
    const logged = consoleError();
    const response = await request(
      appWith({ version: "abc1234", pingDb: () => Promise.reject(new Error("connect ECONNREFUSED 10.0.0.5:5432")) }),
    ).get("/api/health");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: "error", db: "error" });
    expect(logged).toHaveBeenCalledWith("Health check failed:", "connect ECONNREFUSED 10.0.0.5:5432");
  });

  it("returns 503 when the database hangs past the timeout", async () => {
    consoleError();
    const response = await request(appWith({ version: "v", pingDb: () => new Promise(() => {}), timeoutMs: 20 })).get(
      "/api/health",
    );

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: "error", db: "error" });
  });

  it("merges extra readiness checks into the body, and reports 503 with db ok when one fails", async () => {
    consoleError();
    const healthy = await request(
      appWith({ version: "v", pingDb: async () => {}, extraChecks: async () => ({ migrations: { files: 2 } }) }),
    ).get("/api/health");
    const failing = await request(
      appWith({ version: "v", pingDb: async () => {}, extraChecks: () => Promise.reject(new Error("boom")) }),
    ).get("/api/health");

    expect(healthy.body).toMatchObject({ status: "ok", migrations: { files: 2 } });
    expect(failing.status).toBe(503);
    expect(failing.body).toEqual({ status: "error", db: "ok" });
  });
});
