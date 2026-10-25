/**
 * Who sits where (server/routes/seating.ts, phase4-contracts §3.1 S6–S11): one-tap setup, the draw
 * and redraw, moving, seating and swapping one player, unseating, balancing exactly what was
 * suggested, and the final table. Each answers the seating after the change and the moves it made,
 * stores every vacated seat with its release reason, and logs one activity row (none for a change
 * that moved nobody).
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { findForbiddenKeys } from "@shared/api/public";
import type { SeatingDto, SeatingMutationDto, SeatMoveDto } from "@shared/api/seating";
import { activityLog, tournamentRegistrations, tournamentSeats, tournamentTables, type TournamentRegistration, type TournamentTable } from "@shared/schema";
import { createTournament, type NewTournament } from "../factories";
import { createSeat, createTable, registerPlayers } from "../factories/seating";
import { resetDb, testDb, UNKNOWN_ID } from "../helpers";
import { clubWithStaff } from "../helpers/club-staff";

beforeEach(resetDb);

const names = (count: number) => Array.from({ length: count }, (_, i) => `Player ${String(i + 1).padStart(2, "0")}`);

async function world({ players = 0, tournament: overrides = {} }: { players?: number; tournament?: Partial<NewTournament> } = {}) {
  const staff = await clubWithStaff();
  const tournament = await createTournament({ clubId: staff.club.id, status: "in_progress", ...overrides });
  const registrations = await registerPlayers(tournament.id, names(players));
  return { staff, tournament, registrations, td: staff.manager.agent };
}

const path = (tournamentId: string, rest: string) => `/api/tournaments/${tournamentId}/${rest}`;

const seat = (table: TournamentTable, registration: TournamentRegistration, seatNumber: number) =>
  createSeat({ tournamentId: table.tournamentId, tableId: table.id, registrationId: registration.id, seatNumber });

const markOut = (registration: TournamentRegistration) =>
  testDb().update(tournamentRegistrations).set({ isEliminated: true, eliminationTime: new Date() }).where(eq(tournamentRegistrations.id, registration.id));

async function activity(tournamentId: string) {
  const rows = await testDb().select().from(activityLog).where(eq(activityLog.tournamentId, tournamentId)).orderBy(asc(activityLog.timestamp));
  return rows.map(({ eventType, description, playerId, eventData }) => ({ eventType, description, playerId, data: eventData ? (JSON.parse(eventData) as unknown) : null }));
}

const activeSeats = (tournamentId: string) =>
  testDb().select().from(tournamentSeats).where(and(eq(tournamentSeats.tournamentId, tournamentId), isNull(tournamentSeats.releasedAt)));
const seatRowsOf = (registrationId: string) =>
  testDb().select().from(tournamentSeats).where(eq(tournamentSeats.registrationId, registrationId)).orderBy(asc(tournamentSeats.assignedAt));

/** Every player still in has exactly one seat, no seat is shared, and each table's seats are within its size. */
function expectSoundSeating(seating: SeatingDto, playersStillIn: readonly string[]) {
  const seated = Object.keys(seating.seatByRegistrationId).sort();
  expect(seated).toEqual([...playersStillIn].sort());
  const spots = Object.values(seating.seatByRegistrationId).map((spot) => `${spot.tableNumber}:${spot.seatNumber}`);
  expect(new Set(spots).size).toBe(spots.length);
  for (const table of seating.tables.filter((t) => t.status === "active")) {
    expect(table.occupied).toBeLessThanOrEqual(table.seatCount);
  }
}

const occupancy = (seating: SeatingDto) =>
  seating.tables.filter((table) => table.status === "active").map((table) => table.occupied);

const describeMove = (move: SeatMoveDto) =>
  `${move.playerName}: ${move.from ? `${move.from.tableNumber}/${move.from.seatNumber}` : "-"} -> ${move.to ? `${move.to.tableNumber}/${move.to.seatNumber}` : "-"} (${move.reason})`;

