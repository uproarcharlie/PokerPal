/**
 * Round 6 on the TD's phone (390 × 844) and the TV (1920 × 1080): the owner's two money rules.
 *
 * (f) The prize pool counts only players who have paid: the TD's Money tab says how many have and have
 *     not, and the pool rises on the TD's phone, the public page and the TV together, and only, when a
 *     payment is confirmed at the desk.
 * (g) The AP is the staff's alone: a manual AP total for a low turnout and "No AP tonight" change the
 *     pool everyone sees, but the public page and the TV never show the AP, its reason or what the club
 *     keeps, on screen or in what they are sent.
 * (h) The payout editor leaves what the places do not pay with the club by default ("Club keeps it"):
 *     the TD is told what the club keeps; the public page and the TV show the places only.
 * (i) End Tournament with players who have not paid: it says who owes what, one payment is confirmed in
 *     the sheet (its toast covering none of the sheet's rows), the other player is left out (not ranked,
 *     paid or scored), and the night is finalized; Correct Results then starts with her still left out,
 *     and her late payment puts her back in the order to finalize again.
 * (j) The waiting list: a second QR sign-up past Max players waits as #2, and neither adds anything to
 *     the prize pool or counts as "not paid yet".
 *
 * With SCREENSHOTS_DIR set (PLANNING/screens-round6 for the round's review), the screens the round's
 * brief names are saved there.
 */
import type { APIRequestContext, Locator, Page } from "@playwright/test";
import type { LiveDisplayDto, PublicPrizesDto } from "../../shared/api/live-display";
import type { PrizePoolDto } from "../../shared/api/prize-pool";
import { findTakingsKeys } from "../../shared/api/public";
import type { TournamentDetailDto } from "../../shared/api/tournaments";
import { createTournament, expectJson, registrationsOf, signUp, uniquePhone, uniqueToken } from "./support/api";
import { expect, test } from "./support/fixtures";
import { centralStars, enter, get, PHONE, put, regulars, screenOf, settled, setUpClock, shot } from "./support/phone";
import { toast } from "./support/ui";

test.use(PHONE);

/** The TV's money panel, set as the room sees it: the pool always, with the places. */
const TV_MONEY = { showPrizePool: "always", showPayouts: true };

/** A public page's poll (LIVE_REFRESH_MS) and the TV's, with room to spare. */
const NEXT_POLL = { timeout: 15_000 };

/**
 * Words for what the club takes, keeps or adds, or carries on to another game: never on a public
 * screen (round 6, the owner's rule). "AP" is matched as the word, in capitals, as the club writes it.
 */
const AP_WORD = /\bAP\b/;
const TAKINGS_WORDS = /\brake\b|kept by|keeps it|club keeps|added by the club|carried over to|low turnout|none tonight/i;

/** The page shows nothing of the club's takings, in any text on it (hidden text included). */
async function expectNoTakingsOn(page: Page): Promise<void> {
  const text = await page.locator("body").textContent();
  expect(text, `${page.url()} names the AP`).not.toMatch(AP_WORD);
  expect(text, `${page.url()} names what the club takes or keeps`).not.toMatch(TAKINGS_WORDS);
}

/** What the public page and the TV are sent carries none of the club's takings (the server's own scan). */
async function expectNoTakingsSent(request: APIRequestContext, tournamentId: string): Promise<{ prizes: PublicPrizesDto; display: LiveDisplayDto }> {
  const prizes = await get<PublicPrizesDto>(request, `/api/public/tournaments/${tournamentId}/prizes`);
  const display = await get<LiveDisplayDto>(request, `/api/public/tournaments/${tournamentId}/display`);
  const detail = await get<TournamentDetailDto>(request, `/api/tournaments/${tournamentId}`);
  for (const body of [prizes, display, detail]) {
    expect(findTakingsKeys(body)).toEqual([]);
    expect(JSON.stringify(body)).not.toMatch(/low turnout/i);
  }
  return { prizes, display };
}

const poolOf = async (request: APIRequestContext, tournamentId: string) => (await get<PrizePoolDto>(request, `/api/tournaments/${tournamentId}/prize-pool`)).breakdown;

