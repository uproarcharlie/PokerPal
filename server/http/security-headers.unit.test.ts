import express from "express";
import helmet from "helmet";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { loadEnv, type AppEnv } from "../config/env";
import { imageStorageOrigin, securityHeaders } from "./security-headers";

const production = (extra: Record<string, string> = {}) =>
  loadEnv({ NODE_ENV: "production", DATABASE_URL: "postgres://localhost/x", SESSION_SECRET: "s", ...extra });

/** A complete R2 configuration whose public URL is a custom domain. */
const r2WithCustomDomain = {
  R2_ACCOUNT_ID: "account",
  R2_ACCESS_KEY_ID: "key",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_BUCKET_NAME: "bucket",
  R2_PUBLIC_URL: "https://images.example.com/uploads",
};

/** The CSP the app would send, as directive → sources. */
async function cspOf(env: AppEnv): Promise<Map<string, string[]>> {
  const app = express();
  app.use(helmet(securityHeaders(env)));
  app.get("/", (_req, res) => res.send("ok"));
  const header = (await request(app).get("/")).headers["content-security-policy"] as string | undefined;
  return new Map(
    (header ?? "")
      .split(";")
      .map((directive) => directive.trim().split(/\s+/))
      .filter(([name]) => name)
      .map(([name, ...sources]) => [name, sources]),
  );
}

describe("imageStorageOrigin", () => {
  it("is the origin of an http(s) R2_PUBLIC_URL, and nothing otherwise", () => {
    expect(imageStorageOrigin("https://images.example.com/uploads/")).toBe("https://images.example.com");
    expect(imageStorageOrigin("https://pub-abc.r2.dev")).toBe("https://pub-abc.r2.dev");
    expect(imageStorageOrigin(undefined)).toBeUndefined();
    expect(imageStorageOrigin("not a url")).toBeUndefined();
    expect(imageStorageOrigin("ftp://images.example.com")).toBeUndefined();
  });
});

describe("the production Content-Security-Policy", () => {
  it("allows images from R2_PUBLIC_URL's origin, r2.dev and Google Maps, never the R2 S3 API host (SEC-17, img-02)", async () => {
    const csp = await cspOf(production(r2WithCustomDomain));

    expect(csp.get("img-src")).toEqual([
      "'self'",
      "data:",
      "blob:",
      "https://images.example.com",
      "https://*.r2.dev",
      "https://maps.googleapis.com",
      "https://maps.gstatic.com",
    ]);
  });

  it("keeps the other image sources when R2_PUBLIC_URL is unset", async () => {
    const csp = await cspOf(production());

    expect(csp.get("img-src")).toEqual([
      "'self'",
      "data:",
      "blob:",
      "https://*.r2.dev",
      "https://maps.googleapis.com",
      "https://maps.gstatic.com",
    ]);
  });

  it("runs only our own scripts and Cloudflare's analytics beacon: no inline script, no inline handlers (SEC-08)", async () => {
    const csp = await cspOf(production());

    expect(csp.get("script-src")).toEqual(["'self'", "https://static.cloudflareinsights.com"]);
    expect(csp.get("script-src-attr")).toEqual(["'none'"]);
    expect(csp.get("object-src")).toEqual(["'none'"]);
    expect(csp.get("default-src")).toEqual(["'self'"]);
  });

  it("lets the analytics beacon Cloudflare adds to each page load and report what it counts, and nothing else leave", async () => {
    const csp = await cspOf(production(r2WithCustomDomain));

    expect(csp.get("script-src")).toContain("https://static.cloudflareinsights.com");
    expect(csp.get("connect-src")).toEqual(["'self'", "https://cloudflareinsights.com"]);
    // Neither is a wildcard or 'unsafe-inline': the beacon is one external file, and stored HTML still runs nothing.
    expect([...(csp.get("script-src") ?? []), ...(csp.get("connect-src") ?? [])].join(" ")).not.toMatch(/\*|unsafe/);
  });

  it("is not sent in development, where Vite injects inline scripts", async () => {
    const csp = await cspOf(loadEnv({ NODE_ENV: "development", DATABASE_URL: "postgres://localhost/x" }));

    expect(csp.size).toBe(0);
  });
});
