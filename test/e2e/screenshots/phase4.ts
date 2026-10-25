/**
 * Phase 4's screens for a visual review, on a Friday night at Central Stars: the TV clock (playing and
 * on the re-buy break), the TD's Clock tab and structure generator, the seating plan, the players'
 * seat finder and season leaderboard, and the AP panel on a quiet night with the AP fixed by hand.
 * Run with ./playwright.config.ts (see there); the PNGs land in SCREENSHOTS_DIR, named as below.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { APIRequestContext, Page } from "@playwright/test";
import type { AuthUserResponse } from "../../../shared/api/auth";
import type { FinalizePreviewDto } from "../../../shared/api/finalize";
import type { StaffPlayer } from "../../../shared/api/players";
import type { ClubDto, PublicPointsSystem, PublicRegistration, PublicSeason } from "../../../shared/api/public";
import type { TournamentDetailDto } from "../../../shared/api/tournaments";
import { presetStructure } from "../../../shared/domain/blind-structures";
import { createPointsSystem, createTournament, expectJson, PASSWORD, PROXY_HEADERS, registerPlayer } from "../support/api";
import { logoSvg, photoSvg, uploadImage } from "../support/demo";
import { expect, test } from "../support/fixtures";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const OUT_DIR = path.resolve(REPO_ROOT, process.env.SCREENSHOTS_DIR || "tmp/screenshots");

const LAPTOP = { width: 1280, height: 800 };
const PHONE = { width: 375, height: 812 };
const TV = { width: 1920, height: 1080 };

/** Central Stars' regulars: about two in three have a photo. */
const REGULARS: readonly { name: string; photo: readonly [string, string] | null }[] = [
  { name: "Aroha Ngata", photo: ["#1e3a8a", "#93c5fd"] },
  { name: "Ben Whitfield", photo: ["#7c2d12", "#fdba74"] },
  { name: "Chloe Tan", photo: null },
  { name: "Dev Patel", photo: ["#14532d", "#86efac"] },
  { name: "Ella Fraser", photo: ["#581c87", "#d8b4fe"] },
  { name: "Finn O'Connor", photo: null },
  { name: "Grace Liu", photo: ["#0f766e", "#99f6e4"] },
  { name: "Hemi Walker", photo: ["#831843", "#f9a8d4"] },
  { name: "Isla McKenzie", photo: null },
  { name: "Jack Thompson", photo: ["#1f2937", "#d1d5db"] },
  { name: "Kiri Parata", photo: ["#713f12", "#fde68a"] },
  { name: "Liam Brooks", photo: ["#312e81", "#c7d2fe"] },
  { name: "Mere Tawhiri", photo: ["#7f1d1d", "#fca5a5"] },
  { name: "Nikau Rangi", photo: null },
  { name: "Olivia Chen", photo: ["#164e63", "#a5f3fc"] },
  { name: "Pita Hohaia", photo: ["#3f6212", "#d9f99d"] },
  { name: "Quinn Ellis", photo: null },
  { name: "Ruby Singh", photo: ["#701a75", "#f5d0fe"] },
  { name: "Sione Taufa", photo: ["#1e293b", "#cbd5e1"] },
  { name: "Tama Wiremu", photo: null },
  { name: "Una Kowalski", photo: ["#78350f", "#fcd34d"] },
  { name: "Vikram Rao", photo: ["#065f46", "#6ee7b7"] },
];

interface Night {
  club: ClubDto;
  season: PublicSeason;
  /** Friday's One Life Line, in progress: seats drawn, the clock running. */
  tonight: TournamentDetailDto;
  /** A quiet Tuesday: seven players, the AP fixed by hand for the low turnout. */
  quiet: TournamentDetailDto;
  /** Next Friday's, open for sign-ups, with no clock yet. */
  next: TournamentDetailDto;
}

let night: Night;
let ownerEmail = "";

test.describe.configure({ mode: "serial" });

const post = async <T>(request: APIRequestContext, url: string, data: object, status = 200) => expectJson<T>(await request.post(url, { data }), status);
const put = async <T>(request: APIRequestContext, url: string, data: object) => expectJson<T>(await request.put(url, { data }), 200);

