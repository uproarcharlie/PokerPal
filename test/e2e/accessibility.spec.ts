/**
 * Accessibility: axe-core finds no serious or critical problem on the pages players and TDs use most,
 * on a phone and on a laptop, in every tab and step: sign-in, the public club and tournament pages and
 * the player requests page, the QR poster and sign-up (a new player, an existing one, the
 * confirmation) and the TD's tournament page (in light and dark). Every rule axe has runs, WCAG 2.2
 * A/AA and its best practices alike; the moderate and minor ones are left to review.
 */
import AxeBuilder from "@axe-core/playwright";
import { devices, type Page } from "@playwright/test";
import { createPlayer, registerPlayer, signUp, uniquePhone } from "./support/api";
import { buildDemoClub } from "./support/demo";
import { expect, test } from "./support/fixtures";

const { defaultBrowserType: _browser, ...pixel7 } = devices["Pixel 7"];

/** Axe's serious and critical violations on the page as it is now, one line per rule and element. */
async function seriousViolations(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).analyze();
  return violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .flatMap((violation) =>
      violation.nodes.map((node) => `${violation.id} (${violation.impact}) ${node.target.join(" ")}: ${node.failureSummary?.replace(/\s+/g, " ")}`),
    );
}

/** Checks the page as it is now; `where` names the state in the failure message. */
async function expectAccessible(page: Page, where: string): Promise<void> {
  // Radix and the toasts animate in: check what is finally on screen, not a frame of a fade. (A
  // spinner or a pulsing dot animates for ever, so only animations that end are waited for.)
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
  // Soft, so one run lists the problems of every state the test reaches.
  expect.soft(await seriousViolations(page), `serious or critical accessibility problems: ${where}`).toEqual([]);
}

/** Opens each tab of the page's (first) tab list in turn and checks it. */
async function expectEveryTabAccessible(page: Page, where: string): Promise<void> {
  const tabs = page.getByRole("tablist").first().getByRole("tab");
  for (const name of await tabs.allInnerTexts()) {
    await tabs.filter({ hasText: name }).click();
    await expect(tabs.filter({ hasText: name })).toHaveAttribute("aria-selected", "true");
    await expectAccessible(page, `${where}, ${name} tab`);
  }
}

