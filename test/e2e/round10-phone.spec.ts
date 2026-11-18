/**
 * Round 10 (several high hands per game; the owner, 2026-11-18: "players will only want to sign up to
 * one of the high hands … so they pay 5 instead of 10") on the TD's phone (390 × 844) and the players'.
 *
 * (s) The TD turns the game's one high hand into "Two high hands at $5 each" in Edit Tournament (10%
 *     AP on the first half). A player signs up from the QR code for only the second half: the total is
 *     the buy-in and $5, the bank transfer card asks for the buy-in only and says "Second half high hand
 *     ($5.00) — pay at the door". The desk shows that player's second half and $5 at the door. Each
 *     pot is awarded on its own ("Award First half high hand", then the second half), each from its own
 *     paid entrants less its own AP. The public page lists both pots, and never the AP.
 * (t) The owner's night end to end: the TD makes the game on the phone with "Two high hands at $5
 *     each". From the QR code one player enters only the second half ($5 at the door) and another
 *     "All high hands" ($10 at the door); the desk shows each door amount and confirms both transfers.
 *     Each pot counts only its paid entrants (an unpaid one is left out), a Fix puts a paid player in
 *     the first half, each pot is awarded on its own (the first with a tie, split), and the TV (once the
 *     TD switches "High hand pots" on) and the public page name each pot, never its AP.
 * (u) A game with one high hand, as before round 10: "Yes, I'm in!" at sign-up, "(high hand)" at the
 *     door, "Assign High Hand Winner" with no choice of pot, the High Hand card, no pot on the TV unless
 *     asked, and once finalized it stays as it was (its high hands can no longer change).
 *
 * With SCREENSHOTS_DIR set (PLANNING/screens-round10 for the round's review), the screens are saved there.
 */
import type { Locator, Page } from "@playwright/test";
import type { FinalizePreviewDto } from "../../shared/api/finalize";
import type { LiveDisplayDto, PublicPrizesDto } from "../../shared/api/live-display";
import { findTakingsKeys, type ActivityDto } from "../../shared/api/public";
import type { ManagedRegistration, RegistrationCreatedDto } from "../../shared/api/registrations";
import type { TournamentDetailDto, TournamentListItemDto } from "../../shared/api/tournaments";
import { createTournament, expectJson, registrationsOf, signUp, uniqueToken } from "./support/api";
import { expect, test } from "./support/fixtures";
import { expectNoTakingsOn, expectNoTakingsSent, NEXT_POLL, poolOf, startClock } from "./support/money";
import { centralStars, get, PHONE, post, put, regulars, screenOf, setUpClock, shot } from "./support/phone";
import { choose, dismissToasts, toast } from "./support/ui";

test.use(PHONE);

const BANK = { accountName: "Stars Poker Club Trust", accountNumber: "12-3456-7890123-00", bankName: "ASB", instructions: null };

const staffEntries = async (page: Page, tournamentId: string) => (await registrationsOf(page.request, tournamentId)) as ManagedRegistration[];

/** A regular finds themselves on the QR page by name, which brings them to the high hands (step 3). */
async function findMyself(phone: Page, name: string) {
  await phone.getByTestId("player-type-existing").click();
  await phone.getByTestId("step1-next").click();
  await phone.getByTestId("player-search").fill(name);
  await phone.getByRole("list", { name: "Matching players" }).getByRole("button").filter({ hasText: name }).click();
  await phone.getByTestId("step2-next").click();
  await expect(phone.getByTestId("registering-as")).toHaveText(`Registering ${name}`);
}

/** Completes the QR sign-up; answers what the server made of it. */
async function completeSignUp(phone: Page, tournamentId: string): Promise<RegistrationCreatedDto> {
  const answer = phone.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith(`/api/tournaments/${tournamentId}/registrations`));
  await phone.getByTestId("complete-registration").click();
  return (await (await answer).json()) as RegistrationCreatedDto;
}

/** The QR sign-up's total, as the player sees it. */
const totalOn = (phone: Page) => phone.getByText("Total Amount").locator("xpath=following-sibling::*[1]");

/** Scrolls the element to the top of its scroller, then back by `bars` pixels so the page's sticky bars do not cover it. */
const showBelowBars = (element: Locator, bars: number) =>
  element.evaluate((target, offset) => {
    target.scrollIntoView({ block: "start" });
    let box = target.parentElement;
    while (box && !/(auto|scroll)/.test(getComputedStyle(box).overflowY)) box = box.parentElement;
    (box ?? document.scrollingElement)?.scrollBy(0, -offset);
  }, bars);

/** The room's feed, as anyone reads it. */
const publicFeedOf = async (visitor: Page, tournamentId: string) => (await get<ActivityDto[]>(visitor.request, `/api/tournaments/${tournamentId}/activity`)).map((entry) => entry.description);

/** Awards one high hand from the More tab's Award High Hand: chooses the pot, then its winner. */
async function award(page: Page, tournamentId: string, highHand: string, winner: string) {
  await page.goto(`/admin/tournaments/${tournamentId}?tab=more`);
  await page.getByTestId("award-high-hand-card").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Award a high hand" })).toBeVisible();
  await dialog.getByRole("button", { name: `Award ${highHand}` }).click();
  await expect(dialog.getByRole("heading", { name: `Award ${highHand}` })).toBeVisible();
  await dialog.getByRole("combobox", { name: "Player" }).click();
  await page.getByRole("option", { name: winner }).click();
  return dialog;
}

