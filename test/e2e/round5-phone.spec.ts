/**
 * Round 5 on the TD's phone (390 × 844, where hosts run their games): a Central Stars night.
 *
 * (a) Seating: the TD sets up 2 tables of 9 (the club's rectangles); late QR sign-ups (a selfie, an
 *     avatar, a regular found by name) are seated by themselves until every seat is taken; the next
 *     one waits, and the advisor opens Table 3 with a plan that evens the tables out, applied in a tap.
 * (b) The desk: a bust with its knockout in three taps, then Undo; a player's re-buy request approved
 *     from the header's badge; the clock paused, moved on and adjusted a minute either way; the rest
 *     of the structure changed to 15-minute levels; a custom payout with a fixed $ for 2nd, mid-game;
 *     End Tournament with an even chop between the last three.
 * (c) The club's colours: Central Stars' blue and gold chosen in club settings, then worn by the
 *     public tournament page, the QR sign-up, the TV and the TD's page, with no LovePoker purple left.
 * (d) The AP: fixed by hand for a low turnout from the Money tab's full-screen sheet, on a number
 *     keypad, then taken off for the night in one tap.
 * (e) The waiting list: a QR sign-up past Max players waits as #1, accepting them while the field is
 *     full is refused with no override, and once an accepted player's entry goes they are accepted.
 *
 * With SCREENSHOTS_DIR set, each step also saves its screen there (PLANNING/screens-round5 for the
 * round's review), named as in round5's integration brief.
 */
import type { APIRequestContext, Page } from "@playwright/test";
import type { ClockDto } from "../../shared/api/clock";
import type { LiveDisplayDto } from "../../shared/api/live-display";
import type { PrizePoolDto } from "../../shared/api/prize-pool";
import type { ClubDto } from "../../shared/api/public";
import type { SeatingDto } from "../../shared/api/seating";
import type { TournamentDetailDto } from "../../shared/api/tournaments";
import { CENTRAL_STARS_THEME, themeVariables } from "../../shared/domain/theme";
import { createTournament, registrationsOf, signUp, uniquePhone, uniqueToken } from "./support/api";
import { logoSvg, uploadImage } from "./support/demo";
import { expect, test } from "./support/fixtures";
import { centralStars, enter, get, PHONE, post, put, regulars, screenOf, settled, setUpClock, shot } from "./support/phone";
import { toast } from "./support/ui";

test.use(PHONE);

const seatingOf = (request: APIRequestContext, tournamentId: string) => get<SeatingDto>(request, `/api/tournaments/${tournamentId}/seating`);
/** Players at each table still in play, fullest first. */
const tableSizes = (seating: SeatingDto) =>
  seating.tables
    .filter((table) => table.status === "active")
    .map((table) => table.occupied)
    .sort((a, b) => b - a);

