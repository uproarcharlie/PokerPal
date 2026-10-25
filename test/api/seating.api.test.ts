/**
 * Tables and the seating reads (server/routes/seating.ts, phase4-contracts §3.1 S1–S5, S12): the
 * staff SeatingDto and the public seat finder (PII-free, never cached, leaving out players who are
 * out and broken tables even before a write released their seats), and adding, editing, removing and
 * breaking tables, each with its refusals and its activity row. Draws and moves are in
 * seating-draw.api.test.ts, the registration hooks in seating-hooks, races in seating-concurrency.
 */
import { asc, eq } from "drizzle-orm";
import session from "express-session";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { findForbiddenKeys } from "@shared/api/public";
import type { PublicSeatingDto, SeatingDto, SeatingMutationDto } from "@shared/api/seating";
import {
  activityLog,
  tournamentRegistrations,
  tournamentSeats,
  tournamentTables,
  type TournamentRegistration,
  type TournamentTable,
} from "@shared/schema";
import { createApp } from "../../server/app";
import { loadEnv } from "../../server/config/env";
import { createClub, createTournament, createUser, FACTORY_PASSWORD, type NewTournament } from "../factories";
import { createSeat, createTable, registerPlayers } from "../factories/seating";
import { anon, resetDb, testDb, UNKNOWN_ID } from "../helpers";
import { clubWithStaff } from "../helpers/club-staff";

beforeEach(resetDb);

const NAMES = ["Cleo", "alice", "Bob", "Dee", "Eve", "Finn", "Gus", "Hana", "Ivy", "Jo", "Kit", "Lou"];
const byName = (a: string, b: string) => a.localeCompare(b, "en", { sensitivity: "base" });

async function world({ players = 0, tournament: overrides = {} }: { players?: number; tournament?: Partial<NewTournament> } = {}) {
  const staff = await clubWithStaff();
  const tournament = await createTournament({ clubId: staff.club.id, status: "registration", ...overrides });
  const registrations = await registerPlayers(tournament.id, NAMES.slice(0, players));
  return { staff, tournament, registrations, td: staff.manager.agent };
}

const path = (tournamentId: string, rest: string) => `/api/tournaments/${tournamentId}/${rest}`;
const publicPath = (tournamentId: string) => `/api/public/tournaments/${tournamentId}/seating`;

const seat = (table: TournamentTable, registration: TournamentRegistration, seatNumber: number) =>
  createSeat({ tournamentId: table.tournamentId, tableId: table.id, registrationId: registration.id, seatNumber });

const markOut = (registration: TournamentRegistration) =>
  testDb().update(tournamentRegistrations).set({ isEliminated: true, eliminationTime: new Date() }).where(eq(tournamentRegistrations.id, registration.id));

async function activity(tournamentId: string) {
  const rows = await testDb().select().from(activityLog).where(eq(activityLog.tournamentId, tournamentId)).orderBy(asc(activityLog.timestamp));
  return rows.map(({ eventType, description, playerId, eventData }) => ({
    eventType,
    description,
    playerId,
    data: eventData ? (JSON.parse(eventData) as unknown) : null,
  }));
}

const tableRow = async (id: string) => (await testDb().select().from(tournamentTables).where(eq(tournamentTables.id, id)))[0];
const tablesInCount = async (tournamentId: string) =>
  (await testDb().select().from(tournamentTables).where(eq(tournamentTables.tournamentId, tournamentId))).length;
const seatRows = (tableId: string) => testDb().select().from(tournamentSeats).where(eq(tournamentSeats.tableId, tableId));