/**
 * While a toast shows over a phone sheet, none of the sheet's rows is under it (R6REV1-PHONE-03): what
 * scrolls ends above the toasts, so every finishing-order arrow in view can be tapped.
 */
async function expectSheetClearOfToasts(page: Page, sheet: Locator): Promise<void> {
  const toastTop = async () => Math.min(...(await page.getByRole("region", { name: "Notifications" }).getByRole("listitem").evaluateAll((items) => items.map((item) => item.getBoundingClientRect().top))));
  const bodyBottom = () => sheet.locator(".overflow-y-auto").first().evaluate((body) => body.getBoundingClientRect().bottom);
  await expect.poll(async () => (await bodyBottom()) <= (await toastTop()), { message: "the sheet's body ends above the toasts" }).toBe(true);
  const arrows = sheet.getByRole("button", { name: /^Move .+ (up|down)$/ });
  expect(await arrows.count(), "the finishing order has arrows").toBeGreaterThan(0);
  for (const arrow of await arrows.all()) {
    const where = await arrow.evaluate((button) => {
      const box = button.getBoundingClientRect();
      const view = button.closest(".overflow-y-auto")?.getBoundingClientRect();
      const [x, y] = [box.left + box.width / 2, box.top + box.height / 2];
      if (!view || y < view.top || y > view.bottom) return "scrolled out of view";
      const top = document.elementFromPoint(x, y);
      return top && button.contains(top) ? "tappable" : "under something";
    });
    expect(where, `${await arrow.getAttribute("aria-label")}`).not.toBe("under something");
  }
}

/** Opens the public tournament page; answers its table of what each place pays. */
async function publicPrizes(visitor: Page, tournamentId: string) {
  await visitor.goto(`/tournament/${tournamentId}`);
  const places = visitor.getByRole("region", { name: "Prize structure" });
  await expect(places).toBeVisible();
  return places;
}

/** The public page's headline pool, once the TD has locked it. */
const publicPool = (visitor: Page, amount: string) => visitor.getByText(`Total prize pool: ${amount}`, { exact: true });

/** The TV's clock for the tournament, started, so the room's screen is as on the night. */
async function startClock(request: APIRequestContext, tournamentId: string): Promise<void> {
  await expectJson(await request.post(`/api/tournaments/${tournamentId}/clock/actions`, { data: { action: "start" } }), 200);
}

