/**
 * Tables & seating on the night: the TD puts tables out and draws everyone a seat in one tap, moves a
 * player by tapping them and then an empty seat, and a bust frees that player's seat (on the TD's plan,
 * the standings and the players' seat finder) until a restore gives them the very same seat back.
 */
import { devices, type APIRequestContext } from "@playwright/test";
import type { SeatingDto } from "../../shared/api/seating";
import { createClub, createPlayer, createTournament, expectJson, registerPlayer, signUp, uniqueToken } from "./support/api";
import { expect, test } from "./support/fixtures";
import { toast } from "./support/ui";

const { defaultBrowserType: _browser, ...pixel7 } = devices["Pixel 7"];

/** The TD's seating, as the server has it. */
async function seatingOf(request: APIRequestContext, tournamentId: string): Promise<SeatingDto> {
  return expectJson<SeatingDto>(await request.get(`/api/tournaments/${tournamentId}/seating`), 200);
}

test("a TD draws seats, moves a player, and a bust frees the seat that a restore gives back", async ({ page, openBrowser }) => {
  const token = uniqueToken();
  const names = ["Aroha", "Ben", "Chloe", "Dev", "Ella", "Finn", "Grace", "Hemi", "Isla", "Jack", "Kiri", "Liam"].map((name) => `${name} ${token}`);
  const mover = names[0]!;

  await signUp(page.request, "Tess Director");
  const club = await createClub(page.request, `Seat Club ${token}`);
  const tournament = await createTournament(page.request, { clubId: club.id, name: `Seat Night ${token}`, maxPlayers: 30 });
  const registrationOf: Record<string, string> = {};
  for (const name of names) {
    const player = await createPlayer(page.request, name);
    registrationOf[name] = (await registerPlayer(page.request, tournament.id, player.id, { paymentConfirmed: true })).id;
  }
  await expectJson(await page.request.put(`/api/tournaments/${tournament.id}`, { data: { status: "in_progress" } }), 200);

  const phone = await (await openBrowser(pixel7)).newPage();

  await test.step("the TD sets up the tables and draws everyone a seat in one tap", async () => {
    await page.goto(`/admin/tournaments/${tournament.id}`);
    await page.getByRole("tab", { name: "Tables & Seating" }).click();
    await expect(page.getByText("12 players still in. Start with 2 tables: 6 / 6.")).toBeVisible();
    await page.getByTestId("open-seating-setup").click();

    const setup = page.getByRole("dialog", { name: "Set up tables & draw seats" });
    await expect(setup.getByTestId("setup-preview")).toContainText("2 tables: 6 / 6");
    await setup.getByTestId("setup-seating-submit").click();

    const moves = page.getByRole("dialog").filter({ has: page.getByTestId("seat-moves") });
    await expect(moves.getByTestId("seat-moves").getByRole("listitem")).toHaveCount(12);
    await moves.getByRole("button", { name: "Done" }).click();
    await expect(page.getByTestId("seating-summary")).toHaveText("12/18 seats · 6 open");
    await expect(page.getByTestId("table-1")).toBeVisible();
    await expect(page.getByTestId("table-2")).toBeVisible();
  });

  let seat: { tableNumber: number; seatNumber: number };
  await test.step("the TD moves a player by tapping them, then an empty seat at the other table", async () => {
    const before = (await seatingOf(page.request, tournament.id)).seatByRegistrationId[registrationOf[mover]!]!;
    const otherTable = page.getByTestId(`table-${before.tableNumber === 1 ? 2 : 1}`);

    await page.getByRole("button", { name: new RegExp(`^Seat \\d+: ${mover}$`) }).click();
    await expect(page.getByTestId("selection-bar")).toContainText(mover);
    const empty = otherTable.getByRole("button", { name: /^Seat \d+, empty: move .+ here$/ }).first();
    const target = Number(/^Seat (\d+)/.exec((await empty.getAttribute("aria-label")) ?? "")?.[1]);
    await empty.click();

    await expect(toast(page, "Player moved")).toBeVisible();
    await expect(otherTable.getByRole("button", { name: `Seat ${target}: ${mover}` })).toBeVisible();
    seat = (await seatingOf(page.request, tournament.id)).seatByRegistrationId[registrationOf[mover]!]!;
    expect(seat).toEqual({ tableNumber: before.tableNumber === 1 ? 2 : 1, seatNumber: target });
  });

  await test.step("the player finds that seat on their phone", async () => {
    await phone.goto(`/tournament/${tournament.id}`);
    await phone.getByTestId("find-your-seat").click();
    await phone.getByTestId("seat-search").fill(mover.split(" ")[0]!);
    await expect(phone.getByTestId("seat-results")).toContainText(`Table ${seat.tableNumber} · Seat ${seat.seatNumber}`);
  });

  await test.step("a bust frees the seat on the TD's plan, the standings and the seat finder", async () => {
    await page.getByRole("tab", { name: "Standings" }).click();
    const row = page.getByTestId(`player-row-${registrationOf[mover]}`);
    await expect(row.getByTestId("standings-seat")).toHaveText(`T${seat.tableNumber} · S${seat.seatNumber}Table ${seat.tableNumber}, seat ${seat.seatNumber}`);

    await page.getByTestId(`eliminate-player-${registrationOf[mover]}`).click();
    const dialog = page.getByRole("dialog", { name: "Eliminate Player" });
    await dialog.getByRole("button", { name: "Eliminate Player" }).click();
    await expect(dialog).toBeHidden();
    await expect(row).toContainText("Eliminated");
    await expect(row.getByTestId("standings-seat")).toHaveText("–No seat");

    await page.getByRole("tab", { name: "Tables & Seating" }).click();
    await expect(page.getByTestId(`table-${seat.tableNumber}`).getByRole("button", { name: new RegExp(`^Seat ${seat.seatNumber}, empty`) })).toBeVisible();
    await expect(page.getByTestId("seating-summary")).toHaveText("11/18 seats · 7 open");

    await phone.reload();
    await phone.getByTestId("seat-search").fill(mover.split(" ")[0]!);
    await expect(phone.getByTestId("seat-results")).toContainText("Nobody seated has that name.");
  });

  await test.step("a restore puts the player back in the very same seat", async () => {
    await page.getByRole("tab", { name: "Standings" }).click();
    await page.getByTestId(`restore-player-${registrationOf[mover]}`).click();
    await expect(toast(page, "Player restored successfully")).toBeVisible();
    const row = page.getByTestId(`player-row-${registrationOf[mover]}`);
    await expect(row.getByTestId("standings-seat")).toHaveText(`T${seat.tableNumber} · S${seat.seatNumber}Table ${seat.tableNumber}, seat ${seat.seatNumber}`);

    await page.getByRole("tab", { name: "Tables & Seating" }).click();
    await expect(page.getByTestId(`table-${seat.tableNumber}`).getByRole("button", { name: `Seat ${seat.seatNumber}: ${mover}` })).toBeVisible();
    await expect(page.getByTestId("seating-summary")).toHaveText("12/18 seats · 6 open");

    await phone.reload();
    await phone.getByTestId("seat-search").fill(mover.split(" ")[0]!);
    await expect(phone.getByTestId("seat-results")).toContainText(`Table ${seat.tableNumber} · Seat ${seat.seatNumber}`);
  });
});