describe("GET /api/tournaments/:id/seating", () => {
  it("shows the TD an unseated field, by name, with a setup suggestion, never cached", async () => {
    const { tournament, registrations, td } = await world({ players: 12 });

    const response = await td.get(path(tournament.id, "seating"));

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const seating = response.body as SeatingDto;
    expect(seating).toMatchObject({
      tournamentId: tournament.id,
      tournamentStatus: "registration",
      readOnly: false,
      tables: [],
      stats: { activePlayers: 12, seated: 0, unseated: 12, unconfirmedUnseated: 0, openSeats: 0, capacity: 0, activeTables: 0, maxDiff: 0 },
      suggestions: { balance: [], breakTable: null, finalTable: null, setup: { seatCount: 9, tableCount: 2, perTable: [6, 6] } },
      seatByRegistrationId: {},
    });
    expect(seating.version).toMatch(/^[0-9a-f]{8}$/);
    expect(seating.unseated.map((entry) => entry.player.name)).toEqual([...NAMES].sort(byName));
    expect(seating.unseated[0]).toEqual({
      registrationId: registrations[1].id,
      player: { id: registrations[1].playerId, name: "alice", imageUrl: null },
      paymentConfirmed: true,
    });
  });

  it("lists active tables by number with one entry per seat, then archived ones without seats", async () => {
    const { tournament, registrations, td } = await world({ players: 3 });
    await testDb().update(tournamentRegistrations).set({ paymentConfirmed: false }).where(eq(tournamentRegistrations.id, registrations[2].id));
    await createTable({ tournamentId: tournament.id, tableNumber: 1, status: "broken" });
    const feature = await createTable({ tournamentId: tournament.id, tableNumber: 3, seatCount: 6, name: "Feature table" });
    const small = await createTable({ tournamentId: tournament.id, tableNumber: 2, seatCount: 2 });
    await seat(small, registrations[0], 2);
    await seat(feature, registrations[1], 6);

    const seating = (await td.get(path(tournament.id, "seating"))).body as SeatingDto;

    expect(seating.tables.map(({ tableNumber, name, displayName, status, occupied, seats }) => ({ tableNumber, name, displayName, status, occupied, seats: seats.length }))).toEqual([
      { tableNumber: 2, name: null, displayName: "Table 2", status: "active", occupied: 1, seats: 2 },
      { tableNumber: 3, name: "Feature table", displayName: "Feature table", status: "active", occupied: 1, seats: 6 },
      { tableNumber: 1, name: null, displayName: "Table 1", status: "broken", occupied: 0, seats: 0 },
    ]);
    expect(seating.tables[0].seats).toEqual([
      { seatNumber: 1, registrationId: null, player: null, paymentConfirmed: null },
      { seatNumber: 2, registrationId: registrations[0].id, player: { id: registrations[0].playerId, name: "Cleo", imageUrl: null }, paymentConfirmed: true },
    ]);
    expect(seating.seatByRegistrationId).toEqual({
      [registrations[0].id]: { tableNumber: 2, seatNumber: 2 },
      [registrations[1].id]: { tableNumber: 3, seatNumber: 6 },
    });
    expect(seating.unseated).toEqual([expect.objectContaining({ registrationId: registrations[2].id, paymentConfirmed: false })]);
    expect(seating.stats).toEqual({ activePlayers: 3, seated: 2, unseated: 1, unconfirmedUnseated: 1, openSeats: 6, capacity: 8, activeTables: 2, maxDiff: 0 });
    expect(seating.suggestions.setup).toBeNull();
  });

  it("leaves out the seat of a player who is out and seats on a broken table, before any write releases them", async () => {
    const { tournament, registrations, td } = await world({ players: 3 });
    const live = await createTable({ tournamentId: tournament.id, tableNumber: 1 });
    const broken = await createTable({ tournamentId: tournament.id, tableNumber: 2, status: "broken" });
    await seat(live, registrations[0], 1);
    await seat(live, registrations[1], 2);
    await seat(broken, registrations[2], 1);
    await markOut(registrations[1]);

    const seating = (await td.get(path(tournament.id, "seating"))).body as SeatingDto;
    const seatFinder = (await (await anon()).get(publicPath(tournament.id))).body as PublicSeatingDto;

    expect(seating.seatByRegistrationId).toEqual({ [registrations[0].id]: { tableNumber: 1, seatNumber: 1 } });
    expect(seating.unseated.map((entry) => entry.registrationId)).toEqual([registrations[2].id]);
    expect(seating.stats).toMatchObject({ activePlayers: 2, seated: 1, unseated: 1 });
    expect(seatFinder.players.map((entry) => entry.player.name)).toEqual(["Cleo"]);
    expect(seatFinder.unseatedCount).toBe(1);
    // A read never writes: the rows are released by the next seating write.
    expect((await seatRows(live.id)).every((row) => row.releasedAt === null)).toBe(true);
  });

  it("is read-only once the tournament is completed or cancelled", async () => {
    for (const status of ["completed", "cancelled"]) {
      const { tournament, td } = await world({ tournament: { status } });

      expect((await td.get(path(tournament.id, "seating"))).body).toMatchObject({ readOnly: true, tournamentStatus: status });
    }
  });
});

