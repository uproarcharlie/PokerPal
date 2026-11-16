/**
 * Round 7 on the TD's phone (390 × 844), a player's phone and the TV (1920 × 1080).
 *
 * (k) Free entries from the quick actions: a player let in free is accepted and seated, and the pool
 *     does not change; with "Club pays their buy-in" it rises by the buy-in, with no AP taken. The
 *     public page and the TV show the pool and the places only. Past Max players there is none to give.
 * (l) A one-off game made on the phone with no season: the TV's QR code leads to its own page, and
 *     finalizing it pays prizes, scores no points and leaves the season's leaderboard as it was.
 * (m) A percentage that does not divide into whole dollars: the pool shown everywhere is what the places
 *     pay, and only the TD sees "Leftover $1 → AP".
 * (n) A $0 freeroll: players are accepted, not paid, and the club puts up the prize pool by hand.
 * (o) The mobile number is optional: a QR sign-up with a name only, then "That's me" when the same name
 *     signs up again; at the desk, a new player added by name, then "That's them".
 *
 * With SCREENSHOTS_DIR set (PLANNING/screens-round7 for the round's review), the screens the round's
 * brief names are saved there.
 */
import type { Page } from "@playwright/test";
import type { ApiErrorBody } from "../../shared/api/errors";
import type { FinalizePreviewDto } from "../../shared/api/finalize";
import type { LiveDisplayDto, PublicSeasonLeaderboardDto } from "../../shared/api/live-display";
import type { ClubPlayer } from "../../shared/api/players";
import type { PublicRegistration } from "../../shared/api/public";
import type { ManagedRegistration } from "../../shared/api/registrations";
import type { SeatingDto } from "../../shared/api/seating";
import type { TournamentDetailDto, TournamentListItemDto } from "../../shared/api/tournaments";
import { createPointsSystem, createSeason, createTournament, expectJson, registrationsOf, signUp, uniqueToken } from "./support/api";
import { expect, test } from "./support/fixtures";
import { expectNoTakingsOn, expectNoTakingsSent, NEXT_POLL, poolOf, publicPool, publicPrizes, startClock, TV_MONEY } from "./support/money";
import { centralStars, enter, get, PHONE, post, put, regulars, screenOf, setUpClock, shot } from "./support/phone";
import { choose, dismissToasts, toast } from "./support/ui";

test.use(PHONE);

/** Words that would tell the room who came in free, or that the club paid for them: staff-only (round 7). */
const FREE_ENTRY_WORDS = /free entr|club pays|for free entries/i;

/** The staff's view of the sign-ups: with their payments and free entries. */
const staffRegistrations = async (page: Page, tournamentId: string) => (await registrationsOf(page.request, tournamentId)) as ManagedRegistration[];

/** The staff's players list, searched by name (GET /api/players?q=). */
const playersNamed = (page: Page, name: string) => get<ClubPlayer[]>(page.request, `/api/players?q=${encodeURIComponent(name)}`);

/** Opens the quick actions' "Free entry" sheet. */
async function openFreeEntry(page: Page) {
  await page.getByTestId("quick-actions").click();
  await page.getByRole("menuitem", { name: "Free entry" }).click();
  const sheet = page.getByTestId("free-entry-sheet");
  await expect(sheet).toBeVisible();
  return sheet;
}

