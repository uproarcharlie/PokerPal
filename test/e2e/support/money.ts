/**
 * What the money specs (round6-phone, round7-phone) check on the room's screens: the public page and
 * the TV show the prize pool and its places, and never what the club takes, keeps or adds (round 6,
 * the owner's rule), on screen or in what they are sent.
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import type { LiveDisplayDto, PublicPrizesDto } from "../../../shared/api/live-display";
import type { PrizePoolDto } from "../../../shared/api/prize-pool";
import { findTakingsKeys } from "../../../shared/api/public";
import type { TournamentDetailDto } from "../../../shared/api/tournaments";
import { expectJson } from "./api";
import { get } from "./phone";

/** The TV's money panel, set as the room sees it: the pool always, with the places. */
export const TV_MONEY = { showPrizePool: "always", showPayouts: true };

/** A public page's poll (LIVE_REFRESH_MS) and the TV's, with room to spare. */
export const NEXT_POLL = { timeout: 15_000 };

/**
 * Words for what the club takes, keeps or adds, or carries on to another game: never on a public
 * screen (round 6, the owner's rule), nor what is left over for the club's fee (round 7). "AP" is
 * matched as the word, in capitals, as the club writes it.
 */
const AP_WORD = /\bAP\b/;
const TAKINGS_WORDS = /\brake\b|kept by|keeps it|club keeps|added by the club|carried over to|low turnout|none tonight|\bleft ?over\b/i;

/** The page shows nothing of the club's takings, in any text on it (hidden text included). */
export async function expectNoTakingsOn(page: Page): Promise<void> {
  const text = await page.locator("body").textContent();
  expect(text, `${page.url()} names the AP`).not.toMatch(AP_WORD);
  expect(text, `${page.url()} names what the club takes or keeps`).not.toMatch(TAKINGS_WORDS);
}

/**
 * What the public page and the TV are sent carries none of the club's takings (the server's own scan),
 * nor who came in on a free entry (round 7): the prizes, the TV, the tournament and its sign-ups.
 */
export async function expectNoTakingsSent(request: APIRequestContext, tournamentId: string): Promise<{ prizes: PublicPrizesDto; display: LiveDisplayDto }> {
  const prizes = await get<PublicPrizesDto>(request, `/api/public/tournaments/${tournamentId}/prizes`);
  const display = await get<LiveDisplayDto>(request, `/api/public/tournaments/${tournamentId}/display`);
  const detail = await get<TournamentDetailDto>(request, `/api/tournaments/${tournamentId}`);
  const registrations = await get<unknown[]>(request, `/api/tournaments/${tournamentId}/registrations`);
  for (const body of [prizes, display, detail, registrations]) {
    expect(findTakingsKeys(body)).toEqual([]);
    expect(JSON.stringify(body)).not.toMatch(/low turnout/i);
  }
  return { prizes, display };
}

/** The staff's prize-pool breakdown (computePrizePool): `net` is what the places pay. */
export const poolOf = async (request: APIRequestContext, tournamentId: string) => (await get<PrizePoolDto>(request, `/api/tournaments/${tournamentId}/prize-pool`)).breakdown;

/** Opens the public tournament page; answers its table of what each place pays. */
export async function publicPrizes(visitor: Page, tournamentId: string) {
  await visitor.goto(`/tournament/${tournamentId}`);
  const places = visitor.getByRole("region", { name: "Prize structure" });
  await expect(places).toBeVisible();
  return places;
}

/** The public page's headline pool, once the TD has locked it. */
export const publicPool = (visitor: Page, amount: string) => visitor.getByText(`Total prize pool: ${amount}`, { exact: true });

/** The TV's clock for the tournament, started, so the room's screen is as on the night. */
export async function startClock(request: APIRequestContext, tournamentId: string): Promise<void> {
  await expectJson(await request.post(`/api/tournaments/${tournamentId}/clock/actions`, { data: { action: "start" } }), 200);
}