test("(s) two high hands at $5 each: one entered alone at sign-up and paid at the door, each pot awarded on its own, both pots public without the AP", async ({ page, openBrowser }) => {
  test.slow();
  const token = uniqueToken();
  await signUp(page.request, "Tess Director");
  const club = await centralStars(page.request, token);
  await put(page.request, `/api/clubs/${club.id}/payments`, { bankDetails: BANK });
  // $50 buy-ins, no AP on them, and tonight's one $10 high hand (both halves sold together).
  const tournament = await createTournament(page.request, {
    clubId: club.id,
    name: `Halves Night ${token}`,
    buyInAmount: "50.00",
    enableHighHand: true,
    highHandAmount: "10.00",
    showBankTransfer: true,
    maxPlayers: 9,
  });
  const names = ["Aroha", "Ben", "Chloe", "Dev"].map((name) => `${name} ${token}`);
  const [aroha, ben, chloe, dev] = await regulars(page.request, club.id, names);

  await test.step("the TD makes it two high hands at $5 each, with 10% AP on the first half", async () => {
    await page.goto(`/admin/tournaments/${tournament.id}?tab=more`);
    await page.getByTestId("edit-tournament").click();
    const sheet = page.getByRole("dialog", { name: "Edit Tournament" });
    await expect(sheet.getByTestId("high-hand-name-0")).toHaveValue("High hand");
    await sheet.getByRole("button", { name: "Two high hands at $5 each" }).click();
    await expect(sheet.getByTestId("high-hand-name-0")).toHaveValue("First half");
    await expect(sheet.getByTestId("high-hand-name-1")).toHaveValue("Second half");
    await sheet.getByTestId("high-hand-rake-type-0").selectOption("percentage");
    await sheet.getByTestId("high-hand-rake-amount-0").fill("10");
    await expect(sheet.getByTestId("all-high-hands-total")).toContainText("$10.00");
    // Each card fits the phone: nothing runs off its right edge (its Remove button included).
    for (const testId of ["high-hand-card-0", "remove-high-hand-1"]) {
      const box = await sheet.getByTestId(testId).boundingBox();
      expect(box && box.x + box.width).toBeLessThanOrEqual(390);
    }
    await sheet.getByTestId("high-hands-editor").evaluate((element) => element.scrollIntoView({ block: "start" }));
    await shot(page, "form-two-high-hands-390x844");
    await sheet.getByTestId("save-tournament").click();
    await expect(toast(page, "Tournament updated")).toBeVisible();
    await dismissToasts(page);
  });

  const listed = await get<TournamentDetailDto>(page.request, `/api/tournaments/${tournament.id}`);
  expect(listed.highHands?.map(({ name, entryFee, rakeType, rakeAmount }) => ({ name, entryFee, rakeType, rakeAmount }))).toEqual([
    { name: "First half", entryFee: "5.00", rakeType: "percentage", rakeAmount: "10.00" },
    { name: "Second half", entryFee: "5.00", rakeType: "none", rakeAmount: "0.00" },
  ]);
  const [firstHalf, secondHalf] = listed.highHands ?? [];
  // At the desk: Aroha and Chloe enter both halves, Ben the first only, all paid.
  for (const [player, highHandIds] of [
    [aroha!, [firstHalf!.id, secondHalf!.id]],
    [ben!, [firstHalf!.id]],
    [chloe!, [firstHalf!.id, secondHalf!.id]],
  ] as const) {
    await post(page.request, `/api/tournaments/${tournament.id}/registrations`, { playerId: player.id, paymentConfirmed: true, highHandIds }, 201);
  }

  const playersPhone = await openBrowser(PHONE);
  const phone = await playersPhone.newPage();
  let devEntry = "";

  await test.step("Dev signs up from the QR code for only the second half: the transfer is the buy-in, the $5 is paid at the door", async () => {
    await phone.goto(`/register/${tournament.id}`);
    await phone.getByTestId("player-type-existing").click();
    await phone.getByTestId("step1-next").click();
    await phone.getByTestId("player-search").fill(dev!.name);
    await phone.getByRole("list", { name: "Matching players" }).getByRole("button").filter({ hasText: dev!.name }).click();
    await phone.getByTestId("step2-next").click();
    const choices = phone.getByRole("group", { name: "High Hands Entry" });
    await expect(choices.getByRole("checkbox")).toHaveCount(3);
    await expect(choices).toContainText("All high hands$10.00");
    await choices.getByRole("checkbox", { name: /Second half high hand/ }).click();
    await expect(phone.getByText("Total Amount").locator("xpath=following-sibling::*[1]")).toHaveText("$55.00");
    await shot(phone, "signup-second-half-only-390x844");

    const answer = phone.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith(`/api/tournaments/${tournament.id}/registrations`));
    await phone.getByTestId("complete-registration").click();
    const created = (await (await answer).json()) as RegistrationCreatedDto;
    devEntry = created.id;
    expect(created.paymentInstructions).toMatchObject({ amountDueCents: 5_000, highHandAtDoorCents: 500, highHandsAtDoor: [{ highHandId: secondHalf!.id, name: "Second half", feeCents: 500 }] });
    const card = phone.getByRole("region", { name: "Pay by bank transfer" });
    await expect(card.getByTestId("bank-transfer-amount")).toHaveText("$50.00");
    await expect(card.getByTestId("bank-transfer-high-hand")).toHaveText("Second half high hand ($5.00) — pay at the door");
    await dismissToasts(phone);
    await shot(phone, "transfer-card-second-half-390x844");
  });

  await test.step("the desk shows Dev's second half and $5 to collect at the door, then confirms the transfer once it is", async () => {
    await page.goto(`/admin/tournaments/${tournament.id}?tab=money`);
    const row = page.getByTestId(`registration-${devEntry}`);
    await expect(row.getByTestId(`high-hands-${devEntry}`)).toHaveText("Second half");
    await expect(row.getByTestId(`transfer-part-${devEntry}`)).toHaveText("Transfer $50.00 (buy-in)");
    await expect(row.getByTestId(`door-part-${devEntry}`)).toHaveText("At the door $5.00 (Second half high hand)");
    await row.evaluate((element) => element.scrollIntoView({ block: "center" }));
    await shot(page, "desk-door-second-half-390x844");
    await page.getByTestId(`confirm-transfer-${devEntry}`).click();
    const ask = page.getByTestId("collect-at-door");
    await expect(ask).toContainText("The Second half high hand is paid at the door: confirm once you have it.");
    await page.getByTestId("collect-at-door-confirm").click();
    await expect(toast(page, `${dev!.name} has paid by bank transfer.`)).toBeVisible();
    await dismissToasts(page);
  });

  await test.step("each pot is its paid entrants' fees less its own AP, and none of it is in the prize pool", async () => {
    const pool = await poolOf(page.request, tournament.id);
    expect(pool.gross.total).toBe(20_000);
    expect(pool.highHands.map(({ name, entrants, gross, rake, net }) => ({ name, entrants, gross, rake, net }))).toEqual([
      { name: "First half", entrants: 3, gross: 1_500, rake: 150, net: 1_350 },
      { name: "Second half", entrants: 3, gross: 1_500, rake: 0, net: 1_500 },
    ]);
  });

  await put(page.request, `/api/tournaments/${tournament.id}`, { status: "in_progress" });

  await test.step("the first half is awarded on its own: only its players are offered, and it pays its pot", async () => {
    const dialog = await award(page, tournament.id, "First half high hand", ben!.name);
    await expect(dialog.getByTestId("high-hand-amount")).toHaveValue("13.50");
    await shot(page, "award-first-half-390x844");
    await dialog.getByRole("button", { name: "Award First half high hand" }).click();
    await expect(toast(page, `${ben!.name} wins the First half high hand: $13.50`)).toBeVisible();
    await dismissToasts(page);
  });

  await test.step("then the second half, from its own pot", async () => {
    const dialog = await award(page, tournament.id, "Second half high hand", dev!.name);
    await expect(dialog.getByTestId("high-hand-amount")).toHaveValue("15.00");
    await dialog.getByRole("button", { name: "Award Second half high hand" }).click();
    await expect(toast(page, `${dev!.name} wins the Second half high hand: $15`)).toBeVisible();
    const wins = Object.fromEntries((await staffEntries(page, tournament.id)).map((entry) => [entry.id, entry.highHandWins?.map((win) => [win.highHandId, win.amountCents])]));
    expect(wins[devEntry]).toEqual([[secondHalf!.id, 1_500]]);
  });

  await test.step("the public page lists both high hands with their pots and winners, and never the AP", async () => {
    await put(page.request, `/api/tournaments/${tournament.id}`, { prizePoolLocked: true });
    const visitor = await (await openBrowser(PHONE)).newPage();
    await visitor.goto(`/tournament/${tournament.id}`);
    const list = visitor.getByRole("list", { name: "High hands" });
    await expect(list.getByTestId(`high-hand-pot-${firstHalf!.id}`)).toHaveText("Pot: $13.50");
    await expect(list.getByTestId(`high-hand-pot-${secondHalf!.id}`)).toHaveText("Pot: $15");
    await expect(list.getByTestId(`public-high-hand-${firstHalf!.id}`)).toContainText(`Won by ${ben!.name} ($13.50)`);
    await expect(list).not.toContainText(/AP|10%|\$1\.50/);
    await list.evaluate((element) => element.scrollIntoView({ block: "start" }));
    await shot(visitor, "public-high-hands-390x844");

    const prizes = await get<PublicPrizesDto>(visitor.request, `/api/public/tournaments/${tournament.id}/prizes`);
    expect(prizes.highHands.map(({ name, potCents }) => [name, potCents])).toEqual([
      ["First half", 1_350],
      ["Second half", 1_500],
    ]);
    expect(findTakingsKeys(prizes)).toEqual([]);
  });
});