test("(k) free entries from the quick actions: accepted and seated, the pool unchanged or up by the buy-in the club pays, and none past Max players", async ({ page, openBrowser }) => {
  test.slow();
  const token = uniqueToken();
  await signUp(page.request, "Tess Director");
  const club = await centralStars(page.request, token);
  // $50 buy-ins with 10% AP and room for six: four have paid ($200 in, $20 AP, a $180 pool), two have
  // signed up and not paid, and a seventh is on the waiting list.
  const tournament = await createTournament(page.request, {
    clubId: club.id,
    name: `Season Prize Night ${token}`,
    buyInAmount: "50.00",
    rakeType: "percentage",
    rakeAmount: "10",
    payoutStructure: "standard",
    maxPlayers: 6,
  });
  const names = ["Aroha", "Ben", "Chloe", "Dev", "Ella", "Finn", "Grace"].map((name) => `${name} ${token}`);
  const players = await regulars(page.request, club.id, names);
  const paid = await enter(page.request, tournament.id, players.slice(0, 4));
  // The four at their seats; a latecomer is seated once accepted, so a free entry is seated as a payment would be.
  await put(page.request, `/api/tournaments/${tournament.id}`, { status: "in_progress", autoSeat: "once_paid" });
  await post(page.request, `/api/tournaments/${tournament.id}/seating/setup`, {}, 201);
  const [ella, finn, grace] = await enter(page.request, tournament.id, players.slice(4), { paid: false });
  // Locked, so the public page shows the amounts; the lock stops new sign-ups, not accepting those signed up.
  await put(page.request, `/api/tournaments/${tournament.id}`, { prizePoolLocked: true });
  await setUpClock(page.request, tournament.id, TV_MONEY);
  await startClock(page.request, tournament.id);
  const note = page.getByTestId("paid-players-note");

  await test.step("the Money tab: $180 from the four who paid", async () => {
    await page.goto(`/admin/tournaments/${tournament.id}?tab=money`);
    await expect(note).toHaveText(/Prize pool from 4 paid players · 2 not paid yet \(not in the pool\)/);
    await expect(page.getByTestId("net-prize-pool")).toHaveText("$180");
    expect((await poolOf(page.request, tournament.id)).net).toBe(18_000);
    const seating = await get<SeatingDto>(page.request, `/api/tournaments/${tournament.id}/seating`);
    expect(seating.seatByRegistrationId[ella!.id]).toBeUndefined();
  });

  await test.step("Ella's season prize: chosen from the sign-ups not paid yet, with a reason and a note, the club paying nothing in", async () => {
    const sheet = await openFreeEntry(page);
    await expect(sheet.getByTestId(`free-entry-pick-${ella!.id}`)).toContainText("Not paid yet");
    await expect(sheet.getByTestId(`free-entry-pick-${grace!.id}`)).toContainText("#1 on the waiting list");
    await sheet.getByTestId(`free-entry-pick-${ella!.id}`).click();
    await expect(sheet.getByRole("heading", { name: `Free entry for ${names[4]}` })).toBeVisible();
    await sheet.getByRole("group", { name: /Why is it free/ }).getByRole("button", { name: "Season prize" }).click();
    await sheet.getByLabel("Note (optional)").fill("Winter League winner");
    await expect(sheet.getByRole("switch", { name: "Club pays their buy-in into the pool" })).not.toBeChecked();
    await expect(sheet).toContainText("Off: their $50 buy-in adds nothing to the prize pool.");
    await shot(page, "free-entry-sheet-390x844");
    await sheet.getByTestId("give-free-entry").click();
    await expect(toast(page, "Free entry given")).toBeVisible();
    await expect(sheet).toBeHidden();
  });

  await test.step("Ella is accepted and seated, and the pool is still $180", async () => {
    const entry = (await staffRegistrations(page, tournament.id)).find((registration) => registration.id === ella!.id);
    expect(entry).toMatchObject({ paymentConfirmed: true, freeEntry: true, freeEntryFunded: false, freeEntryReason: "season_prize", freeEntryNote: "Winter League winner" });
    const seating = await get<SeatingDto>(page.request, `/api/tournaments/${tournament.id}/seating`);
    expect(seating.seatByRegistrationId[ella!.id]).toEqual({ tableNumber: expect.any(Number), seatNumber: expect.any(Number) });
    expect((await poolOf(page.request, tournament.id)).net).toBe(18_000);
    await expect(page.getByTestId("net-prize-pool")).toHaveText("$180");
    await expect(note).toHaveText(/Prize pool from 5 accepted players · 1 free entry · 1 not paid yet \(not in the pool\)/);
  });

  await test.step("the Players tab marks her FREE, and nobody else", async () => {
    await page.getByRole("tab", { name: "Players" }).click();
    const badge = page.getByTestId(`player-row-${ella!.id}`).getByTestId("free-entry-badge");
    await expect(badge).toBeVisible();
    await expect(badge).toHaveAttribute("title", "Season prize: Winter League winner");
    await expect(page.getByTestId("free-entry-badge")).toHaveCount(1);
    await expect(page.getByTestId(`player-row-${paid[0]!.id}`)).toBeVisible();
    await badge.evaluate((element) => element.scrollIntoView({ block: "center" }));
    await dismissToasts(page);
    await shot(page, "desk-free-badge-390x844");
  });

  await test.step("Finn's promo, the club paying his buy-in: the pool rises by his $50, with no AP taken", async () => {
    const sheet = await openFreeEntry(page);
    await sheet.getByTestId(`free-entry-pick-${finn!.id}`).click();
    await sheet.getByRole("group", { name: /Why is it free/ }).getByRole("button", { name: "Promo" }).click();
    await sheet.getByRole("switch", { name: "Club pays their buy-in into the pool" }).click();
    await expect(sheet).toContainText("Adds $50 to the prize pool, with no AP taken from it.");
    await sheet.getByTestId("give-free-entry").click();
    await expect(toast(page, "Free entry given")).toBeVisible();

    // $180 + $50: 50/30/20 pays $115/$69/$46.
    const pool = await poolOf(page.request, tournament.id);
    expect([pool.net, pool.rake.applied, pool.freeEntries]).toEqual([23_000, 2_000, { entries: 2, funded: 1, addedCents: 5_000 }]);
    await page.getByRole("tab", { name: "Money" }).click();
    await expect(page.getByTestId("net-prize-pool")).toHaveText("$230");
    await expect(page.getByTestId("pool-summary")).toContainText("Added by the club for free entries $50");
  });

  await test.step("the public page and the TV show the $230 pool and its places, and nothing of who came in free or what the club paid", async () => {
    const visitor = await (await openBrowser(PHONE)).newPage();
    const places = await publicPrizes(visitor, tournament.id);
    await expect(publicPool(visitor, "$230")).toBeVisible();
    await expect(places.getByRole("row")).toHaveText([/Position/, /1st.*\$115/, /2nd.*\$69/, /3rd.*\$46/]);
    await visitor.getByRole("tab", { name: "Standings" }).click();
    await expect(visitor.getByText(names[4]!).first()).toBeVisible();

    const tv = await (await openBrowser(screenOf(1920, 1080))).newPage();
    await tv.goto(`/clock/${tournament.id}?screen=tv`);
    await expect(tv.getByTestId("display-money")).toContainText("$230", NEXT_POLL);
    for (const screen of [visitor, tv]) {
      await expectNoTakingsOn(screen);
      expect(await screen.locator("body").textContent()).not.toMatch(FREE_ENTRY_WORDS);
    }
    const { prizes, display } = await expectNoTakingsSent(visitor.request, tournament.id);
    expect([prizes.poolCents, display.money.netCents]).toEqual([23_000, 23_000]);
    expect(JSON.stringify([prizes, display])).not.toMatch(FREE_ENTRY_WORDS);
  });

  await test.step("six of six are in: Grace, waiting, cannot be given one, and the server refuses it too", async () => {
    const sheet = await openFreeEntry(page);
    const row = sheet.getByTestId(`free-entry-pick-${grace!.id}`);
    await expect(row).toBeDisabled();
    await expect(row).toContainText("Field full");
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();

    const refused = await page.request.post(`/api/registrations/${grace!.id}/free-entry`, { data: { action: "give", reason: "promo" } });
    expect((await expectJson<ApiErrorBody>(refused, 409)).code).toBe("TOURNAMENT_FULL");
    const entry = (await staffRegistrations(page, tournament.id)).find((registration) => registration.id === grace!.id);
    expect(entry).toMatchObject({ paymentConfirmed: false, freeEntry: false });
    expect((await poolOf(page.request, tournament.id)).net).toBe(23_000);
  });
});