describe("POST /api/tournaments/:id/seating/setup", () => {
  it("puts out the suggested tables and seats everyone still in, spread evenly", async () => {
    const { tournament, registrations, td } = await world({ players: 22 });
    await markOut(registrations[21]);

    const response = await td.post(path(tournament.id, "seating/setup")).send({});

    expect(response.status).toBe(201);
    const body = response.body as SeatingMutationDto;
    expect(body.excludedUnconfirmed).toBe(0);
    expect(body.moves).toHaveLength(21);
    expect(body.moves.every((move) => move.from === null && move.to !== null && move.reason === "draw")).toBe(true);
    expect(body.seating.tables.map((table) => [table.tableNumber, table.seatCount])).toEqual([[1, 9], [2, 9], [3, 9]]);
    expect(occupancy(body.seating).sort()).toEqual([7, 7, 7]);
    expectSoundSeating(body.seating, registrations.slice(0, 21).map((r) => r.id));
    expect(await activity(tournament.id)).toEqual([
      { eventType: "tables_added", description: "Added 3 tables (9 seats)", playerId: null, data: { tableNumbers: [1, 2, 3], seatCount: 9, shape: "oval" } },
      {
        eventType: "seating_drawn",
        description: "Seats drawn for 21 players",
        playerId: null,
        data: { scope: "unseated", players: 21, moves: body.moves, undo: { versionAfter: body.seating.version, archivedTableIds: [] } },
      },
    ]);
  });

  it("records who drew the seats", async () => {
    const { staff, tournament, td } = await world({ players: 2 });

    await td.post(path(tournament.id, "seating/setup")).send({ seatCount: 6 });

    expect((await activeSeats(tournament.id)).map((row) => row.assignedBy)).toEqual([staff.manager.user.id, staff.manager.user.id]);
  });

  it("leaves out unpaid entries when asked, counting them, and sizes the tables for the rest", async () => {
    const { tournament, registrations, td } = await world({ players: 10 });
    for (const registration of registrations.slice(0, 3)) {
      await testDb().update(tournamentRegistrations).set({ paymentConfirmed: false }).where(eq(tournamentRegistrations.id, registration.id));
    }

    const response = await td.post(path(tournament.id, "seating/setup")).send({ seatCount: 6, includeUnconfirmed: false });

    const body = response.body as SeatingMutationDto;
    expect(body.excludedUnconfirmed).toBe(3);
    expect(occupancy(body.seating).sort()).toEqual([3, 4]);
    expect(body.seating.unseated.map((entry) => entry.registrationId).sort()).toEqual(registrations.slice(0, 3).map((r) => r.id).sort());
    expect(body.seating.stats).toMatchObject({ unseated: 3, unconfirmedUnseated: 3 });
  });

  it("honours a table count: with too few seats, those who have paid sit first and the rest wait for a table to open", async () => {
    const { tournament, registrations, td } = await world({ players: 12 });
    for (const registration of registrations.slice(0, 2)) {
      await testDb().update(tournamentRegistrations).set({ paymentConfirmed: false }).where(eq(tournamentRegistrations.id, registration.id));
    }

    const response = await td.post(path(tournament.id, "seating/setup")).send({ seatCount: 6, tableCount: 1 });
    const again = await td.post(path(tournament.id, "seating/setup")).send({ seatCount: 6, tableCount: 4 });

    expect(response.status).toBe(201);
    const body = response.body as SeatingMutationDto;
    expect(occupancy(body.seating)).toEqual([6]);
    expect(body.moves.map((move) => move.registrationId)).not.toContain(registrations[0].id);
    expect(body.moves.map((move) => move.registrationId)).not.toContain(registrations[1].id);
    expect(body.seating.stats).toMatchObject({ unseated: 6, unconfirmedUnseated: 2 });
    expect(body.seating.advisor.advice[0]).toMatchObject({ kind: "open_table", tableNumber: 2 });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ code: "TABLES_EXIST" });
    const drawn = (await activity(tournament.id)).find((entry) => entry.eventType === "seating_drawn");
    expect(drawn).toMatchObject({ description: "Seats drawn for 6 players; 6 players waiting for a seat", data: { players: 6, waiting: 6 } });
  });

  it("is refused once a table is in play (409 TABLES_EXIST), but not for archived ones", async () => {
    const { tournament, td } = await world({ players: 3 });
    await createTable({ tournamentId: tournament.id, tableNumber: 1, status: "broken" });

    const first = await td.post(path(tournament.id, "seating/setup")).send({});
    const second = await td.post(path(tournament.id, "seating/setup")).send({});

    expect(first.status).toBe(201);
    expect((first.body as SeatingMutationDto).seating.tables.map((table) => table.tableNumber)).toEqual([2, 3, 1]);
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ code: "TABLES_EXIST" });
  });

  it("puts out the starting tables (2) for a tournament nobody has entered yet, or 1 when max players fit at one", async () => {
    const { tournament, td } = await world();
    const small = await createTournament({ clubId: tournament.clubId, status: "in_progress", maxPlayers: 9 });

    const response = await td.post(path(tournament.id, "seating/setup")).send({});
    const oneTable = await td.post(path(small.id, "seating/setup")).send({});

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ moves: [], excludedUnconfirmed: 0, seating: { stats: { activeTables: 2, capacity: 18 } } });
    expect((await activity(tournament.id)).map((entry) => entry.eventType)).toEqual(["tables_added"]);
    expect(oneTable.body).toMatchObject({ seating: { stats: { activeTables: 1, capacity: 9 } } });
  });
});