test("(a) 2 starting tables fill with late QR sign-ups seated by themselves, then the advisor opens Table 3 with an even-out plan", async ({
  page,
  openBrowser,
}) => {
  test.slow();
  const token = uniqueToken();
  await signUp(page.request, "Tess Director");
  const club = await centralStars(page.request, token);
  const tournament = await createTournament(page.request, { clubId: club.id, name: `Wednesday Stars ${token}`, buyInAmount: "100.00", maxPlayers: 27 });
  const players = await regulars(
    page.request,
    club.id,
    Array.from({ length: 16 }, (_, index) => `Regular ${String.fromCharCode(65 + index)} ${token}`),
  );
  await enter(page.request, tournament.id, players);
  // A regular who has not come tonight yet: they find themselves by name on the QR page later.
  const [lateRegular] = await regulars(page.request, club.id, [`Hemi Walker ${token}`]);
  await put(page.request, `/api/tournaments/${tournament.id}`, { status: "in_progress" });

  await test.step("the TD sets up the tables on their phone: 2 tables of 9 rectangles to start with", async () => {
    await page.goto(`/admin/tournaments/${tournament.id}?tab=seating`);
    await expect(page.getByRole("tab", { name: /Seats/ })).toHaveAttribute("aria-selected", "true");
    await page.getByTestId("open-seating-setup").click();

    const setup = page.getByRole("dialog", { name: "Set up tables & draw seats" });
    await expect(setup.getByTestId("setup-table-count")).toHaveValue("2");
    await expect(setup.getByTestId("setup-seat-count")).toHaveValue("9");
    await expect(setup.getByRole("radio", { name: "Rectangle" })).toBeChecked();
    await expect(setup.getByTestId("setup-preview")).toContainText("2 tables: 8 / 8");
    await setup.getByTestId("setup-seating-submit").click();

    const moves = page.getByRole("dialog").filter({ has: page.getByTestId("seat-moves") });
    await expect(moves.getByTestId("seat-moves").getByRole("listitem")).toHaveCount(16);
    await moves.getByRole("button", { name: "Done" }).click();
    await expect(page.getByTestId("seating-summary")).toHaveText("16/18 seats · 2 open");
    const seating = await seatingOf(page.request, tournament.id);
    expect(seating.tables.map((table) => [table.seatCount, table.shape])).toEqual([
      [9, "rectangle"],
      [9, "rectangle"],
    ]);
  });

  const playersPhone = await (await openBrowser({ ...PHONE, permissions: ["camera"] })).newPage();
  const signUpNew = async (name: string, photo: (signUp: Page) => Promise<void>) => {
    await playersPhone.goto(`/register/${tournament.id}`);
    await playersPhone.getByTestId("player-type-new").click();
    await playersPhone.getByTestId("step1-next").click();
    await photo(playersPhone);
    await playersPhone.getByTestId("photo-next").click();
    await playersPhone.getByTestId("player-name").fill(name);
    await playersPhone.getByTestId("player-phone").fill(uniquePhone());
    await playersPhone.getByTestId("step2-next").click();
    await playersPhone.getByTestId("complete-registration").click();
    await expect(playersPhone.getByText("Registration Complete!")).toBeVisible();
  };
  const seatLine = /You're at\s*Table [12], Seat \d/;

  await test.step("a late player signs up from the QR code with a selfie, and is seated there and then", async () => {
    await signUpNew(`Nina Selfie ${token}`, async (signUp) => {
      await expect(signUp.getByText("Add your photo")).toBeVisible();
      await signUp.getByRole("button", { name: "Take a selfie" }).click();
      const camera = signUp.getByRole("dialog", { name: "Take a selfie" });
      await expect(camera.getByRole("button", { name: "Capture" })).toBeEnabled();
      await shot(signUp, "signup-selfie");
      await camera.getByRole("button", { name: "Capture" }).click();
      await signUp.getByRole("dialog", { name: "Position your picture" }).getByRole("button", { name: "Use this" }).click();
      await expect(signUp.getByAltText("Upload preview")).toBeVisible();
    });
    await expect(playersPhone.getByTestId("seat-assignment")).toContainText(seatLine);
    await expect(playersPhone.getByTestId("seat-assignment-finder")).toHaveAttribute("href", `/tournament/${tournament.id}/seats`);
  });

  await test.step("another picks an avatar instead, and takes the last seat", async () => {
    await signUpNew(`Ari Avatar ${token}`, async (signUp) => {
      await signUp.getByRole("button", { name: "Pick an avatar" }).click();
      const picker = signUp.getByRole("dialog", { name: "Pick an avatar" });
      await expect(picker.getByRole("button", { name: "Shark" })).toBeVisible();
      await shot(signUp, "signup-avatars");
      await picker.getByRole("button", { name: "Shark" }).click();
      await expect(signUp.getByAltText("Upload preview")).toHaveAttribute("src", "/avatars/shark.svg");
    });
    await expect(playersPhone.getByTestId("registered-player").locator("img")).toHaveAttribute("src", "/avatars/shark.svg");
    await expect(playersPhone.getByTestId("seat-assignment")).toContainText(seatLine);
    expect(tableSizes(await seatingOf(page.request, tournament.id))).toEqual([9, 9]);
  });

  await test.step("a regular finds themselves by name with their photo, and waits: every table is full", async () => {
    await playersPhone.goto(`/register/${tournament.id}`);
    await playersPhone.getByTestId("player-type-existing").click();
    await playersPhone.getByTestId("step1-next").click();
    await playersPhone.getByTestId("player-search").fill("Hemi");
    const matches = playersPhone.getByRole("list", { name: "Matching players" }).getByRole("button");
    await expect(matches).toHaveCount(1);
    await shot(playersPhone, "existing-player-search");
    await matches.click();
    await playersPhone.getByTestId("step2-next").click();
    await playersPhone.getByTestId("complete-registration").click();
    await expect(playersPhone.getByTestId("seat-assignment")).toContainText("Every table is full right now");

    const registration = (await registrationsOf(page.request, tournament.id)).find((entry) => entry.playerId === lateRegular!.id);
    const seating = await seatingOf(page.request, tournament.id);
    expect(seating.unseated.map((entry) => entry.registrationId)).toEqual([registration?.id]);
  });

  await test.step("the advisor tells the TD to open Table 3 and shows who moves; one tap applies exactly that", async () => {
    await page.goto(`/admin/tournaments/${tournament.id}?tab=seating`);
    const advice = page.getByTestId("advice-open_table");
    await expect(advice).toContainText("Open Table 3");
    await expect(advice).toContainText("7 / 6 / 6");
    // The Seats tab says so from the other tabs too.
    await expect(page.getByRole("tab", { name: /^Seats\s*, Open a table$/ })).toBeVisible();
    await advice.getByText(/^Show who moves/).click();
    const planned = await advice.getByTestId("open-table-moves").getByRole("listitem").allInnerTexts();
    expect(planned.length).toBeGreaterThan(0);
    await shot(page, "advisor-open-table");

    await page.getByTestId("apply-open-table").click();
    const moves = page.getByRole("dialog").filter({ has: page.getByTestId("seat-moves") });
    await expect(moves.getByTestId("seat-moves").getByRole("listitem")).toHaveCount(planned.length);
    await moves.getByRole("button", { name: "Done" }).click();

    const seating = await seatingOf(page.request, tournament.id);
    expect(tableSizes(seating)).toEqual([7, 6, 6]);
    expect(seating.unseated).toEqual([]);
    expect(seating.tables.find((table) => table.tableNumber === 3)?.shape).toBe("rectangle");
    await expect(page.getByTestId("seating-summary")).toHaveText("19/27 seats · 8 open");
  });

  await test.step("on the phone the tables can also be read as a list, seat by seat", async () => {
    await page.getByTestId("seating-view-list").click();
    await expect(page.getByTestId("table-list-3")).toBeVisible();
    await expect(page.getByTestId("table-list")).toContainText("Hemi Walker");
    await shot(page, "seats-list-phone");
    await page.getByTestId("seating-view-tables").click();
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width, "the Seats tab scrolls sideways on a phone").toBeLessThanOrEqual(390);
  });

  await test.step("on the TD's laptop the same tables are drawn as 9-seat rectangles", async () => {
    const laptop = await (await openBrowser({ ...screenOf(1280, 800), storageState: await page.context().storageState() })).newPage();
    await laptop.goto(`/admin/tournaments/${tournament.id}?tab=seating`);
    await expect(laptop.getByRole("tab", { name: /Tables & Seating/ })).toHaveAttribute("aria-selected", "true");
    await expect(laptop.getByTestId("table-3")).toBeVisible();
    await laptop.getByTestId("table-1").evaluate((table) => table.scrollIntoView({ block: "start" }));
    await shot(laptop, "rectangle-tables-desktop");
  });
});