test("(l) a one-off game made on the phone: the TV's QR leads to its own page, and finalizing pays prizes with no points, the season's leaderboard untouched", async ({ page, openBrowser }) => {
  test.slow();
  const token = uniqueToken();
  await signUp(page.request, "Tess Director");
  const club = await centralStars(page.request, token);
  const season = await createSeason(page.request, club.id, `Summer League ${token}`);
  const points = await createPointsSystem(page.request, season.id, {
    name: `League Points ${token}`,
    participationPoints: 10,
    knockoutPoints: 5,
    allocations: [
      { position: 1, points: 100 },
      { position: 2, points: 60 },
      { position: 3, points: 40 },
    ],
  });
  const names = ["Aroha", "Ben", "Chloe", "Dev"].map((name) => `${name} ${token}`);
  const players = await regulars(page.request, club.id, names);

  // Last week's league night, finalized: the leaderboard the one-off must leave as it is.
  const league = await createTournament(page.request, { clubId: club.id, seasonId: season.id, pointsSystemId: points.id, trackPoints: true, name: `League Night ${token}`, payoutStructure: "standard" });
  const leagueEntries = await enter(page.request, league.id, players.slice(0, 3));
  await put(page.request, `/api/tournaments/${league.id}`, { status: "in_progress" });
  for (const out of [2, 1]) await put(page.request, `/api/registrations/${leagueEntries[out]!.id}`, { isEliminated: true, eliminatedBy: leagueEntries[0]!.playerId });
  const leaguePreview = await post<FinalizePreviewDto>(page.request, `/api/tournaments/${league.id}/finalize/preview`, {});
  await post(page.request, `/api/tournaments/${league.id}/finalize`, { expectedPlanHash: leaguePreview.planHash });
  const leaderboardUrl = `/api/public/seasons/${season.id}/leaderboard`;
  const { entries: leaderboard } = await get<PublicSeasonLeaderboardDto>(page.request, leaderboardUrl);
  expect(leaderboard.length).toBe(3);

  const name = `Charity Night ${token}`;
  let oneOff: TournamentListItemDto | undefined;
  await test.step("the TD makes the one-off on the phone: no season, so no points system and no points", async () => {
    await page.goto("/tournaments");
    await page.getByTestId("create-tournament-button").click();
    const form = page.getByRole("dialog", { name: "Create New Tournament" });
    await form.getByTestId("tournament-name").fill(name);
    await choose(page, form.getByTestId("club-select"), club.name);
    // The club has a season, but a game is a one-off until one is chosen.
    await expect(form.getByTestId("season-select")).toHaveText("No season (one-off game)");
    await expect(form.getByTestId("points-system-select")).toBeDisabled();
    await expect(form.getByTestId("points-system-select")).toHaveText("No points — one-off game");
    const trackPoints = form.getByRole("checkbox", { name: "Track Player Points" });
    await expect(trackPoints).not.toBeChecked();
    await expect(trackPoints).toBeDisabled();
    await form.getByTestId("start-datetime").fill("2026-11-20T19:30");
    await form.getByTestId("buyin-amount").fill("40");
    await form.getByTestId("min-players").fill("2");
    await form.getByTestId("max-players").fill("20");
    // The club, the season (with its label) and the points system in one view.
    await form.getByTestId("club-select").evaluate((element) => element.scrollIntoView({ block: "center" }));
    await shot(page, "one-off-form-390x844");
    await form.getByTestId("create-tournament-final").click();
    await expect(toast(page, "Tournament created successfully!")).toBeVisible();

    const oneOffs = await get<TournamentListItemDto[]>(page.request, `/api/tournaments?clubId=${club.id}&oneOff=true`);
    oneOff = oneOffs.find((tournament) => tournament.name === name);
    expect(oneOff).toMatchObject({ seasonId: null });
    const detail = await get<TournamentDetailDto>(page.request, `/api/tournaments/${oneOff!.id}`);
    expect(detail).toMatchObject({ seasonId: null, pointsSystemId: null, trackPoints: false });
  });
  const id = () => oneOff!.id;

  const entries: PublicRegistration[] = [];
  await test.step("the TV's QR code leads to the tournament's own page: there is no season leaderboard", async () => {
    entries.push(...(await enter(page.request, id(), players)));
    await put(page.request, `/api/tournaments/${id()}`, { status: "in_progress" });
    await setUpClock(page.request, id(), { ...TV_MONEY, qrTarget: "season" });
    await startClock(page.request, id());

    const tv = await (await openBrowser(screenOf(1920, 1080))).newPage();
    await tv.goto(`/clock/${id()}?screen=tv`);
    const qr = tv.getByTestId("display-qr");
    await expect(qr).toContainText("Scan for live results");
    await expect(qr).toContainText(`/tournament/${id()}`);
    const display = await get<LiveDisplayDto>(tv.request, `/api/public/tournaments/${id()}/display`);
    expect([display.season, display.qr]).toEqual([null, { target: "tournament", path: `/tournament/${id()}` }]);
    await shot(tv, "tv-one-off-1920x1080");
  });

  await test.step("End Tournament on the phone pays the prizes and scores no points", async () => {
    for (const out of [3, 2]) await put(page.request, `/api/registrations/${entries[out]!.id}`, { isEliminated: true, eliminatedBy: entries[0]!.playerId });
    await page.goto(`/admin/tournaments/${id()}?tab=more`);
    await page.getByTestId("end-tournament").click();
    const dialog = page.getByRole("dialog", { name: "End Tournament" });
    // Four $40 buy-ins, no AP: $160, 50/30/20.
    await expect(dialog.getByTestId("finalize-pool")).toContainText("$160");
    await expect(dialog.getByTestId("confirm-finalize")).toBeEnabled();
    await dialog.getByTestId("confirm-finalize").click();
    await expect(dialog).toBeHidden();

    expect((await get<TournamentDetailDto>(page.request, `/api/tournaments/${id()}`)).status).toBe("completed");
    const results = await registrationsOf(page.request, id());
    expect(results.map((entry) => Number(entry.prizeAmount ?? 0)).sort((a, b) => b - a)).toEqual([80, 48, 32, 0]);
    expect(results.map((entry) => entry.pointsAwarded ?? 0)).toEqual([0, 0, 0, 0]);
  });

  await test.step("the season's leaderboard is as it was, and the one-off is on no leaderboard", async () => {
    const after = await get<PublicSeasonLeaderboardDto>(page.request, leaderboardUrl);
    expect([after.entries, after.tournaments]).toEqual([leaderboard, { completed: 1, total: 1 }]);
    const visitor = await (await openBrowser(PHONE)).newPage();
    await visitor.goto(`/tournament/${id()}`);
    await visitor.getByRole("tab", { name: "Standings" }).click();
    await expect(visitor.getByText(names[0]!).first()).toBeVisible();
    // A one-off tracks no points: its standings have no Points to show.
    await expect(visitor.getByText("Points", { exact: true })).toHaveCount(0);
  });
});