test("(t) the owner's night from the phone: two $5 high hands made with the game, one player in the second only ($5 at the door) and one in both ($10), only paid players in each pot, each awarded on its own with a tie, and the TV and public page naming each pot without the AP", async ({
  page,
  openBrowser,
}) => {
  test.slow();
  const token = uniqueToken();
  await signUp(page.request, "Tess Director");
  const club = await centralStars(page.request, token);
  await put(page.request, `/api/clubs/${club.id}/payments`, { bankDetails: BANK });
  const names = ["Hana", "Ira", "Jo", "Kai", "Lee"].map((name) => `${name} ${token}`);
  const [hana, ira, jo, kai, lee] = await regulars(page.request, club.id, names);
  const name = `Two Halves ${token}`;
  let tournament: TournamentDetailDto | undefined;
  const id = () => tournament!.id;

  await test.step("the TD makes the game on the phone: Two high hands at $5 each, 20% AP on the first half, bank transfers on", async () => {
    await page.goto("/tournaments");
    await page.getByTestId("create-tournament-button").click();
    const form = page.getByRole("dialog", { name: "Create New Tournament" });
    await form.getByTestId("tournament-name").fill(name);
    await choose(page, form.getByTestId("club-select"), club.name);
    await form.getByTestId("start-datetime").fill("2026-11-20T19:30");
    await form.getByTestId("buyin-amount").fill("50");
    await form.getByTestId("min-players").fill("2");
    await form.getByTestId("max-players").fill("20");
    await expect(form.getByTestId("no-high-hands")).toBeVisible();
    await form.getByTestId("two-high-hands").click();
    await expect(form.getByTestId("high-hand-name-0")).toHaveValue("First half");
    await expect(form.getByTestId("high-hand-name-1")).toHaveValue("Second half");
    await form.getByTestId("high-hand-rake-type-0").selectOption("percentage");
    await form.getByTestId("high-hand-rake-amount-0").fill("20");
    await expect(form.getByTestId("all-high-hands-total")).toHaveText("All high hands$10.00");
    for (const testId of ["high-hand-card-0", "high-hand-card-1", "add-high-hand"]) {
      const box = await form.getByTestId(testId).boundingBox();
      expect(box && box.x + box.width, `${testId} fits the phone`).toBeLessThanOrEqual(390);
    }
    await form.getByTestId("high-hands-editor").evaluate((element) => element.scrollIntoView({ block: "start" }));
    await shot(page, "form-high-hands-390x844");
    await form.getByTestId("all-high-hands-total").evaluate((element) => element.scrollIntoView({ block: "end" }));
    await shot(page, "form-high-hands-total-390x844");
    const transfers = form.getByRole("switch", { name: "Show bank transfer details after sign-up" });
    await transfers.click();
    await expect(transfers).toBeChecked();
    await form.getByTestId("create-tournament-final").click();
    await expect(toast(page, "Tournament created successfully!")).toBeVisible();
    await dismissToasts(page);

    const listed = await get<TournamentListItemDto[]>(page.request, `/api/tournaments?clubId=${club.id}`);
    tournament = await get<TournamentDetailDto>(page.request, `/api/tournaments/${listed.find((entry) => entry.name === name)!.id}`);
    expect(tournament.highHands?.map(({ name, entryFee, rakeType, rakeAmount, winners, note }) => ({ name, entryFee, rakeType, rakeAmount, winners, note }))).toEqual([
      { name: "First half", entryFee: "5.00", rakeType: "percentage", rakeAmount: "20.00", winners: 1, note: "Before the break" },
      { name: "Second half", entryFee: "5.00", rakeType: "none", rakeAmount: "0.00", winners: 1, note: "After the break" },
    ]);
    // The legacy columns are the list's summary: a high hand runs, and entering both costs $10.
    expect(tournament).toMatchObject({ enableHighHand: true, highHandAmount: "10.00", showBankTransfer: true });
  });
  const [firstHalf, secondHalf] = tournament!.highHands!;

  // At the desk: Jo in the first half, not paid yet; Kai in both and Lee in none, both paid.
  const desk = async (playerId: string, highHandIds: string[], paymentConfirmed: boolean) =>
    post<ManagedRegistration>(page.request, `/api/tournaments/${id()}/registrations`, { playerId, paymentConfirmed, highHandIds }, 201);
  const joEntry = await desk(jo!.id, [firstHalf!.id], false);
  await desk(kai!.id, [firstHalf!.id, secondHalf!.id], true);
  const leeEntry = await desk(lee!.id, [], true);

  let hanaEntry = "";
  let iraEntry = "";
  await test.step("Hana ticks only the second half on the QR page: $55 in all, the transfer is the $50 buy-in, $5 at the door", async () => {
    const phone = await (await openBrowser(PHONE)).newPage();
    await phone.goto(`/register/${id()}`);
    await findMyself(phone, hana!.name);
    const choices = phone.getByRole("group", { name: "High Hands Entry" });
    await expect(choices.getByRole("checkbox")).toHaveCount(3);
    await expect(choices).toContainText("Before the break");
    await choices.getByRole("checkbox", { name: /Second half high hand/ }).click();
    await expect(choices.getByRole("checkbox", { name: /All high hands/ })).not.toBeChecked();
    await expect(totalOn(phone)).toHaveText("$55.00");
    await shot(phone, "signup-choose-390x844");
    const created = await completeSignUp(phone, id());
    hanaEntry = created.id;
    expect(created.paymentInstructions).toMatchObject({
      amountDueCents: 5_000,
      highHandAtDoorCents: 500,
      highHandsAtDoor: [{ highHandId: secondHalf!.id, name: "Second half", feeCents: 500 }],
    });
    const card = phone.getByRole("region", { name: "Pay by bank transfer" });
    await expect(card.getByTestId("bank-transfer-amount")).toHaveText("$50.00");
    await expect(card.getByTestId("bank-transfer-high-hand")).toHaveText(["Second half high hand ($5.00) — pay at the door"]);
  });

  await test.step("Ira ticks All high hands: $60 in all, the transfer is still the buy-in, $10 at the door for both halves", async () => {
    const phone = await (await openBrowser(PHONE)).newPage();
    await phone.goto(`/register/${id()}`);
    await findMyself(phone, ira!.name);
    const choices = phone.getByRole("group", { name: "High Hands Entry" });
    await choices.getByRole("checkbox", { name: /All high hands/ }).click();
    for (const which of [/First half high hand/, /Second half high hand/]) await expect(choices.getByRole("checkbox", { name: which })).toBeChecked();
    await expect(totalOn(phone)).toHaveText("$60.00");
    const created = await completeSignUp(phone, id());
    iraEntry = created.id;
    expect(created.paymentInstructions).toMatchObject({
      amountDueCents: 5_000,
      highHandAtDoorCents: 1_000,
      highHandsAtDoor: [
        { highHandId: firstHalf!.id, name: "First half", feeCents: 500 },
        { highHandId: secondHalf!.id, name: "Second half", feeCents: 500 },
      ],
    });
    const card = phone.getByRole("region", { name: "Pay by bank transfer" });
    await expect(card.getByTestId("bank-transfer-amount")).toHaveText("$50.00");
    await expect(card.getByTestId("bank-transfer-high-hand")).toHaveText([
      "First half high hand ($5.00) — pay at the door",
      "Second half high hand ($5.00) — pay at the door",
    ]);
    await dismissToasts(phone);
    await shot(phone, "transfer-card-both-halves-390x844");
  });

  await test.step("the desk shows what each still pays at the door: $5 for Hana's second half, $10 for Ira's two, $5 for Jo's first half", async () => {
    await page.goto(`/admin/tournaments/${id()}?tab=money`);
    const hanaRow = page.getByTestId(`registration-${hanaEntry}`);
    await expect(hanaRow.getByTestId(`high-hands-${hanaEntry}`)).toHaveText("Second half");
    await expect(hanaRow.getByTestId(`transfer-part-${hanaEntry}`)).toHaveText("Transfer $50.00 (buy-in)");
    await expect(hanaRow.getByTestId(`door-part-${hanaEntry}`)).toHaveText("At the door $5.00 (Second half high hand)");
    const iraRow = page.getByTestId(`registration-${iraEntry}`);
    await expect(iraRow.getByTestId(`high-hands-${iraEntry}`)).toHaveText("First halfSecond half");
    await expect(iraRow.getByTestId(`transfer-part-${iraEntry}`)).toHaveText("Transfer $50.00 (buy-in)");
    await expect(iraRow.getByTestId(`door-part-${iraEntry}`)).toHaveText("At the door $10.00 (First half high hand, Second half high hand)");
    await expect(page.getByTestId(`door-part-${joEntry.id}`)).toHaveText("At the door $5.00 (First half high hand)");
    await showBelowBars(hanaRow, 130);
    await shot(page, "desk-door-amounts-390x844");
  });

  await test.step("the TD confirms both transfers once the door money is in; Jo has still not paid", async () => {
    await page.getByTestId(`confirm-transfer-${hanaEntry}`).click();
    const ask = page.getByTestId("collect-at-door");
    await expect(ask).toContainText("Collect $5.00 at the door");
    await expect(ask).toContainText("The Second half high hand is paid at the door: confirm once you have it.");
    await page.getByTestId("collect-at-door-confirm").click();
    await expect(toast(page, `${hana!.name} has paid by bank transfer.`)).toBeVisible();
    await dismissToasts(page);

    await page.getByTestId(`confirm-transfer-${iraEntry}`).click();
    await expect(ask).toContainText("Collect $10.00 at the door");
    await expect(ask).toContainText("The First half high hand and Second half high hand are paid at the door: confirm once you have it.");
    await page.getByTestId("collect-at-door-confirm").click();
    await expect(toast(page, `${ira!.name} has paid by bank transfer.`)).toBeVisible();
    await dismissToasts(page);
    const paid = Object.fromEntries((await staffEntries(page, id())).map((entry) => [entry.id, entry.paymentConfirmed]));
    expect([paid[hanaEntry], paid[iraEntry], paid[joEntry.id]]).toEqual([true, true, false]);
  });

  await test.step("each pot is its own paid entrants' fees less its own AP: Jo's unpaid $5 is in neither, and none of it is in the prize pool", async () => {
    const pool = await poolOf(page.request, id());
    // Four paid buy-ins (Jo has not paid): $200, all of it for the places.
    expect([pool.gross.total, pool.net]).toEqual([20_000, 20_000]);
    expect(pool.highHands.map(({ name, entrants, gross, rake, net }) => ({ name, entrants, gross, rake, net }))).toEqual([
      { name: "First half", entrants: 2, gross: 1_000, rake: 200, net: 800 },
      { name: "Second half", entrants: 3, gross: 1_500, rake: 0, net: 1_500 },
    ]);
    // The TD's Money tab: one block per pot.
    await page.goto(`/admin/tournaments/${id()}?tab=money`);
    await expect(page.getByTestId(`high-hand-pot-${firstHalf!.id}`)).toContainText("First half high hand entries (2 × $5.00)");
    await expect(page.getByTestId(`high-hand-net-${firstHalf!.id}`)).toHaveText("$8");
    await expect(page.getByTestId(`high-hand-pot-${secondHalf!.id}`)).toContainText("Second half high hand entries (3 × $5.00)");
    await expect(page.getByTestId(`high-hand-net-${secondHalf!.id}`)).toHaveText("$15");
  });

  await test.step("Fix puts Lee, already paid, in the first half: its pot grows by his $5 less its AP", async () => {
    await page.getByTestId("quick-actions").click();
    await page.getByRole("menuitem", { name: /Take payment/ }).click();
    const sheet = page.getByRole("dialog", { name: "Take payment" });
    await sheet.getByTestId(`fix-entry-${leeEntry.id}`).click();
    const menu = page.getByTestId(`fix-entry-menu-${leeEntry.id}`);
    await expect(menu.getByRole("menuitemcheckbox", { name: "First half high hand" })).not.toBeChecked();
    await expect(menu.getByRole("menuitemcheckbox", { name: "Second half high hand" })).not.toBeChecked();
    await menu.getByRole("menuitemcheckbox", { name: "First half high hand" }).click();
    await expect(toast(page, `${lee!.name} is now in the First half high hand.`)).toBeVisible();
    await dismissToasts(page);
    const leeNow = (await staffEntries(page, id())).find((entry) => entry.id === leeEntry.id);
    expect(leeNow?.highHandIds).toEqual([firstHalf!.id]);
    expect((await poolOf(page.request, id())).highHands.map(({ entrants, net }) => [entrants, net])).toEqual([
      [3, 1_200],
      [3, 1_500],
    ]);
  });

  await put(page.request, `/api/tournaments/${id()}`, { status: "in_progress" });

  await test.step("Award High Hand asks which pot; Kai wins the first half's $12", async () => {
    const dialog = await award(page, id(), "First half high hand", kai!.name);
    await expect(dialog.getByTestId("high-hand-amount")).toHaveValue("12.00");
    await dialog.getByRole("button", { name: "Award First half high hand" }).click();
    await expect(toast(page, `${kai!.name} wins the First half high hand: $12`)).toBeVisible();
    await dismissToasts(page);
  });

  await test.step("a tie in the first half: Lee splits Kai's prize, $6 each; the second half is untouched", async () => {
    await page.getByTestId("award-high-hand-card").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Award a high hand" })).toBeVisible();
    await expect(dialog.getByTestId(`choose-high-hand-${firstHalf!.id}`)).toContainText("Pot $12 · 1 winner so far · every prize awarded");
    await expect(dialog.getByTestId(`choose-high-hand-${secondHalf!.id}`)).toContainText("Pot $15 · 0 winners so far · next prize $15");
    await shot(page, "award-per-pot-390x844");
    await dialog.getByRole("button", { name: "Award First half high hand" }).click();
    await dialog.getByRole("combobox", { name: "Player" }).click();
    // Kai has won it already: only the first half's other players are offered (Hana is in the second half only).
    await expect(page.getByRole("option", { name: kai!.name })).toHaveCount(0);
    await expect(page.getByRole("option", { name: hana!.name })).toHaveCount(0);
    await page.getByRole("option", { name: lee!.name }).click();
    await choose(page, dialog.getByTestId("split-with"), `Split with ${kai!.name} ($12)`);
    await expect(dialog.getByTestId("high-hand-amount")).toHaveValue("6.00");
    await shot(page, "award-split-390x844");
    await dialog.getByRole("button", { name: "Award First half high hand" }).click();
    await expect(toast(page, `First half high hand split: ${lee!.name} gets $6`)).toBeVisible();
    await dismissToasts(page);
  });

  await test.step("then the second half, from its own pot: Hana wins $15", async () => {
    const dialog = await award(page, id(), "Second half high hand", hana!.name);
    await expect(dialog.getByTestId("high-hand-amount")).toHaveValue("15.00");
    await dialog.getByRole("button", { name: "Award Second half high hand" }).click();
    await expect(toast(page, `${hana!.name} wins the Second half high hand: $15`)).toBeVisible();
    await dismissToasts(page);
    const wins = Object.fromEntries((await staffEntries(page, id())).map((entry) => [entry.playerId, entry.highHandWins?.map((win) => [win.highHandId, win.amountCents])]));
    expect([wins[kai!.id], wins[lee!.id], wins[hana!.id], wins[ira!.id]]).toEqual([[[firstHalf!.id, 600]], [[firstHalf!.id, 600]], [[secondHalf!.id, 1_500]], []]);
  });

  await setUpClock(page.request, id());
  await startClock(page.request, id());

  await test.step("the TV shows no pot until the TD switches High hand pots on; then each pot by name, amounts only", async () => {
    const before = await get<LiveDisplayDto>(page.request, `/api/public/tournaments/${id()}/display`);
    expect(before.money.highHands ?? null).toBeNull();
    await page.goto(`/admin/tournaments/${id()}?tab=clock`);
    await page.getByRole("button", { name: /TV display/ }).first().click();
    const settings = page.getByRole("dialog", { name: "TV display" });
    const pots = settings.getByRole("group", { name: "More on the TV" }).getByRole("switch", { name: "High hand pots" });
    await expect(pots).not.toBeChecked();
    await pots.click();
    await expect(pots).toBeChecked();
    await expect
      .poll(async () => (await get<LiveDisplayDto>(page.request, `/api/public/tournaments/${id()}/display`)).money.highHands)
      .toEqual([
        { id: firstHalf!.id, name: "First half", potCents: 1_200 },
        { id: secondHalf!.id, name: "Second half", potCents: 1_500 },
      ]);

    const tv = await (await openBrowser(screenOf(1920, 1080))).newPage();
    await tv.goto(`/clock/${id()}?screen=tv`);
    await expect(tv.getByRole("timer", { name: "Time left" })).toBeVisible();
    const stats = tv.getByTestId("display-stats");
    await expect(stats).toContainText("First half high hand", NEXT_POLL);
    await expect(stats).toContainText("$12");
    await expect(stats).toContainText("Second half high hand");
    await expect(stats).toContainText("$15");
    await expectNoTakingsOn(tv);
    await expect(tv.locator("body")).not.toContainText("20%");
    await shot(tv, "tv-high-hands-1920x1080");
  });

  await test.step("the public page lists each pot with its winners, never the AP; what it and the TV are sent carries no takings", async () => {
    await put(page.request, `/api/tournaments/${id()}`, { prizePoolLocked: true });
    const visitor = await (await openBrowser(PHONE)).newPage();
    await visitor.goto(`/tournament/${id()}`);
    const list = visitor.getByRole("list", { name: "High hands" });
    await expect(list.getByTestId(`high-hand-pot-${firstHalf!.id}`)).toHaveText("Pot: $12");
    await expect(list.getByTestId(`high-hand-pot-${secondHalf!.id}`)).toHaveText("Pot: $15");
    await expect(list.getByTestId(`public-high-hand-${firstHalf!.id}`)).toContainText(`Won by ${kai!.name} ($6), ${lee!.name} ($6)`);
    await expect(list.getByTestId(`public-high-hand-${secondHalf!.id}`)).toContainText(`Won by ${hana!.name} ($15)`);
    await expect(list).not.toContainText(/AP|20%|\$3\b/);
    await expectNoTakingsOn(visitor);
    await showBelowBars(list, 110);
    await shot(visitor, "public-pots-390x844");

    const { prizes, display } = await expectNoTakingsSent(visitor.request, id());
    expect(prizes.highHands.map(({ name, potCents }) => [name, potCents])).toEqual([
      ["First half", 1_200],
      ["Second half", 1_500],
    ]);
    expect(display.money.highHands?.map(({ name, potCents }) => [name, potCents])).toEqual([
      ["First half", 1_200],
      ["Second half", 1_500],
    ]);

    await visitor.getByRole("tab", { name: "Standings" }).click();
    const winners = visitor.getByRole("list", { name: "High hand winners" });
    await expect(winners.getByRole("listitem")).toHaveCount(3);
    await expect(winners.getByRole("listitem").filter({ hasText: hana!.name })).toContainText("Second half high hand");
    await expect(winners.getByRole("listitem").filter({ hasText: lee!.name })).toContainText("First half high hand");

    const feed = await publicFeedOf(visitor, id());
    expect(feed).toEqual(
      expect.arrayContaining([
        `${kai!.name} won the First half high hand ($12)`,
        `${lee!.name} won the First half high hand, split with ${kai!.name} ($6; ${kai!.name} keeps $6)`,
        `${hana!.name} won the Second half high hand ($15)`,
      ]),
    );
    expect(feed.join("\n")).not.toMatch(/\bAP\b|20%|High hands:/);
  });
});