test("(b) the desk on a phone: a 3-tap bust with Undo, a re-buy approved, the clock, 15-minute levels, a fixed 2nd prize and an even chop", async ({
  page,
  openBrowser,
}) => {
  test.slow();
  const token = uniqueToken();
  await signUp(page.request, "Tess Director");
  const club = await centralStars(page.request, token);
  const tournament = await createTournament(page.request, {
    clubId: club.id,
    name: `One Life Line ${token}`,
    buyInAmount: "50.00",
    rebuyAmount: "25.00",
    maxRebuys: 1,
    payoutStructure: "standard",
    maxPlayers: 27,
  });
  const names = ["Aroha", "Ben", "Chloe", "Dev", "Ella", "Finn", "Grace", "Hemi"].map((name) => `${name} ${token}`);
  const players = await regulars(page.request, club.id, names);
  const entries = await enter(page.request, tournament.id, players);
  const entryOf = (index: number) => entries[index]!;
  await put(page.request, `/api/tournaments/${tournament.id}`, { status: "in_progress" });
  await post(page.request, `/api/tournaments/${tournament.id}/seating/setup`, {}, 201);
  await setUpClock(page.request, tournament.id);

  await test.step("the TD's page on a phone: the tournament and its clock at the top, five tabs at the bottom", async () => {
    await page.goto(`/admin/tournaments/${tournament.id}`);
    await expect(page.getByTestId("mobile-header")).toContainText(tournament.name);
    await expect(page.getByTestId("mobile-clock")).toBeVisible();
    const tabs = page.getByRole("tablist", { name: "Tournament sections" }).getByRole("tab");
    await expect(tabs).toHaveText(["Players", /^Seats/, "Clock", "Money", "More"]);
    await expect(page.getByTestId("field-summary")).toContainText("8 players");
    await shot(page, "td-header-and-tabs");
  });

  const out = entryOf(7);
  const winner = entryOf(0);
  await test.step("a bust with its knockout is three taps, and Undo puts the player straight back", async () => {
    await page.getByTestId("quick-actions").click();
    await expect(page.getByRole("menuitem", { name: "Bust a player" })).toBeVisible();
    await shot(page, "quick-actions");
    // 1: Bust a player, 2: who is out, 3: who knocked them out.
    await page.getByRole("menuitem", { name: "Bust a player" }).click();
    await page.getByTestId(`bust-pick-${out.id}`).click();
    await expect(page.getByTestId(`bust-by-${winner.id}`)).toBeVisible();
    await shot(page, "bust-flow");
    await page.getByTestId(`bust-by-${winner.id}`).click();

    const busted = toast(page, `${names[7]}, knocked out by ${names[0]}`);
    await expect(busted).toBeVisible();
    const afterBust = (await registrationsOf(page.request, tournament.id)).find((entry) => entry.id === out.id);
    expect(afterBust).toMatchObject({ isEliminated: true, eliminatedBy: winner.playerId });

    await busted.getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => (await registrationsOf(page.request, tournament.id)).find((entry) => entry.id === out.id)?.isEliminated).toBe(false);
  });

  await test.step("a player asks for a re-buy from their phone, and the TD approves it from the header's badge", async () => {
    const playersPhone = await (await openBrowser(PHONE)).newPage();
    await playersPhone.goto(`/tournaments/${tournament.id}/actions`);
    await playersPhone.getByRole("button", { name: /^Re-buy/ }).click();
    await playersPhone.getByRole("list", { name: "Who is the re-buy for?" }).getByRole("button", { name: new RegExp(`^${names[2]}`) }).click();
    await playersPhone.getByRole("button", { name: "Submit Re-buy" }).click();
    await expect(playersPhone.getByText("Action Submitted!")).toBeVisible();

    await page.reload();
    await expect(page.getByTestId("mobile-requests-count")).toHaveText("1");
    await page.getByTestId("mobile-requests").click();
    const sheet = page.getByRole("dialog", { name: "Player requests" });
    await expect(sheet).toContainText(names[2]!);
    await sheet.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(toast(page, "Action Confirmed")).toBeVisible();
    await expect(sheet.getByText("No pending actions")).toBeVisible();
    const rebought = (await registrationsOf(page.request, tournament.id)).find((entry) => entry.id === entryOf(2).id);
    expect(rebought?.rebuys).toBe(1);
  });

  const timer = () => page.getByRole("tabpanel").getByRole("timer", { name: "Time left" });
  await test.step("the clock on a phone: start, pause, the next level, and a minute either way", async () => {
    await page.goto(`/admin/tournaments/${tournament.id}?tab=clock`);
    const controls = page.getByTestId("clock-phone-controls");
    await controls.getByRole("button", { name: "Start" }).click();
    await expect(controls.getByRole("button", { name: "Pause" })).toBeVisible();
    await controls.getByRole("button", { name: "Pause" }).click();
    await expect(controls.getByRole("button", { name: "Resume" })).toBeVisible();
    await expect(page.getByTestId("mobile-clock-toggle")).toHaveAccessibleName("Resume the clock");

    await controls.getByRole("button", { name: "Next" }).click();
    await expect(timer()).toHaveText("20:00");
    await expect(page.getByTestId("mobile-clock")).toContainText("L2");
    await controls.getByRole("button", { name: "+1 min" }).click();
    await expect(timer()).toHaveText("21:00");
    await controls.getByRole("button", { name: "−1 min" }).click();
    await expect(timer()).toHaveText("20:00");
  });

  await test.step("the TD changes the rest of the structure to 15-minute levels; played levels stay as they were", async () => {
    const before = (await get<LiveDisplayDto>(page.request, `/api/public/tournaments/${tournament.id}/display`)).clock as ClockDto;
    await page.getByRole("button", { name: /Change the rest of the structure/ }).click();
    const sheet = page.getByRole("dialog", { name: "Change the rest of the structure" });
    await sheet.getByRole("switch", { name: "Same length for every later level" }).click();
    await sheet.getByLabel("Minutes per level", { exact: true }).fill("15");
    await expect(sheet.getByTestId("rest-preview")).toContainText("15 min");
    await shot(page, "clock-rest-of-structure");
    await sheet.getByRole("button", { name: "Save the new levels" }).click();
    await expect(sheet).toBeHidden();

    const after = (await get<LiveDisplayDto>(page.request, `/api/public/tournaments/${tournament.id}/display`)).clock as ClockDto;
    const current = after.currentLevelIndex;
    expect(current).toBe(before.currentLevelIndex);
    expect(after.structure.levels.slice(0, current + 1)).toEqual(before.structure.levels.slice(0, current + 1));
    const later = after.structure.levels.slice(current + 1).filter((level) => level.kind === "level");
    expect(later.length).toBeGreaterThan(0);
    expect(later.every((level) => level.durationMinutes === 15)).toBe(true);
    await expect(timer()).toHaveText("20:00");
  });

  await test.step("mid-game the TD sets a custom payout: 2nd a fixed $100, the rest a share, the leftover to 1st", async () => {
    await page.goto(`/admin/tournaments/${tournament.id}?tab=money`);
    await page.getByTestId("edit-payouts").first().click();
    const editor = page.getByRole("dialog", { name: "Edit payouts" });
    await editor.getByTestId("customise-payouts").click();
    const second = editor.getByTestId("payout-place-2");
    await second.getByRole("button", { name: "Fixed amount" }).click();
    await editor.getByLabel("2nd place", { exact: true }).fill("100");
    await expect(editor.getByTestId("payout-pays-2")).toContainText("$100 (fixed)");
    // What the places leave over is the club's unless the TD says otherwise (round 5, item 16): here 1st gets it.
    await expect(editor.getByRole("radio", { name: /^Club keeps it/ })).toBeChecked();
    await editor.getByRole("radio", { name: /^Add it to 1st/ }).click();
    await expect(editor.getByTestId("payout-sum")).toContainText("left over goes to 1st");
    await editor.getByRole("button", { name: "Short field" }).click();
    await editor.getByTestId("payout-place-1").evaluate((place) => place.scrollIntoView({ block: "start" }));
    await shot(page, "payout-editor");
    await editor.getByTestId("save-payouts").click();
    await expect(editor).toBeHidden();

    // 8 buy-ins at $50 and a $25 re-buy, no AP: $425. 3rd's 20% is $85, 2nd $100, and 1st the rest, $240.
    const pool = await get<PrizePoolDto>(page.request, `/api/tournaments/${tournament.id}/prize-pool`);
    expect(pool.breakdown.payouts.map((payout) => payout.amountCents)).toEqual([24_000, 10_000, 8_500]);
    await expect(page.getByTestId("payout-2")).toHaveText("$100");
  });

  await test.step("End Tournament with an even chop between the last three", async () => {
    for (const index of [7, 6, 5, 4, 3]) {
      await put(page.request, `/api/registrations/${entryOf(index).id}`, { isEliminated: true, eliminatedBy: winner.playerId });
    }
    await page.goto(`/admin/tournaments/${tournament.id}?tab=more`);
    await page.getByTestId("end-tournament").click();
    const dialog = page.getByRole("dialog", { name: "End Tournament" });
    await expect(dialog.getByRole("list", { name: "Finishing order" }).getByRole("listitem")).toHaveCount(3);
    await dialog.getByTestId("make-deal").click();
    await dialog.getByTestId("even-chop").click();
    await dialog.getByRole("button", { name: "Even chop at 3 handed" }).click();
    await expect(dialog.getByTestId("deal-total")).toContainText("$425");
    await expect(dialog.getByTestId("confirm-finalize")).toBeEnabled();
    await shot(page, "chop-dialog");
    await dialog.getByTestId("confirm-finalize").click();
    await expect(dialog).toBeHidden();

    const finished = await get<TournamentDetailDto>(page.request, `/api/tournaments/${tournament.id}`);
    expect(finished.status).toBe("completed");
    const deal = finished.prizePoolSnapshot?.deal;
    expect(deal?.reason).toBe("Even chop at 3 handed");
    expect(deal?.players.map((player) => player.amountCents).reduce((sum, cents) => sum + cents, 0)).toBe(42_500);
    expect(deal?.players.map((player) => player.amountCents)).toEqual([14_300, 14_100, 14_100]);
    const prizes = (await registrationsOf(page.request, tournament.id)).filter((entry) => entry.finalPosition !== null && entry.finalPosition <= 3);
    expect(prizes.map((entry) => Number(entry.prizeAmount)).sort((a, b) => b - a)).toEqual([143, 141, 141]);
  });
});