/** Enters `players` (paid) and returns their registrations, in order. */
async function enter(request: APIRequestContext, tournament: TournamentDetailDto, players: readonly StaffPlayer[]): Promise<PublicRegistration[]> {
  const entries: PublicRegistration[] = [];
  for (const player of players) entries.push(await registerPlayer(request, tournament.id, player.id, { paymentConfirmed: true }));
  return entries;
}

/** Busts every entry but the first, last first, each knocked out by a player still in, then finalizes. */
async function playOut(request: APIRequestContext, tournament: TournamentDetailDto, entries: readonly PublicRegistration[]): Promise<void> {
  await put(request, `/api/tournaments/${tournament.id}`, { status: "in_progress" });
  for (let index = entries.length - 1; index > 0; index--) {
    await put(request, `/api/registrations/${entries[index]!.id}`, { isEliminated: true, eliminatedBy: entries[Math.floor(index / 2)]!.playerId });
  }
  const preview = await post<FinalizePreviewDto>(request, `/api/tournaments/${tournament.id}/finalize/preview`, {});
  await post(request, `/api/tournaments/${tournament.id}/finalize`, { expectedPlanHash: preview.planHash });
}

async function clockAction(request: APIRequestContext, tournamentId: string, action: object): Promise<void> {
  await post(request, `/api/tournaments/${tournamentId}/clock/actions`, action);
}

/** Central Stars, a few weeks into its winter league, on the night of its 20th One Life Line. */
async function buildNight(request: APIRequestContext): Promise<Night> {
  const logo = await uploadImage(request, "club_logo", logoSvg());
  const club = await post<ClubDto>(
    request,
    "/api/clubs",
    {
      name: "Central Stars",
      slug: "central-stars",
      description: "<p>One Life Line every Friday at Club 2020: $100 buy-in, 80K stack, one re-buy or add-on.</p>",
      imageUrl: logo,
      timezone: "Pacific/Auckland",
      address: "Club 2020, 57 Princes Street, Onehunga, Auckland 1061",
      rakeLabel: "AP",
    },
    201,
  );
  const season = await post<PublicSeason>(
    request,
    "/api/seasons",
    { clubId: club.id, name: "Winter League 2026", startDate: "2026-06-05", endDate: "2026-11-27", isActive: true },
    201,
  );
  const points: PublicPointsSystem = await createPointsSystem(request, season.id, {
    name: "League points",
    participationPoints: 10,
    knockoutPoints: 5,
    allocations: [
      { position: 1, points: 100, description: "Winner" },
      { position: 2, points: 70 },
      { position: 3, points: 50 },
      { position: 4, points: 35 },
      { position: 5, points: 25 },
      { position: 6, points: 15 },
    ],
  });
  const players: StaffPlayer[] = [];
  for (const [index, { name, photo }] of REGULARS.map((regular, index) => [index, regular] as const)) {
    const imageUrl = photo ? await uploadImage(request, "player_avatar", photoSvg(photo)) : undefined;
    const phone = `021 ${String(310 + index * 23)} ${String(2040 + index * 389).padStart(4, "0")}`;
    players.push(await post<StaffPlayer>(request, "/api/players", { name, phone, imageUrl, clubId: club.id }, 201));
  }

  // Central Stars' One Life Line: $100 in, one $25 re-buy or add-on, $10 AP a buy-in and $5 on each re-buy and add-on.
  const format = {
    clubId: club.id,
    seasonId: season.id,
    pointsSystemId: points.id,
    trackPoints: true,
    buyInAmount: "100.00",
    rebuyAmount: "25.00",
    maxRebuys: 1,
    addonAmount: "25.00",
    rebuyPeriodMinutes: 135,
    rakeType: "fixed" as const,
    rakeAmount: "10.00",
    rebuyRakeType: "fixed" as const,
    rebuyRakeAmount: "5.00",
    addonRakeType: "fixed" as const,
    addonRakeAmount: "5.00",
    payoutStructure: "standard" as const,
    maxPlayers: 40,
    minPlayers: 2,
  };

  for (const [number, date, field] of [
    [18, "2026-10-09", players.slice(0, 14)],
    [19, "2026-10-16", [...players.slice(4, 20)].reverse()],
  ] as const) {
    const game = await createTournament(request, { ...format, name: `One Life Line #${number}`, startDateTime: `${date}T19:00:00+13:00` });
    await playOut(request, game, await enter(request, game, field));
  }

  const tonight = await createTournament(request, {
    ...format,
    name: "One Life Line #20",
    description: "80K stack, 20-minute levels to the break, then 15. One $25 re-buy or add-on for 120K. Early-bird bonus 25K.",
    startDateTime: "2026-10-23T19:00:00+13:00",
    status: "registration",
  });
  const entries = await enter(request, tonight, players);
  await post(request, `/api/tournaments/${tonight.id}/early-birds`, { registrationIds: entries.slice(0, 16).map((entry) => entry.id), earlyBird: true });
  await put(request, `/api/tournaments/${tonight.id}`, { status: "in_progress" });
  for (const entry of entries.slice(2, 6)) await post(request, `/api/registrations/${entry.id}/counts`, { rebuys: 1 });
  for (const entry of entries.slice(8, 14)) await post(request, `/api/registrations/${entry.id}/counts`, { addons: 1 });
  await put(request, `/api/tournaments/${tonight.id}`, { prizePoolLocked: true });
  await post(request, `/api/tournaments/${tonight.id}/seating/setup`, {}, 201);
  for (const [loser, winner] of [[21, 3], [17, 0], [12, 7]] as const) {
    await put(request, `/api/registrations/${entries[loser]!.id}`, { isEliminated: true, eliminatedBy: entries[winner]!.playerId });
  }
  const clock = {
    structure: presetStructure("central_stars_one_life_line"),
    presetKey: "central_stars_one_life_line",
    displaySettings: { showPrizePool: "always", showPayouts: true, showAp: true, showAverageStack: true, qrTarget: "season" },
    baseHash: null,
  };
  await expectJson(await request.put(`/api/tournaments/${tonight.id}/clock`, { data: clock }), 201);
  await clockAction(request, tonight.id, { action: "start" });
  await clockAction(request, tonight.id, { action: "jump", levelIndex: 3, expectedLevelIndex: 0 });
  await clockAction(request, tonight.id, { action: "set_remaining", remainingSeconds: 12 * 60 + 34, expectedLevelIndex: 3 });

  const quiet = await createTournament(request, { ...format, name: "Tuesday One Life Line", startDateTime: "2026-10-27T19:00:00+13:00" });
  await enter(request, quiet, players.slice(0, 7));
  await put(request, `/api/tournaments/${quiet.id}`, { status: "in_progress" });
  await put(request, `/api/tournaments/${quiet.id}/prize-pool/adjustment`, { mode: "ap_override", amount: "30.00", reason: "Low turnout" });

  const next = await createTournament(request, { ...format, name: "One Life Line #21", startDateTime: "2026-10-30T19:00:00+13:00", status: "registration" });
  await enter(request, next, players.slice(0, 5));

  return { club, season, tonight, quiet, next };
}

