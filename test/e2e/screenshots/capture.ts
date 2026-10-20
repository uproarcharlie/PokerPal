/**
 * Captures the main pages, each tab of the tabbed ones, at a phone's and a laptop's size: see
 * ./playwright.config.ts for how to run it. One club is built first (test/e2e/support/demo.ts) with
 * its owner, a manager who accepted an invitation and one invitation still open; the public pages are
 * taken signed out and the staff pages as the owner.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { APIRequestContext, Page } from "@playwright/test";
import type { AuthUserResponse } from "../../../shared/api/auth";
import type { CreateStaffInviteResponse } from "../../../shared/api/clubs";
import { expectJson, PASSWORD, PROXY_HEADERS, type Account } from "../support/api";
import { buildDemoClub, type DemoClub } from "../support/demo";
import { expect, test } from "../support/fixtures";
import { choose } from "../support/ui";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const OUT_DIR = path.resolve(REPO_ROOT, process.env.SCREENSHOTS_DIR || "tmp/screenshots");

const VIEWPORTS = [
  { width: 375, height: 812 },
  { width: 1280, height: 800 },
] as const;

let demo: DemoClub;
let owner: Account;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ playwright }, testInfo) => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { baseURL } = testInfo.project.use;
  const ownerApi = await playwright.request.newContext({ baseURL, extraHTTPHeaders: PROXY_HEADERS });
  const managerApi = await playwright.request.newContext({ baseURL, extraHTTPHeaders: PROXY_HEADERS });
  try {
    owner = await signUpAs(ownerApi, "Mere Tawhiri", "mere@harbourside.example");
    demo = await buildDemoClub(ownerApi, {
      slug: "harbourside-poker",
      phoneOf: (index) => `021 ${String(240 + index * 37)} ${String(1180 + index * 613).padStart(4, "0")}`,
    });

    const manager = await signUpAs(managerApi, "Sam Lee", "sam.lee@harbourside.example");
    const { token } = await expectJson<CreateStaffInviteResponse>(
      await ownerApi.post(`/api/clubs/${demo.club.id}/invites`, { data: { email: manager.email, role: "manager" } }),
      201,
    );
    await expectJson(await managerApi.post("/api/staff-invites/accept", { data: { token } }), 200);
    await expectJson(
      await ownerApi.post(`/api/clubs/${demo.club.id}/invites`, { data: { email: "jordan.dealer@example.com", role: "manager" } }),
      201,
    );
  } finally {
    await Promise.all([ownerApi.dispose(), managerApi.dispose()]);
  }
});

/** Signs up an account with a real-looking address (the database is fresh, so it is free). */
async function signUpAs(request: APIRequestContext, name: string, email: string): Promise<Account> {
  const { user } = await expectJson<AuthUserResponse>(await request.post("/api/auth/register", { data: { name, email, password: PASSWORD } }), 201);
  return { id: user.id, name, email, password: PASSWORD };
}

/** Waits for the page to be still (data, fonts, every image, animations that end), then saves all of it. */
async function capture(page: Page, name: string): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.evaluate(async () => {
    // A full-page shot shows images below the fold, which a lazy image would not have loaded yet.
    for (const image of Array.from(document.images)) image.loading = "eager";
    await document.fonts.ready;
    await Promise.all(
      Array.from(document.images, (image) =>
        image.complete
          ? null
          : new Promise((resolve) => {
              image.addEventListener("load", resolve, { once: true });
              image.addEventListener("error", resolve, { once: true });
            }),
      ),
    );
    await Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    );
  });
  const viewport = page.viewportSize() ?? VIEWPORTS[0];
  // Staff pages scroll inside <main> (the sidebar layout is exactly one screen tall), so a full-page
  // shot of the document would stop at the fold: the window is made tall enough to show all of main.
  const fullHeight = await page.evaluate(() => {
    const main = document.querySelector("main");
    return document.documentElement.scrollHeight + (main ? main.scrollHeight - main.clientHeight : 0);
  });
  if (fullHeight > viewport.height) {
    await page.setViewportSize({ width: viewport.width, height: fullHeight });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  }
  await page.screenshot({ path: path.join(OUT_DIR, `${name}-${viewport.width}x${viewport.height}.png`), fullPage: true });
  await page.setViewportSize(viewport);
}