/** Every colour the visible page paints that reads as purple (hue 255–320°, not a grey): the LovePoker look. */
async function purplesOn(page: Page): Promise<string[]> {
  await settled(page);
  return page.evaluate(() => {
    const isPurple = (css: string): string | null => {
      for (const match of Array.from(css.matchAll(/rgba?\(([^)]+)\)/g))) {
        const [r = 0, g = 0, b = 0, a = 1] = match[1]!.split(/[\s,/]+/).filter(Boolean).map(Number);
        if (a < 0.15) continue;
        const [red, green, blue] = [r / 255, g / 255, b / 255];
        const max = Math.max(red, green, blue);
        const min = Math.min(red, green, blue);
        const delta = max - min;
        const lightness = (max + min) / 2;
        if (delta < 0.12 || delta / (1 - Math.abs(2 * lightness - 1)) < 0.25) continue;
        const sector = max === red ? ((green - blue) / delta) % 6 : max === green ? (blue - red) / delta + 2 : (red - green) / delta + 4;
        const hue = (sector * 60 + 360) % 360;
        if (hue >= 255 && hue <= 320) return match[0];
      }
      return null;
    };
    const found = new Set<string>();
    for (const element of Array.from(document.querySelectorAll<HTMLElement | SVGElement>("body *"))) {
      if (!element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      const style = getComputedStyle(element);
      const painted = ["color", "background-color", "background-image", "box-shadow"];
      for (const side of ["top", "right", "bottom", "left"]) if (Number.parseFloat(style.getPropertyValue(`border-${side}-width`)) > 0) painted.push(`border-${side}-color`);
      if (style.outlineStyle !== "none") painted.push("outline-color");
      if (element instanceof SVGElement) painted.push("fill", "stroke");
      for (const property of painted) {
        const hit = isPurple(style.getPropertyValue(property));
        const testId = element.getAttribute("data-testid");
        if (hit) found.add(`${element.tagName.toLowerCase()}${testId ? `[${testId}]` : ""} ${property}: ${hit}`);
      }
    }
    return Array.from(found).slice(0, 25);
  });
}