test("(f) the prize pool counts only paid players: the TD's phone, the public page and the TV rise together when a payment is confirmed", async ({ page, openBrowser }) => {
  test.slow();
  const token = uniqueToken();
  await signUp(page.request, "Tess Director");
  const club = await centralStars(page.request, token);
  // $50 buy-ins with 10% AP: four paid are $200 in, $20 AP, a $180 pool. Two more have signed up, not paid.
  const tournament = await createTournament(page.request, {
    clubId: club.id,
    name: `Pay at the Door ${token}`,
    buyInAmount: "50.00",
    rakeType: "percentage",
    rakeAmount: "10",
    payoutStructure: "standard",
    maxPlayers: 27,
  });
  const names = ["Aroha", "Ben", "Chloe", "Dev", "Ella", "Finn"].map((name) => `${name} ${token}`);
  const players = await regulars(page.request, club.id, names);
  await enter(page.request, tournament.id, players.slice(0, 4));
  await enter(page.request, tournament.id, players.slice(4), { paid: false });
  // Locked, so the public page shows the amounts; a payment taken late still goes in (the lock stops new entries).
  await put(page.request, `/api/tournaments/${tournament.id}`, { status: "in_progress", prizePoolLocked: true });
  await setUpClock(page.request, tournament.id, TV_MONEY);
  await startClock(page.request, tournament.id);

  const note = page.getByTestId("paid-players-note");
  await test.step("the TD's Money tab says whose money the pool holds: 4 paid, 2 not paid yet, with the way to take payments", async () => {
    await page.goto(`/admin/tournaments/${tournament.id}?tab=money`);
    await expect(note).toHaveText(/Prize pool from 4 paid players · 2 not paid yet \(not in the pool\)/);
    // On the phone it opens the desk's own Take payment sheet: no link off the desk (R6REV1-PHONE-02).
    await expect(note.getByRole("button", { name: "Take payments" })).toBeVisible();
    await expect(note.getByRole("link")).toHaveCount(0);
    await expect(page.getByTestId("prize-pool")).toContainText("$180");
    await expect(page.getByTestId("net-prize-pool")).toHaveText("$180");
    // The entries are every player's: the TV counts them the same way.
    await expect(page.getByTestId("total-buyins")).toHaveText("6");
    expect((await poolOf(page.request, tournament.id)).net).toBe(18_000);
    // The tab's top: the players and the pool, then whose money it is.
    await expect(note).toBeInViewport();
    await shot(page, "admin-money-390x844");
  });

  const visitor = await (await openBrowser(PHONE)).newPage();
  const tv = await (await openBrowser(screenOf(1920, 1080))).newPage();
  const tvMoney = tv.getByTestId("display-money");
  await test.step("the public page and the TV show the same $180: what the paid players are playing for, and nothing of the AP", async () => {
    await publicPrizes(visitor, tournament.id);
    await expect(publicPool(visitor, "$180")).toBeVisible();
    await expectNoTakingsOn(visitor);

    await tv.goto(`/clock/${tournament.id}?screen=tv`);
    await expect(tvMoney).toContainText("$180");
    await expectNoTakingsOn(tv);
    const { prizes, display } = await expectNoTakingsSent(visitor.request, tournament.id);
    expect([prizes.poolCents, display.money.netCents]).toEqual([18_000, 18_000]);
  });

  await test.step("the TD takes Ella's payment from the note's Take payments, without leaving the desk: the pool rises to $225 on the phone", async () => {
    await note.getByRole("button", { name: "Take payments" }).click();
    const sheet = page.getByRole("dialog", { name: "Take payment" });
    await sheet.getByRole("button", { name: `Confirm payment for ${names[4]}` }).click();
    await expect(toast(page, "Payment Confirmed")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    // Still on the desk's Money tab, its tab bar and quick actions in place.
    expect(new URL(page.url()).pathname).toBe(`/admin/tournaments/${tournament.id}`);
    await expect(page.getByRole("tab", { name: "Money" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("quick-actions")).toBeVisible();

    // Five paid: $250 in, $25 AP.
    await expect(note).toHaveText(/Prize pool from 5 paid players · 1 not paid yet \(not in the pool\)/);
    await expect(page.getByTestId("net-prize-pool")).toHaveText("$225");
  });

  await test.step("the public page and the TV follow at their next poll, and all three agree", async () => {
    await expect(publicPool(visitor, "$225")).toBeVisible(NEXT_POLL);
    await expect(tvMoney).toContainText("$225", NEXT_POLL);
    const { prizes, display } = await expectNoTakingsSent(visitor.request, tournament.id);
    expect([prizes.poolCents, display.money.netCents, (await poolOf(page.request, tournament.id)).net]).toEqual([22_500, 22_500, 22_500]);
    // The TV still counts every player in the game, paid or not: the chips are on the table.
    expect(display.stats).toMatchObject({ entrants: 6, remaining: 6 });
    await expectNoTakingsOn(visitor);
    await expectNoTakingsOn(tv);
    await publicPool(visitor, "$225").evaluate((element) => element.scrollIntoView({ block: "center" }));
    await shot(visitor, "public-tournament-390x844");
    await shot(tv, "tv-1920x1080");
  });
});

test("(g) a manual AP and No AP tonight change the pool everyone sees, but only the TD ever sees the AP", async ({ page, openBrowser }) => {
  test.slow();
  const token = uniqueToken();
  await signUp(page.request, "Tess Director");
  const club = await centralStars(page.request, token);
  // Eight $50 buy-ins with 10% AP: $400 in, $40 AP, a $360 pool.
  const tournament = await createTournament(page.request, {
    clubId: club.id,
    name: `Quiet Night ${token}`,
    buyInAmount: "50.00",
    rakeType: "percentage",
    rakeAmount: "10",
    payoutStructure: "standard",
    maxPlayers: 27,
  });
  await enter(page.request, tournament.id, await regulars(page.request, club.id, ["Aroha", "Ben", "Chloe", "Dev", "Ella", "Finn", "Grace", "Hemi"].map((name) => `${name} ${token}`)));
  await put(page.request, `/api/tournaments/${tournament.id}`, { status: "in_progress", prizePoolLocked: true });
  await setUpClock(page.request, tournament.id, TV_MONEY);
  await startClock(page.request, tournament.id);
  const panel = page.getByTestId("ap-panel");
  const visitor = await (await openBrowser(PHONE)).newPage();
  const tv = await (await openBrowser(screenOf(1920, 1080))).newPage();

  await test.step("the TD fixes the AP at $10 for a low turnout, in the full-screen sheet", async () => {
    await page.goto(`/admin/tournaments/${tournament.id}?tab=money`);
    await expect(panel.getByTestId("ap-take")).toHaveText("$40");
    await panel.getByTestId("adjust-ap").click();
    const sheet = page.getByRole("dialog", { name: "Adjust AP" });
    await sheet.getByLabel("Set AP total").check();
    await sheet.getByTestId("adjust-amount").fill("10");
    await sheet.getByRole("group", { name: "Common reasons" }).getByRole("button", { name: "Low turnout" }).click();
    await shot(page, "ap-sheet-390x844");
    await sheet.getByTestId("save-adjustment").click();
    await expect(toast(page, "AP fixed at $10")).toBeVisible();
    await expect(sheet).toBeHidden();
    await expect(page.getByTestId("net-prize-pool")).toHaveText("$390");
  });

  await test.step("the public page and the TV show the $390 pool, never the AP, its reason or what it keeps", async () => {
    await publicPrizes(visitor, tournament.id);
    await expect(publicPool(visitor, "$390")).toBeVisible();
    await expectNoTakingsOn(visitor);
    await tv.goto(`/clock/${tournament.id}?screen=tv`);
    await expect(tv.getByTestId("display-money")).toContainText("$390");
    await expectNoTakingsOn(tv);
    const { prizes, display } = await expectNoTakingsSent(visitor.request, tournament.id);
    expect([prizes.poolCents, display.money.netCents]).toEqual([39_000, 39_000]);
  });

  await test.step("No AP tonight: the TD sees it taken off; the room sees a $400 pool and still no AP", async () => {
    await panel.getByTestId("no-ap").click();
    // The pool is locked: the TD is told its published payouts change first.
    const ask = page.getByRole("alertdialog", { name: "No AP tonight?" });
    await expect(ask).toContainText("its published payouts change, to a pool of $400 with no AP");
    await ask.getByRole("button", { name: "No AP tonight" }).click();
    await expect(toast(page, "No AP tonight")).toBeVisible();
    await expect(panel.getByTestId("no-ap-tonight")).toContainText("AP: none tonight");
    await expect(page.getByTestId("net-prize-pool")).toHaveText("$400");

    await expect(publicPool(visitor, "$400")).toBeVisible(NEXT_POLL);
    await expect(tv.getByTestId("display-money")).toContainText("$400", NEXT_POLL);
    await expectNoTakingsOn(visitor);
    await expectNoTakingsOn(tv);
    const { prizes } = await expectNoTakingsSent(visitor.request, tournament.id);
    expect(prizes.poolCents).toBe(40_000);
  });
});

test("(h) the payout editor's default leaves what the places do not pay with the club: the TD is told, the room is not", async ({ page, openBrowser }) => {
  test.slow();
  const token = uniqueToken();
  await signUp(page.request, "Tess Director");
  const club = await centralStars(page.request, token);
  // Eight $50 buy-ins, no AP: $400.
  const tournament = await createTournament(page.request, { clubId: club.id, name: `Fixed Second ${token}`, buyInAmount: "50.00", payoutStructure: "standard", maxPlayers: 27 });
  await enter(page.request, tournament.id, await regulars(page.request, club.id, ["Aroha", "Ben", "Chloe", "Dev", "Ella", "Finn", "Grace", "Hemi"].map((name) => `${name} ${token}`)));
  await put(page.request, `/api/tournaments/${tournament.id}`, { status: "in_progress", prizePoolLocked: true });
  await setUpClock(page.request, tournament.id, TV_MONEY);
  await startClock(page.request, tournament.id);

  await test.step("2nd is set to a fixed $100: what is left over goes to the club unless the TD says otherwise", async () => {
    await page.goto(`/admin/tournaments/${tournament.id}?tab=money`);
    await page.getByTestId("edit-payouts").first().click();
    const editor = page.getByRole("dialog", { name: "Edit payouts" });
    await editor.getByTestId("customise-payouts").click();
    await editor.getByTestId("payout-place-2").getByRole("button", { name: "Fixed amount" }).click();
    await editor.getByLabel("2nd place", { exact: true }).fill("100");
    await expect(editor.getByTestId("payout-pays-2")).toContainText("$100 (fixed)");
    // 1st's 50% is $200 and 3rd's 20% $80: $380 of the $400, so $20 is left over.
    const choice = editor.getByTestId("difference-choice");
    await expect(choice).toContainText("Where does the $20 left over go?");
    await expect(choice.getByRole("radio", { name: /^Club keeps it/ })).toBeChecked();
    await editor.getByRole("button", { name: "Short field" }).click();
    await editor.getByTestId("save-payouts").click();
    await expect(editor).toBeHidden();
  });

  await test.step("the TD's Money tab says what the club keeps", async () => {
    await expect(page.getByTestId("difference-kept-by-club")).toContainText("$20");
    const pool = await poolOf(page.request, tournament.id);
    expect(pool.payouts.map((payout) => payout.amountCents)).toEqual([20_000, 10_000, 8_000]);
    expect(pool.difference).toMatchObject({ choice: "club", keptByClubCents: 2_000 });
  });

  await test.step("the public page and the TV show the places as set, and nothing of what the club keeps", async () => {
    const visitor = await (await openBrowser(PHONE)).newPage();
    const places = await publicPrizes(visitor, tournament.id);
    await expect(publicPool(visitor, "$380")).toBeVisible();
    await expect(places.getByRole("row")).toHaveText([/Position/, /1st.*\$200/, /2nd.*\$100/, /3rd.*\$80/]);
    await expectNoTakingsOn(visitor);

    const tv = await (await openBrowser(screenOf(1920, 1080))).newPage();
    await tv.goto(`/clock/${tournament.id}?screen=tv`);
    const tvPlaces = tv.getByTestId("display-money").getByRole("list", { name: "Payouts" }).getByRole("listitem");
    await expect(tvPlaces).toHaveText([/1st\s*\$200/, /2nd\s*\$100/, /3rd\s*\$80/]);
    await expectNoTakingsOn(tv);
    const { prizes, display } = await expectNoTakingsSent(visitor.request, tournament.id);
    expect(prizes.payouts.map((payout) => payout.amountCents)).toEqual([20_000, 10_000, 8_000]);
    expect(display.money.payouts?.map((payout) => payout.amountCents)).toEqual([20_000, 10_000, 8_000]);
  });
});

test("(i) End Tournament with players who have not paid: one payment taken in the sheet, the other player left out, then finalized", async ({ page, openBrowser }) => {
  test.slow();
  const token = uniqueToken();
  await signUp(page.request, "Tess Director");
  const club = await centralStars(page.request, token);
  const tournament = await createTournament(page.request, { clubId: club.id, name: `Last Orders ${token}`, buyInAmount: "50.00", payoutStructure: "standard", maxPlayers: 27 });
  const names = ["Aroha", "Ben", "Chloe", "Dee", "Eve"].map((name) => `${name} ${token}`);
  const players = await regulars(page.request, club.id, names);
  const entries = [...(await enter(page.request, tournament.id, players.slice(0, 3))), ...(await enter(page.request, tournament.id, players.slice(3), { paid: false }))];
  const entryOf = (index: number) => entries[index]!;
  await put(page.request, `/api/tournaments/${tournament.id}`, { status: "in_progress" });
  // Eve goes out first, then Dee and Chloe: Aroha and Ben are still in, so the TD gives their order.
  for (const index of [4, 3, 2]) await put(page.request, `/api/registrations/${entryOf(index).id}`, { isEliminated: true, eliminatedBy: entryOf(0).playerId });
  const finishingOrder = page.getByRole("dialog", { name: "End Tournament" }).getByRole("list", { name: "Finishing order" }).getByRole("listitem");

  const dialog = page.getByRole("dialog", { name: "End Tournament" });
  const unpaid = dialog.getByTestId("finalize-unpaid");
  await test.step("End Tournament says who has not paid and what each owes, and will not finalize until that is settled", async () => {
    await page.goto(`/admin/tournaments/${tournament.id}?tab=more`);
    await page.getByTestId("end-tournament").click();
    await expect(unpaid).toContainText("2 players have not paid");
    await expect(unpaid.getByTestId(`unpaid-${entryOf(3).id}`)).toContainText("Owes $50");
    await expect(unpaid.getByTestId(`unpaid-${entryOf(4).id}`)).toContainText("Owes $50");
    await expect(dialog.getByTestId("finalize-pool")).toContainText("$150");
    await expect(dialog.getByTestId("confirm-finalize")).toBeDisabled();
    await settled(page);
    const box = await dialog.boundingBox();
    expect(box && [box.x, box.y, box.width, box.height].map(Math.round), "End Tournament fills the phone's screen").toEqual([0, 0, 390, 844]);
    await shot(page, "finalize-sheet-390x844");
  });

  await test.step("Dee pays at the desk: confirmed in the sheet, her $50 goes into the pool, and the toast covers none of the sheet", async () => {
    await unpaid.getByRole("button", { name: `Confirm ${names[3]}'s payment` }).click();
    await expect(toast(page, "Payment Confirmed")).toBeVisible();
    await expect(unpaid).toContainText("1 player has not paid");
    await expect(dialog.getByTestId("finalize-pool")).toContainText("$200");
    await expect(finishingOrder).toHaveCount(2);
    await settled(page);
    await expectSheetClearOfToasts(page, dialog);
  });

  // The two still in, in the order the TD finalized them (the server suggests it).
  let top: number[] = [];
  await test.step("Eve never paid: the TD leaves her out, and finalizes", async () => {
    await unpaid.getByTestId("leave-out-unpaid").click();
    await expect(unpaid).toContainText("Left out: 1 not paid");
    await expect(dialog.getByTestId("confirm-finalize")).toBeEnabled();
    const shown = await finishingOrder.allTextContents();
    top = shown.map((text) => names.findIndex((name) => text.includes(name)));
    expect([...top].sort()).toEqual([0, 1]);
    await dialog.getByTestId("confirm-finalize").click();
    await expect(dialog).toBeHidden();

    const finished = await get<TournamentDetailDto>(page.request, `/api/tournaments/${tournament.id}`);
    expect(finished.status).toBe("completed");
    const results = new Map((await registrationsOf(page.request, tournament.id)).map((entry) => [entry.id, entry]));
    // Four paid entries: $200, standard 50/30/20 over the top three.
    expect([...top, 2, 3].map((index) => [results.get(entryOf(index).id)?.finalPosition, Number(results.get(entryOf(index).id)?.prizeAmount ?? 0)])).toEqual([
      [1, 100],
      [2, 60],
      [3, 40],
      [4, 0],
    ]);
    // Left out: not ranked, paid or scored.
    expect(results.get(entryOf(4).id)).toMatchObject({ finalPosition: null, prizeAmount: null });
  });

  await test.step("the public page shows what was paid, from the paid players only", async () => {
    const visitor = await (await openBrowser(PHONE)).newPage();
    await publicPrizes(visitor, tournament.id);
    await expect(publicPool(visitor, "$200")).toBeVisible();
    await expectNoTakingsOn(visitor);
  });

  const correct = page.getByRole("dialog", { name: "Correct Results" });
  await test.step("Eve pays the next day: Correct Results starts with her still left out, and her payment puts her back in, last (R6REV1-PHONE-01)", async () => {
    await page.getByTestId("correct-results").click();
    const panel = correct.getByTestId("finalize-unpaid");
    await expect(panel).toContainText("Left out: 1 not paid");
    await expect(correct.getByTestId("confirm-correction")).toBeEnabled();
    await expect(correct).not.toContainText("Give the finishing order");
    const order = correct.getByRole("list", { name: "Finishing order" }).getByRole("listitem");
    await expect(order).toHaveCount(4);

    await panel.getByRole("button", { name: `Confirm ${names[4]}'s payment` }).click();
    await expect(correct.getByTestId("back-in-order")).toContainText(`${names[4]} has paid and is back in the order, last`);
    await expect(order).toHaveCount(5);
    await expect(order.last()).toContainText(names[4]);
    await expect(correct.getByTestId("finalize-unpaid")).toBeHidden();
    await expect(correct.getByTestId("confirm-correction")).toBeEnabled();
    await expect(correct).not.toContainText("Give the finishing order");
    await correct.getByTestId("confirm-correction").click();
    await expect(correct).toBeHidden();

    // Five paid entries: $250, 50/30/20 over the top three; Eve, out first, is 5th.
    const results = new Map((await registrationsOf(page.request, tournament.id)).map((entry) => [entry.id, entry]));
    expect([...top, 2, 3, 4].map((index) => [results.get(entryOf(index).id)?.finalPosition, Number(results.get(entryOf(index).id)?.prizeAmount ?? 0)])).toEqual([
      [1, 125],
      [2, 75],
      [3, 50],
      [4, 0],
      [5, 0],
    ]);
  });
});

test("(j) a second QR sign-up past Max players waits as #2, and the waiting list adds nothing to the pool", async ({ page, openBrowser }) => {
  test.slow();
  const token = uniqueToken();
  await signUp(page.request, "Tess Director");
  const club = await centralStars(page.request, token);
  const tournament = await createTournament(page.request, { clubId: club.id, name: `Two Seats ${token}`, buyInAmount: "40.00", maxPlayers: 2 });
  await enter(page.request, tournament.id, await regulars(page.request, club.id, ["Aroha", "Ben"].map((name) => `${name} ${token}`)));
  await setUpClock(page.request, tournament.id, TV_MONEY);
  const playersPhone = await (await openBrowser(PHONE)).newPage();
  const signUpLate = async (name: string, place: number) => {
    await playersPhone.goto(`/register/${tournament.id}`);
    await expect(playersPhone.getByTestId("waiting-list-notice")).toContainText(`#${place} on the waiting list`);
    await playersPhone.getByTestId("player-type-new").click();
    await playersPhone.getByTestId("step1-next").click();
    await playersPhone.getByTestId("photo-skip").click();
    await playersPhone.getByTestId("player-name").fill(name);
    await playersPhone.getByTestId("player-phone").fill(uniquePhone());
    await playersPhone.getByTestId("step2-next").click();
    await playersPhone.getByTestId("complete-registration").click();
    await expect(playersPhone.getByTestId("waiting-list-place")).toContainText(`You're on the waiting list — #${place}`);
  };

  await test.step("two late players sign up from the QR code: told #1 and #2 before they start, and listed so after", async () => {
    await signUpLate(`Dee Late ${token}`, 1);
    await signUpLate(`Eli Later ${token}`, 2);
    const positions = (await registrationsOf(page.request, tournament.id)).map((entry) => entry.waitingListPosition ?? null);
    expect(positions.sort()).toEqual([1, 2, null, null]);
  });

  await test.step("the pool is the two accepted players' $80 everywhere; the waiting list is not 'not paid yet'", async () => {
    const { prizes, display } = await expectNoTakingsSent(playersPhone.request, tournament.id);
    expect([prizes.poolCents, display.money.netCents, (await poolOf(page.request, tournament.id)).net]).toEqual([8_000, 8_000, 8_000]);
    await page.goto(`/admin/tournaments/${tournament.id}?tab=money`);
    await expect(page.getByTestId("paid-players-note")).toHaveText("Prize pool from 2 paid players");
    await expect(page.getByTestId("net-prize-pool")).toHaveText("$80");
  });
});