describe("GET /api/public/tournaments/:id/seating", () => {
  it("shows anyone the active tables and every seated player by name, with no personal data, never cached", async () => {
    const { staff, tournament, registrations } = await world({ players: 4 });
    const first = await createTable({ tournamentId: tournament.id, tableNumber: 1, seatCount: 3, name: "Feature table" });
    const second = await createTable({ tournamentId: tournament.id, tableNumber: 2, seatCount: 2 });
    await createTable({ tournamentId: tournament.id, tableNumber: 3, status: "broken" });
    await seat(first, registrations[0], 3);
    await seat(second, registrations[1], 1);
    await seat(second, registrations[2], 2);

    for (const agent of [await anon(), staff.stranger.agent]) {
      const response = await agent.get(publicPath(tournament.id));

      expect(response.status).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      const body = response.body as PublicSeatingDto;
      expect(body).toMatchObject({
        tournament: { id: tournament.id, name: tournament.name, status: "registration" },
        club: { id: staff.club.id, name: staff.club.name, slug: staff.club.slug, imageUrl: null },
        unseatedCount: 1,
      });
      expect(body.tables).toEqual([
        {
          tableNumber: 1,
          displayName: "Feature table",
          seatCount: 3,
          shape: "oval",
          seats: [
            { seatNumber: 1, player: null },
            { seatNumber: 2, player: null },
            { seatNumber: 3, player: { id: registrations[0].playerId, name: "Cleo", imageUrl: null } },
          ],
        },
        {
          tableNumber: 2,
          displayName: "Table 2",
          seatCount: 2,
          shape: "oval",
          seats: [
            { seatNumber: 1, player: { id: registrations[1].playerId, name: "alice", imageUrl: null } },
            { seatNumber: 2, player: { id: registrations[2].playerId, name: "Bob", imageUrl: null } },
          ],
        },
      ]);
      expect(body.players.map(({ player, tableNumber, tableName, seatNumber }) => [player.name, tableNumber, tableName, seatNumber])).toEqual([
        ["alice", 2, "Table 2", 1],
        ["Bob", 2, "Table 2", 2],
        ["Cleo", 1, "Feature table", 3],
      ]);
      expect(findForbiddenKeys(body)).toEqual([]);
      expect(JSON.stringify(body)).not.toMatch(/@example\.test|021 555|paymentConfirmed|registrationId/);
    }
  });

  it("answers 404 for a tournament that does not exist", async () => {
    const response = await (await anon()).get(publicPath(UNKNOWN_ID));

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ code: "NOT_FOUND", error: "Tournament not found" });
  });
});