describe("POST /api/tournaments/:id/seating/draw", () => {
  it("seats everyone waiting at the emptiest tables, and a repeat seats nobody twice", async () => {
    const { tournament, registrations, td } = await world({ players: 8 });
    const [first, second] = [
      await createTable({ tournamentId: tournament.id, tableNumber: 1, seatCount: 6 }),
      await createTable({ tournamentId: tournament.id, tableNumber: 2, seatCount: 6 }),
    ];
    await seat(first, registrations[0], 1);
    await seat(first, registrations[1], 2);
    await seat(second, registrations[2], 1);

    const response = await td.post(path(tournament.id, "seating/draw")).send({});
    const repeat = await td.post(path(tournament.id, "seating/draw")).send({});

    expect(response.status).toBe(200);
    const body = response.body as SeatingMutationDto;
    expect(body.moves).toHaveLength(5);
    expect(body.excludedUnconfirmed).toBe(0);
    expect(occupancy(body.seating).sort()).toEqual([4, 4]);
    expectSoundSeating(body.seating, registrations.map((r) => r.id));
    expect(repeat.status).toBe(200);
    expect(repeat.body).toMatchObject({ moves: [], excludedUnconfirmed: 0 });
    expect(repeat.body.seating).toEqual(body.seating);
    expect(await activity(tournament.id)).toEqual([
      {
        eventType: "seating_drawn",
        description: "Seats drawn for 5 players",
        playerId: null,
        data: { scope: "unseated", players: 5, moves: body.moves, undo: { versionAfter: body.seating.version, archivedTableIds: [] } },
      },
    ]);
  });

  it("seats just the players named, and leaves out unpaid ones when asked", async () => {
    const { tournament, registrations, td } = await world({ players: 4 });
    await createTable({ tournamentId: tournament.id, tableNumber: 1 });
    await testDb().update(tournamentRegistrations).set({ paymentConfirmed: false }).where(eq(tournamentRegistrations.id, registrations[1].id));

    const response = await td
      .post(path(tournament.id, "seating/draw"))
      .send({ registrationIds: [registrations[0].id, registrations[1].id], includeUnconfirmed: false });

    const body = response.body as SeatingMutationDto;
    expect(body.moves.map((move) => move.registrationId)).toEqual([registrations[0].id]);
    expect(body.excludedUnconfirmed).toBe(1);
  });

  it("redraws everyone still in (scope all), releasing their old seats as redrawn", async () => {
    const { tournament, registrations, td } = await world({ players: 6 });
    await createTable({ tournamentId: tournament.id, tableNumber: 1, seatCount: 6 });
    await createTable({ tournamentId: tournament.id, tableNumber: 2, seatCount: 6 });
    await td.post(path(tournament.id, "seating/draw")).send({});

    const response = await td.post(path(tournament.id, "seating/draw")).send({ scope: "all" });

    expect(response.status).toBe(200);
    const body = response.body as SeatingMutationDto;
    expect(body.moves.every((move) => move.reason === "redraw" && move.from !== null && move.to !== null)).toBe(true);
    expectSoundSeating(body.seating, registrations.map((r) => r.id));
    const released = (await testDb().select().from(tournamentSeats).where(eq(tournamentSeats.tournamentId, tournament.id))).filter((row) => row.releasedAt);
    expect(released).toHaveLength(body.moves.length);
    expect(released.every((row) => row.releaseReason === "redraw")).toBe(true);
    expect((await activity(tournament.id)).at(-1)).toMatchObject({ eventType: "seating_drawn", description: "Seats redrawn for 6 players", data: { scope: "all", players: 6 } });
  });

  it("refuses without tables (409 NO_TABLES) or with too few seats (409 INSUFFICIENT_SEATS), seating nobody", async () => {
    const { tournament, td } = await world({ players: 5 });

    const noTables = await td.post(path(tournament.id, "seating/draw")).send({});
    await createTable({ tournamentId: tournament.id, tableNumber: 1, seatCount: 3 });
    const tooFew = await td.post(path(tournament.id, "seating/draw")).send({});

    expect(noTables.status).toBe(409);
    expect(noTables.body).toMatchObject({ code: "NO_TABLES" });
    expect(tooFew.status).toBe(409);
    expect(tooFew.body).toMatchObject({ code: "INSUFFICIENT_SEATS", details: { needed: 5, available: 3 } });
    expect(await activeSeats(tournament.id)).toEqual([]);
  });

  it("refuses a player who is out or not in this tournament (409 PLAYER_NOT_ACTIVE)", async () => {
    const { staff, tournament, registrations, td } = await world({ players: 2 });
    await createTable({ tournamentId: tournament.id, tableNumber: 1 });
    await markOut(registrations[1]);
    const other = await createTournament({ clubId: staff.club.id, status: "in_progress" });
    const [stranger] = await registerPlayers(other.id, ["Elsewhere"]);

    for (const registrationId of [registrations[1].id, stranger.id, UNKNOWN_ID]) {
      const response = await td.post(path(tournament.id, "seating/draw")).send({ registrationIds: [registrations[0].id, registrationId] });

      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ code: "PLAYER_NOT_ACTIVE", details: { registrationId } });
    }
    expect(await activeSeats(tournament.id)).toEqual([]);
  });
});

