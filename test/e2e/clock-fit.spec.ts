/**
 * The TV clock never scrolls and nothing on it leaves the screen (round 5, items 17, 22 and 23): at every
 * size a club shows it on (TVs at 1920 × 1080, 1366 × 768 and 1280 × 720, a tablet either way up, a
 * phone either way up), in every state (running, paused, on a break, the last level, not started, not
 * set up yet, finished, the seats and payouts overlays, every optional figure and the level's number
 * switched on, a club with no logo, a small old logo), with the worst a night throws at it: a
 * 60-character name, 1,000,000/2,000,000 blinds with an ante, 200 entries, three paid places, the AP
 * and the QR code. The TVs are also checked in full screen (requestFullscreen), every part inside the
 * tournament's edge margin for overscan, and for the club's logo: about 15% of the height over the
 * clock in play, about 30% as the centrepiece before the start, on a break and once it is over, a
 * small logo never past twice its size (round 5, items 21, 22 and 24). The production build draws it;
 * the display's answer is served by the test (page.route) so every state can be set up exactly.
 */
import type { Page } from "@playwright/test";
import sharp from "sharp";
import { DEFAULT_DISPLAY_SETTINGS, type ClockDto } from "../../shared/api/clock";
import type { LiveDisplayDto } from "../../shared/api/live-display";
import type { PublicSeatingDto } from "../../shared/api/seating";
import type { ClockStructure } from "../../shared/domain/clock";
import { logoSvg } from "./support/demo";
import { expect, test } from "./support/fixtures";

const STATES = ["running", "paused", "break", "final", "not started", "not set up", "finished", "seats overlay", "payouts overlay", "every figure", "no logo", "small logo"] as const;
type State = (typeof STATES)[number];

const VIEWPORTS = [
  { width: 1920, height: 1080, tv: true },
  { width: 1366, height: 768, tv: true },
  { width: 1280, height: 720, tv: true },
  { width: 1024, height: 768, tv: false },
  { width: 768, height: 1024, tv: false },
  { width: 390, height: 844, tv: false },
  { width: 844, height: 390, tv: false },
] as const;

const STRUCTURE: ClockStructure = {
  levels: [
    { kind: "level", id: "l1", durationMinutes: 20, smallBlind: 500_000, bigBlind: 1_000_000, ante: 1_000_000 },
    { kind: "level", id: "l2", durationMinutes: 20, smallBlind: 1_000_000, bigBlind: 2_000_000, ante: 2_000_000 },
    { kind: "break", id: "b1", durationMinutes: 15, note: "Last re-buys / add-ons, then colour up" },
    { kind: "level", id: "l3", durationMinutes: 20, smallBlind: 1_500_000, bigBlind: 3_000_000, ante: 3_000_000 },
  ],
  anteMode: "bb_ante",
  startingStack: 80_000,
  rebuyStack: 120_000,
  addonStack: 120_000,
  earlyBirdStack: 25_000,
};

const LOGO_PATH = "/test-assets/central-stars-logo.png";
/** An old 64 px logo: drawn no larger than 128 px. */
const SMALL_LOGO_PATH = "/test-assets/central-stars-logo-64.png";
const SMALL_LOGO_SIZE = 64;

/** Every figure the TD can switch on, and the level's number. */
const EVERY_FIGURE = {
  showLevel: true,
  showEntries: true,
  showRebuys: true,
  showAddons: true,
  showEarlyBirds: true,
  showChipsInPlay: true,
  showTables: true,
  showRebuyWindow: true,
} as const;

function clockFor(state: State, now: number): ClockDto | null {
  if (state === "not set up") return null;
  const overlay = state === "seats overlay" ? "seating" : state === "payouts overlay" ? "payouts" : "none";
  const status = state === "finished" ? "finished" : state === "paused" ? "paused" : state === "not started" ? "idle" : "running";
  return {
    version: 3,
    status,
    currentLevelIndex: state === "break" ? 2 : state === "final" ? 3 : state === "not started" ? 0 : 1,
    periodEndsAt: status === "running" ? now + 12 * 60_000 + 5_000 : null,
    pausedRemainingMs: status === "paused" ? 8 * 60_000 : status === "finished" ? 0 : status === "idle" ? 20 * 60_000 : null,
    startedAt: status === "idle" ? null : now - 3_600_000,
    structure: STRUCTURE,
    structureHash: "0badf00d",
    presetKey: null,
    displaySettings: { ...DEFAULT_DISPLAY_SETTINGS, showPrizePool: "always", showPayouts: true, showAp: true, overlay, ...(state === "every figure" ? EVERY_FIGURE : {}) },
    undo: null,
    updatedAt: new Date(now - 60_000).toISOString(),
  };
}