describe("POST /api/tournaments/:id/tables", () => {
  it("adds tables numbered after the highest the tournament has had, archived ones included", async () => {
    const { tournament, td } = await world();
    await createTable({ tournamentId: tournament.id, tableNumber: 3, status: "broken" });

    const response = await td.post(path(tournament.id, "tables")).send({ count: 2, seatCount: 6 });

    expect(response.status).toBe(201);
    const body = response.body as SeatingMutationDto;
    expect(body.moves).toEqual([]);
    expect(body.seating.tables.map(({ tableNumber, seatCount, status, seats }) => [tableNumber, seatCount, status, seats.length])).toEqual([
      [4, 6, "active", 6],
      [5, 6, "active", 6],
      [3, 9, "broken", 0],
    ]);
    expect(await activity(tournament.id)).toEqual([
      { eventType: "tables_added", description: "Added 2 tables (6 seats)", playerId: null, data: { tableNumbers: [4, 5], seatCount: 6, shape: "oval" } },
    ]);
  });

  it("adds one table of 9 seats by default", async () => {
    const { tournament, td } = await world();

    const response = await td.post(path(tournament.id, "tables")).send({});

    expect(response.status).toBe(201);
    expect((response.body as SeatingMutationDto).seating.tables).toEqual([expect.objectContaining({ tableNumber: 1, seatCount: 9, displayName: "Table 1" })]);
    expect((await activity(tournament.id))[0].description).toBe("Added 1 table (9 seats)");
  });

  it("refuses more than 50 tables in play (409 TABLE_LIMIT), counting no archived one", async () => {
    const { tournament, td } = await world();
    for (let number = 1; number <= 49; number++) await createTable({ tournamentId: tournament.id, tableNumber: number });
    await createTable({ tournamentId: tournament.id, tableNumber: 50, status: "broken" });

    const tooMany = await td.post(path(tournament.id, "tables")).send({ count: 2 });
    const fiftieth = await td.post(path(tournament.id, "tables")).send({ count: 1 });

    expect(tooMany.status).toBe(409);
    expect(tooMany.body).toMatchObject({ code: "TABLE_LIMIT" });
    expect(fiftieth.status).toBe(201);
    expect((fiftieth.body as SeatingMutationDto).seating.stats.activeTables).toBe(50);
  });

  it("refuses a table past number 999 (409 TABLE_LIMIT)", async () => {
    const { tournament, td } = await world();
    await createTable({ tournamentId: tournament.id, tableNumber: 998 });

    const response = await td.post(path(tournament.id, "tables")).send({ count: 2 });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: "TABLE_LIMIT" });
    expect(await tablesInCount(tournament.id)).toBe(1);
  });

  it("refuses a seat count outside 2–10 (400 VALIDATION)", async () => {
    const { tournament, td } = await world();

    const response = await td.post(path(tournament.id, "tables")).send({ seatCount: 11 });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: "VALIDATION" });
  });

  it("refuses every seating write once the tournament is completed or cancelled (409 TOURNAMENT_CLOSED)", async () => {
    for (const status of ["completed", "cancelled"]) {
      const { tournament, registrations, td } = await world({ players: 1, tournament: { status } });
      const table = await createTable({ tournamentId: tournament.id, tableNumber: 1 });
      const writes = [
        () => td.post(path(tournament.id, "tables")).send({}),
        () => td.patch(path(tournament.id, `tables/${table.id}`)).send({ name: "Feature table" }),
        () => td.delete(path(tournament.id, `tables/${table.id}`)),
        () => td.post(path(tournament.id, `tables/${table.id}/break`)).send({}),
        () => td.post(path(tournament.id, "seating/setup")).send({}),
        () => td.post(path(tournament.id, "seating/draw")).send({}),
        () => td.post(path(tournament.id, "seating/assign")).send({ registrationId: registrations[0].id, tableId: table.id, seatNumber: 1 }),
        () => td.post(path(tournament.id, "seating/unseat")).send({ registrationId: registrations[0].id }),
        () => td.post(path(tournament.id, "seating/balance")).send({}),
        () => td.post(path(tournament.id, "seating/final-table")).send({}),
      ];

      const answers: Array<[number, unknown]> = [];
      for (const write of writes) {
        const response = await write();
        answers.push([response.status, response.body.code]);
      }
      expect(answers).toEqual(writes.map(() => [409, "TOURNAMENT_CLOSED"]));
      expect(await seatRows(table.id)).toEqual([]);
      expect(await activity(tournament.id)).toEqual([]);
    }
  });
});

