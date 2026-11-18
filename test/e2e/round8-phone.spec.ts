/**
 * Round 8 (bank transfer payments) on the TD's phone (390 × 844), the players' phones and the TV
 * (1920 × 1080).
 *
 * (p) The owner adds the club's bank details in Club settings → Payments; until then the tournament's
 *     "Show bank transfer details after sign-up" switch cannot be used. Switched on, a QR sign-up is
 *     told to transfer the buy-in only (the high hand is paid at the door), with Particulars and the
 *     name cut to 12 characters as the Reference, each with Copy, and the card is still there when the
 *     phone reloads the page (back from the banking app); a sign-up past Max players is told not to
 *     pay yet, and is not given the account. The TD finds the transfer by name on the desk, sees the
 *     high hand is still to collect at the door, and confirms it as paid by bank transfer once it is;
 *     a free entry is never asked to pay, nor is a sign-up for a $0 game. The Payments tab says who
 *     last changed the bank details. The club page, the public tournament page, the TV and every
 *     public response carry none of the bank details.
 *
 * With SCREENSHOTS_DIR set (PLANNING/screens-round8 for the round's review), the screens the round's
 * brief names are saved there.
 */
import type { BrowserContext, Locator, Page } from "@playwright/test";
import type { ClubPaymentsDto } from "../../shared/api/clubs";
import { findForbiddenKeys, findTakingsKeys } from "../../shared/api/public";
import type { ManagedRegistration, PaymentInstructionsDto, RegistrationCreatedDto } from "../../shared/api/registrations";
import type { TournamentDetailDto } from "../../shared/api/tournaments";
import { createTournament, registrationsOf, signUp, uniqueToken } from "./support/api";
import { expect, test } from "./support/fixtures";
import { NEXT_POLL, poolOf, startClock, TV_MONEY } from "./support/money";
import { centralStars, enter, get, PHONE, regulars, screenOf, setUpClock, shot } from "./support/phone";
import { dismissToasts, toast } from "./support/ui";

test.use(PHONE);

const BANK = {
  accountName: "Stars Poker Club Trust",
  accountNumber: "12-3456-7890123-00",
  bankName: "ASB",
  instructions: "Pay by 5 pm on the day",
};

/** What no public screen or response may hold: every part of the club's bank details. */
const SECRETS = [BANK.accountName, BANK.accountNumber, "7890123", BANK.instructions];

/** The staff's view of the sign-ups: with their payments and how each was paid. */
const staffRegistrations = async (page: Page, tournamentId: string) => (await registrationsOf(page.request, tournamentId)) as ManagedRegistration[];

/**
 * Taps Complete Registration and answers the sign-up's own answer: the one response that may carry
 * the bank details (to the person who has just signed up).
 */
async function completeSignUp(phone: Page, tournamentId: string): Promise<RegistrationCreatedDto> {
  const answer = phone.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().endsWith(`/api/tournaments/${tournamentId}/registrations`),
  );
  await phone.getByTestId("complete-registration").click();
  const response = await answer;
  expect(response.status()).toBe(201);
  return (await response.json()) as RegistrationCreatedDto;
}

/** The page names none of the bank details, in any text on it (hidden text included). */
async function expectNoBankDetailsOn(page: Page): Promise<void> {
  const text = (await page.locator("body").textContent()) ?? "";
  for (const secret of SECRETS) expect(text, `${page.url()} shows "${secret}"`).not.toContain(secret);
}

/** Every JSON answer the browser's pages get from /api/, kept to be checked once they have all arrived. */
function recordApiAnswers(context: BrowserContext): () => Promise<{ url: string; body: unknown }[]> {
  const answers: Promise<{ url: string; body: unknown } | null>[] = [];
  context.on("response", (response) => {
    if (!new URL(response.url()).pathname.startsWith("/api/")) return;
    if (!(response.headers()["content-type"] ?? "").includes("json")) return;
    answers.push(response.json().then((body: unknown) => ({ url: response.url(), body }), () => null));
  });
  return async () => (await Promise.all(answers)).filter((answer): answer is { url: string; body: unknown } => answer !== null);
}

