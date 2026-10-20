/**
 * (c) A tournament director runs a game from the admin pages: payments, a re-buy and an add-on that
 * players request from their phones, eliminations with knockouts, then End Tournament. What the
 * finalize preview promises is exactly what the standings, the admin page and the public page show
 * afterwards, and the money is the v2 split of the pool (it adds up to the pool, to the cent).
 */
import { devices, type Page } from "@playwright/test";
import {
  createClub,
  createPlayer,
  createPointsSystem,
  createSeason,
  createTournament,
  registerPlayer,
  signUp,
  uniqueToken,
} from "./support/api";
import { expect, test } from "./support/fixtures";
import { choose, tableRows, tableWithColumn, toast } from "./support/ui";

const { defaultBrowserType: _browser, ...pixel7 } = devices["Pixel 7"];

/**
 * 4 buy-ins at $25, one $25 re-buy and one $20 add-on: $145. The AP is 10% of the buy-ins ($10), so the
 * pool is $135. Standard pays 50/30/20: $67.50, $40.50 and $27 floored to $67, $40 and $27, and the
 * leftover $1 goes to 1st. (Rounding each place, as before v2, would have paid $68 + $41 + $27 = $136.)
 */
const POOL = "$135";
const PAYOUTS = ["$68", "$40", "$27"];

/** The admin page's Prize Structure cards, 1st to 3rd. */
async function expectPrizeStructure(page: Page) {
  await Promise.all(PAYOUTS.map((amount, index) => expect(page.getByTestId(`payout-${index + 1}`)).toHaveText(amount)));
}

/** The finalize preview names places "1st", "2nd"; the standings and leaderboards number them. */
const placeNumber = (place: string) => String(Number.parseInt(place, 10));

/** One finisher as the finalize preview shows them: place ("1st"), player, prize ("$68" or "-") and points. */
interface Finish {
  place: string;
  player: string;
  prize: string;
  points: string;
}