const primaryOn = (page: Page) => page.evaluate(() => document.documentElement.style.getPropertyValue("--primary"));

test("(c) Central Stars' colours, chosen in club settings, on its public pages, the QR sign-up, the TV and the TD's page: no purple", async ({
  page,
  openBrowser,
}) => {
  test.slow();
  const token = uniqueToken();
  await signUp(page.request, "Charlie Owner");
  const created = await centralStars(page.request, token, { colours: false });
  const club = await put<ClubDto>(page.request, `/api/clubs/${created.id}`, { imageUrl: await uploadImage(page.request, "club_logo", logoSvg()) });
  const season = await post<{ id: string }>(page.request, "/api/seasons", { clubId: club.id, name: `Winter ${token}`, startDate: "2026-06-01", isActive: true }, 201);
  const tournament = await createTournament(page.request, {
    clubId: club.id,
    seasonId: season.id,
    name: `Friday Stars ${token}`,
    buyInAmount: "100.00",
    maxPlayers: 27,
  });
  await enter(page.request, tournament.id, await regulars(page.request, club.id, ["Aroha", "Ben", "Chloe"].map((name) => `${name} ${token}`)));
  await put(page.request, `/api/tournaments/${tournament.id}`, { status: "in_progress" });
  await setUpClock(page.request, tournament.id);
  await post(page.request, `/api/tournaments/${tournament.id}/clock/actions`, { action: "start" });

  await test.step("the owner picks the Central Stars preset on the club's Colours tab and saves it", async () => {
    await page.goto(`/clubs/${club.id}/settings`);
    await page.getByRole("tab", { name: "Colours" }).click();
    await page.getByRole("button", { name: /^Central Stars/ }).click();
    await expect(page.getByRole("button", { name: /^Central Stars/ })).toHaveAttribute("aria-pressed", "true");
    await shot(page, "colours-tab");
    await page.getByRole("button", { name: "Save colours" }).click();
    await expect(toast(page, "Club colours saved")).toBeVisible();
    expect((await get<ClubDto>(page.request, `/api/clubs/${club.id}`)).theme).toEqual(CENTRAL_STARS_THEME);
  });

  const light = themeVariables(CENTRAL_STARS_THEME, "light")["--primary"];
  const dark = themeVariables(CENTRAL_STARS_THEME, "dark")["--primary"];
  const visitor = await (await openBrowser(PHONE)).newPage();

  await test.step("the public tournament page and the QR sign-up wear the club's blue, with no purple", async () => {
    await visitor.goto(`/tournament/${tournament.id}`);
    await expect(visitor.getByRole("heading", { name: tournament.name, exact: true })).toBeVisible();
    await expect.poll(() => primaryOn(visitor)).toBe(light);
    expect(await purplesOn(visitor)).toEqual([]);
    await shot(visitor, "central-stars-public-tournament");

    await visitor.goto(`/register/${tournament.id}`);
    await expect(visitor.getByText("Step 1 of 3")).toBeVisible();
    await expect.poll(() => primaryOn(visitor)).toBe(light);
    expect(await purplesOn(visitor)).toEqual([]);
  });

  await test.step("the TV wears it too, worked out for its dark screen", async () => {
    const tv = await (await openBrowser(screenOf(1920, 1080))).newPage();
    await tv.goto(`/clock/${tournament.id}?screen=tv`);
    await expect(tv.getByRole("timer", { name: "Time left" })).toBeVisible();
    await expect.poll(() => primaryOn(tv)).toBe(dark);
    expect(await purplesOn(tv)).toEqual([]);
    await shot(tv, "central-stars-tv-1920x1080");
  });

  await test.step("and so does the TD's page for the club's tournament", async () => {
    await page.goto(`/admin/tournaments/${tournament.id}`);
    await expect(page.getByTestId("mobile-header")).toContainText(tournament.name);
    await expect.poll(() => primaryOn(page)).toBe(light);
    expect(await purplesOn(page)).toEqual([]);
  });
});

