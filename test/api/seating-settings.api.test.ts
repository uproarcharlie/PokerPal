/**
 * A tournament's seating settings (round 5, items 4, 11 and 12; round5-contracts §3.2 rules 1 and
 * 4): seats per table and table shape default from the tournament, else its club, else 9-seat ovals;
 * setup opens the starting tables (2 by default) and remembers seats or a shape it was sent; tables can
 * be redrawn as another shape; the open-table threshold may not exceed the seats per table.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { PublicSeatingDto, SeatingDto, SeatingMutationDto } from "@shared/api/seating";
import { activityLog, clubs, tournamentRegistrations as tournamentRegistrationsTable, tournaments, tournamentTables } from "@shared/schema";
import { createTournament, type NewTournament } from "../factories";
import { createClock, MINUTE_MS, runningState } from "../factories/clock";
import { createSeat, createTable, registerPlayers } from "../factories/seating";
import { anon, resetDb, testDb } from "../helpers";
import { clubWithStaff } from "../helpers/club-staff";

beforeEach(resetDb);

const path = (tournamentId: string, rest: string) => `/api/tournaments/${tournamentId}/${rest}`;

async function world({ club = {}, tournament: overrides = {}, players = 0 }: { club?: Partial<typeof clubs.$inferInsert>; tournament?: Partial<NewTournament>; players?: number } = {}) {
  const staff = await clubWithStaff(club);
  const tournament = await createTournament({ clubId: staff.club.id, status: "in_progress", ...overrides });
  const registrations = await registerPlayers(tournament.id, Array.from({ length: players }, (_, i) => `Player ${i + 1}`));
  return { staff, tournament, registrations, td: staff.manager.agent };
}

const tableRows = (tournamentId: string) => testDb().select().from(tournamentTables).where(eq(tournamentTables.tournamentId, tournamentId));
const tournamentRow = async (id: string) => (await testDb().select().from(tournaments).where(eq(tournaments.id, id)))[0];

describe("setup and new tables follow the seating settings", () => {
  it("a Central Stars-style club (9 seats, rectangles) gets 2 rectangle tables of 9 at setup, drawn as rectangles everywhere", async () => {
    const { tournament, td } = await world({ club: { defaultSeatsPerTable: 9, defaultTableShape: "rectangle" }, players: 12 });

    const before = (await td.get(path(tournament.id, "seating"))).body as SeatingDto;
    const response = await td.post(path(tournament.id, "seating/setup")).send({});

    expect(before.settings).toMatchObject({ seatsPerTable: 9, startingTables: 2, openTableAt: 9, autoSeat: "on_register", tableShape: "rectangle" });
    expect(before.suggestions.setup).toEqual({ seatCount: 9, tableCount: 2, perTable: [6, 6] });
    expect(response.status).toBe(201);
    const seating = (response.body as SeatingMutationDto).seating;
    expect(seating.tables.map((table) => [table.tableNumber, table.seatCount, table.shape, table.occupied])).toEqual([
      [1, 9, "rectangle", 6],
      [2, 9, "rectangle", 6],
    ]);
    expect((await tableRows(tournament.id)).map((row) => row.shape)).toEqual(["rectangle", "rectangle"]);
    const finder = (await (await anon()).get(`/api/public/tournaments/${tournament.id}/seating`)).body as PublicSeatingDto;
    expect(finder.tables.map((table) => table.shape)).toEqual(["rectangle", "rectangle"]);
    // Nothing the TD did not send is stored on the tournament: it keeps following its club.
    expect(await tournamentRow(tournament.id)).toMatchObject({ seatsPerTable: null, tableShape: null });
  });

  it("opens more than the starting tables when the players registered need them at the threshold", async () => {
    const { tournament, td } = await world({ tournament: { seatsPerTable: 9, openTableAt: 8 }, players: 30 });

    const response = await td.post(path(tournament.id, "seating/setup")).send({});

    expect((response.body as SeatingMutationDto).seating.stats).toMatchObject({ activeTables: 4, seated: 30 });
  });

  it("remembers the seats and shape setup was sent, so the tables opened later match", async () => {
    const { tournament, td } = await world({ players: 4 });

    await td.post(path(tournament.id, "seating/setup")).send({ seatCount: 6, shape: "round", tableCount: 1 });
    const added = await td.post(path(tournament.id, "tables")).send({});

    expect(await tournamentRow(tournament.id)).toMatchObject({ seatsPerTable: 6, tableShape: "round" });
    expect((added.body as SeatingMutationDto).seating.tables.map((table) => [table.seatCount, table.shape])).toEqual([
      [6, "round"],
      [6, "round"],
    ]);
  });

  it("adds tables of the settings' seats and shape unless told otherwise", async () => {
    const { tournament, td } = await world({ tournament: { seatsPerTable: 8, tableShape: "rectangle" } });

    const defaults = await td.post(path(tournament.id, "tables")).send({ count: 1 });
    const chosen = await td.post(path(tournament.id, "tables")).send({ count: 1, seatCount: 10, shape: "oval" });

    expect((defaults.body as SeatingMutationDto).seating.tables[0]).toMatchObject({ seatCount: 8, shape: "rectangle" });
    expect((chosen.body as SeatingMutationDto).seating.tables[1]).toMatchObject({ seatCount: 10, shape: "oval" });
  });
});

describe("PATCH /api/tournaments/:id/tables/:tableId { shape }", () => {
  it("redraws one table as another shape, logged; its own shape already, it changes nothing", async () => {
    const { tournament, td } = await world({ tournament: { tableShape: "rectangle" } });
    const table = await createTable({ tournamentId: tournament.id, tableNumber: 1 });

    const same = await td.patch(path(tournament.id, `tables/${table.id}`)).send({ shape: "rectangle" });
    const round = await td.patch(path(tournament.id, `tables/${table.id}`)).send({ shape: "round" });

    expect(same.status).toBe(200);
    expect(round.status).toBe(200);
    expect((round.body as SeatingMutationDto).seating.tables[0].shape).toBe("round");
    const entries = await testDb().select().from(activityLog).where(eq(activityLog.tournamentId, tournament.id));
    expect(entries.map((entry) => entry.description)).toEqual(["Table 1 is now a round table"]);
  });

  it("refuses a shape it does not know (400 VALIDATION)", async () => {
    const { tournament, td } = await world();
    const table = await createTable({ tournamentId: tournament.id, tableNumber: 1 });

    const response = await td.patch(path(tournament.id, `tables/${table.id}`)).send({ shape: "hexagon" });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: "VALIDATION" });
  });
});

describe("seating settings on the tournament (PUT/POST /api/tournaments)", () => {
  it("are stored and read back resolved; blank clears them back to the club's", async () => {
    const { tournament, td } = await world({ club: { defaultSeatsPerTable: 9, defaultTableShape: "rectangle" } });

    const saved = await td
      .put(`/api/tournaments/${tournament.id}`)
      .send({ seatsPerTable: 6, startingTables: 3, openTableAt: 5, autoSeat: "once_paid", tableShape: "round" });
    const seating = (await td.get(path(tournament.id, "seating"))).body as SeatingDto;
    const cleared = await td.put(`/api/tournaments/${tournament.id}`).send({ seatsPerTable: "", openTableAt: null, tableShape: null, autoSeat: null, startingTables: null });
    const back = (await td.get(path(tournament.id, "seating"))).body as SeatingDto;

    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ seatsPerTable: 6, startingTables: 3, openTableAt: 5, autoSeat: "once_paid", tableShape: "round" });
    expect(seating.settings).toMatchObject({ seatsPerTable: 6, startingTables: 3, openTableAt: 5, autoSeat: "once_paid", tableShape: "round" });
    expect(cleared.status).toBe(200);
    expect(back.settings).toMatchObject({ seatsPerTable: 9, startingTables: 2, openTableAt: 9, autoSeat: "on_register", tableShape: "rectangle" });
  });

  it("refuse an open-table threshold above the seats per table, on its field (400 VALIDATION), counting the stored and the club's values", async () => {
    const { staff, tournament, td } = await world({ club: { defaultSeatsPerTable: 8 } });

    const above = await td.put(`/api/tournaments/${tournament.id}`).send({ openTableAt: 9 });
    const withSeats = await td.put(`/api/tournaments/${tournament.id}`).send({ openTableAt: 9, seatsPerTable: 10 });
    const shrinking = await td.put(`/api/tournaments/${tournament.id}`).send({ seatsPerTable: 6 });
    const created = await td.post("/api/tournaments").send({
      clubId: staff.club.id,
      name: "Six-handed",
      startDateTime: "2026-11-01T07:00:00.000Z",
      buyInAmount: "50.00",
      maxPlayers: 30,
      seatsPerTable: 6,
      openTableAt: 7,
    });

    for (const response of [above, shrinking, created]) {
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: "VALIDATION", details: [{ path: ["openTableAt"] }] });
    }
    expect(above.body.error).toBe("Open the next table at 8 players or fewer (the seats per table)");
    expect(withSeats.status).toBe(200);
    expect(await tournamentRow(tournament.id)).toMatchObject({ seatsPerTable: 10, openTableAt: 9 });
  });
});

describe("the tables a room opens with are its starting tables (R5REV1-ADV-01)", () => {
  const kinds = (seating: SeatingDto) => seating.advisor.advice.map((advice) => advice.kind);

  it("setup keeps the number of tables the TD chose, so the advisor does not ask to break one while players arrive", async () => {
    const { tournament, td } = await world({ players: 12 });

    const response = await td.post(path(tournament.id, "seating/setup")).send({ tableCount: 3 });

    const { seating } = response.body as SeatingMutationDto;
    expect(seating.stats).toMatchObject({ activeTables: 3, seated: 12 });
    expect(seating.settings.startingTables).toBe(3);
    expect(kinds(seating)).toEqual([]);
    expect(await tournamentRow(tournament.id)).toMatchObject({ startingTables: 3 });
  });

  it("stores nothing when setup opens the starting tables the settings give", async () => {
    const { tournament, td } = await world({ players: 12 });

    await td.post(path(tournament.id, "seating/setup")).send({});

    expect(await tournamentRow(tournament.id)).toMatchObject({ startingTables: null });
  });

  it("Add tables before anyone sits down counts as the room's starting tables; once players sit, it does not", async () => {
    const { tournament, td } = await world({ players: 2 });

    await td.post(path(tournament.id, "tables")).send({ count: 2 });
    await td.post(path(tournament.id, "tables")).send({ count: 1 });
    expect(await tournamentRow(tournament.id)).toMatchObject({ startingTables: 3 });

    await td.post(path(tournament.id, "seating/draw")).send({ scope: "unseated" });
    await td.post(path(tournament.id, "tables")).send({ count: 1 });
    expect(await tournamentRow(tournament.id)).toMatchObject({ startingTables: 3 });
  });
});

describe("the advisor once late registration is over, or players are out (R5REV-HOST-01)", () => {
  /** Two 9-seat tables holding 5 and 4 of the 9 players registered. */
  async function twoTables(overrides: Partial<NewTournament> = {}, busted = 0) {
    const setup = await world({ tournament: overrides, players: 9 + busted });
    const { tournament, registrations } = setup;
    const tables = [await createTable({ tournamentId: tournament.id, tableNumber: 1 }), await createTable({ tournamentId: tournament.id, tableNumber: 2 })];
    for (let i = 0; i < 9; i++) await createSeat({ tournamentId: tournament.id, tableId: tables[i % 2].id, registrationId: registrations[i].id, seatNumber: Math.floor(i / 2) + 1 });
    for (const out of registrations.slice(9)) {
      await testDb().update(tournamentRegistrationsTable).set({ isEliminated: true, eliminationTime: new Date() }).where(eq(tournamentRegistrationsTable.id, out.id));
    }
    return { ...setup, tables };
  }
  const seatingOf = async ({ td, tournament }: { td: Awaited<ReturnType<typeof world>>["td"]; tournament: { id: string } }) =>
    (await td.get(path(tournament.id, "seating"))).body as SeatingDto;

  it("still filling (nobody out, the clock inside the re-buy period): the starting tables stay", async () => {
    const room = await twoTables({ rebuyPeriodMinutes: 60 });
    await createClock({ tournamentId: room.tournament.id, state: runningState(Date.now(), 0, 10 * MINUTE_MS) });

    const seating = await seatingOf(room);

    expect(seating.advisor).toMatchObject({ phase: "growing", advice: [] });
  });

  it("draws the final table on the starting tables once the re-buy period is over on the clock", async () => {
    const room = await twoTables({ rebuyPeriodMinutes: 60 });
    // Level 3 with 5 of its 15 minutes left: 65 minutes on the clock.
    await createClock({ tournamentId: room.tournament.id, state: runningState(Date.now(), 3, 5 * MINUTE_MS) });

    const seating = await seatingOf(room);

    expect(seating.advisor.phase).toBe("shrinking");
    expect(seating.advisor.advice[0]).toMatchObject({ kind: "final_table", tableNumber: 1, message: "9 players fit at one table: draw the final table at Table 1" });
  });

  it("draws it once players have been knocked out, whatever the clock says", async () => {
    const room = await twoTables({}, 7);

    const seating = await seatingOf(room);

    expect(seating.advisor.phase).toBe("growing");
    expect(seating.advisor.advice[0]).toMatchObject({ kind: "final_table", tableId: room.tables[0].id });
  });
});
