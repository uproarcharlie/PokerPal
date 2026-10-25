/**
 * Recovering from a wrong table break, redraw, balance or final table (P4REV0-BREAK-NO-RECOVERY):
 * each keeps every move it made in its activity entry, so SeatingDto.lastChange shows them again after
 * the moves dialog is gone or the page reloads; POST .../seating/undo puts everyone back and reopens
 * the tables it archived, while the seats are still as it left them. And a repeated "Final table" or
 * "Redraw everyone" with the version the TD confirmed against is refused (P4REV1-04).
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import type request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import type { SeatingDto, SeatingMutationDto } from "@shared/api/seating";
import { activityLog, tournamentRegistrations, tournamentSeats, type TournamentTable } from "@shared/schema";
import { createTournament } from "../factories";
import { createSeat, createTable, registerPlayers } from "../factories/seating";
import { anon, resetDb, testDb } from "../helpers";
import { clubWithStaff } from "../helpers/club-staff";

beforeEach(resetDb);

const path = (tournamentId: string, rest: string) => `/api/tournaments/${tournamentId}/${rest}`;

/** `tables` tables of 9 with the players seated round them in order (seat 1, 2, ... at each). */
async function world({ players, tables: tableCount }: { players: number; tables: number }) {
  const staff = await clubWithStaff();
  const tournament = await createTournament({ clubId: staff.club.id, status: "in_progress" });
  const registrations = await registerPlayers(tournament.id, Array.from({ length: players }, (_, i) => `Player ${String(i + 1).padStart(2, "0")}`));
  const tables: TournamentTable[] = [];
  for (let number = 1; number <= tableCount; number++) tables.push(await createTable({ tournamentId: tournament.id, tableNumber: number }));
  for (let i = 0; i < registrations.length; i++) {
    await createSeat({ tournamentId: tournament.id, tableId: tables[i % tableCount].id, registrationId: registrations[i].id, seatNumber: Math.floor(i / tableCount) + 1 });
  }
  return { staff, tournament, registrations, tables, td: staff.manager.agent };
}

const seating = async (td: request.Agent, tournamentId: string) => (await td.get(path(tournamentId, "seating"))).body as SeatingDto;

/** Who sits where, by registration: "tableNumber/seatNumber". */
const placesOf = (dto: SeatingDto) =>
  Object.fromEntries(Object.entries(dto.seatByRegistrationId).map(([id, spot]) => [id, `${spot.tableNumber}/${spot.seatNumber}`]));

async function activity(tournamentId: string) {
  const rows = await testDb().select().from(activityLog).where(eq(activityLog.tournamentId, tournamentId)).orderBy(asc(activityLog.timestamp));
  return rows.map(({ eventType, description, eventData }) => ({ eventType, description, data: eventData ? (JSON.parse(eventData) as Record<string, unknown>) : null }));
}

describe("the last seating change", () => {
  it("keeps a table break's moves, by name and seat, after the dialog is gone", async () => {
    const { tournament, tables, td } = await world({ players: 12, tables: 3 });

    const broken = (await td.post(path(tournament.id, `tables/${tables[2].id}/break`)).send({})).body as SeatingMutationDto;
    const reloaded = await seating(td, tournament.id);

    expect(broken.moves).toHaveLength(4);
    expect(reloaded.lastChange).toEqual({
      activityId: expect.any(String),
      eventType: "table_broken",
      description: "Broke Table 3: 4 players moved",
      at: expect.any(String),
      moves: broken.moves,
      canUndo: true,
    });
    expect(broken.seating.lastChange).toEqual(reloaded.lastChange);
    const [entry] = await activity(tournament.id);
    expect(entry.data).toMatchObject({ tableNumber: 3, moved: 4, moves: broken.moves, undo: { versionAfter: reloaded.version, archivedTableIds: [tables[2].id] } });
  });

  it("is null before any, and is not replaced by a new table or a single move, which only end its undo", async () => {
    const { tournament, registrations, td } = await world({ players: 6, tables: 2 });
    expect((await seating(td, tournament.id)).lastChange).toBeNull();

    await td.post(path(tournament.id, "seating/draw")).send({ scope: "all" });
    const drawn = await seating(td, tournament.id);
    const added = (await td.post(path(tournament.id, "tables")).send({ count: 1 })).body as SeatingMutationDto;
    const table3 = added.seating.tables.find((table) => table.tableNumber === 3);
    const moved = await td.post(path(tournament.id, "seating/assign")).send({ registrationId: registrations[0].id, tableId: table3?.id, seatNumber: 1 });

    expect(drawn.lastChange).toMatchObject({ eventType: "seating_drawn", description: "Seats redrawn for 6 players", canUndo: true });
    expect(added.seating.lastChange).toEqual({ ...drawn.lastChange, canUndo: false });
    expect(moved.status).toBe(200);
    expect((moved.body as SeatingMutationDto).seating.lastChange).toEqual({ ...drawn.lastChange, canUndo: false });
  });
});

