import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { guardEnv } from "../setup/db-guard";
import { e2eDatabaseName } from "./database";
import { e2eWorkDir } from "./server-env";

declare global {
  interface Window {
    __cspViolations: Array<{ directive: string; blockedUri: string }>;
  }
}

/** Console errors an anonymous visit is expected to log: the auth check is told "nobody" with a 401. */
const EXPECTED_CONSOLE_ERRORS = [{ url: /\/api\/auth\/me$/, text: /status of 401/ }];

/**
 * CSP violations production has today and this behaviour-neutral phase leaves
 * alone. client/src/index.css @imports Google Fonts, which the production
 * `style-src` blocks, so the live site falls back to system fonts. Self-hosting
 * the fonts (branding phase) fixes it; the test then fails until the entry is
 * deleted, so the allowance cannot outlive the bug.
 */
const KNOWN_CSP_VIOLATIONS = [{ directive: "style-src-elem", blockedUri: /^https:\/\/fonts\.googleapis\.com\/css2\?/ }];

test("the landing page loads with no console errors or CSP violations", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const { url } = message.location();
    const text = message.text();
    // CSP reports are checked precisely below, from the securitypolicyviolation events.
    const isCspReport = text.includes("Content Security Policy");
    const expected = EXPECTED_CONSOLE_ERRORS.some((entry) => entry.url.test(url) && entry.text.test(text));
    if (!expected && !isCspReport) consoleErrors.push(`${text} (${url})`);
  });
  page.on("pageerror", (error) => consoleErrors.push(`Uncaught: ${error.message}`));
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      window.__cspViolations.push({ directive: event.effectiveDirective, blockedUri: event.blockedURI || "inline" });
    });
  });

  const response = await page.goto("/");

  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle(/LovePoker\.club/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Run Your Poker Club Like a Pro");
  await page.waitForLoadState("networkidle");

  const violations = await page.evaluate(() => window.__cspViolations);
  const isKnown = (violation: { directive: string; blockedUri: string }, known: (typeof KNOWN_CSP_VIOLATIONS)[number]) =>
    violation.directive === known.directive && known.blockedUri.test(violation.blockedUri);
  expect(violations.filter((violation) => !KNOWN_CSP_VIOLATIONS.some((known) => isKnown(violation, known)))).toEqual([]);
  expect(
    KNOWN_CSP_VIOLATIONS.filter((known) => !violations.some((violation) => isKnown(violation, known))),
    "a known CSP violation no longer happens: delete it from KNOWN_CSP_VIOLATIONS",
  ).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("/api/health reports the app, database and boot migrations as ok", async ({ request }) => {
  const response = await request.get("/api/health");

  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({
    status: "ok",
    db: "ok",
    migrations: { files: expect.any(Number), lastFile: expect.stringMatching(/^\d{4}_/) },
  });
});

test("a visitor who registers is signed in, and still is on the next page load", async ({ page }) => {
  const email = `e2e-${Date.now()}@example.test`;

  const register = await page.request.post("/api/auth/register", { data: { email, password: "E2e-Sturdy-Pass1", name: "E2E Player" } });

  expect(register.status()).toBe(201);
  // Beside it, the known-device mark for this account (TN2-06).
  expect(register.headers()["set-cookie"]).toMatch(/^pokerpal\.sid=.*; Secure/m);
  await page.goto("/");
  const me = await page.evaluate(async () => {
    const response = await fetch("/api/auth/me");
    return { status: response.status, email: ((await response.json()) as { user?: { email?: string } }).user?.email };
  });
  expect(me).toEqual({ status: 200, email });
});

test("a photo uploaded at self-registration is stored in the server's own uploads/, never the repo's", async ({ request }) => {
  const photo = await sharp({ create: { width: 32, height: 24, channels: 3, background: "#c03030" } }).png().toBuffer();

  const response = await request.post("/api/upload/public", {
    multipart: { image: { name: "photo.png", mimeType: "image/png", buffer: photo } },
  });

  expect(response.status()).toBe(200);
  const { imageUrl } = (await response.json()) as { imageUrl: string };
  expect(imageUrl).toMatch(/^\/uploads\/player_avatar\/[0-9a-f-]{36}\/\d+\.webp$/);
  const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
  expect(fs.existsSync(path.join(e2eWorkDir(e2eDatabaseName(guardEnv())), imageUrl))).toBe(true);
  expect(fs.existsSync(path.join(repoRoot, imageUrl))).toBe(false);
  const served = await request.get(imageUrl);
  expect(served.status()).toBe(200);
  expect(served.headers()["content-type"]).toBe("image/webp");
});

/** The first bytes the server sends back for a raw HTTP/1.1 request, or "" if it sends nothing within `ms`. */
function rawResponse(port: number, head: string, ms = 5_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => socket.write(head));
    const timer = setTimeout(() => {
      socket.destroy();
      resolve("");
    }, ms);
    socket.once("data", (chunk) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(chunk.toString("latin1"));
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

// Production has no websockets, so a request asking to upgrade must still reach Express, as it always has.
for (const upgrade of ["websocket", "h2c"]) {
  test(`a request with "Upgrade: ${upgrade}" is answered like any other`, async ({ baseURL }) => {
    const { port } = new URL(baseURL ?? "");

    const head = await rawResponse(
      Number(port),
      `GET /api/health HTTP/1.1\r\nHost: localhost:${port}\r\nConnection: Upgrade\r\nUpgrade: ${upgrade}\r\n\r\n`,
    );

    expect(head).toMatch(/^HTTP\/1\.1 200 OK\r\n/);
  });
}

