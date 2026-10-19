import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestLogger } from "./request-log";

function appWithLog() {
  const app = express();
  app.use(requestLogger);
  app.get("/api/players", (_req, res) => {
    res.json([{ id: "p1", name: "Ann", email: "ann@example.test", phone: "021 555 0101" }]);
  });
  app.get("/assets/app.js", (_req, res) => {
    res.type("js").send("console.log(1)");
  });
  return app;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("requestLogger", () => {
  it("logs an API response's method, path, status and duration, never its body (SEC-31)", async () => {
    const lines = vi.spyOn(console, "log").mockImplementation(() => {});

    await request(appWithLog()).get("/api/players?q=ann");

    expect(lines).toHaveBeenCalledOnce();
    const line = String(lines.mock.calls[0][0]);
    expect(line).toMatch(/\[express\] GET \/api\/players 200 in \d+ms$/);
    expect(line).not.toMatch(/ann@example|021 555|Ann|q=ann/);
  });

  it("leaves non-API requests out", async () => {
    const lines = vi.spyOn(console, "log").mockImplementation(() => {});

    await request(appWithLog()).get("/assets/app.js");

    expect(lines).not.toHaveBeenCalled();
  });
});