/** Waits for the page to be still (data, fonts, images, animations that end). */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.evaluate(async () => {
    for (const image of Array.from(document.images)) image.loading = "eager";
    await document.fonts.ready;
    await Promise.all(
      Array.from(document.images, (image) =>
        image.complete ? null : new Promise((resolve) => ["load", "error"].forEach((event) => image.addEventListener(event, resolve, { once: true }))),
      ),
    );
    await Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    );
  });
}

/** The whole page (staff pages scroll inside <main>, so the window grows to show all of it), as `<name>-<w>x<h>.png`. */
async function capture(page: Page, name: string, { fullPage = true }: { fullPage?: boolean } = {}): Promise<void> {
  await settle(page);
  const viewport = page.viewportSize() ?? LAPTOP;
  const file = path.join(OUT_DIR, `${name}-${viewport.width}x${viewport.height}.png`);
  if (!fullPage) {
    await page.screenshot({ path: file });
    return;
  }
  const fullHeight = await page.evaluate(() => {
    const main = document.querySelector("main");
    return document.documentElement.scrollHeight + (main ? main.scrollHeight - main.clientHeight : 0);
  });
  if (fullHeight > viewport.height) {
    await page.setViewportSize({ width: viewport.width, height: fullHeight });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  }
  await page.screenshot({ path: file, fullPage: true });
  await page.setViewportSize(viewport);
}

test.beforeAll(async ({ playwright }, testInfo) => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const request = await playwright.request.newContext({ baseURL: testInfo.project.use.baseURL, extraHTTPHeaders: PROXY_HEADERS });
  try {
    ownerEmail = "rangi@centralstars.example";
    await expectJson<AuthUserResponse>(await request.post("/api/auth/register", { data: { name: "Rangi Parata", email: ownerEmail, password: PASSWORD } }), 201);
    night = await buildNight(request);
  } finally {
    await request.dispose();
  }
});