describe("POST /api/tournaments/:id/seating/assign", () => {
  async function seated() {
    const setup = await world({ players: 3 });
    const { tournament, registrations } = setup;
    const tables = [
      await createTable({ tournamentId: tournament.id, tableNumber: 1 }),
      await createTable({ tournamentId: tournament.id, tableNumber: 2, name: "Feature table" }),
    ];
    await seat(tables[0], registrations[0], 1);
    await seat(tables[1], registrations[1], 4);
    return { ...setup, tables };
  }

  it("moves a seated player to an empty seat, releasing the old one as moved", async () => {
    const { tournament, registrations, tables, td } = await seated();

    const response = await td.post(path(tournament.id, "seating/assign")).send({ registrationId: registrations[0].id, tableId: tables[1].id, seatNumber: 7 });

    expect(response.status).toBe(200);
    const body = response.body as SeatingMutationDto;
    expect(body.moves.map(describeMove)).toEqual(["Player 01: 1/1 -> 2/7 (move)"]);
    expect(body.moves[0].to).toEqual({ tableId: tables[1].id, tableNumber: 2, tableName: "Feature table", seatNumber: 7 });
    expect(body.seating.seatByRegistrationId[registrations[0].id]).toEqual({ tableNumber: 2, seatNumber: 7 });
    expect((await seatRowsOf(registrations[0].id)).map((row) => [row.seatNumber, row.releaseReason])).toEqual([[1, "moved"], [7, null]]);
    expect(await activity(tournament.id)).toEqual([
      {
        eventType: "seat_assigned",
        description: "Player 01 moved to Feature table, Seat 7",
        playerId: registrations[0].playerId,
        data: { registrationId: registrations[0].id, from: { tableNumber: 1, seatNumber: 1 }, to: { tableNumber: 2, seatNumber: 7 } },
      },
    ]);
  });

  it("seats a waiting player in the seat chosen", async () => {
    const { tournament, registrations, tables, td } = await seated();

    const response = await td.post(path(tournament.id, "seating/assign")).send({ registrationId: registrations[2].id, tableId: tables[0].id, seatNumber: 3 });

    expect((response.body as SeatingMutationDto).moves.map(describeMove)).toEqual(["Player 03: - -> 1/3 (move)"]);
    expect((await activity(tournament.id))[0].description).toBe("Player 03 seated at Table 1, Seat 3");
  });

  it("refuses an occupied seat (409 SEAT_TAKEN with its occupant) unless asked to swap", async () => {
    const { tournament, registrations, tables, td } = await seated();
    const body = { registrationId: registrations[0].id, tableId: tables[1].id, seatNumber: 4 };

    const taken = await td.post(path(tournament.id, "seating/assign")).send(body);
    const swapped = await td.post(path(tournament.id, "seating/assign")).send({ ...body, swap: true });

    expect(taken.status).toBe(409);
    expect(taken.body).toMatchObject({ code: "SEAT_TAKEN", details: { occupantRegistrationId: registrations[1].id } });
    expect(swapped.status).toBe(200);
    expect((swapped.body as SeatingMutationDto).moves.map(describeMove)).toEqual(["Player 01: 1/1 -> 2/4 (swap)", "Player 02: 2/4 -> 1/1 (swap)"]);
    expect((swapped.body as SeatingMutationDto).seating.seatByRegistrationId).toEqual({
      [registrations[0].id]: { tableNumber: 2, seatNumber: 4 },
      [registrations[1].id]: { tableNumber: 1, seatNumber: 1 },
    });
    expect((await seatRowsOf(registrations[1].id)).map((row) => row.releaseReason)).toEqual(["swapped", null]);
    expect(await activity(tournament.id)).toEqual([
      expect.objectContaining({ eventType: "seats_swapped", description: "Player 01 and Player 02 swapped seats", playerId: null }),
    ]);
  });

  it("swaps only the pair the TD confirmed: with expectedVersion, a seat taken meanwhile is 409 STALE_PLAN and nobody moves (P4REV1-CC-03)", async () => {
    const { tournament, registrations, tables, td } = await seated();
    const shown = ((await td.get(path(tournament.id, "seating"))).body as SeatingDto).version;
    // The dialog asks "Swap Player 01 and Player 02?"; meanwhile Player 02 moves away and Player 03 sits in seat 2/4.
    await td.post(path(tournament.id, "seating/assign")).send({ registrationId: registrations[1].id, tableId: tables[1].id, seatNumber: 6 });
    await td.post(path(tournament.id, "seating/assign")).send({ registrationId: registrations[2].id, tableId: tables[1].id, seatNumber: 4 });
    const before = await activeSeats(tournament.id);

    const stale = await td
      .post(path(tournament.id, "seating/assign"))
      .send({ registrationId: registrations[0].id, tableId: tables[1].id, seatNumber: 4, swap: true, expectedVersion: shown });

    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ code: "STALE_PLAN", error: "The seats have changed since you chose that: check them and try again" });
    const current = (stale.body as { details: { seating: SeatingDto } }).details.seating;
    expect(current.seatByRegistrationId[registrations[2].id]).toEqual({ tableNumber: 2, seatNumber: 4 });
    expect(await activeSeats(tournament.id)).toEqual(before);

    const confirmed = await td
      .post(path(tournament.id, "seating/assign"))
      .send({ registrationId: registrations[0].id, tableId: tables[1].id, seatNumber: 4, swap: true, expectedVersion: current.version });
    expect(confirmed.status).toBe(200);
    expect((confirmed.body as SeatingMutationDto).moves.map(describeMove)).toEqual(["Player 01: 1/1 -> 2/4 (swap)", "Player 03: 2/4 -> 1/1 (swap)"]);
  });

  it("refuses a swap for a player with no seat (409 NOT_SEATED)", async () => {
    const { tournament, registrations, tables, td } = await seated();

    const response = await td.post(path(tournament.id, "seating/assign")).send({ registrationId: registrations[2].id, tableId: tables[0].id, seatNumber: 1, swap: true });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: "NOT_SEATED" });
  });

  it("does nothing for the player's own seat", async () => {
    const { tournament, registrations, tables, td } = await seated();

    const response = await td.post(path(tournament.id, "seating/assign")).send({ registrationId: registrations[0].id, tableId: tables[0].id, seatNumber: 1 });

    expect(response.status).toBe(200);
    expect(response.body.moves).toEqual([]);
    expect(await activity(tournament.id)).toEqual([]);
  });

  it("refuses a seat the table does not have (400 SEAT_OUT_OF_RANGE), a table not in play, and a player who is out", async () => {
    const { tournament, registrations, tables, td } = await seated();
    const archived = await createTable({ tournamentId: tournament.id, tableNumber: 3, status: "broken" });
    await testDb().update(tournamentTables).set({ seatCount: 6 }).where(eq(tournamentTables.id, tables[0].id));
    await markOut(registrations[2]);

    const pastEnd = await td.post(path(tournament.id, "seating/assign")).send({ registrationId: registrations[0].id, tableId: tables[0].id, seatNumber: 7 });
    const notInPlay = await td.post(path(tournament.id, "seating/assign")).send({ registrationId: registrations[0].id, tableId: archived.id, seatNumber: 1 });
    const out = await td.post(path(tournament.id, "seating/assign")).send({ registrationId: registrations[2].id, tableId: tables[0].id, seatNumber: 2 });

    expect(pastEnd.status).toBe(400);
    expect(pastEnd.body).toMatchObject({ code: "SEAT_OUT_OF_RANGE", error: "Table 1 has seats 1 to 6" });
    expect(notInPlay.status).toBe(409);
    expect(notInPlay.body).toMatchObject({ code: "TABLE_NOT_ACTIVE" });
    expect(out.status).toBe(409);
    expect(out.body).toMatchObject({ code: "PLAYER_NOT_ACTIVE", details: { registrationId: registrations[2].id } });
  });

  it("answers 404 TABLE_NOT_FOUND for another tournament's table", async () => {
    const { staff, tournament, registrations, td } = await seated();
    const theirs = await createTable({ tournamentId: (await createTournament({ clubId: staff.club.id })).id, tableNumber: 1 });

    const response = await td.post(path(tournament.id, "seating/assign")).send({ registrationId: registrations[2].id, tableId: theirs.id, seatNumber: 1 });

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ code: "TABLE_NOT_FOUND" });
    expect(await seatRowsOf(registrations[2].id)).toEqual([]);
  });
});