describe("PATCH /api/tournaments/:id/tables/:tableId", () => {
  it("renames and resizes a table, logging one staff-only entry", async () => {
    const { tournament, td } = await world();
    const table = await createTable({ tournamentId: tournament.id, tableNumber: 1 });

    const response = await td.patch(path(tournament.id, `tables/${table.id}`)).send({ name: " Feature table ", seatCount: 8 });

    expect(response.status).toBe(200);
    expect((response.body as SeatingMutationDto).seating.tables[0]).toMatchObject({ name: "Feature table", displayName: "Feature table", seatCount: 8 });
    expect(await tableRow(table.id)).toMatchObject({ name: "Feature table", seatCount: 8 });
    expect(await activity(tournament.id)).toEqual([
      {
        eventType: "table_updated",
        description: "Table 1 renamed Feature table; Table 1 now has 8 seats",
        playerId: null,
        data: { tableNumber: 1, changes: { name: "Feature table", seatCount: 8 } },
      },
    ]);
    const feed = (await (await anon()).get(`/api/tournaments/${tournament.id}/activity`)).body as Array<{ eventType: string }>;
    expect(feed.map((entry) => entry.eventType)).not.toContain("table_updated");
  });

  it("clears a name, renumbers to a free number, and logs nothing when nothing changes", async () => {
    const { tournament, td } = await world();
    const table = await createTable({ tournamentId: tournament.id, tableNumber: 1, name: "Feature table" });

    await td.patch(path(tournament.id, `tables/${table.id}`)).send({ name: "", tableNumber: 7 });
    const unchanged = await td.patch(path(tournament.id, `tables/${table.id}`)).send({ name: null, seatCount: 9, tableNumber: 7 });

    expect(unchanged.status).toBe(200);
    expect(await tableRow(table.id)).toMatchObject({ name: null, tableNumber: 7 });
    expect((await activity(tournament.id)).map((entry) => entry.description)).toEqual(["Table 1's name was cleared; Table 1 is now Table 7"]);
  });

  it("refuses a number another table has, archived ones included (409 TABLE_NUMBER_TAKEN)", async () => {
    const { tournament, td } = await world();
    const table = await createTable({ tournamentId: tournament.id, tableNumber: 1 });
    await createTable({ tournamentId: tournament.id, tableNumber: 2, status: "broken" });

    const response = await td.patch(path(tournament.id, `tables/${table.id}`)).send({ tableNumber: 2 });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: "TABLE_NUMBER_TAKEN" });
    expect(await tableRow(table.id)).toMatchObject({ tableNumber: 1 });
  });

  it("refuses to shrink a table below an occupied seat (409 SEATS_OCCUPIED with the seats)", async () => {
    const { tournament, registrations, td } = await world({ players: 3 });
    const table = await createTable({ tournamentId: tournament.id, tableNumber: 1 });
    await seat(table, registrations[0], 9);
    await seat(table, registrations[1], 8);
    await seat(table, registrations[2], 2);

    const response = await td.patch(path(tournament.id, `tables/${table.id}`)).send({ seatCount: 7 });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: "SEATS_OCCUPIED", details: { seatNumbers: [8, 9] } });
    expect(await tableRow(table.id)).toMatchObject({ seatCount: 9 });
  });

  it("shrinks past a seat whose player is out: that seat is released first", async () => {
    const { tournament, registrations, td } = await world({ players: 1 });
    const table = await createTable({ tournamentId: tournament.id, tableNumber: 1 });
    await seat(table, registrations[0], 9);
    await markOut(registrations[0]);

    const response = await td.patch(path(tournament.id, `tables/${table.id}`)).send({ seatCount: 6 });

    expect(response.status).toBe(200);
    expect(await seatRows(table.id)).toEqual([expect.objectContaining({ releaseReason: "eliminated", releasedAt: expect.any(Date) })]);
  });

  it("reopens an archived table, within the 50-table limit", async () => {
    const { tournament, td } = await world();
    const archived = await createTable({ tournamentId: tournament.id, tableNumber: 1, status: "broken" });

    const response = await td.patch(path(tournament.id, `tables/${archived.id}`)).send({ status: "active" });

    expect(response.status).toBe(200);
    expect(await tableRow(archived.id)).toMatchObject({ status: "active", brokenAt: null });
    expect((await activity(tournament.id)).map((entry) => entry.description)).toEqual(["Table 1 reopened"]);

    const crowded = await world();
    const old = await createTable({ tournamentId: crowded.tournament.id, tableNumber: 51, status: "broken" });
    for (let number = 1; number <= 50; number++) await createTable({ tournamentId: crowded.tournament.id, tableNumber: number });
    const refused = await crowded.td.patch(path(crowded.tournament.id, `tables/${old.id}`)).send({ status: "active" });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: "TABLE_LIMIT" });
  });

  it("answers 404 TABLE_NOT_FOUND for another tournament's table or none", async () => {
    const { staff, tournament, td } = await world();
    const other = await createTournament({ clubId: staff.club.id, status: "registration" });
    const theirs = await createTable({ tournamentId: other.id, tableNumber: 1 });

    for (const tableId of [theirs.id, UNKNOWN_ID]) {
      const response = await td.patch(path(tournament.id, `tables/${tableId}`)).send({ name: "Mine now" });

      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({ code: "TABLE_NOT_FOUND" });
    }
    expect(await tableRow(theirs.id)).toMatchObject({ name: null });
  });
});