for (const [device, use] of [
  ["phone", pixel7],
  ["laptop", { viewport: { width: 1280, height: 800 } }],
] as const) {
  test.describe(`on a ${device}`, () => {
    test.use(use);

    test("sign-in page", async ({ page }) => {
      await page.goto("/login");
      await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
      await expectAccessible(page, "sign-in");

      await page.getByRole("button", { name: "Sign In" }).click();
      await expect(page.getByText("Required").or(page.getByRole("alert")).first()).toBeVisible();
      await expectAccessible(page, "sign-in with its errors shown");
    });

    test("public club and tournament pages", async ({ page, request }) => {
      // The owner sets the club up on their own device; the page is a visitor, signed out.
      await signUp(request, "Mere Owner");
      const demo = await buildDemoClub(request);

      await page.goto(`/club/${demo.club.slug}`);
      await expect(page.getByRole("heading", { name: demo.club.name, exact: true })).toBeVisible();
      await expectEveryTabAccessible(page, "public club page");

      for (const [when, tournament] of [
        ["in progress", demo.live],
        ["finished", demo.finished],
        ["open for sign-ups", demo.upcoming],
      ] as const) {
        await page.goto(`/tournament/${tournament.id}`);
        await expect(page.getByRole("heading", { name: tournament.name, exact: true })).toBeVisible();
        await expectEveryTabAccessible(page, `public tournament page, ${when}`);
      }

      // The Standings tab has its own tabs: the tournament's standings, and its season's leaderboard.
      await page.getByRole("tab", { name: "Standings" }).click();
      await page.getByRole("tab", { name: demo.season.name }).click();
      await expect(page.getByRole("tab", { name: demo.season.name })).toHaveAttribute("aria-selected", "true");
      await expectAccessible(page, "public tournament page, season leaderboard");

      await page.goto(`/tournaments/${demo.live.id}/actions`);
      await expect(page.getByRole("button", { name: /^Re-buy/ })).toBeVisible();
      await expectAccessible(page, "player requests page");
    });

    test("QR sign-up, as a new player and as an existing one", async ({ page, request }) => {
      // The owner sets the club up on their own device; the page is a visitor, signed out.
      await signUp(request, "Mere Owner");
      const demo = await buildDemoClub(request);

      await page.goto(`/qr/${demo.upcoming.id}`);
      await expect(page.getByText("Scan to Register", { exact: true })).toBeVisible();
      await expectAccessible(page, "QR code poster");

      await page.goto(`/register/${demo.upcoming.id}`);
      await expect(page.getByText("Step 1 of 3")).toBeVisible();
      await expectAccessible(page, "sign-up step 1");

      await page.getByTestId("player-type-new").click();
      await page.getByTestId("step1-next").click();
      await expect(page.getByTestId("player-name")).toBeVisible();
      await expectAccessible(page, "sign-up step 2, new player");
      await page.getByTestId("step2-next").click();
      await expect(page.getByText("Step 2 of 3")).toBeVisible();
      await expectAccessible(page, "sign-up step 2, new player, with its errors shown");

      await page.getByTestId("player-name").fill("Tama Rangi");
      await page.getByTestId("player-phone").fill(uniquePhone());
      await page.getByTestId("step2-next").click();
      await expect(page.getByTestId("registering-as")).toBeVisible();
      await expectAccessible(page, "sign-up step 3");
      await page.getByTestId("complete-registration").click();
      await expect(page.getByText("Registration Complete!")).toBeVisible();
      await expectAccessible(page, "sign-up complete");

      await page.getByTestId("register-another").click();
      await page.getByTestId("player-type-existing").click();
      await page.getByTestId("step1-next").click();
      await page.getByTestId("player-search").fill("Ben");
      await expect(page.getByRole("list", { name: "Matching players" }).getByRole("button").first()).toBeVisible();
      await expectAccessible(page, "sign-up step 2, finding an existing player");
      await page.getByRole("list", { name: "Matching players" }).getByRole("button").first().click();
      await expectAccessible(page, "sign-up step 2, existing player chosen");
    });

    test("the TD's tournament page, light and dark", async ({ page }) => {
      // Eighteen axe passes (two schemes, two tournaments, every tab, two dialogs): about 20 s when the
      // suite runs in parallel, too close to the default 30 s.
      test.slow();
      await signUp(page.request, "Mere Director");
      const demo = await buildDemoClub(page.request);

      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        for (const [when, tournament] of [
          ["in progress", demo.live],
          ["finished", demo.finished],
        ] as const) {
          await page.goto(`/admin/tournaments/${tournament.id}`);
          await expect(page.getByRole("heading", { name: tournament.name, exact: true })).toBeVisible();
          await expect(page.getByRole("tab", { name: "Overview" })).toBeVisible();
          await expectEveryTabAccessible(page, `tournament admin, ${when}, ${colorScheme}`);
        }
      }

      await page.goto(`/admin/tournaments/${demo.live.id}`);
      await page.getByTestId("register-player").click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expectAccessible(page, "tournament admin, Register Player dialog");

      // End Tournament: the finishing order and the payout plan it previews (MA-REV-07).
      await page.goto(`/admin/tournaments/${demo.live.id}`);
      await page.getByTestId("end-tournament").click();
      await expect(page.getByTestId("finalize-plan")).toBeVisible();
      await expectAccessible(page, "tournament admin, End Tournament dialog");
    });
  });
}

test.describe("on a 320 px phone (WCAG 1.4.10, reflow)", () => {
  test.use({ ...pixel7, viewport: { width: 320, height: 740 } });

  test("the staff pages fit the screen: nothing scrolls sideways (MA-P3REV1-06)", async ({ page }) => {
    await signUp(page.request, "Mere Director");
    const demo = await buildDemoClub(page.request);
    // A sign-up still to pay, so the payment desk has a card with its button (the request desk has two).
    const latecomer = await createPlayer(page.request, "Aroha Ngata-Whitfield");
    await registerPlayer(page.request, demo.live.id, latecomer.id);

    for (const [path, ready] of [
      ["/dashboard", page.getByRole("heading", { name: "Season Leaderboard" })],
      ["/tournaments", page.getByRole("heading", { name: "All Tournaments" })],
      ["/clubs", page.getByRole("heading", { name: "Club Management" })],
      [`/admin/tournaments/${demo.live.id}`, page.getByRole("tab", { name: "Overview" })],
      // The desks a TD works from on a phone during a game, with their Confirm / Dismiss buttons (MA-REV-01).
      [`/admin/actions/${demo.live.id}`, page.getByRole("button", { name: "Dismiss" }).first()],
      [`/admin/registrations/${demo.live.id}`, page.getByRole("button", { name: "Confirm Payment" }).first()],
    ] as const) {
      await page.goto(path);
      await expect(ready).toBeVisible();
      const widths = await page.locator("main").evaluate((main) => ({ scroll: main.scrollWidth, client: main.clientWidth }));
      expect.soft(widths.scroll, `${path} is wider than the screen`).toBeLessThanOrEqual(widths.client);
    }
  });
});