describe("POST /api/tournaments/:id/seating/undo", () => {
  it("puts everyone a table break moved back in their old seats and reopens the table", async () => {
    const { tournament, tables, td } = await world({ players: 12, tables: 3 });
    const before = await seating(td, tournament.id);
    await td.post(path(tournament.id, `tables/${tables[2].id}/break`)).send({ expectedVersion: before.version });
    const broken = await seating(td, tournament.id);

    const response = await td.post(path(tournament.id, "seating/undo")).send({ activityId: broken.lastChange?.activityId, expectedVersion: broken.version });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const body = response.body as SeatingMutationDto;
    expect(placesOf(body.seating)).toEqual(placesOf(before));
    expect(body.seating.version).toBe(before.version);
    expect(body.seating.tables.map((table) => [table.tableNumber, table.status])).toEqual([[1, "active"], [2, "active"], [3, "active"]]);
    expect(body.moves).toHaveLength(4);
    expect(body.moves.every((move) => move.reason === "move" && move.to?.tableNumber === 3)).toBe(true);
    expect(body.seating.lastChange).toMatchObject({ eventType: "seating_undone", description: "Undid “Broke Table 3: 4 players moved”", moves: body.moves, canUndo: false });
    const log = await activity(tournament.id);
    expect(log.map(({ eventType, description }) => ({ eventType, description }))).toEqual([
      { eventType: "table_broken", description: "Broke Table 3: 4 players moved" },
      { eventType: "seating_undone", description: "Undid “Broke Table 3: 4 players moved”" },
    ]);
    expect(log[1].data).toMatchObject({ undid: "table_broken", players: 4, reopenedTables: [3] });
    // The feed calls it what it is, and shows it to players as the draw it takes back was shown.
    const feed = await (await anon()).get(`/api/tournaments/${tournament.id}/activity`);
    expect(feed.body.map((entry: { eventType: string }) => entry.eventType)).toEqual(["seating_undone", "table_broken"]);
    // The broken table's old seat rows stay released; each player has one new active row there.
    const active = await testDb().select().from(tournamentSeats).where(and(eq(tournamentSeats.tableId, tables[2].id), isNull(tournamentSeats.releasedAt)));
    expect(active).toHaveLength(4);
  });

  it("puts a redraw of everyone back exactly", async () => {
    const { tournament, td } = await world({ players: 14, tables: 2 });
    const before = await seating(td, tournament.id);
    await td.post(path(tournament.id, "seating/draw")).send({ scope: "all", expectedVersion: before.version });
    const redrawn = await seating(td, tournament.id);

    const undone = (await td.post(path(tournament.id, "seating/undo")).send({ activityId: redrawn.lastChange?.activityId })).body as SeatingMutationDto;

    expect(placesOf(undone.seating)).toEqual(placesOf(before));
  });

  it("unseats again the players a draw seated, and reopens the tables a final table archived", async () => {
    const drawWorld = await world({ players: 4, tables: 1 });
    const late = await registerPlayers(drawWorld.tournament.id, ["Late Larry", "Late Lucy"]);
    await drawWorld.td.post(path(drawWorld.tournament.id, "seating/draw")).send({});
    const drawn = await seating(drawWorld.td, drawWorld.tournament.id);

    const undoneDraw = (await drawWorld.td.post(path(drawWorld.tournament.id, "seating/undo")).send({ activityId: drawn.lastChange?.activityId })).body as SeatingMutationDto;

    expect(undoneDraw.seating.unseated.map((entry) => entry.registrationId).sort()).toEqual(late.map((registration) => registration.id).sort());
    expect(undoneDraw.moves.every((move) => move.reason === "unseat" && move.to === null)).toBe(true);

    const finalWorld = await world({ players: 8, tables: 3 });
    const before = await seating(finalWorld.td, finalWorld.tournament.id);
    await finalWorld.td.post(path(finalWorld.tournament.id, "seating/final-table")).send({ expectedVersion: before.version });
    const final = await seating(finalWorld.td, finalWorld.tournament.id);

    const undoneFinal = (await finalWorld.td.post(path(finalWorld.tournament.id, "seating/undo")).send({ activityId: final.lastChange?.activityId })).body as SeatingMutationDto;

    expect(final.stats.activeTables).toBe(1);
    expect(undoneFinal.seating.stats.activeTables).toBe(3);
    expect(placesOf(undoneFinal.seating)).toEqual(placesOf(before));
  });

  it("refuses once the seats have changed since (STALE_PLAN): a bust, or a move by hand", async () => {
    const { tournament, registrations, tables, td } = await world({ players: 12, tables: 3 });
    await td.post(path(tournament.id, `tables/${tables[2].id}/break`)).send({});
    const broken = await seating(td, tournament.id);
    await testDb().update(tournamentRegistrations).set({ isEliminated: true, eliminationTime: new Date() }).where(eq(tournamentRegistrations.id, registrations[0].id));

    const afterBust = await td.post(path(tournament.id, "seating/undo")).send({ activityId: broken.lastChange?.activityId });

    expect(afterBust.status).toBe(409);
    expect(afterBust.body).toMatchObject({ code: "STALE_PLAN", details: { seating: { lastChange: { activityId: broken.lastChange?.activityId, canUndo: false } } } });
    expect((await seating(td, tournament.id)).stats.activeTables).toBe(2);
  });

  it("refuses an expectedVersion the seating has moved on from (STALE_PLAN)", async () => {
    const { tournament, tables, td } = await world({ players: 12, tables: 3 });
    const before = await seating(td, tournament.id);
    await td.post(path(tournament.id, `tables/${tables[2].id}/break`)).send({});
    const broken = await seating(td, tournament.id);

    const response = await td.post(path(tournament.id, "seating/undo")).send({ activityId: broken.lastChange?.activityId, expectedVersion: before.version });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("STALE_PLAN");
  });

  it("undoes only once, and only the last change (NOTHING_TO_UNDO)", async () => {
    const { tournament, tables, td } = await world({ players: 12, tables: 3 });
    await td.post(path(tournament.id, "seating/balance")).send({});
    await td.post(path(tournament.id, `tables/${tables[2].id}/break`)).send({});
    const broken = await seating(td, tournament.id);
    const first = await td.post(path(tournament.id, "seating/undo")).send({ activityId: broken.lastChange?.activityId });

    const twice = await td.post(path(tournament.id, "seating/undo")).send({ activityId: broken.lastChange?.activityId });
    const ofTheUndo = await td.post(path(tournament.id, "seating/undo")).send({ activityId: (first.body as SeatingMutationDto).seating.lastChange?.activityId });

    expect(first.status).toBe(200);
    for (const response of [twice, ofTheUndo]) {
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ code: "NOTHING_TO_UNDO", details: { seating: { tournamentId: tournament.id } } });
    }
  });

  it("refuses a closed tournament (TOURNAMENT_CLOSED), which shows its last change as not undoable", async () => {
    const { staff, tournament, tables, td } = await world({ players: 12, tables: 3 });
    await td.post(path(tournament.id, `tables/${tables[2].id}/break`)).send({});
    const broken = await seating(td, tournament.id);
    await staff.owner.agent.put(`/api/tournaments/${tournament.id}`).send({ status: "cancelled" });

    const response = await td.post(path(tournament.id, "seating/undo")).send({ activityId: broken.lastChange?.activityId });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("TOURNAMENT_CLOSED");
    expect((await seating(td, tournament.id)).lastChange?.canUndo).toBe(false);
  });
});