/**
 * Scrolls `element` to just below the staff screens' sticky bars (`bars` px tall), in whatever box
 * scrolls it (the staff layout scrolls its own main area, not the window).
 */
const showBelowBars = (element: Locator, bars: number) =>
  element.evaluate((target, offset) => {
    target.scrollIntoView({ block: "start" });
    let box = target.parentElement;
    while (box && !/(auto|scroll)/.test(getComputedStyle(box).overflowY)) box = box.parentElement;
    (box ?? document.scrollingElement)?.scrollBy(0, -offset);
  }, bars);

/** Opens the TD's Edit Tournament sheet from the phone's More tab; answers the bank-transfer switch. */
async function openEdit(page: Page, tournamentId: string) {
  await page.goto(`/admin/tournaments/${tournamentId}?tab=more`);
  await page.getByTestId("edit-tournament").click();
  const sheet = page.getByRole("dialog", { name: "Edit Tournament" });
  await expect(sheet).toBeVisible();
  const setting = sheet.getByTestId("bank-transfer-setting");
  await setting.evaluate((element) => element.scrollIntoView({ block: "center" }));
  return { sheet, setting, toggle: sheet.getByRole("switch", { name: "Show bank transfer details after sign-up" }) };
}

/** A regular finds themselves on the QR page by name and signs up (no high hand). */
async function signUpRegular(phone: Page, name: string) {
  await phone.getByTestId("player-type-existing").click();
  await phone.getByTestId("step1-next").click();
  await phone.getByTestId("player-search").fill(name);
  await phone.getByRole("list", { name: "Matching players" }).getByRole("button").filter({ hasText: name }).click();
  await phone.getByTestId("step2-next").click();
  await expect(phone.getByTestId("registering-as")).toHaveText(`Registering ${name}`);
}