/** Opens each tab of the page's first tab list and captures it as `<name>-<tab>`. */
async function captureTabs(page: Page, name: string): Promise<void> {
  const tabs = page.getByRole("tablist").first().getByRole("tab");
  for (const label of await tabs.allInnerTexts()) {
    const tab = tabs.filter({ hasText: label });
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await capture(page, `${name}-${label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}`);
  }
}

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport, isMobile: viewport.width < 600, hasTouch: viewport.width < 600 });

    test("public pages, signed out", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await capture(page, "landing");

      await page.goto("/login");
      await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
      await capture(page, "login");

      await page.goto(`/club/${demo.club.slug}`);
      await expect(page.getByRole("heading", { name: demo.club.name, exact: true })).toBeVisible();
      await captureTabs(page, "public-club");

      await page.goto(`/tournament/${demo.live.id}`);
      await expect(page.getByRole("heading", { name: demo.live.name, exact: true })).toBeVisible();
      await captureTabs(page, "public-tournament");

      await page.goto(`/register/${demo.upcoming.id}`);
      await page.getByTestId("player-type-new").click();
      await page.getByTestId("step1-next").click();
      await page.getByTestId("player-name").fill("Tama Rangi");
      await capture(page, "qr-signup-new");

      await page.goto(`/register/${demo.upcoming.id}`);
      await page.getByTestId("player-type-existing").click();
      await page.getByTestId("step1-next").click();
      await page.getByTestId("player-search").fill("ra");
      await expect(page.getByRole("list", { name: "Matching players" }).getByRole("button").first()).toBeVisible();
      await capture(page, "qr-signup-existing");

      await page.goto(`/tournaments/${demo.live.id}/actions`);
      await expect(page.getByRole("button", { name: /^Re-buy/ })).toBeVisible();
      await capture(page, "player-actions");
    });

    test("staff pages, as the club's owner", async ({ page }) => {
      await expectJson(await page.request.post("/api/auth/login", { data: { email: owner.email, password: PASSWORD } }), 200);

      await page.goto(`/admin/tournaments/${demo.live.id}`);
      await expect(page.getByRole("heading", { name: demo.live.name, exact: true })).toBeVisible();
      await captureTabs(page, "tournament-admin");

      await page.goto(`/clubs/${demo.club.id}/settings`);
      await expect(page.getByRole("heading", { name: `${demo.club.name} Settings` })).toBeVisible();
      await captureTabs(page, "club-settings");

      await page.goto(`/seasons/${demo.season.id}/settings`);
      await expect(page.getByRole("tab", { name: "Points Systems" })).toBeVisible();
      await captureTabs(page, "season-settings");

      await page.goto(`/leaderboards?season=${demo.season.id}`);
      await expect(page.getByText(demo.players[0]!.name).first()).toBeVisible();
      await capture(page, "leaderboards");

      await page.goto("/players");
      await choose(page, page.getByRole("combobox", { name: "Select Club" }), demo.club.name);
      await expect(page.getByText(demo.players[0]!.name).first()).toBeVisible();
      await capture(page, "players");

      await page.goto("/dashboard");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await capture(page, "dashboard");

      await page.goto("/tournaments");
      await expect(page.getByTestId(`tournament-row-${demo.live.id}`)).toBeVisible();
      await capture(page, "tournaments");

      await page.goto("/clubs");
      await expect(page.getByText(demo.club.name).first()).toBeVisible();
      await capture(page, "clubs");

      await page.goto("/seasons");
      await expect(page.getByText(demo.season.name).first()).toBeVisible();
      await capture(page, "seasons");

      await page.goto(`/admin/registrations/${demo.live.id}`);
      await expect(page.getByRole("heading", { name: "Pending Payment Confirmations" })).toBeVisible();
      await capture(page, "payment-desk");

      await page.goto(`/admin/actions/${demo.live.id}`);
      await expect(page.getByRole("heading", { name: "Pending Actions" })).toBeVisible();
      await capture(page, "request-desk");

      // Staff pages follow the device's dark mode unless the viewer picked a theme.
      await page.emulateMedia({ colorScheme: "dark" });
      await page.goto(`/admin/tournaments/${demo.live.id}`);
      await expect(page.getByRole("heading", { name: demo.live.name, exact: true })).toBeVisible();
      await page.getByRole("tab", { name: "Standings" }).click();
      await capture(page, "tournament-admin-standings-dark");
    });
  });
}