test("(d) the AP on a phone: fixed by hand for a low turnout in a full-screen sheet, then taken off for the night", async ({ page }) => {
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
  await put(page.request, `/api/tournaments/${tournament.id}`, { status: "in_progress" });
  const panel = page.getByTestId("ap-panel");
  const net = async () => (await get<PrizePoolDto>(page.request, `/api/tournaments/${tournament.id}/prize-pool`)).breakdown.net;

  await test.step("the Money tab shows the AP the rates take", async () => {
    await page.goto(`/admin/tournaments/${tournament.id}?tab=money`);
    await expect(panel.getByTestId("ap-take")).toHaveText("$40");
    await expect(page.getByTestId("net-prize-pool")).toHaveText("$360");
  });

  await test.step("the TD fixes the AP at $10 for the low turnout, in a sheet that fills the phone, on a number keypad", async () => {
    await panel.getByTestId("adjust-ap").click();
    const sheet = page.getByRole("dialog", { name: "Adjust AP" });
    await sheet.getByLabel("Set AP total").check();
    const amount = sheet.getByTestId("adjust-amount");
    await expect(amount).toHaveAttribute("inputmode", "decimal");
    await amount.fill("10");
    await sheet.getByRole("group", { name: "Common reasons" }).getByRole("button", { name: "Low turnout" }).click();
    await settled(page);
    const box = await sheet.boundingBox();
    expect(box && [box.x, box.y, box.width, box.height].map(Math.round), "the Adjust AP sheet fills the phone's screen").toEqual([0, 0, 390, 844]);
    await shot(page, "ap-adjust-phone");
    await sheet.getByTestId("save-adjustment").click();

    await expect(toast(page, "AP fixed at $10")).toBeVisible();
    await expect(sheet).toBeHidden();
    await expect(panel.getByTestId("ap-take")).toHaveText("$10");
    await expect(page.getByTestId("net-prize-pool")).toHaveText("$390");
    expect(await net()).toBe(39_000);
  });

  await test.step("No AP tonight takes it off in one tap: everything collected goes to the pool", async () => {
    await panel.getByTestId("no-ap").click();
    await expect(toast(page, "No AP tonight")).toBeVisible();
    await expect(panel.getByTestId("no-ap-tonight")).toContainText("AP: none tonight");
    await expect(page.getByTestId("net-prize-pool")).toHaveText("$400");
    expect(await net()).toBe(40_000);
  });
});