describe("POST /api/tournaments/:id/seating/unseat", () => {
  it("takes a player out of their seat, once", async () => {
    const { tournament, registrations, td } = await world({ players: 1 });
    const table = await createTable({ tournamentId: tournament.id, tableNumber: 1 });
    await seat(table, registrations[0], 5);

    const response = await td.post(path(tournament.id, "seating/unseat")).send({ registrationId: registrations[0].id });
    const again = await td.post(path(tournament.id, "seating/unseat")).send({ registrationId: registrations[0].id });

    expect(response.status).toBe(200);
    expect((response.body as SeatingMutationDto).moves.map(describeMove)).toEqual(["Player 01: 1/5 -> - (unseat)"]);
    expect((response.body as SeatingMutationDto).seating.unseated.map((entry) => entry.registrationId)).toEqual([registrations[0].id]);
    expect(again.status).toBe(200);
    expect(again.body.moves).toEqual([]);
    expect((await seatRowsOf(registrations[0].id)).map((row) => row.releaseReason)).toEqual(["unseated"]);
    expect(await activity(tournament.id)).toEqual([
      {
        eventType: "seat_released",
        description: "Player 01 was unseated",
        playerId: registrations[0].playerId,
        data: { registrationId: registrations[0].id, from: { tableNumber: 1, seatNumber: 5 } },
      },
    ]);
  });

  it("answers a player of this tournament who is out with no moves, and refuses another tournament's (409 PLAYER_NOT_ACTIVE)", async () => {
    const { staff, tournament, registrations, td } = await world({ players: 1 });
    await markOut(registrations[0]);
    const [stranger] = await registerPlayers((await createTournament({ clubId: staff.club.id })).id, ["Elsewhere"]);

    const out = await td.post(path(tournament.id, "seating/unseat")).send({ registrationId: registrations[0].id });
    const elsewhere = await td.post(path(tournament.id, "seating/unseat")).send({ registrationId: stranger.id });

    expect(out.status).toBe(200);
    expect(out.body.moves).toEqual([]);
    expect(elsewhere.status).toBe(409);
    expect(elsewhere.body).toMatchObject({ code: "PLAYER_NOT_ACTIVE", details: { registrationId: stranger.id } });
  });
});

