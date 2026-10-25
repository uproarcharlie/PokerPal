/**
 * Round 5's read model as R5-ARCH left it (round5-contracts §0): a club's table defaults, photo rule
 * and colours round-trip through the club API and reach every public screen of the club; the TD's
 * seating carries the tournament's settings (club defaults filled in), each table's shape and the
 * table advisor; the seat finder draws each table's shape. The units that build on these extend them.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { findForbiddenKeys } from "@shared/api/public";
import type { PublicSeatingDto, SeatingDto } from "@shared/api/seating";
import { NEW_TABLE_ID } from "@shared/domain/table-advisor";
import { CENTRAL_STARS_THEME } from "@shared/domain/theme";
import { clubs } from "@shared/schema";
import { createSeason, createTournament } from "../factories";
import { createSeat, createTable, registerPlayers } from "../factories/seating";
import { anon, resetDb, testDb } from "../helpers";
import { clubWithStaff } from "../helpers/club-staff";

beforeEach(resetDb);

async function world(players: number, club: Parameters<typeof clubWithStaff>[0] = {}) {
  const staff = await clubWithStaff(club);
  const tournament = await createTournament({ clubId: staff.club.id, status: "in_progress", maxPlayers: 40 });
  const registrations = await registerPlayers(tournament.id, Array.from({ length: players }, (_, i) => `Player ${i + 1}`));
  return { staff, tournament, registrations };
}

describe("a club's round 5 settings", () => {
  it("round-trip through PUT /api/clubs/:id, colours in upper case, and are public", async () => {
    const { staff } = await world(0);
    const theme = { v: 1, preset: "central_stars", colors: { primary: "#1e7bff", accent: "#f2c14e", primaryGlow: "#3FA9FF", accentDeep: "#B8862B" } };

    const updated = await staff.owner.agent
      .put(`/api/clubs/${staff.club.id}`)
      .send({ defaultSeatsPerTable: 9, defaultTableShape: "rectangle", requireSignupPhoto: true, theme });

    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ defaultSeatsPerTable: 9, defaultTableShape: "rectangle", requireSignupPhoto: true, theme: CENTRAL_STARS_THEME });
    const visitor = await (await anon()).get(`/api/clubs/${staff.club.id}`);
    expect(visitor.body).toMatchObject({ defaultTableShape: "rectangle", theme: CENTRAL_STARS_THEME });
    expect(findForbiddenKeys(visitor.body)).toEqual([]);

    const refused = await staff.owner.agent.put(`/api/clubs/${staff.club.id}`).send({ theme: { v: 1, preset: null, colors: { primary: "red" } } });
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe("VALIDATION");
    const cleared = await staff.owner.agent.put(`/api/clubs/${staff.club.id}`).send({ theme: null });
    expect(cleared.body.theme).toBeNull();
  });

  it("dress the TV display, the seat finder and the season page in the club's colours", async () => {
    const { staff, tournament } = await world(0);
    await testDb().update(clubs).set({ theme: CENTRAL_STARS_THEME }).where(eq(clubs.id, staff.club.id));
    const season = await createSeason({ clubId: staff.club.id });
    const visitor = await anon();

    expect((await visitor.get(`/api/public/tournaments/${tournament.id}/display`)).body.club.theme).toEqual(CENTRAL_STARS_THEME);
    expect((await visitor.get(`/api/public/tournaments/${tournament.id}/seating`)).body.club.theme).toEqual(CENTRAL_STARS_THEME);
    expect((await visitor.get(`/api/public/seasons/${season.id}/leaderboard`)).body.club.theme).toEqual(CENTRAL_STARS_THEME);
  });
});

describe("the TD's seating (round 5)", () => {
  it("carries the tournament's settings with the club's defaults filled in", async () => {
    const { staff, tournament } = await world(0, { defaultSeatsPerTable: 9, defaultTableShape: "rectangle" });

    const seating = (await staff.manager.agent.get(`/api/tournaments/${tournament.id}/seating`)).body as SeatingDto;

    expect(seating.settings).toEqual({
      seatsPerTable: 9,
      startingTables: 2,
      openTableAt: 9,
      autoSeat: "on_register",
      tableShape: "rectangle",
      maxPlayers: 40,
      maxTables: 5,
    });
    expect(seating.advisor).toEqual({ phase: "growing", players: 0, waiting: 0, notArrived: 0, overCapacity: 0, advice: [] });
  });

  it("stores the tournament's own settings, which win over the club's", async () => {
    const { staff, tournament } = await world(0, { defaultSeatsPerTable: 9, defaultTableShape: "rectangle" });

    const updated = await staff.manager.agent
      .put(`/api/tournaments/${tournament.id}`)
      .send({ seatsPerTable: 6, startingTables: 3, openTableAt: 5, autoSeat: "once_paid", tableShape: "round" });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ seatsPerTable: 6, startingTables: 3, openTableAt: 5, autoSeat: "once_paid", tableShape: "round" });

    const seating = (await staff.manager.agent.get(`/api/tournaments/${tournament.id}/seating`)).body as SeatingDto;
    expect(seating.settings).toEqual({ seatsPerTable: 6, startingTables: 3, openTableAt: 5, autoSeat: "once_paid", tableShape: "round", maxPlayers: 40, maxTables: 7 });
    const cleared = await staff.manager.agent.put(`/api/tournaments/${tournament.id}`).send({ seatsPerTable: null, tableShape: null });
    expect(cleared.body).toMatchObject({ seatsPerTable: null, tableShape: null });
  });

  it("draws each table as its own shape, else the tournament's, else the club's", async () => {
    const { staff, tournament } = await world(0, { defaultTableShape: "rectangle" });
    await createTable({ tournamentId: tournament.id, tableNumber: 1 });
    await createTable({ tournamentId: tournament.id, tableNumber: 2, shape: "round" });

    const seating = (await staff.manager.agent.get(`/api/tournaments/${tournament.id}/seating`)).body as SeatingDto;
    const finder = (await (await anon()).get(`/api/public/tournaments/${tournament.id}/seating`)).body as PublicSeatingDto;

    expect(seating.tables.map((table) => [table.tableNumber, table.shape])).toEqual([
      [1, "rectangle"],
      [2, "round"],
    ]);
    expect(finder.tables.map((table) => [table.tableNumber, table.shape])).toEqual([
      [1, "rectangle"],
      [2, "round"],
    ]);
  });

  it("advises opening Table 3 when both tables are full and a player is waiting, naming the moves", async () => {
    const { staff, tournament, registrations } = await world(19);
    const tables = [await createTable({ tournamentId: tournament.id, tableNumber: 1 }), await createTable({ tournamentId: tournament.id, tableNumber: 2 })];
    for (let i = 0; i < 18; i++) {
      await createSeat({ tournamentId: tournament.id, tableId: tables[Math.floor(i / 9)].id, registrationId: registrations[i].id, seatNumber: (i % 9) + 1 });
    }

    const seating = (await staff.manager.agent.get(`/api/tournaments/${tournament.id}/seating`)).body as SeatingDto;

    expect(seating.advisor).toMatchObject({ phase: "growing", players: 19, waiting: 1 });
    const [open] = seating.advisor.advice;
    expect(open).toMatchObject({
      kind: "open_table",
      message: "Every table is full and 1 player is waiting: open Table 3 and even the tables out to 7 / 6 / 6",
      tableId: NEW_TABLE_ID,
      tableNumber: 3,
      players: 6,
    });
    expect(open.moves).toHaveLength(6);
    expect(open.moves.every((move) => move.to?.tableId === NEW_TABLE_ID && move.to.tableName === "Table 3" && move.to.tableNumber === 3)).toBe(true);
    expect(open.moves.find((move) => move.registrationId === registrations[18].id)).toMatchObject({ playerName: "Player 19", from: null });
  });
});