function displayFor(state: State): LiveDisplayDto {
  const now = Date.now();
  return {
    serverNow: now,
    tournament: {
      id: "t1",
      name: "Central Stars Thursday Night Deepstack Championship Freezeout",
      status: state === "finished" ? "completed" : "in_progress",
      startDateTime: new Date(now - 7_200_000).toISOString(),
      seasonId: "s1",
      prizePoolLocked: false,
      rebuyPeriodMinutes: 135,
      offersRebuys: true,
      offersAddons: true,
    },
    club: { id: "c1", name: "Central Stars Poker Club", slug: "central-stars", imageUrl: state === "no logo" ? null : state === "small logo" ? SMALL_LOGO_PATH : LOGO_PATH, rakeLabel: "AP", theme: null },
    season: { id: "s1", name: "Winter 2026 Central Stars League" },
    clock: clockFor(state, now),
    stats: { entrants: 200, remaining: 188, buyIns: 200, rebuys: 12, addons: 40, earlyBirds: 120, activeTables: 23, totalChips: 232_000_000, averageStack: 1_234_567 },
    money: {
      show: true,
      estimated: true,
      rakeLabel: "AP",
      netCents: 12_345_600,
      netSource: "calculated",
      apCents: 1_234_500,
      clubAddedCents: null,
      payouts: [
        { position: 1, amountCents: 6_172_800 },
        { position: 2, amountCents: 3_703_700 },
        { position: 3, amountCents: 2_469_100 },
      ],
      lines: [
        { kind: "carried_in", label: "Carried over from Central Stars Thursday Night Deepstack Championship", cents: 123_400 },
        { kind: "carried_over", label: "Carried over to Winter 2026 Central Stars League", cents: 98_700 },
      ],
    },
    qr: { target: "season", path: "/season/s1" },
    viewer: { canControl: false, canChangeDisplay: false, clockKeyIssuedAt: null, clockKeyExpiresAt: null },
  };
}

const NAMES = ["Alice Smith", "Bob Jones", "Carmen Electra-Whitfield", "Dave Ngata", "Eve Tamatea", "Frank Li", "Grace O'Connor", "Hemi Walker"];

/** Six full 9-seat rectangles of eight players each: the seats overlay at its busiest. */
function seating(): PublicSeatingDto {
  const tables = Array.from({ length: 6 }, (_, t) => ({
    tableNumber: t + 1,
    displayName: `Table ${t + 1}`,
    seatCount: 9,
    shape: "rectangle" as const,
    seats: Array.from({ length: 9 }, (_, s) => ({ seatNumber: s + 1, player: s < 8 ? { id: `p${t}-${s}`, name: NAMES[s]!, imageUrl: null } : null })),
  }));
  const players = tables.flatMap((table) =>
    table.seats.flatMap((seat) => (seat.player ? [{ player: seat.player, tableNumber: table.tableNumber, tableName: table.displayName, seatNumber: seat.seatNumber }] : [])),
  );
  return { tournament: { id: "t1", name: "x", status: "in_progress" }, club: { id: "c1", name: "Central Stars", slug: "central-stars", imageUrl: null, theme: null }, tables, players, unseatedCount: 0 };
}

/** Serves the display (in `state()`), the seats and the logos; nobody is signed in. */
async function serve(page: Page, state: () => State): Promise<void> {
  const logo = await sharp(Buffer.from(logoSvg())).png().toBuffer();
  const small = await sharp(Buffer.from(logoSvg())).resize(SMALL_LOGO_SIZE, SMALL_LOGO_SIZE).png().toBuffer();
  await page.route(`**${LOGO_PATH}`, (route) => route.fulfill({ status: 200, contentType: "image/png", body: logo }));
  await page.route(`**${SMALL_LOGO_PATH}`, (route) => route.fulfill({ status: 200, contentType: "image/png", body: small }));
  await page.route(
    (url) => url.pathname.startsWith("/api/"),
    (route) => {
      const { pathname } = new URL(route.request().url());
      if (pathname === "/api/public/tournaments/t1/display") return route.fulfill({ json: displayFor(state()) });
      if (pathname === "/api/public/tournaments/t1/seating") return route.fulfill({ json: seating() });
      if (pathname === "/api/auth/me") return route.fulfill({ status: 401, json: { error: "Not signed in" } });
      return route.fulfill({ status: 404, json: { error: "Not found" } });
    },
  );
}

