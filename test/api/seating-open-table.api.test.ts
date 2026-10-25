/**
 * "Open Table N" (round 5, item 11; round5-contracts R5-S13): the advisor's one-tap plan to open the
 * next table, seat the players waiting and even the tables out to within one player, applied exactly
 * as it was shown (the same snapshot and seeded draw), refused once the seating changed (STALE_PLAN),
 * logged with its moves so Undo can put them back.
 */
import { and, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { SeatingDto, SeatingMutationDto, SeatMoveDto } from "@shared/api/seating";
import { activityLog, tournamentSeats, tournamentTables, type TournamentRegistration, type TournamentTable } from "@shared/schema";
import { createTournament, type NewTournament } from "../factories";
import { createSeat, createTable, registerPlayers } from "../factories/seating";
import { resetDb, testDb } from "../helpers";
import { clubWithStaff } from "../helpers/club-staff";

beforeEach(resetDb);

const path = (tournamentId: string, rest: string) => `/api/tournaments/${tournamentId}/${rest}`;

/** Two full tables of `seats` and `waiting` players with no seat. */
async function fullRoom({ seats = 10, waiting = 1, tournament: overrides = {} }: { seats?: number; waiting?: number; tournament?: Partial<NewTournament> } = {}) {
  const staff = await clubWithStaff();
  const tournament = await createTournament({ clubId: staff.club.id, status: "in_progress", seatsPerTable: seats, ...overrides });
  const tables = [await createTable({ tournamentId: tournament.id, tableNumber: 1, seatCount: seats }), await createTable({ tournamentId: tournament.id, tableNumber: 2, seatCount: seats })];
  const seated = await registerPlayers(tournament.id, Array.from({ length: seats * 2 }, (_, i) => `Player ${String(i + 1).padStart(2, "0")}`));
  for (let index = 0; index < seated.length; index++) {
    const registration = seated[index];
    await seatAt(tables[index < seats ? 0 : 1], registration, (index % seats) + 1);
  }
  const late = await registerPlayers(tournament.id, Array.from({ length: waiting }, (_, i) => `Late ${i + 1}`));
  return { staff, tournament, tables, seated, late, td: staff.manager.agent };
}

const seatAt = (table: TournamentTable, registration: TournamentRegistration, seatNumber: number) =>
  createSeat({ tournamentId: table.tournamentId, tableId: table.id, registrationId: registration.id, seatNumber });

const seatingOf = async (td: { get: (path: string) => PromiseLike<{ body: unknown }> }, tournamentId: string) =>
  (await td.get(path(tournamentId, "seating"))).body as SeatingDto;

const occupancy = (seating: SeatingDto) => seating.tables.filter((table) => table.status === "active").map((table) => table.occupied);

/** A move without the new table's id (the advice names it NEW_TABLE_ID; Apply has the real one). */
const shown = (move: SeatMoveDto) => ({
  registrationId: move.registrationId,
  from: move.from ? `${move.from.tableNumber}:${move.from.seatNumber}` : null,
  to: move.to ? `${move.to.tableName}:${move.to.seatNumber}` : null,
  reason: move.reason,
});

describe("POST /api/tournaments/:id/seating/open-table", () => {
  it("refuses Apply once someone joins or leaves the players waiting after the advice was shown (409 STALE_PLAN, R5REV-HOST-07)", async () => {
    const room = await fullRoom();
    const before = await seatingOf(room.td, room.tournament.id);
    await registerPlayers(room.tournament.id, ["Later Still"]);

    const response = await room.td.post(path(room.tournament.id, "seating/open-table")).send({ expectedVersion: before.version });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("STALE_PLAN");
    const now = response.body.details.seating as SeatingDto;
    expect(now.advisor.advice[0]).toMatchObject({ kind: "open_table", message: "Every table is full and 2 players are waiting: open Table 3 and even the tables out to 8 / 7 / 7" });
    expect(await testDb().select().from(tournamentTables).where(eq(tournamentTables.tournamentId, room.tournament.id))).toHaveLength(2);

    // The plan shown now is the one Apply does.
    const applied = await room.td.post(path(room.tournament.id, "seating/open-table")).send({ expectedVersion: now.version });
    expect(applied.status).toBe(201);
    expect((applied.body as SeatingMutationDto).moves.map(shown)).toEqual(now.advisor.advice[0].moves.map(shown));
  });

  it("does exactly what the advice showed: 10 / 10 with 1 arrival becomes 7 / 7 / 7", async () => {
    const room = await fullRoom();
    const before = await seatingOf(room.td, room.tournament.id);
    const [advice] = before.advisor.advice;
    expect(advice).toMatchObject({ kind: "open_table", tableNumber: 3, message: "Every table is full and 1 player is waiting: open Table 3 and even the tables out to 7 / 7 / 7" });

    const response = await room.td.post(path(room.tournament.id, "seating/open-table")).send({ expectedVersion: before.version });

    expect(response.status).toBe(201);
    const body = response.body as SeatingMutationDto;
    expect(occupancy(body.seating)).toEqual([7, 7, 7]);
    expect(body.moves.map(shown)).toEqual(advice.moves.map(shown));
    expect(body.moves.filter((move) => move.from === null).map((move) => move.registrationId)).toEqual([room.late[0].id]);
    expect(body.seating.unseated).toEqual([]);
    expect(body.seating.tables[2]).toMatchObject({ tableNumber: 3, seatCount: 10, shape: "oval", status: "active" });
    expect(body.seating.advisor.advice).toEqual([]);

    const moved = body.moves.filter((move) => move.from !== null).map((move) => move.registrationId);
    const released = await testDb().select().from(tournamentSeats).where(and(eq(tournamentSeats.tournamentId, room.tournament.id)));
    expect(released.filter((row) => row.releasedAt !== null).map((row) => [row.registrationId, row.releaseReason]).sort()).toEqual(moved.map((id) => [id, "balanced"]).sort());

    const [entry] = await testDb().select().from(activityLog).where(and(eq(activityLog.tournamentId, room.tournament.id), eq(activityLog.eventType, "table_opened")));
    expect(entry.description).toBe("Opened Table 3: 1 player seated, 6 moved");
    expect(JSON.parse(entry.eventData ?? "{}")).toMatchObject({ tableNumber: 3, seated: 1, moved: 6, sizes: [7, 7, 7], moves: body.moves, undo: { versionAfter: body.seating.version, archivedTableIds: [] } });
    expect(body.seating.lastChange).toMatchObject({ eventType: "table_opened", canUndo: true });
  });

  it("applied twice at once with the same version: one opens the table, the other is told the seating changed (409 STALE_PLAN)", async () => {
    const room = await fullRoom();
    const { version } = await seatingOf(room.td, room.tournament.id);

    const responses = await Promise.all([
      room.td.post(path(room.tournament.id, "seating/open-table")).send({ expectedVersion: version }),
      room.staff.owner.agent.post(path(room.tournament.id, "seating/open-table")).send({ expectedVersion: version }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const refused = responses.find((response) => response.status === 409);
    expect(refused?.body).toMatchObject({ code: "STALE_PLAN", details: { seating: { version: expect.any(String) } } });
    expect(await testDb().select().from(tournamentTables).where(eq(tournamentTables.tournamentId, room.tournament.id))).toHaveLength(3);
  });

  it("can be undone: the moved players go back, the new arrivals wait again, and the new table stays, empty", async () => {
    const room = await fullRoom({ seats: 6, waiting: 2 });
    const before = await seatingOf(room.td, room.tournament.id);
    const opened = (await room.td.post(path(room.tournament.id, "seating/open-table")).send({ expectedVersion: before.version })).body as SeatingMutationDto;
    expect(occupancy(opened.seating)).toEqual([5, 5, 4]);

    const undo = await room.td.post(path(room.tournament.id, "seating/undo")).send({ activityId: opened.seating.lastChange?.activityId, expectedVersion: opened.seating.version });

    expect(undo.status).toBe(200);
    const after = (undo.body as SeatingMutationDto).seating;
    expect(occupancy(after)).toEqual([6, 6, 0]);
    expect(after.seatByRegistrationId).toEqual(before.seatByRegistrationId);
    expect(after.unseated.map((entry) => entry.registrationId).sort()).toEqual(room.late.map((r) => r.id).sort());
  });

  it("takes the seats and shape from the seating settings, or the ones sent", async () => {
    const room = await fullRoom({ seats: 9, tournament: { seatsPerTable: 9, tableShape: "rectangle" } });
    const { version } = await seatingOf(room.td, room.tournament.id);

    const first = (await room.td.post(path(room.tournament.id, "seating/open-table")).send({ expectedVersion: version })).body as SeatingMutationDto;
    const second = await room.td.post(path(room.tournament.id, "seating/open-table")).send({ expectedVersion: first.seating.version, seatCount: 6, shape: "round" });

    expect(first.seating.tables[2]).toMatchObject({ tableNumber: 3, seatCount: 9, shape: "rectangle" });
    expect(second.status).toBe(201);
    expect((second.body as SeatingMutationDto).seating.tables[3]).toMatchObject({ tableNumber: 4, seatCount: 6, shape: "round" });
    const rows = await testDb().select().from(tournamentTables).where(eq(tournamentTables.tournamentId, room.tournament.id));
    expect(rows.map((row) => [row.tableNumber, row.shape]).sort()).toEqual([[1, null], [2, null], [3, "rectangle"], [4, "round"]]);
  });

  it("needs the seating version the advice was shown with (400), and refuses a changed seating (409 STALE_PLAN)", async () => {
    const room = await fullRoom();

    const without = await room.td.post(path(room.tournament.id, "seating/open-table")).send({});
    const stale = await room.td.post(path(room.tournament.id, "seating/open-table")).send({ expectedVersion: "00000000" });

    expect(without.status).toBe(400);
    expect(without.body).toMatchObject({ code: "VALIDATION" });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ code: "STALE_PLAN" });
  });

  it("is refused past 50 tables in play (409 TABLE_LIMIT) and once the tournament is over (409 TOURNAMENT_CLOSED)", async () => {
    const staff = await clubWithStaff();
    const busy = await createTournament({ clubId: staff.club.id, status: "in_progress" });
    for (let number = 1; number <= 50; number++) await createTable({ tournamentId: busy.id, tableNumber: number, seatCount: 2 });
    const over = await createTournament({ clubId: staff.club.id, status: "completed" });

    const { version } = await seatingOf(staff.manager.agent, busy.id);
    const limit = await staff.manager.agent.post(path(busy.id, "seating/open-table")).send({ expectedVersion: version });
    const closed = await staff.manager.agent.post(path(over.id, "seating/open-table")).send({ expectedVersion: "00000000" });

    expect(limit.status).toBe(409);
    expect(limit.body).toMatchObject({ code: "TABLE_LIMIT" });
    expect(closed.status).toBe(409);
    expect(closed.body).toMatchObject({ code: "TOURNAMENT_CLOSED" });
  });

  it("with nobody waiting opens the table and evens out the room (the TD asked for it)", async () => {
    const room = await fullRoom({ seats: 6, waiting: 0 });
    const { version } = await seatingOf(room.td, room.tournament.id);

    const response = await room.td.post(path(room.tournament.id, "seating/open-table")).send({ expectedVersion: version });

    expect(occupancy((response.body as SeatingMutationDto).seating)).toEqual([4, 4, 4]);
    const active = await testDb().select().from(tournamentSeats).where(and(eq(tournamentSeats.tournamentId, room.tournament.id), isNull(tournamentSeats.releasedAt)));
    expect(new Set(active.map((row) => `${row.tableId}:${row.seatNumber}`)).size).toBe(12);
  });
});