describe("DELETE /api/tournaments/:id/tables/:tableId", () => {
  it("deletes a table nobody ever sat at", async () => {
    const { tournament, td } = await world();
    const table = await createTable({ tournamentId: tournament.id, tableNumber: 4 });

    const response = await td.delete(path(tournament.id, `tables/${table.id}`));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ removed: "deleted", moves: [], seating: { tables: [] } });
    expect(await tableRow(table.id)).toBeUndefined();
    expect(await activity(tournament.id)).toEqual([
      { eventType: "table_removed", description: "Removed Table 4", playerId: null, data: { tableNumber: 4, removed: "deleted" } },
    ]);
  });

  it("archives a table someone sat at, keeping its history and its number", async () => {
    const { tournament, registrations, td } = await world({ players: 1 });
    const table = await createTable({ tournamentId: tournament.id, tableNumber: 1 });
    await createSeat({ tournamentId: tournament.id, tableId: table.id, registrationId: registrations[0].id, seatNumber: 1, releasedAt: new Date(), releaseReason: "unseated" });

    const response = await td.delete(path(tournament.id, `tables/${table.id}`));
    const again = await td.delete(path(tournament.id, `tables/${table.id}`));
    const added = await td.post(path(tournament.id, "tables")).send({});

    expect(response.body).toMatchObject({ removed: "archived" });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ removed: "archived" });
    expect(await tableRow(table.id)).toMatchObject({ status: "broken", brokenAt: expect.any(Date) });
    expect(await seatRows(table.id)).toHaveLength(1);
    expect((added.body as SeatingMutationDto).seating.tables.map((t) => t.tableNumber)).toEqual([2, 1]);
    expect((await activity(tournament.id)).map((entry) => entry.description)).toEqual(["Removed Table 1", "Added 1 table (9 seats)"]);
  });

  it("refuses a table someone sits at (409 TABLE_OCCUPIED)", async () => {
    const { tournament, registrations, td } = await world({ players: 2 });
    const table = await createTable({ tournamentId: tournament.id, tableNumber: 1 });
    await seat(table, registrations[0], 1);
    await seat(table, registrations[1], 2);

    const response = await td.delete(path(tournament.id, `tables/${table.id}`));

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: "TABLE_OCCUPIED", error: "Table 1 still has 2 players: break the table or move them first" });
    expect(await tableRow(table.id)).toMatchObject({ status: "active" });
  });

  it("answers 404 TABLE_NOT_FOUND for another tournament's table", async () => {
    const { staff, tournament, td } = await world();
    const theirs = await createTable({ tournamentId: (await createTournament({ clubId: staff.club.id })).id, tableNumber: 1 });

    const response = await td.delete(path(tournament.id, `tables/${theirs.id}`));

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ code: "TABLE_NOT_FOUND" });
    expect(await tableRow(theirs.id)).toBeDefined();
  });
});