interface Fit {
  /** "1920 × 1080" when the page scrolls that far, else null. */
  scrolls: string | null;
  /** Each visible part that crosses the edge (by more than a pixel), with its box. */
  outside: string[];
  /** The screen plan's boxes ([data-fit]) whose content is taller or wider than they are: cut off. */
  overflowing: string[];
}

/** Whether the screen fits: no scrolling, every visible part of the clock and its overlays on screen (inside the edge margin when `insetFromMargin`), nothing cut off. */
function measure(page: Page, insetFromMargin: boolean): Promise<Fit> {
  return page.evaluate((useMargin) => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const root = document.querySelector<HTMLElement>('[data-testid="clock-screen"]');
    const margin = useMargin ? Number(root?.dataset.edgeMargin ?? 0) / 100 : 0;
    const [left, top, right, bottom] = [width * margin, height * margin, width * (1 - margin), height * (1 - margin)];
    const doc = document.documentElement;
    const outside: string[] = [];
    for (const element of Array.from(document.querySelectorAll('[data-testid="clock-screen"] *'))) {
      if (!element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) || element.closest(".sr-only")) continue;
      // An overlay's backdrop covers the whole screen on purpose; its padding keeps what it shows inside the margin.
      if (element.getAttribute("data-testid") === "display-overlay") continue;
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      // Words past the ellipsis of a line cut short (a long name) are not on screen; anything else is.
      const line = element.parentElement?.closest(".truncate");
      if (line) {
        const shown = line.getBoundingClientRect();
        if (box.left < shown.left - 1 || box.right > shown.right + 1) continue;
      }
      if (box.left < left - 1 || box.top < top - 1 || box.right > right + 1 || box.bottom > bottom + 1) {
        const name = element.getAttribute("data-testid") ?? element.tagName.toLowerCase();
        outside.push(`${name} [${Math.round(box.left)}, ${Math.round(box.top)}, ${Math.round(box.right)}, ${Math.round(box.bottom)}]`);
      }
    }
    const scrolls = doc.scrollHeight > height || doc.scrollWidth > width ? `${doc.scrollWidth} × ${doc.scrollHeight}` : null;
    const overflowing = Array.from(document.querySelectorAll<HTMLElement>("[data-fit]"))
      .filter((part) => part.checkVisibility() && (part.scrollHeight > part.clientHeight + 1 || part.scrollWidth > part.clientWidth + 1))
      .map((part) => `${part.scrollWidth}×${part.scrollHeight} of content in ${part.clientWidth}×${part.clientHeight}: ${(part.textContent ?? "").slice(0, 40)}`);
    return { scrolls, outside: outside.slice(0, 8), overflowing };
  }, insetFromMargin);
}

/** The club's logo as drawn (its image's box) against the clock's stage inside the edge margin, and where it sits. */
function logoOnScreen(page: Page): Promise<{ share: number; height: number; inHeader: boolean; inCentre: boolean } | null> {
  return page.evaluate(() => {
    const image = document.querySelector<HTMLImageElement>('[data-testid="display-logo"] img');
    const stage = document.querySelector<HTMLElement>("[data-layout]");
    if (!image || !stage || !image.complete) return null;
    const height = image.getBoundingClientRect().height;
    return {
      share: height / stage.getBoundingClientRect().height,
      height,
      inHeader: image.closest("header") !== null,
      inCentre: image.closest('[data-testid="clock-centrepiece"]') !== null,
    };
  });
}

/** In play, the logo over the event's name; before the start, on a break and once over, the centrepiece. */
const CENTREPIECE_STATES: readonly State[] = ["break", "not started", "not set up", "finished"];