test("(m) 50/30/20 of $475 in whole dollars: the pool shown everywhere is the $474 the places pay, and only the TD sees the $1 going to the AP", async ({ page, openBrowser }) => {
  test.slow();
  const token = uniqueToken();
  await signUp(page.request, "Tess Director");
  const club = await centralStars(page.request, token);
  // Five $95 buy-ins, no AP: $475. 50/30/20 is $237.50, $142.50 and $95: the places pay $237, $142 and $95.
  const tournament = await createTournament(page.request, { clubId: club.id, name: `Odd Dollars ${token}`, buyInAmount: "95.00", payoutStructure: "standard", maxPlayers: 27 });
  await enter(page.request, tournament.id, await regulars(page.request, club.id, ["Aroha", "Ben", "Chloe", "Dev", "Ella"].map((name) => `${name} ${token}`)));
  await put(page.request, `/api/tournaments/${tournament.id}`, { status: "in_progress", prizePoolLocked: true });
  await setUpClock(page.request, tournament.id, TV_MONEY);
  await startClock(page.request, tournament.id);

  await test.step("the TD's Money tab: a $474 pool, and the $1 left over going to the AP", async () => {
    await page.goto(`/admin/tournaments/${tournament.id}?tab=money`);
    await expect(page.getByTestId("prize-pool")).toHaveText("$474");
    await expect(page.getByTestId("net-prize-pool")).toHaveText("$474");
    await expect(page.getByTestId("difference-kept-by-club")).toContainText("$1");
    const summary = page.getByTestId("pool-summary");
    await expect(summary).toContainText("Prize pool $474");
    await expect(summary).toContainText("Leftover $1 → AP");
    await expect(page.getByTestId("payout-1")).toHaveText("$237");
    await expect(page.getByTestId("payout-2")).toHaveText("$142");
    await expect(page.getByTestId("payout-3")).toHaveText("$95");
    const pool = await poolOf(page.request, tournament.id);
    expect([pool.netAfterAp, pool.net, pool.difference.keptByClubCents]).toEqual([47_500, 47_400, 100]);
    expect(pool.payouts.map((payout) => payout.amountCents)).toEqual([23_700, 14_200, 9_500]);
    await summary.evaluate((element) => element.scrollIntoView({ block: "center" }));
    await shot(page, "money-leftover-390x844");
  });

  await test.step("the public page and the TV show $474 and the places, and nothing of what is left over", async () => {
    const visitor = await (await openBrowser(PHONE)).newPage();
    const places = await publicPrizes(visitor, tournament.id);
    await expect(publicPool(visitor, "$474")).toBeVisible();
    await expect(places.getByRole("row")).toHaveText([/Position/, /1st.*\$237/, /2nd.*\$142/, /3rd.*\$95/]);
    await expectNoTakingsOn(visitor);

    const tv = await (await openBrowser(screenOf(1920, 1080))).newPage();
    await tv.goto(`/clock/${tournament.id}?screen=tv`);
    await expect(tv.getByTestId("display-money")).toContainText("$474");
    const tvPlaces = tv.getByTestId("display-money").getByRole("list", { name: "Payouts" }).getByRole("listitem");
    await expect(tvPlaces).toHaveText([/1st\s*\$237/, /2nd\s*\$142/, /3rd\s*\$95/]);
    await expectNoTakingsOn(tv);
    const { prizes, display } = await expectNoTakingsSent(visitor.request, tournament.id);
    expect([prizes.poolCents, display.money.netCents]).toEqual([47_400, 47_400]);
    expect(prizes.payouts.map((payout) => payout.amountCents)).toEqual([23_700, 14_200, 9_500]);
  });
});

