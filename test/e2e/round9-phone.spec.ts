/**
 * Round 9 (quick fixes from the owner's game night, 2026-11-18) on the TD's phone (390 × 844).
 *
 * (q) Correcting a player already confirmed as paid ("I need to be able to edit players who are
 *     confirmed as paid just in case of a mistake"): from the Take payment sheet's paid list, Fix →
 *     Mark as not paid, after a question saying what the prize pool loses; the entry is back on the
 *     list to pay, out of the paid-only pool, in its seat, and the room's feed says nothing of it.
 *     Then Fix → how they paid (recorded as a bank transfer), Fix → the high hand, and, from a row on
 *     the Players tab, Fix → Edit player details. Each correction is a line in the staff's feed.
 * (r) The Clock tab's read-only Blind structure card has Edit, which opens the same full-screen
 *     structure editor as Clock tools → Edit the blind structure.
 *
 * With SCREENSHOTS_DIR set (PLANNING/screens-round9 for the round's review), the screens are saved there.
 */
import type { Page } from "@playwright/test";
import type { ActivityDto } from "../../shared/api/public";
import type { ManagedRegistration } from "../../shared/api/registrations";
import type { SeatingDto } from "../../shared/api/seating";
import { createTournament, registrationsOf, signUp, uniqueToken } from "./support/api";
import { expect, test } from "./support/fixtures";
import { poolOf } from "./support/money";
import { centralStars, enter, get, PHONE, post, put, regulars, setUpClock, shot } from "./support/phone";
import { dismissToasts, toast } from "./support/ui";

test.use(PHONE);

/** The staff's view of one entry: with its payment status. */
const staffEntry = async (page: Page, tournamentId: string, registrationId: string) =>
  ((await registrationsOf(page.request, tournamentId)) as ManagedRegistration[]).find((registration) => registration.id === registrationId);

const feedOf = async (request: Page["request"], tournamentId: string) =>
  (await get<ActivityDto[]>(request, `/api/tournaments/${tournamentId}/activity`)).map((entry) => entry.description);

/** Opens a row's Fix menu: on a payment list, or (`standings-fix`) on the Players tab. */
async function openFix(page: Page, registrationId: string, prefix = "fix-entry") {
  await page.getByTestId(`${prefix}-${registrationId}`).click();
  const menu = page.getByTestId(`fix-entry-menu-${registrationId}`);
  await expect(menu).toBeVisible();
  return menu;
}