describe("POST /api/tournaments/:id/tables/:tableId/break", () => {
  async function threeTables() {
    const setup = await world({ players: 8 });
    const { tournament, registrations } = setup;
    const tables = [
      await createTable({ tournamentId: tournament.id, tableNumber: 1, seatCount: 4 }),
      await createTable({ tournamentId: tournament.id, tableNumber: 2, seatCount: 4 }),
      await createTable({ tournamentId: tournament.id, tableNumber: 3, seatCount: 4 }),
    ];
    // Table 1: 3 players, table 2: 3, table 3: 2.
    const spots: Array<[number, number]> = [[0, 1], [0, 2], [0, 3], [1, 1], [1, 2], [1, 4], [2, 1], [2, 2]];
    for (let i = 0; i < spots.length; i++) await seat(tables[spots[i][0]], registrations[i], spots[i][1]);
    return { ...setup, tables };
  }

  it("draws the table's players onto the other tables and archives it", async () => {
    const { tournament, registrations, tables, td } = await threeTables();

    const response = await td.post(path(tournament.id, `tables/${tables[2].id}/break`)).send({});

    expect(response.status).toBe(200);
    const body = response.body as SeatingMutationDto;
    expect(body.moves.map((move) => [move.playerName, move.from?.tableNumber, move.from?.seatNumber, move.reason]).sort()).toEqual([
      ["Gus", 3, 1, "table_broken"],
      ["Hana", 3, 2, "table_broken"],
    ]);
    expect(body.moves.every((move) => move.to !== null && move.to.tableNumber !== 3)).toBe(true);
    expect(body.seating.tables.map((table) => [table.tableNumber, table.status, table.occupied])).toEqual([
      [1, "active", 4],
      [2, "active", 4],
      [3, "broken", 0],
    ]);
    expect(Object.keys(body.seating.seatByRegistrationId).sort()).toEqual(registrations.map((r) => r.id).sort());
    expect((await seatRows(tables[2].id)).map((row) => row.releaseReason)).toEqual(["table_broken", "table_broken"]);
    expect(await tableRow(tables[2].id)).toMatchObject({ status: "broken", brokenAt: expect.any(Date) });
    expect(await activity(tournament.id)).toEqual([
      {
        eventType: "table_broken",
        description: "Broke Table 3: 2 players moved",
        playerId: null,
        data: { tableNumber: 3, moved: 2, moves: body.moves, undo: { versionAfter: body.seating.version, archivedTableIds: [tables[2].id] } },
      },
    ]);
  });

  it("applies only the seating the TD saw: a stale version is 409 STALE_PLAN with the current seating", async () => {
    const { tournament, registrations, tables, td } = await threeTables();
    const shown = ((await td.get(path(tournament.id, "seating"))).body as SeatingDto).version;
    await markOut(registrations[7]);

    const stale = await td.post(path(tournament.id, `tables/${tables[2].id}/break`)).send({ expectedVersion: shown });
    const current = ((await td.get(path(tournament.id, "seating"))).body as SeatingDto);
    const fresh = await td.post(path(tournament.id, `tables/${tables[2].id}/break`)).send({ expectedVersion: current.version });

    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ code: "STALE_PLAN" });
    expect(stale.body.details.seating).toEqual(current);
    expect(fresh.status).toBe(200);
    expect((fresh.body as SeatingMutationDto).moves).toHaveLength(1);
  });

  it("refuses the last table, a table not in play, and a break the other tables cannot take", async () => {
    const { tournament, registrations, tables, td } = await threeTables();
    const archived = await createTable({ tournamentId: tournament.id, tableNumber: 4, status: "broken" });
    const [extra] = await registerPlayers(tournament.id, ["Zed"]);
    await seat(tables[2], extra, 3);

    const notInPlay = await td.post(path(tournament.id, `tables/${archived.id}/break`)).send({});
    const tooFull = await td.post(path(tournament.id, `tables/${tables[0].id}/break`)).send({});
    // With only table 1's players left, the other two can go; then table 1 is the last.
    for (const registration of [...registrations.slice(3), extra]) await markOut(registration);
    expect((await td.post(path(tournament.id, `tables/${tables[1].id}/break`)).send({})).status).toBe(200);
    expect((await td.post(path(tournament.id, `tables/${tables[2].id}/break`)).send({})).status).toBe(200);
    const last = await td.post(path(tournament.id, `tables/${tables[0].id}/break`)).send({});

    expect(notInPlay.status).toBe(409);
    expect(notInPlay.body).toMatchObject({ code: "TABLE_NOT_ACTIVE" });
    expect(tooFull.status).toBe(409);
    expect(tooFull.body).toMatchObject({ code: "INSUFFICIENT_SEATS", details: { needed: 3, available: 2 } });
    expect(last.status).toBe(409);
    expect(last.body).toMatchObject({ code: "LAST_TABLE" });
  });

  it("answers 404 TABLE_NOT_FOUND for another tournament's table", async () => {
    const { staff, tournament, td } = await world();
    const theirs = await createTable({ tournamentId: (await createTournament({ clubId: staff.club.id })).id, tableNumber: 1 });

    const response = await td.post(path(tournament.id, `tables/${theirs.id}/break`)).send({});

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ code: "TABLE_NOT_FOUND" });
  });
});