test("(p) bank transfers: the club's details, the tournament's switch, the QR card with the buy-in and the name as reference, don't pay yet, the desk's transfer match, and nothing public", async ({
  page,
  openBrowser,
  baseURL,
}) => {
  test.slow();
  const token = uniqueToken();
  await signUp(page.request, "Tess Director");
  const club = await centralStars(page.request, token);
  // $50 buy-ins and a $5 high hand, no AP, room for three, on Wednesday 18 November (Particulars "Wed 18 Nov").
  const tournament = await createTournament(page.request, {
    clubId: club.id,
    name: `Wednesday Stars ${token}`,
    startDateTime: "2026-11-18T19:30:00+13:00",
    buyInAmount: "50.00",
    enableHighHand: true,
    highHandAmount: "5.00",
    maxPlayers: 3,
  });
  const [aroha, chloe, ben, dev] = await regulars(
    page.request,
    club.id,
    ["Aroha Ngata", "Chloe Tamati", "Ben Waititi", "Dev Patel"].map((name) => `${name} ${token}`),
  );
  // Aroha paid at the door; Chloe signed up at the desk and has not paid.
  await enter(page.request, tournament.id, [aroha!]);
  const [chloeEntry] = await enter(page.request, tournament.id, [chloe!], { paid: false });
  const alexandra = `Alexandra Fitzgerald ${token}`;

  await test.step("before the club has bank details, the tournament's switch is off, cannot be used, and says where to add them", async () => {
    const { sheet, setting, toggle } = await openEdit(page, tournament.id);
    await expect(toggle).toBeDisabled();
    await expect(toggle).not.toBeChecked();
    await expect(setting).toContainText("Add the club's bank details first");
    await expect(setting.getByTestId("add-bank-details")).toHaveAttribute("href", `/clubs/${club.id}/settings?tab=payments`);
    await sheet.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(sheet).toBeHidden();
  });

  await test.step("the owner adds the club's bank details on the Payments tab, the account number tidied as typed", async () => {
    await page.goto(`/clubs/${club.id}/settings?tab=payments`);
    const tab = page.getByTestId("club-payments");
    await expect(page.getByRole("tab", { name: "Payments" })).toHaveAttribute("aria-selected", "true");
    await expect(tab.getByTestId("club-payments-none")).toBeVisible();
    await tab.getByLabel("Account name").fill(BANK.accountName);
    await tab.getByLabel("Account number").pressSequentially("12 3456 7890123 00");
    await expect(tab.getByLabel("Account number")).toHaveValue(BANK.accountNumber);
    await tab.getByLabel("Bank (optional)").fill(BANK.bankName);
    await tab.getByLabel("Note for players (optional)").fill(BANK.instructions);
    await tab.getByTestId("bank-details-save").click();
    await expect(toast(page, "Bank details saved")).toBeVisible();
    // Who changed them, and when, for the owner to see (R8REV0-PRIV-03).
    await expect(tab.getByTestId("bank-details-last-change")).toContainText("Last changed by Tess Director on");
    await expect(tab.getByTestId("bank-details-changes").getByRole("listitem")).toHaveText([/Tess Director added the bank details$/]);
    expect(await get<ClubPaymentsDto>(page.request, `/api/clubs/${club.id}/payments`)).toMatchObject({ clubId: club.id, bankDetails: BANK });
    await dismissToasts(page);
    await showBelowBars(tab, 70);
    await shot(page, "payments-tab");
  });

  await test.step("the TD switches on \"Show bank transfer details after sign-up\"", async () => {
    const { sheet, toggle } = await openEdit(page, tournament.id);
    await expect(toggle).toBeEnabled();
    await toggle.click();
    await expect(toggle).toBeChecked();
    await sheet.getByTestId("bank-transfer-setting").evaluate((element) => element.scrollIntoView({ block: "start" }));
    await shot(page, "tournament-toggle");
    await sheet.getByTestId("save-tournament").click();
    await expect(toast(page, "Tournament updated")).toBeVisible();
    expect((await get<TournamentDetailDto>(page.request, `/api/tournaments/${tournament.id}`)).showBankTransfer).toBe(true);
  });

  const playersPhone = await openBrowser(PHONE);
  await playersPhone.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseURL });
  const phone = await playersPhone.newPage();
  let alexandraId = "";

  await test.step("a new player signs up from the QR code, with the high hand, and is shown how to pay the buy-in by transfer", async () => {
    await phone.goto(`/register/${tournament.id}`);
    await expect(phone.getByText("Step 1 of 3")).toBeVisible();
    // Nothing of the account before signing up.
    await expectNoBankDetailsOn(phone);
    await phone.getByTestId("player-type-new").click();
    await phone.getByTestId("step1-next").click();
    await phone.getByTestId("photo-skip").click();
    await phone.getByTestId("player-name").fill(alexandra);
    await phone.getByTestId("step2-next").click();
    await expect(phone.getByTestId("registering-as")).toHaveText(`Registering ${alexandra}`);
    await phone.getByTestId("high-hands-yes").click();
    const created = await completeSignUp(phone, tournament.id);
    alexandraId = created.id;
    // The transfer is the buy-in only; the high hand is paid at the door; the reference is the name, cut to 12.
    expect(created.paymentInstructions).toEqual({
      ...BANK,
      amountDueCents: 5_000,
      particulars: "Wed 18 Nov",
      reference: "Alexandra Fi",
      highHandAtDoorCents: 500,
      highHandsAtDoor: [{ highHandId: "legacy", name: "High hand", feeCents: 500 }],
      waitingList: false,
    } satisfies PaymentInstructionsDto);
    await expect(phone.getByText("Registration Complete!")).toBeVisible();
    await expect(toast(phone, "Pay by bank transfer, or at the door.")).toBeVisible();

    const card = phone.getByRole("region", { name: "Pay by bank transfer" });
    await expect(card.getByTestId("bank-transfer-amount")).toHaveText("$50.00");
    await expect(card.getByTestId("bank-transfer-account-name")).toHaveText(BANK.accountName);
    await expect(card.getByTestId("bank-transfer-account-number")).toHaveText(BANK.accountNumber);
    await expect(card.getByTestId("bank-transfer-bank")).toHaveText(BANK.bankName);
    await expect(card.getByTestId("bank-transfer-particulars")).toHaveText("Wed 18 Nov");
    await expect(card.getByTestId("bank-transfer-reference")).toHaveText("Alexandra Fi");
    await expect(card.getByTestId("bank-transfer-instructions")).toHaveText(BANK.instructions);
    await expect(card.getByTestId("bank-transfer-high-hand")).toHaveText("High hand ($5.00) — pay at the door");
    await expect(card).toContainText("Or pay at the door.");
    await expect(card).toContainText("The TD will confirm your payment.");
    // The desk's "proceed to the payment desk" box gives way to the card.
    await expect(phone.getByTestId("amount-due")).toHaveCount(0);

    for (const [button, value] of [
      ["copy-account-number", BANK.accountNumber],
      ["copy-particulars", "Wed 18 Nov"],
      ["copy-reference", "Alexandra Fi"],
    ] as const) {
      await card.getByTestId(button).click();
      await expect(card.getByTestId(button)).toContainText("Copied");
      expect(await phone.evaluate(() => navigator.clipboard.readText())).toBe(value);
    }

    await dismissToasts(phone);
    await card.evaluate((element) => element.scrollIntoView({ block: "start" }));
    await shot(phone, "signup-transfer-card");

    // Back from the banking app, the phone has unloaded the page: the card is still there, with no second sign-up (R8REV1-PHONE-02).
    let signUps = 0;
    phone.on("request", (request) => {
      if (request.method() === "POST" && request.url().endsWith(`/api/tournaments/${tournament.id}/registrations`)) signUps++;
    });
    await phone.reload();
    await expect(phone.getByText("Registration Complete!")).toBeVisible();
    const again = phone.getByRole("region", { name: "Pay by bank transfer" });
    await expect(again.getByTestId("bank-transfer-amount")).toHaveText("$50.00");
    await expect(again.getByTestId("bank-transfer-account-number")).toHaveText(BANK.accountNumber);
    await expect(again.getByTestId("bank-transfer-reference")).toHaveText("Alexandra Fi");
    await expect(again.getByTestId("bank-transfer-high-hand")).toHaveText("High hand ($5.00) — pay at the door");
    expect(signUps).toBe(0);
  });

  await test.step("a sign-up past Max players is on the waiting list, and told not to pay yet", async () => {
    await phone.getByTestId("register-another").click();
    await signUpRegular(phone, ben!.name);
    const created = await completeSignUp(phone, tournament.id);
    expect(created.waitingListPosition).toBe(1);
    // Told not to pay yet, and not given the account to pay into (R8REV0-PRIV-01).
    expect(created.paymentInstructions?.waitingList).toBe(true);
    expect(created.paymentInstructions).not.toHaveProperty("accountNumber");
    await expect(phone.getByTestId("dont-pay-yet")).toHaveText("You're on the waiting list (#1) — don't pay yet; the club will tell you if a spot opens.");
    await expect(toast(phone, "You're on the waiting list: don't pay yet.")).toBeVisible();
    await expect(phone.getByRole("region", { name: "Pay by bank transfer" })).toHaveCount(0);
    await expectNoBankDetailsOn(phone);
    await dismissToasts(phone);
    await shot(phone, "signup-waiting-list");
  });

  await test.step("the TD finds Alexandra's transfer by name on the desk and confirms it as paid by bank transfer", async () => {
    await page.goto(`/admin/tournaments/${tournament.id}?tab=money`);
    await expect(page.getByTestId(`transfer-reference-${alexandraId}`)).toHaveText("Alexandra Fi");
    await expect(page.getByTestId(`transfer-reference-${chloeEntry!.id}`)).toHaveText("Chloe Tamati");
    // The bank statement says "ALEXANDRA FI": case and spacing do not matter.
    await page.getByTestId("transfer-search").fill("  ALEXANDRA   fi ");
    await expect(page.getByTestId(`registration-${alexandraId}`)).toBeVisible();
    await expect(page.getByTestId(`registration-${chloeEntry!.id}`)).toHaveCount(0);
    await showBelowBars(page.getByTestId("transfer-search").locator(".."), 125);
    await shot(page, "desk-find-transfer");

    // Her transfer pays the buy-in; the high hand is still to collect at the door (R8REV1-PHONE-01).
    const row = page.getByTestId(`registration-${alexandraId}`);
    await expect(row.getByTestId(`transfer-part-${alexandraId}`)).toHaveText("Transfer $50.00 (buy-in)");
    await expect(row.getByTestId(`door-part-${alexandraId}`)).toHaveText("At the door $5.00 (high hand)");
    await page.getByTestId(`confirm-transfer-${alexandraId}`).click();
    const ask = page.getByTestId("collect-at-door");
    await expect(ask.getByRole("heading", { name: "Collect $5.00 at the door" })).toBeVisible();
    await expect(ask).toContainText(`${alexandra}'s bank transfer pays the buy-in, $50.00. The high hand is paid at the door: confirm once you have it.`);
    await shot(page, "desk-collect-at-door");
    // Not collected yet: she stays on the list to pay, and nothing is in the pot for her.
    await ask.getByRole("button", { name: "Not yet" }).click();
    await expect(ask).toBeHidden();
    await expect(row).toBeVisible();
    expect((await poolOf(page.request, tournament.id)).gross.total).toBe(5_000);

    await page.getByTestId(`confirm-transfer-${alexandraId}`).click();
    await page.getByTestId("collect-at-door-confirm").click();
    await expect(toast(page, `${alexandra} has paid by bank transfer.`)).toBeVisible();
    const paidBy = page.getByTestId(`paid-by-${alexandraId}`);
    await expect(paidBy).toHaveText("Bank transfer");
    const paidRow = page.getByTestId(`confirmed-registration-${alexandraId}`);
    await expect(paidRow.getByTestId(`transfer-part-${alexandraId}`)).toHaveText("Transfer $50.00 (buy-in)");
    await expect(paidRow.getByTestId(`door-part-${alexandraId}`)).toHaveText("At the door $5.00 (high hand)");
    await page.getByTestId("transfer-search").fill("");

    const entry = (await staffRegistrations(page, tournament.id)).find((registration) => registration.id === alexandraId);
    expect(entry).toMatchObject({ paymentConfirmed: true, paidBy: "transfer", enteringHighHands: true });
    // The pool counts the paid players only: Aroha's and Alexandra's $50, not Chloe's (unpaid) or Ben's (waiting).
    expect((await poolOf(page.request, tournament.id)).gross.total).toBe(10_000);
    await dismissToasts(page);
    await paidBy.evaluate((element) => element.scrollIntoView({ block: "center" }));
    await shot(page, "desk-paid-by");
  });

  await test.step("a free entry is never asked to pay: Chloe's leaves the list to pay, with no cash or transfer to record", async () => {
    await page.getByTestId(`free-entry-${chloeEntry!.id}`).click();
    const sheet = page.getByTestId("free-entry-sheet");
    await expect(sheet.getByRole("heading", { name: `Free entry for ${chloe!.name}` })).toBeVisible();
    await sheet.getByRole("group", { name: /Why is it free/ }).getByRole("button", { name: "Season prize" }).click();
    await sheet.getByTestId("give-free-entry").click();
    await expect(toast(page, "Free entry given")).toBeVisible();
    await expect(page.getByTestId(`registration-${chloeEntry!.id}`)).toHaveCount(0);
    await expect(page.getByTestId(`transfer-reference-${chloeEntry!.id}`)).toHaveCount(0);
    await expect(page.getByTestId(`confirmed-registration-${chloeEntry!.id}`).getByTestId("free-entry-badge")).toBeVisible();
    await expect(page.getByTestId(`paid-by-${chloeEntry!.id}`)).toHaveCount(0);

    const entry = (await staffRegistrations(page, tournament.id)).find((registration) => registration.id === chloeEntry!.id);
    expect(entry).toMatchObject({ paymentConfirmed: true, freeEntry: true, paidBy: "free" });
    // Her buy-in adds nothing (the club does not fund it); the three accepted now share the $100 50/30/20.
    const pool = await poolOf(page.request, tournament.id);
    expect([pool.gross.total, pool.net]).toEqual([10_000, 10_000]);
  });

  await test.step("nor is a sign-up for a $0 game that shows bank transfer details: nothing to transfer, no account shown", async () => {
    const freeroll = await createTournament(page.request, { clubId: club.id, name: `Freeroll ${token}`, buyInAmount: "0.00", showBankTransfer: true });
    await phone.goto(`/register/${freeroll.id}`);
    await signUpRegular(phone, dev!.name);
    const created = await completeSignUp(phone, freeroll.id);
    expect(created.paymentInstructions?.amountDueCents).toBe(0);
    expect(created.paymentInstructions).not.toHaveProperty("accountNumber");
    await expect(phone.getByText("Registration Complete!")).toBeVisible();
    await expect(phone.getByRole("region", { name: "Pay by bank transfer" })).toHaveCount(0);
    await expectNoBankDetailsOn(phone);
  });

  await test.step("the club page, the public tournament page, the QR page, the TV and every public response show none of the bank details", async () => {
    await setUpClock(page.request, tournament.id, TV_MONEY);
    await startClock(page.request, tournament.id);
    const visitorBrowser = await openBrowser(PHONE);
    const visitorAnswers = recordApiAnswers(visitorBrowser);
    const visitor = await visitorBrowser.newPage();

    await visitor.goto(`/club/${club.slug}`);
    await expect(visitor.getByRole("heading", { name: club.name, level: 1 })).toBeVisible();
    await expectNoBankDetailsOn(visitor);
    await visitor.getByRole("tab", { name: "Tournaments" }).click();
    await expect(visitor.getByText(tournament.name).first()).toBeVisible();
    await expectNoBankDetailsOn(visitor);

    await visitor.goto(`/tournament/${tournament.id}`);
    await expect(visitor.getByRole("heading", { name: tournament.name, exact: true })).toBeVisible();
    await visitor.getByRole("tab", { name: "Standings" }).click();
    await expect(visitor.getByText(alexandra).first()).toBeVisible();
    await expectNoBankDetailsOn(visitor);

    await visitor.goto(`/register/${tournament.id}`);
    await expect(visitor.getByText("Step 1 of 3")).toBeVisible();
    await expectNoBankDetailsOn(visitor);

    const tvBrowser = await openBrowser(screenOf(1920, 1080));
    const tvAnswers = recordApiAnswers(tvBrowser);
    const tv = await tvBrowser.newPage();
    await tv.goto(`/clock/${tournament.id}?screen=tv`);
    await expect(tv.getByRole("timer", { name: "Time left" })).toBeVisible();
    await expect(tv.getByTestId("display-money")).toContainText("$100", NEXT_POLL);
    await expectNoBankDetailsOn(tv);

    // What the pages were sent, and the public reads asked for directly, as nobody signed in.
    const direct = await Promise.all(
      [
        `/api/clubs/slug/${club.slug}`,
        `/api/clubs/${club.id}`,
        "/api/clubs",
        `/api/tournaments/${tournament.id}`,
        `/api/tournaments/${tournament.id}/registrations`,
        `/api/tournaments?clubId=${club.id}`,
        `/api/public/tournaments/${tournament.id}/display`,
        `/api/public/tournaments/${tournament.id}/prizes`,
        `/api/public/tournaments/${tournament.id}/players?q=${encodeURIComponent(token)}`,
      ].map(async (url) => ({ url, body: await get<unknown>(visitor.request, url) })),
    );
    const answers = [...(await visitorAnswers()), ...(await tvAnswers()), ...direct];
    expect(answers.length).toBeGreaterThan(direct.length);
    for (const { url, body } of answers) {
      expect(findForbiddenKeys(body), url).toEqual([]);
      expect(findTakingsKeys(body), url).toEqual([]);
      for (const secret of SECRETS) expect(JSON.stringify(body), url).not.toContain(secret);
    }
    // And the bank details themselves are for the club's staff only.
    expect((await visitor.request.get(`/api/clubs/${club.id}/payments`)).status()).toBe(401);
  });
});