test("(q) a payment confirmed by mistake put right from the phone: not paid, how they paid, the high hand and the player's details", async ({ page, openBrowser }) => {
  test.slow();
  const token = uniqueToken();
  await signUp(page.request, "Tess Director");
  const club = await centralStars(page.request, token);
  // $50 buy-ins with 10% AP and a $10 high hand: four have paid ($200 in, $180 after AP), seated at a table.
  const tournament = await createTournament(page.request, {
    clubId: club.id,
    name: `Game Night ${token}`,
    buyInAmount: "50.00",
    rakeType: "percentage",
    rakeAmount: "10",
    payoutStructure: "standard",
    enableHighHand: true,
    highHandAmount: "10.00",
    maxPlayers: 9,
  });
  const names = ["Aroha", "Ben", "Chloe", "Tama"].map((name) => `${name} ${token}`);
  const players = await regulars(page.request, club.id, names);
  const [, ben, , tama] = await enter(page.request, tournament.id, players);
  await put(page.request, `/api/tournaments/${tournament.id}`, { status: "in_progress" });
  // Setting up the tables seats the four.
  await post(page.request, `/api/tournaments/${tournament.id}/seating/setup`, {}, 201);
  const seatBefore = (await get<SeatingDto>(page.request, `/api/tournaments/${tournament.id}/seating`)).seatByRegistrationId[tama!.id];
  expect(seatBefore).toEqual({ tableNumber: expect.any(Number), seatNumber: expect.any(Number) });
  const poolBefore = await poolOf(page.request, tournament.id);
  await page.goto(`/admin/tournaments/${tournament.id}`);

  await test.step("Take payment lists who has paid, each with Fix; Mark as not paid asks first, saying what the pool loses", async () => {
    await page.getByTestId("quick-actions").click();
    await page.getByRole("menuitem", { name: /Take payment/ }).click();
    const sheet = page.getByRole("dialog", { name: "Take payment" });
    await expect(sheet.getByRole("heading", { name: "Paid · 4" })).toBeVisible();
    const menu = await openFix(page, tama!.id);
    await shot(page, "fix-menu-390x844");
    await menu.getByRole("menuitem", { name: "Mark as not paid…" }).click();
    const question = page.getByRole("alertdialog", { name: `Mark ${names[3]} as not paid?` });
    // $200 less 10% AP pays $180 over three places; $150 less 10% pays $134 ($67 + $40 + $27): $46 less.
    await expect(question).toContainText(`${names[3]} goes back to Not paid yet; the prize pool drops by $46. They keep their seat.`);
    await shot(page, "fix-not-paid-question-390x844");
    await question.getByTestId("fix-not-paid-confirm").click();
    await expect(toast(page, `${names[3]} is back on the list to pay.`)).toBeVisible();
    await expect(sheet.getByTestId(`confirm-payment-${tama!.id}`)).toBeVisible();
    await expect(sheet.getByRole("heading", { name: "Paid · 3" })).toBeVisible();
  });

  await test.step("the entry is not paid, out of the paid-only pool, in its seat; only the staff's feed says so", async () => {
    expect(await staffEntry(page, tournament.id, tama!.id)).toMatchObject({ paymentConfirmed: false, paidBy: null, waitingListPosition: null });
    const poolAfter = await poolOf(page.request, tournament.id);
    expect([poolBefore.gross.total, poolAfter.gross.total]).toEqual([20_000, 15_000]);
    expect(poolBefore.net - poolAfter.net).toBe(4_600);
    expect((await get<SeatingDto>(page.request, `/api/tournaments/${tournament.id}/seating`)).seatByRegistrationId[tama!.id]).toEqual(seatBefore);
    expect(await feedOf(page.request, tournament.id)).toContain(`${names[3]}'s payment was taken back: not paid yet`);
    const room = await openBrowser(PHONE);
    expect((await feedOf(room.request, tournament.id)).join("\n")).not.toMatch(/taken back|corrected|How .* paid/);
  });

  await test.step("paid again at the desk, then Fix records how: a bank transfer", async () => {
    const sheet = page.getByRole("dialog", { name: "Take payment" });
    await sheet.getByTestId(`confirm-payment-${tama!.id}`).click();
    await expect(toast(page, "Payment Confirmed")).toBeVisible();
    await dismissToasts(page);
    const menu = await openFix(page, tama!.id);
    await menu.getByRole("menuitemradio", { name: "Bank transfer" }).click();
    await expect(toast(page, `${names[3]} paid by bank transfer.`)).toBeVisible();
    await expect(sheet.getByTestId(`paid-by-${tama!.id}`)).toHaveText("Bank transfer");
    expect(await staffEntry(page, tournament.id, tama!.id)).toMatchObject({ paymentConfirmed: true, paidBy: "transfer" });
  });

  await test.step("Fix ticks the high hand they paid for at the desk", async () => {
    const menu = await openFix(page, tama!.id);
    await menu.getByRole("menuitemcheckbox", { name: "High hand entered" }).click();
    await expect(toast(page, `${names[3]} is now in the high hand.`)).toBeVisible();
    expect(await staffEntry(page, tournament.id, tama!.id)).toMatchObject({ enteringHighHands: true });
    expect((await poolOf(page.request, tournament.id)).highHand.gross).toBe(1_000);
    await expect(menu).toBeHidden();
    const sheet = page.getByRole("dialog", { name: "Take payment" });
    await sheet.getByRole("button", { name: "Close" }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByRole("tab", { name: "Players" })).toBeVisible();
  });

  await test.step("from a player's row on the Players tab, Fix → Edit player details", async () => {
    await page.getByRole("tab", { name: "Players" }).click();
    const menu = await openFix(page, ben!.id, "standings-fix");
    await menu.getByRole("menuitem", { name: "Edit player details…" }).click();
    const sheet = page.getByRole("dialog", { name: "Edit Player" });
    await expect(sheet.getByLabel(/Mobile/)).not.toHaveValue("");
    await sheet.getByLabel(/Player Name/).fill(`Ben Waititi ${token}`);
    await shot(page, "fix-edit-player-390x844");
    await sheet.getByRole("button", { name: "Save Changes" }).click();
    await expect(toast(page, `Ben Waititi ${token}'s details are saved.`)).toBeVisible();
    await expect(page.getByTestId(`player-row-${ben!.id}`)).toContainText(`Ben Waititi ${token}`);
  });

  await test.step("every correction is a line in the staff's feed", async () => {
    const feed = await feedOf(page.request, tournament.id);
    expect(feed).toEqual(
      expect.arrayContaining([
        `${names[3]}'s payment was taken back: not paid yet`,
        `${names[3]}'s payment recorded as bank transfer`,
        `${names[3]} is now in the high hand`,
        `Ben Waititi ${token}'s details were corrected (name)`,
      ]),
    );
  });
});

test("(r) the Clock tab's Blind structure card opens the full-screen structure editor with Edit", async ({ page }) => {
  const token = uniqueToken();
  await signUp(page.request, "Tess Director");
  const club = await centralStars(page.request, token);
  const tournament = await createTournament(page.request, { clubId: club.id, name: `Clock Night ${token}`, buyInAmount: "100.00" });
  await setUpClock(page.request, tournament.id);
  await post(page.request, `/api/tournaments/${tournament.id}/clock/actions`, { action: "start" }, 200);

  await page.goto(`/admin/tournaments/${tournament.id}?tab=clock`);
  const card = page.getByTestId("structure-card");
  await card.scrollIntoViewIfNeeded();
  await expect(card.getByRole("table", { name: "Blind structure" })).toBeVisible();
  const edit = card.getByRole("button", { name: "Edit levels and breaks" });
  expect((await edit.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await shot(page, "structure-card-390x844");
  await edit.click();

  const editor = page.getByRole("dialog", { name: "Blind structure" });
  await expect(editor.getByRole("form", { name: "Blind structure" })).toBeVisible();
  await expect(editor.getByTestId("level-row-0")).toBeVisible();
  // The whole screen, as from Clock tools.
  const box = await editor.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(389);
  await shot(page, "structure-editor-390x844");
});
