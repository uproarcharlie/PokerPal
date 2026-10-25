/**
 * What the phone specs (round5-phone, round6-phone) share: the TD's 390 × 844 phone and the TV's
 * screen, waiting for the screen to settle and saving it, and a Central Stars night set up through the
 * API (the club as the boot seeds leave it, its regulars, their paid entries and its clock).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { devices, type APIRequestContext, type BrowserContextOptions, type Page } from "@playwright/test";
import type { StaffPlayer } from "../../../shared/api/players";
import type { ClubDto, PublicRegistration } from "../../../shared/api/public";
import { presetStructure } from "../../../shared/domain/blind-structures";
import { CENTRAL_STARS_THEME } from "../../../shared/domain/theme";
import { createClub, expectJson, registerPlayer, uniquePhone } from "./api";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const SCREENS = process.env.SCREENSHOTS_DIR ? path.resolve(REPO_ROOT, process.env.SCREENSHOTS_DIR) : null;

// The browser type is the project's (Chromium, with the fake camera); a device may not choose another.
const { defaultBrowserType: _browser, ...pixel7 } = devices["Pixel 7"];
/** A 390 × 844 phone (an iPhone 12–14's screen) with a phone's touch and user agent. */
export const PHONE: BrowserContextOptions = { ...pixel7, viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 } };
/** A laptop or a TV: a mouse, no touch, 1× pixels (contexts opened in a test take its `use` options unless told otherwise). */
const { defaultBrowserType: _desktopBrowser, ...desktopChrome } = devices["Desktop Chrome"];
export const screenOf = (width: number, height: number): BrowserContextOptions => ({ ...desktopChrome, viewport: { width, height }, screen: { width, height } });

/**
 * Waits for what animates in (Radix, the toasts) and every colour transition (a club's colours arriving)
 * to end, so what is read or pictured is what is finally on screen. A spinner animates for ever: only
 * animations that end are waited for.
 */
export async function settled(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
}

/** Saves the screen as `<name>.png` in SCREENSHOTS_DIR, when it is set. */
export async function shot(page: Page, name: string): Promise<void> {
  if (!SCREENS) return;
  await settled(page);
  await page.screenshot({ path: path.join(SCREENS, `${name}.png`) });
}

export const post = async <T>(request: APIRequestContext, url: string, data: object, status = 200) => expectJson<T>(await request.post(url, { data }), status);
export const put = async <T>(request: APIRequestContext, url: string, data: object) => expectJson<T>(await request.put(url, { data }), 200);
export const get = async <T>(request: APIRequestContext, url: string) => expectJson<T>(await request.get(url), 200);

/**
 * Central Stars as the boot seeds leave it on production: its AP label, 9-seat rectangles and (unless
 * `colours` is false, for a test that chooses them in club settings) its blue and gold.
 */
export async function centralStars(request: APIRequestContext, token: string, { colours = true } = {}): Promise<ClubDto> {
  const club = await createClub(request, `Central Stars ${token}`);
  return put<ClubDto>(request, `/api/clubs/${club.id}`, {
    defaultSeatsPerTable: 9,
    defaultTableShape: "rectangle",
    rakeLabel: "AP",
    ...(colours ? { theme: CENTRAL_STARS_THEME } : {}),
  });
}

/** The club's regulars, by name: it is their home club, so its QR page's search finds them. */
export async function regulars(request: APIRequestContext, clubId: string, names: readonly string[]): Promise<StaffPlayer[]> {
  const players: StaffPlayer[] = [];
  for (const name of names) players.push(await post<StaffPlayer>(request, "/api/players", { name, phone: uniquePhone(), clubId }, 201));
  return players;
}

/** Each player entered by the club's staff, paid (`paid: false`: signed up, not paid yet). */
export async function enter(request: APIRequestContext, tournamentId: string, players: readonly StaffPlayer[], { paid = true } = {}): Promise<PublicRegistration[]> {
  const entries: PublicRegistration[] = [];
  for (const player of players) entries.push(await registerPlayer(request, tournamentId, player.id, { paymentConfirmed: paid }));
  return entries;
}

/** The Central Stars "One Life Line" clock, set up (not started) by the club's staff, with any TV settings. */
export async function setUpClock(request: APIRequestContext, tournamentId: string, displaySettings?: object): Promise<void> {
  const clock = {
    structure: presetStructure("central_stars_one_life_line"),
    presetKey: "central_stars_one_life_line",
    ...(displaySettings ? { displaySettings } : {}),
    baseHash: null,
  };
  await expectJson(await request.put(`/api/tournaments/${tournamentId}/clock`, { data: clock }), 201);
}
