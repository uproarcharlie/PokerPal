import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";
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

/** Collects a page's console errors, uncaught exceptions and CSP violations from its first script on. */
async function watch(page: Page): Promise<{ consoleErrors: string[]; cspViolations: () => Promise<Window["__cspViolations"]> }> {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const { url } = message.location();
    const text = message.text();
    // CSP reports are checked precisely, from the securitypolicyviolation events.
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
  return { consoleErrors, cspViolations: () => page.evaluate(() => window.__cspViolations) };
}

test("the landing page loads with no console errors or CSP violations, in the self-hosted Inter", async ({ page }) => {
  const { consoleErrors, cspViolations } = await watch(page);

  const response = await page.goto("/");

  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle(/LovePoker\.club/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Run Your Poker Club Like a Pro");
  await page.waitForLoadState("networkidle");
  // The font comes from our own origin, so production's `font-src 'self'` lets it load.
  const interLoaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return Array.from(document.fonts).some((face) => face.family.includes("Inter Variable") && face.status === "loaded");
  });
  expect(interLoaded).toBe(true);
  expect(await cspViolations()).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

const PUBLIC_PAGES: Array<{ path: string; ready: (page: Page) => Locator }> = [
  { path: "/home", ready: (page) => page.getByRole("heading", { name: "Upcoming Tournaments" }) },
  { path: "/login", ready: (page) => page.getByRole("button", { name: "Sign In" }) },
  { path: "/register", ready: (page) => page.getByLabel("Email") },
  { path: "/privacy", ready: (page) => page.getByRole("heading", { level: 1, name: "Privacy" }) },
  // An unknown address is a page of its own, not the sign-in screen (each page now loads on demand).
  { path: "/no-such-page", ready: (page) => page.getByRole("heading", { name: "Page not found" }) },
];

for (const { path, ready } of PUBLIC_PAGES) {
  test(`${path} loads on its own with no console errors or CSP violations`, async ({ page }) => {
    const { consoleErrors, cspViolations } = await watch(page);

    const response = await page.goto(path);

    expect(response?.status()).toBe(200);
    await expect(ready(page)).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(path);
    await page.waitForLoadState("networkidle");
    expect(await cspViolations()).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
}

test("a signed-in organiser's staff pages load in the sidebar layout with no console errors or CSP violations", async ({ page }) => {
  const register = await page.request.post("/api/auth/register", {
    data: { email: `e2e-staff-${Date.now()}@example.test`, password: "E2e-Sturdy-Pass1", name: "E2E Organiser" },
  });
  expect(register.status()).toBe(201);
  const { consoleErrors, cspViolations } = await watch(page);

  for (const [path, heading] of [
    ["/clubs", "Club Management"],
    ["/tournaments", "Tournaments"],
    ["/settings", "Settings"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, exact: true }).first()).toBeVisible();
    await expect(page.getByTestId("nav-clubs")).toBeVisible();
  }
  await page.waitForLoadState("networkidle");
  expect(await cspViolations()).toEqual([]);
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