test("a TD confirms payments, approves re-buys and add-ons, records knockouts and finalizes the payouts the preview showed", async ({
  page,
  openBrowser,
}) => {
  const token = uniqueToken();
  const players = ["Ava", "Ben", "Cal", "Dee"].map((name) => `${name} ${token}`);
  const [ava, ben, cal, dee] = players;
  /** The player named in a table cell, which also holds their initials (and on the admin page, their entries). */
  const playerIn = (cell: string) => players.find((name) => cell.includes(name)) ?? cell;

  // The club owner sets the game up; `page.request` shares the page's session, so the page is signed in as them.
  await signUp(page.request, "Tess Director");
  const club = await createClub(page.request, `TD Club ${token}`);
  const season = await createSeason(page.request, club.id, `Spring ${token}`);
  const points = await createPointsSystem(page.request, season.id, {
    name: "League points",
    participationPoints: 10,
    knockoutPoints: 5,
    allocations: [
      { position: 1, points: 100 },
      { position: 2, points: 70 },
      { position: 3, points: 50 },
    ],
  });
  const tournament = await createTournament(page.request, {
    clubId: club.id,
    seasonId: season.id,
    pointsSystemId: points.id,
    name: `Thursday Deepstack ${token}`,
    buyInAmount: "25.00",
    rebuyAmount: "25.00",
    maxRebuys: 2,
    addonAmount: "20.00",
    rakeType: "percentage",
    rakeAmount: "10",
    payoutStructure: "standard",
    trackPoints: true,
  });
  const registrationOf: Record<string, string> = {};
  for (const name of players) {
    const player = await createPlayer(page.request, name);
    registrationOf[name] = (await registerPlayer(page.request, tournament.id, player.id)).id;
  }

  const phone = await (await openBrowser(pixel7)).newPage();

  await test.step("the TD confirms everyone's payment at the desk", async () => {
    await page.goto(`/admin/registrations/${tournament.id}`);
    for (const name of players) {
      await page.getByTestId(`confirm-payment-${registrationOf[name]}`).filter({ visible: true }).click();
      await expect(page.getByTestId(`confirmed-registration-${registrationOf[name]}`)).toBeVisible();
    }

    await expect(page.getByText("No pending registrations")).toBeVisible();
    await expect(page.getByText("Total Collected").locator("..")).toContainText("$100.00");
  });

  await test.step("the TD starts the tournament", async () => {
    await page.goto(`/admin/tournaments/${tournament.id}`);
    await page.getByTestId("start-tournament").click();
    await expect(page.getByText("In Progress", { exact: true })).toBeVisible();
    await expect(page.getByTestId("end-tournament")).toBeVisible();
  });

  await test.step("players ask for a re-buy and an add-on from their phones", async () => {
    await phone.goto(`/tournaments/${tournament.id}/actions`);
    for (const [action, player] of [["Re-buy", ava], ["Add-on", ben]] as const) {
      await phone.getByRole("button", { name: new RegExp(`^${action}`) }).click();
      await choose(phone, phone.getByRole("combobox"), new RegExp(`^${player}`));
      await phone.getByRole("button", { name: `Submit ${action}` }).click();
      await expect(phone.getByText("Action Submitted!")).toBeVisible();
      await expect(phone.getByText(`${action} for ${player}`)).toBeVisible();
      await phone.getByRole("button", { name: "Back to Actions" }).click();
    }
  });

  await test.step("the TD approves both requests, once each", async () => {
    await page.goto(`/admin/actions/${tournament.id}`);
    const requests = page.getByRole("row").filter({ has: page.getByRole("button", { name: "Confirm", exact: true }) });
    await expect(requests).toHaveCount(2);
    await expect(requests.filter({ hasText: ava })).toContainText("Re-buy");
    await expect(requests.filter({ hasText: ben })).toContainText("Add-on");
    for (const remaining of [1, 0]) {
      await requests.first().getByRole("button", { name: "Confirm", exact: true }).click();
      await expect(requests).toHaveCount(remaining);
    }
    await expect(page.getByText("No pending actions")).toBeVisible();
  });

  await test.step("the pool counts the re-buy and the add-on, and the TD locks it", async () => {
    await page.goto(`/admin/tournaments/${tournament.id}`);
    await expect(page.getByTestId("total-buyins")).toHaveText("4");
    await expect(page.getByTestId("total-rebuys")).toHaveText("1");
    await expect(page.getByTestId("total-addons")).toHaveText("1");
    await expect(page.getByTestId("prize-pool")).toHaveText(POOL);
    await expectPrizeStructure(page);
    await expect(page.getByTestId("gross-total")).toHaveText("$145");
    await expect(page.getByTestId("rake-amount")).toHaveText("-$10");
    await expect(page.getByTestId("net-prize-pool")).toHaveText(POOL);

    await page.getByRole("tab", { name: "Actions" }).click();
    await page.getByText("Lock Prize Pool").click();
    // Locking asks first (TN2-01).
    await page.getByTestId("confirm-lock-action").click();
    await expect(toast(page, "Prize Pool Locked")).toBeVisible();
  });

  await test.step("the public page shows the same pool and payouts", async () => {
    await phone.goto(`/tournament/${tournament.id}`);
    await expect(phone.getByText(`Total prize pool: ${POOL}`)).toBeVisible();
    const structure = tableWithColumn(phone, "Position");
    await expect
      .poll(async () => (await tableRows(structure)).slice(0, 3).map(([place, , prize]) => [place, prize]))
      .toEqual([
        ["1st Place", PAYOUTS[0]],
        ["2nd Place", PAYOUTS[1]],
        ["3rd Place", PAYOUTS[2]],
      ]);
  });

  await test.step("the TD knocks out two players, crediting who did it", async () => {
    await page.getByRole("tab", { name: "Standings" }).click();
    for (const [out, by] of [[dee, ava], [cal, ben]]) {
      await page.getByTestId(`eliminate-player-${registrationOf[out]}`).click();
      const dialog = page.getByRole("dialog", { name: "Eliminate Player" });
      await choose(page, dialog.getByLabel("Knocked out by (optional)"), by);
      await dialog.getByRole("button", { name: "Eliminate Player" }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByTestId(`player-row-${registrationOf[out]}`)).toContainText("Eliminated");
    }
  });

  let preview: Finish[] = [];
  await test.step("End Tournament previews the payouts, with the finishing order of the last two", async () => {
    await page.getByTestId("end-tournament").click();
    const dialog = page.getByRole("dialog", { name: "End Tournament" });
    await expect(dialog.getByTestId("finish-order-2")).toBeVisible();
    if (!(await dialog.getByTestId("finish-order-1").textContent())?.includes(ben)) {
      await dialog.getByRole("button", { name: `Move ${ben} up` }).click();
    }
    await expect(dialog.getByTestId("finish-order-1")).toContainText(ben);
    await expect(dialog.getByTestId("finish-order-2")).toContainText(ava);

    // Enabled once the preview for this order is in (not the one before the move).
    await expect(dialog.getByTestId("confirm-finalize")).toBeEnabled();
    await expect(dialog.getByTestId("finalize-pool")).toHaveText(POOL);
    // Everyone paid, the pool locked, more players than paid places: nothing for the TD to look at twice.
    await expect(dialog.getByTestId("finalize-warnings")).toHaveCount(0);
    preview = (await tableRows(dialog.getByTestId("finalize-plan"))).map(([place, player, prize, pointsAwarded]) => ({
      place,
      player,
      prize,
      points: pointsAwarded,
    }));
    // Placing points, plus 5 per knockout; 4th has no placing points, so gets the participation points.
    expect(preview).toEqual([
      { place: "1st", player: ben, prize: PAYOUTS[0], points: "105" },
      { place: "2nd", player: ava, prize: PAYOUTS[1], points: "75" },
      { place: "3rd", player: cal, prize: PAYOUTS[2], points: "50" },
      { place: "4th", player: dee, prize: "-", points: "10" },
    ]);

    await dialog.getByTestId("confirm-finalize").click();
    await expect(toast(page, "Tournament finalized")).toBeVisible();
    await expect(dialog).toBeHidden();
  });

  await test.step("the admin standings and payouts are what the preview showed", async () => {
    await expect(page.getByText("Completed", { exact: true })).toBeVisible();
    await expect(page.getByTestId("end-tournament")).toHaveCount(0);
    await expect(page.getByTestId("prize-pool")).toHaveText(`${POOL}(paid)`);

    const standings = tableWithColumn(page, "Entry");
    const shown = async () =>
      (await tableRows(standings)).map(([place, player, , , pointsAwarded, prize]) => ({
        place,
        player: playerIn(player),
        prize,
        points: pointsAwarded,
      }));
    await expect.poll(shown).toEqual(preview.map((row) => ({ ...row, place: placeNumber(row.place) })));

    await page.getByRole("tab", { name: "Overview" }).click();
    await expect(page.getByText("What was paid out")).toBeVisible();
    await expectPrizeStructure(page);
  });

  await test.step("the public page shows the same results, knockouts and payouts", async () => {
    await phone.reload();
    await expect(phone.getByText(`Total prize pool: ${POOL}`)).toBeVisible();
    const paid = async () =>
      (await tableRows(tableWithColumn(phone, "Position"))).slice(0, 3).map(([place, player, prize]) => ({
        place,
        player: playerIn(player),
        prize,
      }));
    await expect
      .poll(paid)
      .toEqual(preview.slice(0, 3).map(({ place, player, prize }) => ({ place: `${place} Place`, player, prize })));

    await phone.getByRole("tab", { name: "Standings" }).click();
    await expect(phone.getByText("Final Results")).toBeVisible();
    // A phone has no room for the Status, Knockouts and Points columns: the player's cell says them, under
    // the name ("1st", "1 knockout", "105 pts"; no knockout badge for none), and only Prize is beside it (MA-05).
    const finalResults = phone.getByRole("region", { name: "Final results", exact: true }).locator("table");
    const results = async () =>
      (await tableRows(finalResults)).map(([, player, prize]) => ({
        player: playerIn(player),
        knockouts: /(\d+) knockouts?\b/.exec(player)?.[1] ?? "0",
        points: /([\d,]+) pts\b/.exec(player)?.[1],
        prize,
      }));
    const knockoutsBy = { [ben]: "1", [ava]: "1", [cal]: "0", [dee]: "0" };
    await expect
      .poll(results)
      .toEqual(preview.map(({ player, points, prize }) => ({ player, knockouts: knockoutsBy[player], points, prize })));

    // This was the season's only game, so the season leaderboard is its points.
    await phone.getByRole("tab", { name: season.name }).click();
    // On a phone the Played column is the player's cell's "1 tournament".
    const leaderboard = async () =>
      (await tableRows(tableWithColumn(phone, "Rank"))).map(([rank, player, total]) => ({
        rank,
        player: playerIn(player),
        played: /(\d+) tournaments?\b/.exec(player)?.[1],
        points: total.replace(/\s*pts$/, ""),
      }));
    await expect
      .poll(leaderboard)
      .toEqual(preview.map(({ place, player, points }) => ({ rank: placeNumber(place), player, played: "1", points })));
  });
});