async function signIn(page: Page): Promise<void> {
  await expectJson(await page.request.post("/api/auth/login", { data: { email: ownerEmail, password: PASSWORD } }), 200);
}

test("the TD's Clock tab and structure generator, and the TV clock playing and on the break", async ({ page, browser, baseURL }) => {
  await page.setViewportSize(LAPTOP);
  await signIn(page);
  await page.goto(`/admin/tournaments/${night.tonight.id}`);
  await page.getByRole("tab", { name: "Clock" }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await capture(page, "clock-panel");

  await page.goto(`/admin/tournaments/${night.next.id}`);
  await page.getByRole("tab", { name: "Clock" }).click();
  await page.getByRole("button", { name: "Open the structure generator" }).click();
  await expect(page.getByRole("table", { name: "Generated levels" })).toBeVisible();
  // The pointer stays where the button was, over "Start from: Turbo": moved away, nothing looks chosen.
  await page.mouse.move(0, 0);
  await capture(page, "structure-generator");

  // The TV at the venue is nobody's: signed out, so no staff controls.
  const tv = await (await browser.newContext({ baseURL, viewport: TV, extraHTTPHeaders: PROXY_HEADERS })).newPage();
  await tv.goto(`/clock/${night.tonight.id}`);
  await expect(tv.getByRole("timer", { name: "Time left" })).toBeVisible();
  await expect(tv.getByTestId("display-qr")).toBeVisible();
  await capture(tv, "tv-display", { fullPage: false });

  await clockAction(page.request, night.tonight.id, { action: "jump", levelIndex: 6, expectedLevelIndex: 3 });
  await clockAction(page.request, night.tonight.id, { action: "set_remaining", remainingSeconds: 9 * 60 + 41, expectedLevelIndex: 6 });
  await tv.reload();
  await expect(tv.getByRole("heading", { name: "Last re-buys / add-ons" })).toBeVisible();
  await capture(tv, "tv-display-break", { fullPage: false });
  await tv.context().close();
});

test("the seating plan, on a laptop and a phone", async ({ page }) => {
  await signIn(page);
  for (const viewport of [LAPTOP, PHONE]) {
    await page.setViewportSize(viewport);
    await page.goto(`/admin/tournaments/${night.tonight.id}`);
    await page.getByRole("tab", { name: "Tables & Seating" }).click();
    await expect(page.getByTestId("table-1")).toBeVisible();
    await capture(page, "seating-plan");
  }
});

test("the players' seat finder and season leaderboard, on a phone", async ({ browser, baseURL }) => {
  const phone = await (await browser.newContext({ baseURL, viewport: PHONE, isMobile: true, hasTouch: true, extraHTTPHeaders: PROXY_HEADERS })).newPage();
  await phone.goto(`/tournament/${night.tonight.id}/seats`);
  await phone.getByTestId("seat-search").fill("Aroha");
  await expect(phone.getByTestId("seat-results")).toContainText(/Table \d+ · Seat \d+/);
  await capture(phone, "find-your-seat");

  await phone.goto(`/season/${night.season.id}`);
  await expect(phone.getByRole("heading", { name: night.season.name, level: 1 })).toBeVisible();
  await capture(phone, "season-leaderboard");
  await phone.context().close();
});

test("the AP panel on a quiet night, the AP fixed by hand", async ({ page }) => {
  await signIn(page);
  await page.setViewportSize(LAPTOP);
  await page.goto(`/admin/tournaments/${night.quiet.id}`);
  await expect(page.getByTestId("ap-panel").getByTestId("ap-override")).toBeVisible();
  await capture(page, "ap-panel");

  // On a phone the panel is one card among many: just the card.
  await page.setViewportSize(PHONE);
  await page.goto(`/admin/tournaments/${night.quiet.id}`);
  const panel = page.getByTestId("ap-panel");
  await expect(panel.getByTestId("ap-override")).toBeVisible();
  await settle(page);
  // The phone's fixed top bar would cover the card's top while it is scrolled into view.
  await panel.screenshot({ path: path.join(OUT_DIR, `ap-panel-${PHONE.width}x${PHONE.height}.png`), style: "header.fixed { visibility: hidden; }" });
});