test("(n) a $0 freeroll: the TD accepts the players, and the club puts up a $300 prize pool that the room sees", async ({ page, openBrowser }) => {
  test.slow();
  const token = uniqueToken();
  await signUp(page.request, "Tess Director");
  const club = await centralStars(page.request, token);
  const tournament = await createTournament(page.request, { clubId: club.id, name: `Freeroll ${token}`, buyInAmount: "0.00", payoutStructure: "standard", maxPlayers: 27 });
  const names = ["Aroha", "Ben", "Chloe", "Dev"].map((name) => `${name} ${token}`);
  await enter(page.request, tournament.id, await regulars(page.request, club.id, names), { paid: false });
  await put(page.request, `/api/tournaments/${tournament.id}`, { status: "in_progress" });
  await setUpClock(page.request, tournament.id, TV_MONEY);
  await startClock(page.request, tournament.id);
  const note = page.getByTestId("paid-players-note");

  await test.step("the Money tab counts who is accepted, and Accept players accepts them at $0", async () => {
    await page.goto(`/admin/tournaments/${tournament.id}?tab=money`);
    await expect(note).toHaveText(/^0 accepted players · 4 not accepted yet/);
    await note.getByRole("button", { name: "Accept players" }).click();
    const sheet = page.getByRole("dialog", { name: "Accept players" });
    await expect(sheet).toContainText("Free tournament: accept each player who signed up.");
    for (const player of names) {
      await sheet.getByRole("button", { name: `Accept ${player}` }).click();
      await expect(sheet.getByRole("button", { name: `Accept ${player}` })).toHaveCount(0);
    }
    // Nobody paid: the desk says they are in.
    await expect(toast(page, `${names[3]} is in.`)).toBeVisible();
    await expect(toast(page, "Payment Confirmed")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(note).toHaveText("4 accepted players");
    expect((await staffRegistrations(page, tournament.id)).every((entry) => entry.paymentConfirmed === true && entry.freeEntry === false)).toBe(true);
  });

  await test.step("the TD sets the prize pool the club puts up: $300, added by the club", async () => {
    await page.getByTestId("edit-prize-pool").click();
    await page.getByTestId("manual-pool-input").fill("300");
    await page.getByTestId("save-manual-pool").click();
    await expect(toast(page, "Prize pool updated successfully")).toBeVisible();
    await expect(page.getByTestId("prize-pool")).toContainText("$300");
    await expect(page.getByTestId("pool-summary")).toContainText("Added by the club $300");
    const pool = await poolOf(page.request, tournament.id);
    expect([pool.gross.total, pool.net, pool.difference.addedByClubCents]).toEqual([0, 30_000, 30_000]);
    await dismissToasts(page);
    await shot(page, "freeroll-money-390x844");
  });

  await test.step("locked, the public page and the TV show the $300 and its places, and not who put it up", async () => {
    await put(page.request, `/api/tournaments/${tournament.id}`, { prizePoolLocked: true });
    const visitor = await (await openBrowser(PHONE)).newPage();
    const places = await publicPrizes(visitor, tournament.id);
    await expect(publicPool(visitor, "$300")).toBeVisible();
    await expect(places.getByRole("row")).toHaveText([/Position/, /1st.*\$150/, /2nd.*\$90/, /3rd.*\$60/]);
    await expectNoTakingsOn(visitor);

    const tv = await (await openBrowser(screenOf(1920, 1080))).newPage();
    await tv.goto(`/clock/${tournament.id}?screen=tv`);
    await expect(tv.getByTestId("display-money")).toContainText("$300");
    await expectNoTakingsOn(tv);
    const { prizes, display } = await expectNoTakingsSent(visitor.request, tournament.id);
    expect([prizes.poolCents, display.money.netCents]).toEqual([30_000, 30_000]);
  });
});

test("(o) the mobile number is optional: a QR sign-up by name only, \"That's me\" the next week, and the desk adding a player by name", async ({ page, openBrowser }) => {
  test.slow();
  const token = uniqueToken();
  await signUp(page.request, "Tess Director");
  const club = await centralStars(page.request, token);
  const tonight = await createTournament(page.request, { clubId: club.id, name: `Tonight ${token}`, buyInAmount: "40.00" });
  const nextWeek = await createTournament(page.request, { clubId: club.id, name: `Next Week ${token}`, buyInAmount: "40.00" });
  const mia = `Mia Ngata ${token}`;
  const playersPhone = await (await openBrowser(PHONE)).newPage();
  const startNewPlayer = async (tournamentId: string) => {
    await playersPhone.goto(`/register/${tournamentId}`);
    await playersPhone.getByTestId("player-type-new").click();
    await playersPhone.getByTestId("step1-next").click();
    await playersPhone.getByTestId("photo-skip").click();
    await playersPhone.getByTestId("player-name").fill(mia);
  };

  await test.step("a new player signs up from the QR code with a name and no mobile number", async () => {
    await startNewPlayer(tonight.id);
    await expect(playersPhone.getByLabel("Mobile (optional)")).toHaveValue("");
    await expect(playersPhone.getByTestId("privacy-notice")).toContainText("if you give it, your phone number");
    await shot(playersPhone, "signup-no-phone-390x844");
    await playersPhone.getByTestId("step2-next").click();
    await expect(playersPhone.getByTestId("registering-as")).toHaveText(`Registering ${mia}`);
    await playersPhone.getByTestId("complete-registration").click();
    await expect(playersPhone.getByText("Registration Complete!")).toBeVisible();

    const [player] = await playersNamed(page, mia);
    expect(player).toMatchObject({ name: mia, phone: null });
    expect((await registrationsOf(page.request, tonight.id)).map((entry) => entry.playerId)).toEqual([player!.id]);
  });

  await test.step("the next week she types her name again and taps That's me: signed up as herself, not as a second player", async () => {
    const [player] = await playersNamed(page, mia);
    await startNewPlayer(nextWeek.id);
    await playersPhone.getByTestId("step2-next").click();
    const suggestion = playersPhone.getByTestId("same-name-suggestion");
    await expect(suggestion).toContainText("Already played here?");
    await expect(suggestion.getByRole("button")).toHaveCount(1);
    await expect(playersPhone.getByTestId("step2-next")).toHaveCount(0);
    await shot(playersPhone, "signup-thats-me-390x844");
    await suggestion.getByTestId(`same-name-${player!.id}`).click();
    await expect(playersPhone.getByTestId("registering-as")).toHaveText(`Registering ${mia}`);
    await playersPhone.getByTestId("complete-registration").click();
    await expect(playersPhone.getByText("Registration Complete!")).toBeVisible();

    expect(await playersNamed(page, mia)).toHaveLength(1);
    expect((await registrationsOf(page.request, nextWeek.id)).map((entry) => entry.playerId)).toEqual([player!.id]);
  });

  const kai = `Kai Parata ${token}`;
  const registerAtDesk = async (tournamentId: string) => {
    await page.goto(`/admin/tournaments/${tournamentId}`);
    await page.getByTestId("quick-actions").click();
    await page.getByTestId("quick-register").click();
    const sheet = page.getByRole("dialog", { name: "Register Player" });
    await sheet.getByTestId("add-new-player").click();
    await sheet.getByTestId("new-player-name").fill(kai);
    await expect(sheet.getByTestId("new-player-phone")).toHaveValue("");
    await sheet.getByTestId("new-player-add").click();
    return sheet;
  };

  await test.step("at the desk the TD adds a new player by name only, and registers them", async () => {
    const sheet = await registerAtDesk(nextWeek.id);
    await expect(sheet.getByTestId("new-player-added")).toContainText("New player added");
    await sheet.getByTestId("register-player-final").click();
    await expect(toast(page, "Player registered")).toBeVisible();
    const [player] = await playersNamed(page, kai);
    expect(player).toMatchObject({ name: kai, phone: null });
    expect((await registrationsOf(page.request, nextWeek.id)).map((entry) => entry.playerId)).toContain(player!.id);
  });

  await test.step("the same name at the desk the next time: That's them, the same player", async () => {
    const [player] = await playersNamed(page, kai);
    const sheet = await registerAtDesk(tonight.id);
    const suggestion = sheet.getByTestId("same-name-suggestion");
    await expect(suggestion).toContainText("Played before?");
    await suggestion.getByTestId(`same-name-${player!.id}`).click();
    await expect(sheet.getByTestId("new-player-added")).toContainText("Has played before");
    await sheet.getByTestId("register-player-final").click();
    await expect(toast(page, "Player registered")).toBeVisible();
    expect(await playersNamed(page, kai)).toHaveLength(1);
    expect((await registrationsOf(page.request, tonight.id)).map((entry) => entry.playerId)).toContain(player!.id);
  });
});
