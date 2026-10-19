import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { asyncHandler } from "./async-handler";
import { errorHandler, HttpError } from "./errors";
import { parseOrThrow, validateBody, validateParams } from "./validate";

afterEach(() => {
  vi.restoreAllMocks();
});

const bodySchema = z.object({ name: z.string().trim().min(1), count: z.coerce.number().int().default(1) });
const querySchema = z.object({ limit: z.coerce.number().int().max(50).default(10) });
const paramsSchema = z.object({ id: z.string().regex(/^[a-z0-9]+$/) });

function app() {
  const server = express();
  server.use(express.json());
  server.post(
    "/items/:id",
    validateParams(paramsSchema),
    validateBody(bodySchema, { message: "Invalid item data" }),
    asyncHandler(async (req, res) => {
      res.json({ params: req.params, query: parseOrThrow(querySchema, req.query), body: req.body });
    }),
  );
  server.use(errorHandler);
  return server;
}

describe("validateBody / validateParams, and a query parsed in the handler", () => {
  it("hands the handler the parsed values: trimmed, coerced, defaulted, unknown keys stripped", async () => {
    const response = await request(app())
      .post("/items/abc?limit=5&extra=1")
      .send({ name: "  Alice  ", paymentConfirmed: true });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      params: { id: "abc" },
      query: { limit: 5 },
      body: { name: "Alice", count: 1 },
    });
  });

  it("answers an invalid body with 400 VALIDATION, the route's message and the zod issues", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const response = await request(app()).post("/items/abc").send({ name: "" });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: "Invalid item data", code: "VALIDATION" });
    expect(response.body.details).toEqual([expect.objectContaining({ path: ["name"] })]);
  });

  it("treats a missing body as an empty object", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const response = await request(app()).post("/items/abc");

    expect(response.status).toBe(400);
    expect(response.body.details).toEqual([expect.objectContaining({ path: ["name"] })]);
  });

  it("refuses a malformed path parameter before the body is read, and a malformed query in the handler", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const badParam = await request(app()).post("/items/ABC!").send({ name: "x" });
    const badQuery = await request(app()).post("/items/abc?limit=500").send({ name: "x" });

    expect(badParam.status).toBe(400);
    expect(badParam.body).toMatchObject({ error: "Invalid request", code: "VALIDATION" });
    expect(badQuery.status).toBe(400);
    expect(badQuery.body.details).toEqual([expect.objectContaining({ path: ["limit"] })]);
  });
});

describe("parseOrThrow", () => {
  it("returns the parsed value", () => {
    expect(parseOrThrow(bodySchema, { name: " Bob ", count: "3" })).toEqual({ name: "Bob", count: 3 });
  });

  it("throws an HttpError 400 carrying the issues", () => {
    let thrown: unknown;
    try {
      parseOrThrow(bodySchema, {}, { message: "Invalid player data" });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(HttpError);
    expect(thrown).toMatchObject({ status: 400, code: "VALIDATION", message: "Invalid player data" });
  });
});

describe("asyncHandler", () => {
  it("passes a rejected promise to the error handler instead of leaving the request hanging", async () => {
    const server = express();
    server.get(
      "/",
      asyncHandler(async () => {
        await Promise.resolve();
        throw new HttpError(409, "CONFLICT", "Taken");
      }),
    );
    server.use(errorHandler);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const response = await request(server).get("/");

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "Taken", code: "CONFLICT" });
  });
});