for (const viewport of VIEWPORTS) {
  test.describe(`the TV clock at ${viewport.width} × ${viewport.height}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("fits the screen in every state: no scrolling, nothing off the edge", async ({ page }) => {
      let state: State = STATES[0];
      await serve(page, () => state);
      for (const next of STATES) {
        state = next;
        await page.goto("/clock/t1?screen=tv");
        await expect(page.getByTestId("clock-screen")).toBeVisible();
        if (next === "seats overlay") await expect(page.getByText("Table 1").first()).toBeVisible();
        // The screen plan measures the visible area and settles on a layout within a frame or two.
        await page.waitForTimeout(400);
        expect.soft(await measure(page, false), `${next} at ${viewport.width} × ${viewport.height}`).toEqual({ scrolls: null, outside: [], overflowing: [] });
      }
    });

    if (viewport.tv) {
      test("fits inside its overscan margin in full screen", async ({ page }) => {
        let state: State = STATES[0];
        await serve(page, () => state);
        for (const next of ["running", "break", "not started", "every figure", "seats overlay", "payouts overlay"] as const) {
          state = next;
          await page.goto("/clock/t1?screen=tv");
          await expect(page.getByTestId("clock-screen")).toBeVisible();
          await page.evaluate(() => document.documentElement.requestFullscreen());
          await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true);
          await page.waitForTimeout(400);
          expect.soft(await measure(page, true), `${next}, full screen, at ${viewport.width} × ${viewport.height}`).toEqual({ scrolls: null, outside: [], overflowing: [] });
          await page.evaluate(() => document.exitFullscreen());
        }
      });

      test("puts the logo over the clock at about 15% of the height in play, and in the middle at about 30% before the start, on a break and once over", async ({ page }) => {
        let state: State = STATES[0];
        await serve(page, () => state);
        for (const next of ["running", "paused", "final", ...CENTREPIECE_STATES, "small logo"] as const) {
          state = next;
          await page.goto("/clock/t1?screen=tv");
          await expect(page.getByTestId("display-logo").locator("img")).toBeVisible();
          await expect.poll(async () => (await logoOnScreen(page)) !== null, { message: `${next}: the logo has loaded` }).toBe(true);
          await page.waitForTimeout(400);
          const logo = (await logoOnScreen(page))!;
          if (next === "small logo") {
            // In play, where the box (15% of the height) is larger than twice a 64 px logo on a 1080p TV.
            await expect.poll(async () => (await logoOnScreen(page))?.height ?? Infinity, { message: `a 64 px logo at ${viewport.width} × ${viewport.height}` }).toBeLessThanOrEqual(2 * SMALL_LOGO_SIZE + 1);
          } else if (CENTREPIECE_STATES.includes(next)) {
            expect.soft(logo.inCentre, `${next}: the logo is the centrepiece`).toBe(true);
            expect.soft(logo.share, `${next}: the centrepiece's share of the height`).toBeGreaterThanOrEqual(0.25);
            expect.soft(logo.share, `${next}: the centrepiece's share of the height`).toBeLessThanOrEqual(0.31);
          } else {
            expect.soft(logo.inHeader, `${next}: the logo is over the event's name`).toBe(true);
            expect.soft(logo.share, `${next}: the logo's share of the height`).toBeGreaterThanOrEqual(0.135);
            expect.soft(logo.share, `${next}: the logo's share of the height`).toBeLessThanOrEqual(0.16);
          }
        }
      });

      test("leaves the level's number off unless the TD shows it, so the blinds are the headline under the countdown", async ({ page }) => {
        let state: State = "running";
        await serve(page, () => state);
        await page.goto("/clock/t1?screen=tv");
        const face = page.getByTestId("clock-face");
        await expect(face.getByRole("timer", { name: "Time left" })).toBeVisible();
        await expect(face.getByRole("heading")).toHaveCount(0);
        await expect(face).not.toContainText("Level");
        await expect(page.getByTestId("display-stats").locator("dt")).toHaveText(["Players", "Average stack"]);

        state = "every figure";
        await page.goto("/clock/t1?screen=tv");
        await expect(face.getByRole("heading", { name: "Level 2" })).toBeVisible();
        await expect(page.getByTestId("display-stats").locator("dt").nth(2)).toBeVisible();
      });
    }
  });
}