describe("POST /api/tournaments/:id/seating/balance", () => {
  async function lopsided() {
    const setup = await world({ players: 8 });
    const { tournament, registrations } = setup;
    const tables = [
      await createTable({ tournamentId: tournament.id, tableNumber: 1 }),
      await createTable({ tournamentId: tournament.id, tableNumber: 2 }),
    ];
    for (let i = 0; i < 7; i++) await seat(tables[0], registrations[i], i + 1);
    await seat(tables[1], registrations[7], 1);
    return { ...setup, tables };
  }

  it("applies exactly the suggestion the TD saw: highest seats of the fullest table to the lowest open seats", async () => {
    const { tournament, td } = await lopsided();
    const shown = (await td.get(path(tournament.id, "seating"))).body as SeatingDto;

    const response = await td.post(path(tournament.id, "seating/balance")).send({ expectedVersion: shown.version });

    expect(response.status).toBe(200);
    const body = response.body as SeatingMutationDto;
    expect(body.moves).toEqual(shown.advisor.advice.find((advice) => advice.kind === "balance")?.moves);
    expect(body.moves.map(describeMove)).toEqual(["Player 07: 1/7 -> 2/2 (balance)", "Player 06: 1/6 -> 2/3 (balance)", "Player 05: 1/5 -> 2/4 (balance)"]);
    expect(occupancy(body.seating)).toEqual([4, 4]);
    expect(body.seating.advisor.advice).toEqual([]);
    expect(await activity(tournament.id)).toEqual([
      {
        eventType: "seating_balanced",
        description: "Tables balanced: 3 players moved",
        playerId: null,
        data: { moved: 3, moves: body.moves, undo: { versionAfter: body.seating.version, archivedTableIds: [] } },
      },
    ]);
  });

  it("refuses a suggestion made from a seating that changed since (409 STALE_PLAN with the current seating)", async () => {
    const { tournament, registrations, td } = await lopsided();
    const shown = (await td.get(path(tournament.id, "seating"))).body as SeatingDto;
    await markOut(registrations[0]);

    const response = await td.post(path(tournament.id, "seating/balance")).send({ expectedVersion: shown.version });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: "STALE_PLAN" });
    expect(response.body.details.seating).toEqual((await td.get(path(tournament.id, "seating"))).body);
    // 7 players left after the bust: the advice is the final table now.
    expect(response.body.details.seating.advisor.advice.map((advice: { kind: string }) => advice.kind)).toEqual(["final_table"]);
    expect(findForbiddenKeys(response.body)).toEqual([]);
  });

  it("moves nobody when the tables are already even", async () => {
    const { tournament, td } = await lopsided();
    await td.post(path(tournament.id, "seating/balance")).send({});

    const again = await td.post(path(tournament.id, "seating/balance")).send({});

    expect(again.status).toBe(200);
    expect(again.body.moves).toEqual([]);
    expect(await activity(tournament.id)).toHaveLength(1);
  });
});