test("(u) a game with one high hand, as before round 10: Yes or No at sign-up, \"(high hand)\" at the door, Assign High Hand Winner with no choice of pot, the High Hand card, no TV pot unless asked, and a finished game kept as it was", async ({
  page,
  openBrowser,
}) => {
  test.slow();
  const token = uniqueToken();
  await signUp(page.request, "Tess Director");
  const club = await centralStars(page.request, token);
  await put(page.request, `/api/clubs/${club.id}/payments`, { bankDetails: BANK });
  // Tonight's one $10 high hand, with 10% AP on it, made the way every game was before round 10.
  const tournament = await createTournament(page.request, {
    clubId: club.id,
    name: `Classic Night ${token}`,
    buyInAmount: "50.00",
    payoutStructure: "standard",
    enableHighHand: true,
    highHandAmount: "10.00",
    highHandRakeType: "percentage",
    highHandRakeAmount: "10",
    showBankTransfer: true,
    maxPlayers: 9,
  });
  expect(tournament.highHands).toBeNull();
  const names = ["Mia", "Ned", "Ola"].map((name) => `${name} ${token}`);
  const [mia, ned, ola] = await regulars(page.request, club.id, names);
  const nedEntry = await post<ManagedRegistration>(page.request, `/api/tournaments/${tournament.id}/registrations`, { playerId: ned!.id, paymentConfirmed: true, enteringHighHands: true }, 201);
  const olaEntry = await post<ManagedRegistration>(page.request, `/api/tournaments/${tournament.id}/registrations`, { playerId: ola!.id, paymentConfirmed: true }, 201);
  let miaEntry = "";

  await test.step("the QR page asks Yes or No, as before; the transfer card says the high hand is paid at the door", async () => {
    const phone = await (await openBrowser(PHONE)).newPage();
    await phone.goto(`/register/${tournament.id}`);
    await findMyself(phone, mia!.name);
    await expect(phone.getByTestId("high-hand-choices")).toHaveCount(0);
    await phone.getByTestId("high-hands-yes").click();
    await expect(totalOn(phone)).toHaveText("$60.00");
    const created = await completeSignUp(phone, tournament.id);
    miaEntry = created.id;
    expect(created.paymentInstructions).toMatchObject({
      amountDueCents: 5_000,
      highHandAtDoorCents: 1_000,
      highHandsAtDoor: [{ highHandId: "legacy", name: "High hand", feeCents: 1_000 }],
    });
    await expect(phone.getByRole("region", { name: "Pay by bank transfer" }).getByTestId("bank-transfer-high-hand")).toHaveText("High hand ($10.00) — pay at the door");
    const entry = (await staffEntries(page, tournament.id)).find((registration) => registration.id === miaEntry);
    expect(entry).toMatchObject({ enteringHighHands: true, highHandIds: [], highHandWins: [] });
  });

  await test.step("the desk shows Yes and \"(high hand)\" at the door, and asks for it before confirming the transfer", async () => {
    await page.goto(`/admin/tournaments/${tournament.id}?tab=money`);
    const row = page.getByTestId(`registration-${miaEntry}`);
    await expect(row.getByTestId(`high-hands-${miaEntry}`)).toHaveCount(0);
    await expect(row.getByTestId(`door-part-${miaEntry}`)).toHaveText("At the door $10.00 (high hand)");
    await page.getByTestId(`confirm-transfer-${miaEntry}`).click();
    const ask = page.getByTestId("collect-at-door");
    await expect(ask).toContainText(`${mia!.name}'s bank transfer pays the buy-in, $50.00. The high hand is paid at the door: confirm once you have it.`);
    await page.getByTestId("collect-at-door-confirm").click();
    await expect(toast(page, `${mia!.name} has paid by bank transfer.`)).toBeVisible();
    await dismissToasts(page);
  });

  await test.step("one pot, as before: two paid entrants' $20 less 10% AP, in the Money tab's High Hand lines", async () => {
    const pool = await poolOf(page.request, tournament.id);
    expect(pool.highHand).toMatchObject({ entrants: 2, gross: 2_000, rake: 200, net: 1_800 });
    expect(pool.highHands.map(({ highHandId, name, net }) => [highHandId, name, net])).toEqual([["legacy", "High hand", 1_800]]);
    await page.goto(`/admin/tournaments/${tournament.id}?tab=money`);
    await expect(page.getByTestId("high-hand-pot")).toContainText("High Hand Entries (2 × $10.00)");
    await expect(page.getByTestId("high-hand-net")).toHaveText("$18");
    await expect(page.getByTestId("high-hand-pot-legacy")).toHaveCount(0);
  });

  await put(page.request, `/api/tournaments/${tournament.id}`, { status: "in_progress" });

  await test.step("Award High Hand goes straight to Assign High Hand Winner, with the whole pot", async () => {
    await page.goto(`/admin/tournaments/${tournament.id}?tab=more`);
    await page.getByTestId("award-high-hand-card").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Assign High Hand Winner" })).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Award a high hand" })).toHaveCount(0);
    await dialog.getByRole("combobox", { name: "Player" }).click();
    // Only the two in the high hand: Ola is not.
    await expect(page.getByRole("option", { name: ola!.name })).toHaveCount(0);
    await page.getByRole("option", { name: ned!.name }).click();
    await expect(dialog.getByTestId("high-hand-amount")).toHaveValue("18.00");
    await dialog.getByRole("button", { name: "Assign High Hand" }).click();
    await expect(toast(page, `${ned!.name} wins the high hand: $18`)).toBeVisible();
    const winner = (await staffEntries(page, tournament.id)).find((registration) => registration.id === nedEntry.id);
    expect(winner).toMatchObject({ highHandWinner: true, highHandWins: [] });
    expect(Number(winner?.highHandAmount)).toBe(18);
    // Still one high hand in its old columns: nothing was turned into a list.
    expect((await get<TournamentDetailDto>(page.request, `/api/tournaments/${tournament.id}`)).highHands).toBeNull();
  });

  await test.step("the public page has its High Hand card and winner, and the TV no pot while High hand pots is off", async () => {
    await put(page.request, `/api/tournaments/${tournament.id}`, { prizePoolLocked: true });
    const visitor = await (await openBrowser(PHONE)).newPage();
    await visitor.goto(`/tournament/${tournament.id}`);
    await expect(visitor.getByTestId("high-hand-pot")).toHaveText("High hand pot: $18");
    await expect(visitor.getByText("High hand entry (optional)")).toBeVisible();
    await expect(visitor.getByTestId("public-high-hands")).toHaveCount(0);
    await expectNoTakingsOn(visitor);
    const { prizes, display } = await expectNoTakingsSent(visitor.request, tournament.id);
    expect([prizes.highHandPotCents, prizes.highHands.map(({ id, potCents }) => [id, potCents])]).toEqual([1_800, [["legacy", 1_800]]]);
    expect(display.money.highHands ?? null).toBeNull();
    await visitor.getByRole("tab", { name: "Standings" }).click();
    const winners = visitor.getByRole("list", { name: "High hand winners" });
    await expect(winners.getByRole("listitem")).toHaveText([new RegExp(`${ned!.name}\\$18$`)]);
    expect(await publicFeedOf(visitor, tournament.id)).not.toContain("High hands:");

    await setUpClock(page.request, tournament.id);
    await startClock(page.request, tournament.id);
    const tv = await (await openBrowser(screenOf(1920, 1080))).newPage();
    await tv.goto(`/clock/${tournament.id}?screen=tv`);
    await expect(tv.getByRole("timer", { name: "Time left" })).toBeVisible();
    await expect(tv.getByTestId("clock-screen")).not.toContainText(/high hand/i);
  });

  await test.step("finalized, it stays one high hand with its winner, and its high hands can no longer change", async () => {
    for (const out of [olaEntry, { id: miaEntry }]) await put(page.request, `/api/registrations/${out.id}`, { isEliminated: true, eliminatedBy: ned!.id });
    const preview = await post<FinalizePreviewDto>(page.request, `/api/tournaments/${tournament.id}/finalize/preview`, {});
    await post(page.request, `/api/tournaments/${tournament.id}/finalize`, { expectedPlanHash: preview.planHash });
    const finished = await get<TournamentDetailDto>(page.request, `/api/tournaments/${tournament.id}`);
    expect([finished.status, finished.highHands]).toEqual(["completed", null]);
    const refused = await expectJson<{ code: string }>(
      await page.request.put(`/api/tournaments/${tournament.id}/high-hands`, {
        data: { highHands: [{ id: "legacy", name: "High hand", entryFee: "5.00" }, { name: "Second half", entryFee: "5.00" }] },
      }),
      409,
    );
    expect(refused.code).toBe("TOURNAMENT_CLOSED");

    const visitor = await (await openBrowser(PHONE)).newPage();
    await visitor.goto(`/tournament/${tournament.id}`);
    await visitor.getByRole("tab", { name: "Standings" }).click();
    await expect(visitor.getByRole("list", { name: "High hand winners" }).getByRole("listitem")).toHaveText([new RegExp(`${ned!.name}\\$18$`)]);
  });
});
