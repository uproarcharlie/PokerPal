import express, { type Express } from "express";
import multer from "multer";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { asyncHandler } from "./async-handler";
import { apiNotFound, errorHandler, HttpError, toHttpError } from "./errors";

/** node-postgres's DatabaseError carries these fields; the mapper reads nothing else. */
function pgError(code: string, constraint?: string): Error {
  return Object.assign(new Error(`internal detail for ${code}`), { code, constraint, severity: "ERROR" });
}

function appThrowing(error: unknown): Express {
  const app = express();
  app.use(express.json({ limit: "1kb" }));
  app.post("/boom", (_req, _res, next) => next(error));
  app.get("/items/:id", (req, res) => res.json({ id: req.params.id }));
  app.get(
    "/async",
    asyncHandler(async () => {
      throw error;
    }),
  );
  app.use("/api", apiNotFound);
  app.use(errorHandler);
  return app;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("toHttpError", () => {
  it("keeps an HttpError as it is", () => {
    const error = new HttpError(409, "TOURNAMENT_FULL", "The tournament is full", { maxPlayers: 40 });

    expect(toHttpError(error)).toBe(error);
  });

  it("answers a ZodError with 400 VALIDATION and the issues as details", () => {
    const parsed = z.object({ name: z.string() }).safeParse({ name: 1 });
    if (parsed.success) throw new Error("expected a failure");

    const error = toHttpError(parsed.error);

    expect(error).toMatchObject({ status: 400, code: "VALIDATION", message: "Invalid request" });
    expect(error.details).toEqual([expect.objectContaining({ path: ["name"] })]);
  });

  it.each([
    ["23505", "clubs_slug_key", 409, "SLUG_TAKEN"],
    ["23505", "clubs_slug_unique", 409, "SLUG_TAKEN"],
    ["23505", "users_email_unique", 409, "EMAIL_TAKEN"],
    ["23505", "uq_club_managers_club_user", 409, "ALREADY_MANAGER"],
    ["23505", "some_other_unique", 409, "CONFLICT"],
    ["23503", "fk_x", 409, "FK_VIOLATION"],
    ["23514", "ck_x", 400, "CHECK_VIOLATION"],
    ["22P02", undefined, 400, "VALIDATION"],
    ["22003", undefined, 400, "VALIDATION"],
    // A NUL byte (%00) in a path id or query, which Postgres cannot store (P2REV0-07).
    ["22021", undefined, 400, "VALIDATION"],
    ["22P05", undefined, 400, "VALIDATION"],
    ["40P01", undefined, 409, "RETRY"],
    ["40001", undefined, 409, "RETRY"],
  ])("maps Postgres %s (%s) to %i %s without leaking the database's message", (code, constraint, status, apiCode) => {
    const error = toHttpError(pgError(code, constraint));

    expect(error).toMatchObject({ status, code: apiCode });
    expect(error.message).not.toContain("internal detail");
  });

  it("finds a Postgres error wrapped as the cause of another error", () => {
    const wrapped = new Error("query failed", { cause: pgError("23505", "users_email_unique") });

    expect(toHttpError(wrapped)).toMatchObject({ status: 409, code: "EMAIL_TAKEN" });
  });

  it("treats an unrecognised Postgres error as a 500", () => {
    expect(toHttpError(pgError("57014"))).toMatchObject({ status: 500, code: "INTERNAL" });
  });

  it("maps multer's file-size limit to 413 and its other errors to 400", () => {
    expect(toHttpError(new multer.MulterError("LIMIT_FILE_SIZE", "image"))).toMatchObject({
      status: 413,
      code: "FILE_TOO_LARGE",
    });
    expect(toHttpError(new multer.MulterError("LIMIT_UNEXPECTED_FILE", "other"))).toMatchObject({
      status: 400,
      code: "VALIDATION",
    });
  });

  it("keeps a 4xx http-errors status, showing its message only when exposed, and never a 5xx one", () => {
    const exposed = Object.assign(new Error("unsupported charset \"X\""), { status: 415, expose: true });
    const hidden = Object.assign(new Error("secret"), { status: 400, expose: false });
    const server = Object.assign(new Error("secret"), { status: 502, expose: true });

    expect(toHttpError(exposed)).toMatchObject({ status: 415, code: "UNSUPPORTED_MEDIA_TYPE", message: 'unsupported charset "X"' });
    expect(toHttpError(hidden)).toMatchObject({ status: 400, code: "VALIDATION", message: "Bad Request" });
    expect(toHttpError(server)).toMatchObject({ status: 500, code: "INTERNAL" });
  });

  it("answers serve-static's missing file with 404, without the path on disk", () => {
    const missing = Object.assign(new Error("ENOENT: no such file or directory, stat '/srv/app/uploads/x.webp'"), {
      code: "ENOENT",
      status: 404,
      statusCode: 404,
      expose: false,
    });

    expect(toHttpError(missing)).toMatchObject({ status: 404, code: "NOT_FOUND", message: "Not Found" });
  });

  it("answers anything else with a 500 that says nothing about the cause", () => {
    const error = toHttpError(new Error("password=hunter2 in a stack trace"));

    expect(error).toMatchObject({ status: 500, code: "INTERNAL" });
    expect(error.message).not.toContain("hunter2");
    expect(toHttpError("a string")).toMatchObject({ status: 500, code: "INTERNAL" });
    expect(toHttpError(null)).toMatchObject({ status: 500, code: "INTERNAL" });
  });
});

describe("errorHandler", () => {
  it("answers { error, code, details } with the error's status", async () => {
    const app = appThrowing(new HttpError(409, "ALREADY_REGISTERED", "Already registered", { registrationId: "r1" }));

    const response = await request(app).post("/boom");

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "Already registered", code: "ALREADY_REGISTERED", details: { registrationId: "r1" } });
  });

  it("leaves details out when there are none", async () => {
    const response = await request(appThrowing(new HttpError(403, "FORBIDDEN", "No"))).post("/boom");

    expect(response.body).toEqual({ error: "No", code: "FORBIDDEN" });
  });

  it("handles a rejection from an asyncHandler", async () => {
    const response = await request(appThrowing(new HttpError(404, "NOT_FOUND", "Tournament not found"))).get("/async");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Tournament not found", code: "NOT_FOUND" });
  });

  it("answers malformed JSON with 400 BAD_JSON", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const response = await request(appThrowing(new Error("unused")))
      .post("/boom")
      .set("Content-Type", "application/json")
      .send('{"name": ');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "The request body is not valid JSON", code: "BAD_JSON" });
  });

  it("answers a body over the JSON limit with 413 PAYLOAD_TOO_LARGE", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const response = await request(appThrowing(new Error("unused")))
      .post("/boom")
      .send({ name: "x".repeat(2048) });

    expect(response.status).toBe(413);
    expect(response.body).toEqual({ error: "The request body is too large", code: "PAYLOAD_TOO_LARGE" });
  });

  it("answers a path parameter that is not valid percent-encoding with 400, not 500", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await request(appThrowing(new Error("unused"))).get("/items/%E0%A4%A");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "The URL is malformed", code: "VALIDATION" });
    expect(logged).not.toHaveBeenCalled();
  });

  it("logs one line for a 4xx, and none for a 429 (the limiters log those themselves)", async () => {
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});

    await request(appThrowing(new HttpError(403, "FORBIDDEN", "No"))).post("/boom");
    await request(appThrowing(new HttpError(429, "RATE_LIMITED", "Slow down"))).post("/boom");

    expect(warned.mock.calls).toEqual([["POST /boom → 403 FORBIDDEN: No"]]);
  });

  it("logs a 500 with the original error but sends only a generic message", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const original = new Error("connection string postgres://user:pw@host/db");

    const response = await request(appThrowing(original)).post("/boom");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "Something went wrong on our side. Please try again.", code: "INTERNAL" });
    expect(JSON.stringify(response.body)).not.toContain("postgres://");
    expect(logged).toHaveBeenCalledWith("POST /boom failed:", original);
  });
});

describe("apiNotFound", () => {
  it("answers an unknown /api path with a JSON 404", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const response = await request(appThrowing(new Error("unused"))).get("/api/registrations");

    expect(response.status).toBe(404);
    expect(response.headers["content-type"]).toMatch(/^application\/json/);
    expect(response.body).toEqual({ error: "No such API endpoint", code: "NOT_FOUND" });
  });
});