describe("a second confirm of a whole-room redraw (P4REV1-04)", () => {
  it("refuses a repeated final table with the version the TD confirmed against, so the seats read out stand", async () => {
    const { tournament, td } = await world({ players: 8, tables: 2 });
    const confirmed = await seating(td, tournament.id);

    const [first, second] = await Promise.all([
      td.post(path(tournament.id, "seating/final-table")).send({ expectedVersion: confirmed.version }),
      td.post(path(tournament.id, "seating/final-table")).send({ expectedVersion: confirmed.version }),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const [won, lost] = first.status === 200 ? [first, second] : [second, first];
    expect(lost.body).toMatchObject({ code: "STALE_PLAN", details: { seating: { version: (won.body as SeatingMutationDto).seating.version } } });
    expect((await activity(tournament.id)).filter((entry) => entry.eventType === "final_table")).toHaveLength(1);
  });

  it("refuses a repeated redraw of everyone the same way", async () => {
    const { tournament, td } = await world({ players: 8, tables: 2 });
    const confirmed = await seating(td, tournament.id);

    const first = await td.post(path(tournament.id, "seating/draw")).send({ scope: "all", expectedVersion: confirmed.version });
    const second = await td.post(path(tournament.id, "seating/draw")).send({ scope: "all", expectedVersion: confirmed.version });

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("STALE_PLAN");
    expect((await activity(tournament.id)).filter((entry) => entry.eventType === "seating_drawn")).toHaveLength(1);
  });

  it("validates the version (400)", async () => {
    const { tournament, td } = await world({ players: 2, tables: 1 });

    for (const rest of ["seating/final-table", "seating/draw", "seating/undo"]) {
      const response = await td.post(path(tournament.id, rest)).send({ activityId: tournament.id, expectedVersion: "nope" });
      expect(response.status, rest).toBe(400);
    }
  });
});
