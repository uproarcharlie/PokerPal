import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  dateSchema,
  httpUrlSchema,
  idSchema,
  imageUrlSchema,
  limitSchema,
  moneySchema,
  nullableDateSchema,
  optionalMoneySchema,
  optionalText,
} from "./common";
import { safeHttpUrl } from "../domain/urls";
import { isApiErrorBody, isErrorCode } from "./errors";

const ok = <T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown): T => schema.parse(value);
const fails = (schema: z.ZodTypeAny, value: unknown) => expect(schema.safeParse(value).success).toBe(false);

describe("moneySchema", () => {
  it.each([
    ["50", "50.00"],
    [50, "50.00"],
    [2.5, "2.50"],
    ["  12.34 ", "12.34"],
    ["0", "0.00"],
    ["99999999.99", "99999999.99"],
  ])("accepts %j as %j", (input, output) => {
    expect(ok(moneySchema, input)).toBe(output);
  });

  it.each(["-1", "1.234", "abc", "", "1e3", "100000000", NaN, Infinity, null])("refuses %j", (input) => {
    fails(moneySchema, input);
  });

  it("optionalMoneySchema: blank and null store NULL, absent stays absent", () => {
    const schema = z.object({ amount: optionalMoneySchema });

    expect(schema.parse({ amount: "" })).toEqual({ amount: null });
    expect(schema.parse({ amount: null })).toEqual({ amount: null });
    expect(schema.parse({})).toEqual({});
    expect(schema.parse({ amount: 7 })).toEqual({ amount: "7.00" });
  });
});

describe("dates", () => {
  it("dateSchema reads ISO strings and Dates, and refuses invalid ones", () => {
    expect(ok(dateSchema, "2026-10-20T07:00:00.000Z").toISOString()).toBe("2026-10-20T07:00:00.000Z");
    expect(ok(dateSchema, new Date(0)).getTime()).toBe(0);
    fails(dateSchema, "not a date");
    fails(dateSchema, "");
    fails(dateSchema, null);
  });

  it("nullableDateSchema: null and blank are no date, never 1 January 1970 (DATA-22)", () => {
    const schema = z.object({ endDate: nullableDateSchema });

    expect(schema.parse({ endDate: null })).toEqual({ endDate: null });
    expect(schema.parse({ endDate: "  " })).toEqual({ endDate: null });
    expect(schema.parse({})).toEqual({});
    expect(schema.parse({ endDate: "2026-12-31" }).endDate?.toISOString()).toBe("2026-12-31T00:00:00.000Z");
  });
});

describe("text and ids", () => {
  it("optionalText trims, stores NULL for blank, and limits length", () => {
    const schema = z.object({ note: optionalText(5) });

    expect(schema.parse({ note: "  hi  " })).toEqual({ note: "hi" });
    expect(schema.parse({ note: "   " })).toEqual({ note: null });
    fails(schema, { note: "toolong" });
  });

  it("idSchema accepts uuids and short tokens, and refuses anything that could be a path or query", () => {
    expect(ok(idSchema, "3f2b8c1e-1d2a-4c4e-9a43-0f6b1c2d3e4f")).toBe("3f2b8c1e-1d2a-4c4e-9a43-0f6b1c2d3e4f");
    for (const bad of ["", "../x", "a b", "a/b", "x".repeat(65)]) fails(idSchema, bad);
  });

  it("limitSchema coerces, defaults and caps", () => {
    const schema = limitSchema(10, 25);

    expect(schema.parse(undefined)).toBe(10);
    expect(schema.parse("5")).toBe(5);
    fails(schema, "26");
    fails(schema, "0");
  });
});

describe("URLs", () => {
  it("httpUrlSchema keeps http(s) links and refuses script and data URLs (SEC-08)", () => {
    const schema = z.object({ url: httpUrlSchema });

    expect(schema.parse({ url: "https://discord.gg/abc" })).toEqual({ url: "https://discord.gg/abc" });
    expect(schema.parse({ url: "" })).toEqual({ url: null });
    for (const bad of ["javascript:alert(1)", "data:text/html,<b>x</b>", "ftp://x.test/a", "not a url"]) {
      fails(schema, { url: bad });
    }
  });

  it("safeHttpUrl keeps what httpUrlSchema would accept and turns anything else into null (P2REV0-SEC-05)", () => {
    expect(safeHttpUrl("https://discord.gg/abc")).toBe("https://discord.gg/abc");
    expect(safeHttpUrl("  HTTP://Example.test/x  ")).toBe("HTTP://Example.test/x");
    for (const bad of [
      "javascript:alert(1)",
      " javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "ftp://x.test/a",
      "//evil.test/a",
      "https://",
      "not a url",
      "",
      `https://x.test/${"a".repeat(3000)}`,
      null,
      undefined,
    ]) {
      expect(safeHttpUrl(bad)).toBeNull();
    }
  });

  it("imageUrlSchema keeps our upload paths and https URLs, and refuses traversal and other schemes", () => {
    const schema = z.object({ imageUrl: imageUrlSchema });

    for (const good of [
      "/uploads/players/image-1-2.webp",
      "https://pub-abc.r2.dev/player_avatar/8a/512.webp",
      "https://images.lovepoker.club/players/1700000000-photo of me.jpg",
    ]) {
      expect(schema.parse({ imageUrl: good })).toEqual({ imageUrl: good });
    }
    expect(schema.parse({ imageUrl: null })).toEqual({ imageUrl: null });
    for (const bad of [
      "javascript:alert(1)",
      "http://insecure.test/a.png",
      "/uploads/../etc/passwd",
      "/elsewhere/a.png",
      "https://x.test/a/../../b",
    ]) {
      fails(schema, { imageUrl: bad });
    }
  });
});

describe("error bodies", () => {
  it("recognises an API error body and the codes it may carry", () => {
    expect(isApiErrorBody({ error: "Tournament not found", code: "NOT_FOUND" })).toBe(true);
    expect(isApiErrorBody({ message: "legacy" })).toBe(false);
    expect(isApiErrorBody(null)).toBe(false);
    expect(isErrorCode("PRIZE_POOL_LOCKED")).toBe(true);
    expect(isErrorCode("NOPE")).toBe(false);
  });
});