describe("the TD's seating requests and the venue's shared request budget", () => {
  it("never count against globalApi: a full room cannot stop the TD seating players", async () => {
    const app = await createApp({
      env: loadEnv(process.env),
      sessionStore: new session.MemoryStore(),
      rateLimits: { enabled: true, limits: { globalApi: 3 } },
    });
    const owner = await createUser();
    const club = await createClub({ ownerId: owner.id });
    const tournament = await createTournament({ clubId: club.id, status: "registration" });
    await registerPlayers(tournament.id, NAMES);
    const td = request.agent(app);
    expect((await td.post("/api/auth/login").send({ email: owner.email, password: FACTORY_PASSWORD })).status).toBe(200);

    const statuses = [
      (await td.post(path(tournament.id, "tables")).send({ count: 2 })).status,
      (await td.post(path(tournament.id, "seating/draw")).send({})).status,
      (await td.post(path(tournament.id, "seating/balance")).send({})).status,
    ];
    for (let poll = 0; poll < 5; poll++) {
      statuses.push((await td.get(path(tournament.id, "seating"))).status, (await td.get(publicPath(tournament.id))).status);
    }

    expect(statuses.every((status) => status === 200 || status === 201)).toBe(true);
    expect((await td.get("/api/clubs")).status).toBe(200);
    expect((await td.get("/api/clubs")).status).toBe(200);
    expect((await td.get("/api/clubs")).status).toBe(429);
  });
});