test("(e) the waiting list on a phone: a QR sign-up past Max players waits as #1, cannot be accepted while the field is full, and is once a place opens", async ({
  page,
  openBrowser,
}) => {
  test.slow();
  const token = uniqueToken();
  await signUp(page.request, "Tess Director");
  const club = await centralStars(page.request, token);
  const tournament = await createTournament(page.request, { clubId: club.id, name: `Full House ${token}`, buyInAmount: "40.00", maxPlayers: 3 });
  const names = ["Aroha", "Ben", "Chloe"].map((name) => `${name} ${token}`);
  await enter(page.request, tournament.id, await regulars(page.request, club.id, names));
  const latecomer = `Dee Late ${token}`;
  const entryOf = async (name: string) => (await registrationsOf(page.request, tournament.id)).find((entry) => entry.player?.name === name);

  await test.step("a player signs up from the QR code past Max players: told first, then on the waiting list as #1", async () => {
    const playersPhone = await (await openBrowser(PHONE)).newPage();
    await playersPhone.goto(`/register/${tournament.id}`);
    await expect(playersPhone.getByTestId("waiting-list-notice")).toContainText("#1 on the waiting list");
    await playersPhone.getByTestId("player-type-new").click();
    await playersPhone.getByTestId("step1-next").click();
    await playersPhone.getByTestId("photo-skip").click();
    await playersPhone.getByTestId("player-name").fill(latecomer);
    await playersPhone.getByTestId("player-phone").fill(uniquePhone());
    await playersPhone.getByTestId("step2-next").click();
    await playersPhone.getByTestId("complete-registration").click();
    await expect(playersPhone.getByTestId("waiting-list-place")).toContainText("You're on the waiting list — #1");
    await expect(playersPhone.getByText("Pay at the desk once you're called in")).toBeVisible();
    await shot(playersPhone, "waiting-list-confirmation");
    expect((await entryOf(latecomer))?.waitingListPosition).toBe(1);
  });
  const waiting = (await entryOf(latecomer))!;

  await test.step("the TD's Players tab counts the field of 3 and numbers the list behind it", async () => {
    await page.goto(`/admin/tournaments/${tournament.id}`);
    await expect(page.getByTestId("field-summary")).toContainText("3 players");
    await expect(page.getByTestId("field-summary")).toContainText("1 on the waiting list");
    await expect(page.getByTestId(`waiting-${waiting.id}`)).toContainText("#1");
    await expect(page.getByTestId("waiting-list-full")).toContainText("3 of 3 players accepted");
    await shot(page, "waiting-list-players-tab");
  });

  const takePayment = async () => {
    await page.getByTestId("quick-actions").click();
    await page.getByRole("menuitem", { name: /Take payment/ }).click();
    return page.getByRole("dialog", { name: "Take payment" });
  };

  await test.step("accepting them while the field is full is refused: Tournament full, with no override", async () => {
    const sheet = await takePayment();
    const list = sheet.getByTestId("payment-waiting-list");
    await expect(list.getByRole("heading", { name: "Waiting list · 1" })).toBeVisible();
    await list.getByRole("button", { name: `Confirm payment for ${latecomer}` }).click();
    await expect(toast(page, "Tournament full")).toBeVisible();
    expect((await entryOf(latecomer))?.waitingListPosition).toBe(1);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  });

  await test.step("once an accepted player's entry is removed, the next on the list moves up and is accepted", async () => {
    await page.getByRole("button", { name: `Remove ${names[2]}'s entry` }).click();
    await page.getByRole("alertdialog", { name: "Remove this entry?" }).getByRole("button", { name: "Remove entry" }).click();
    await expect(toast(page, "Entry removed")).toBeVisible();
    await expect(page.getByTestId("field-summary")).not.toContainText("waiting list");

    const sheet = await takePayment();
    await sheet.getByRole("button", { name: `Confirm payment for ${latecomer}` }).click();
    await expect(toast(page, "Payment Confirmed")).toBeVisible();
    expect((await entryOf(latecomer))?.waitingListPosition ?? null).toBeNull();
    expect((await registrationsOf(page.request, tournament.id)).map((entry) => entry.player?.name).sort()).toEqual([names[0], names[1], latecomer].sort());
  });
});