describe("POST /api/tournaments/:id/seating/final-table", () => {
  async function lateGame() {
    const setup = await world({ players: 12 });
    const { tournament, registrations } = setup;
    const tables = [
      await createTable({ tournamentId: tournament.id, tableNumber: 1, seatCount: 6 }),
      await createTable({ tournamentId: tournament.id, tableNumber: 2 }),
      await createTable({ tournamentId: tournament.id, tableNumber: 3 }),
    ];
    for (let i = 0; i < 9; i++) await seat(tables[i % 3], registrations[i], Math.floor(i / 3) + 1);
    for (const registration of registrations.slice(9)) await markOut(registration);
    return { ...setup, tables };
  }

  it("redraws everyone still in at the suggested table and archives the rest", async () => {
    const { tournament, registrations, tables, td } = await lateGame();
    const shown = (await td.get(path(tournament.id, "seating"))).body as SeatingDto;

    const response = await td.post(path(tournament.id, "seating/final-table")).send({});

    expect(shown.advisor.advice[0]).toMatchObject({ kind: "final_table", tableId: tables[1].id, tableNumber: 2 });
    expect(response.status).toBe(200);
    const body = response.body as SeatingMutationDto;
    expect(body.moves.every((move) => move.reason === "final_table" && move.to?.tableNumber === 2)).toBe(true);
    expect(body.seating.tables.map((table) => [table.tableNumber, table.status, table.occupied])).toEqual([
      [2, "active", 9],
      [1, "broken", 0],
      [3, "broken", 0],
    ]);
    expectSoundSeating(body.seating, registrations.slice(0, 9).map((r) => r.id));
    expect(await activity(tournament.id)).toEqual([
      {
        eventType: "final_table",
        description: "Final table drawn at Table 2",
        playerId: null,
        data: {
          tableNumber: 2,
          players: 9,
          waiting: 0,
          archivedTables: [1, 3],
          moves: body.moves,
          undo: { versionAfter: body.seating.version, archivedTableIds: [tables[0].id, tables[2].id] },
        },
      },
    ]);
  });

  it("uses the table the TD picks, and refuses one too small, one not in play or another tournament's", async () => {
    const { staff, tournament, tables, td } = await lateGame();
    const archived = await createTable({ tournamentId: tournament.id, tableNumber: 4, status: "broken" });
    const theirs = await createTable({ tournamentId: (await createTournament({ clubId: staff.club.id })).id, tableNumber: 1 });

    const tooSmall = await td.post(path(tournament.id, "seating/final-table")).send({ tableId: tables[0].id });
    const notInPlay = await td.post(path(tournament.id, "seating/final-table")).send({ tableId: archived.id });
    const notOurs = await td.post(path(tournament.id, "seating/final-table")).send({ tableId: theirs.id });
    const picked = await td.post(path(tournament.id, "seating/final-table")).send({ tableId: tables[2].id });

    expect(tooSmall.status).toBe(409);
    expect(tooSmall.body).toMatchObject({ code: "INSUFFICIENT_SEATS", details: { needed: 9, available: 6 } });
    expect(notInPlay.status).toBe(409);
    expect(notInPlay.body).toMatchObject({ code: "TABLE_NOT_ACTIVE" });
    expect(notOurs.status).toBe(404);
    expect(notOurs.body).toMatchObject({ code: "TABLE_NOT_FOUND" });
    expect(picked.status).toBe(200);
    expect((picked.body as SeatingMutationDto).seating.stats).toMatchObject({ activeTables: 1, seated: 9 });
    expect((await activity(tournament.id)).map((entry) => entry.description)).toEqual(["Final table drawn at Table 3"]);
  });

  /** 8 paid players at two 9-seat tables (4 and 4), and two unpaid online sign-ups who never arrived, with no seat. */
  async function noShowsWaiting(seatedCount = 8) {
    const setup = await world({ players: seatedCount });
    const { tournament, registrations } = setup;
    const noShows = await registerPlayers(tournament.id, ["Zed No-show", "Yan No-show"], { paymentConfirmed: false });
    const tables = [await createTable({ tournamentId: tournament.id, tableNumber: 1 }), await createTable({ tournamentId: tournament.id, tableNumber: 2 })];
    for (let i = 0; i < seatedCount; i++) await seat(tables[i % 2], registrations[i], Math.floor(i / 2) + 1);
    return { ...setup, noShows, tables };
  }

  it("is drawn for the players at the tables, leaving those waiting for a seat as they are (TDN3-FINAL-TABLE-WAITING)", async () => {
    const { tournament, registrations, noShows, td } = await noShowsWaiting();
    const shown = (await td.get(path(tournament.id, "seating"))).body as SeatingDto;

    const response = await td.post(path(tournament.id, "seating/final-table")).send({ expectedVersion: shown.version });

    expect(shown.stats).toMatchObject({ activePlayers: 10, seated: 8, unseated: 2, unconfirmedUnseated: 2 });
    expect(response.status).toBe(200);
    const { seating, moves } = response.body as SeatingMutationDto;
    expectSoundSeating(seating, registrations.map((r) => r.id));
    expect(seating.unseated.map((entry) => entry.registrationId).sort()).toEqual(noShows.map((r) => r.id).sort());
    expect(moves.every((move) => move.from !== null && move.to?.tableNumber === 1)).toBe(true);
    const [entry] = await activity(tournament.id);
    expect(entry).toMatchObject({
      eventType: "final_table",
      description: "Final table drawn at Table 1; 2 players are waiting for a seat (2 unpaid)",
      data: { tableNumber: 1, players: 8, waiting: 2, archivedTables: [2] },
    });
  });

  it("also draws the players waiting for a seat when the TD includes them, counting them in the size check", async () => {
    const crowded = await noShowsWaiting(8);
    const tooMany = await crowded.td.post(path(crowded.tournament.id, "seating/final-table")).send({ includeWaiting: true });
    expect(tooMany.status).toBe(409);
    expect(tooMany.body).toMatchObject({ code: "INSUFFICIENT_SEATS", error: "Everyone still in does not fit at one table yet", details: { needed: 10, available: 9 } });

    await resetDb();
    const { tournament, registrations, noShows, td } = await noShowsWaiting(7);
    const response = await td.post(path(tournament.id, "seating/final-table")).send({ includeWaiting: true });

    expect(response.status).toBe(200);
    const { seating } = response.body as SeatingMutationDto;
    expectSoundSeating(seating, [...registrations, ...noShows].map((r) => r.id));
    expect(seating.stats).toMatchObject({ activeTables: 1, seated: 9, unseated: 0 });
    expect((await activity(tournament.id)).map((entry) => entry.description)).toEqual(["Final table drawn at Table 1"]);
  });

  it("refuses without tables (409 NO_TABLES), and while everyone does not fit at one table (409 INSUFFICIENT_SEATS)", async () => {
    const { tournament, td } = await world({ players: 12 });

    const noTables = await td.post(path(tournament.id, "seating/final-table")).send({});
    await td.post(path(tournament.id, "seating/setup")).send({});
    const tooMany = await td.post(path(tournament.id, "seating/final-table")).send({});

    expect(noTables.status).toBe(409);
    expect(noTables.body).toMatchObject({ code: "NO_TABLES" });
    expect(tooMany.status).toBe(409);
    expect(tooMany.body).toMatchObject({ code: "INSUFFICIENT_SEATS", details: { needed: 12, available: 9 } });
  });
});
