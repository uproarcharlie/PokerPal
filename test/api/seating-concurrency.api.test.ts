/**
 * Seating under races (phase4-contracts §3.1 rule 1, §5): two taps, or two devices, at once. Every
 * write locks the tournament first, so they run one after the other and the second plans against the
 * first's result: a doubled draw seats nobody twice, two players sent to one seat get one 200 and one
 * SEAT_TAKEN, a bust racing a redraw leaves the busted player unseated. Behind the lock, the partial
 * unique indexes refuse a second active seat outright (409 SEAT_CONFLICT).
 */
import { and, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { SeatingDto, SeatingMutationDto } from "@shared/api/seating";
import { activityLog, tournamentSeats, tournamentTables, type TournamentRegistration } from "@shared/schema";
import { toHttpError } from "../../server/http/errors";
import { insertSeats } from "../../server/repositories/seating";
import { createTournament } from "../factories";
import { createSeat, createTable, registerPlayers } from "../factories/seating";
import { resetDb, testDb } from "../helpers";
import { clubWithStaff } from "../helpers/club-staff";

beforeEach(resetDb);

async function game(players: number) {
  const staff = await clubWithStaff();
  const tournament = await createTournament({ clubId: staff.club.id, status: "in_progress" });
  const registrations = await registerPlayers(
    tournament.id,
    Array.from({ length: players }, (_, i) => `Player ${i + 1}`),
  );
  return { staff, tournament, registrations, td: staff.manager.agent, owner: staff.owner.agent };
}

const path = (tournamentId: string, rest: string) => `/api/tournaments/${tournamentId}/${rest}`;

const activeSeats = (tournamentId: string) =>
  testDb().select().from(tournamentSeats).where(and(eq(tournamentSeats.tournamentId, tournamentId), isNull(tournamentSeats.releasedAt)));

/** Every registration given has exactly one active seat, and no two active seats are the same seat. */
async function expectEachSeatedOnce(tournamentId: string, registrations: readonly TournamentRegistration[]) {
  const rows = await activeSeats(tournamentId);
  expect(rows.map((row) => row.registrationId).sort()).toEqual(registrations.map((r) => r.id).sort());
  const spots = rows.map((row) => `${row.tableId}:${row.seatNumber}`);
  expect(new Set(spots).size).toBe(spots.length);
}

describe("two draws at once", () => {
  it("seat everyone exactly once: one does the draw, the other finds nobody left to seat", async () => {
    const { tournament, registrations, td, owner } = await game(20);
    await createTable({ tournamentId: tournament.id, tableNumber: 1 });
    await createTable({ tournamentId: tournament.id, tableNumber: 2 });
    await createTable({ tournamentId: tournament.id, tableNumber: 3 });

    const responses = await Promise.all([
      td.post(path(tournament.id, "seating/draw")).send({}),
      owner.post(path(tournament.id, "seating/draw")).send({}),
      td.post(path(tournament.id, "seating/draw")).send({}),
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
    expect(responses.map((response) => (response.body as SeatingMutationDto).moves.length).sort((a, b) => a - b)).toEqual([0, 0, 20]);
    await expectEachSeatedOnce(tournament.id, registrations);
    const drawn = await testDb().select().from(activityLog).where(and(eq(activityLog.tournamentId, tournament.id), eq(activityLog.eventType, "seating_drawn")));
    expect(drawn).toHaveLength(1);
  });

  it("of a one-tap setup: one sets up, the other is told the tables exist", async () => {
    const { tournament, registrations, td, owner } = await game(12);

    const responses = await Promise.all([
      td.post(path(tournament.id, "seating/setup")).send({}),
      owner.post(path(tournament.id, "seating/setup")).send({}),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(responses.find((response) => response.status === 409)?.body).toMatchObject({ code: "TABLES_EXIST" });
    expect(await testDb().select().from(tournamentTables).where(eq(tournamentTables.tournamentId, tournament.id))).toHaveLength(2);
    await expectEachSeatedOnce(tournament.id, registrations);
  });
});

describe("moves at once", () => {
  it("of two players to one empty seat: one gets it, the other is told it is taken", async () => {
    const { tournament, registrations, td, owner } = await game(2);
    const table = await createTable({ tournamentId: tournament.id, tableNumber: 1 });
    const to = (registration: TournamentRegistration) => ({ registrationId: registration.id, tableId: table.id, seatNumber: 5 });

    const responses = await Promise.all([
      td.post(path(tournament.id, "seating/assign")).send(to(registrations[0])),
      owner.post(path(tournament.id, "seating/assign")).send(to(registrations[1])),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const refused = responses.find((response) => response.status === 409);
    const winner = responses.find((response) => response.status === 200)?.body as SeatingMutationDto;
    expect(refused?.body).toMatchObject({ code: "SEAT_TAKEN", details: { occupantRegistrationId: winner.moves[0].registrationId } });
    const rows = await activeSeats(tournament.id);
    expect(rows.map((row) => [row.seatNumber, row.registrationId])).toEqual([[5, winner.moves[0].registrationId]]);
  });

  it("of one player to two seats: they end in exactly one of them", async () => {
    const { tournament, registrations, td, owner } = await game(1);
    const table = await createTable({ tournamentId: tournament.id, tableNumber: 1 });
    await createSeat({ tournamentId: tournament.id, tableId: table.id, registrationId: registrations[0].id, seatNumber: 1 });

    const responses = await Promise.all([
      td.post(path(tournament.id, "seating/assign")).send({ registrationId: registrations[0].id, tableId: table.id, seatNumber: 2 }),
      owner.post(path(tournament.id, "seating/assign")).send({ registrationId: registrations[0].id, tableId: table.id, seatNumber: 3 }),
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const rows = await activeSeats(tournament.id);
    expect(rows).toHaveLength(1);
    expect([2, 3]).toContain(rows[0].seatNumber);
    const history = await testDb().select().from(tournamentSeats).where(eq(tournamentSeats.registrationId, registrations[0].id));
    expect(history.filter((row) => row.releasedAt !== null).map((row) => row.releaseReason)).toEqual(["moved", "moved"]);
  });

  it("of a double-tapped swap: the players trade seats once", async () => {
    const { tournament, registrations, td } = await game(2);
    const table = await createTable({ tournamentId: tournament.id, tableNumber: 1 });
    await createSeat({ tournamentId: tournament.id, tableId: table.id, registrationId: registrations[0].id, seatNumber: 1 });
    await createSeat({ tournamentId: tournament.id, tableId: table.id, registrationId: registrations[1].id, seatNumber: 4 });
    const swap = { registrationId: registrations[0].id, tableId: table.id, seatNumber: 4, swap: true };

    const responses = await Promise.all([td.post(path(tournament.id, "seating/assign")).send(swap), td.post(path(tournament.id, "seating/assign")).send(swap)]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(responses.map((response) => (response.body as SeatingMutationDto).moves.length).sort()).toEqual([0, 2]);
    const seating = (await td.get(path(tournament.id, "seating"))).body as SeatingDto;
    expect(seating.seatByRegistrationId).toEqual({
      [registrations[0].id]: { tableNumber: 1, seatNumber: 4 },
      [registrations[1].id]: { tableNumber: 1, seatNumber: 1 },
    });
  });
});

describe("a bust racing a seating change", () => {
  it("leaves the busted player unseated and everyone else seated once, whichever runs first", async () => {
    const { tournament, registrations, td, owner } = await game(10);
    await createTable({ tournamentId: tournament.id, tableNumber: 1, seatCount: 6 });
    await createTable({ tournamentId: tournament.id, tableNumber: 2, seatCount: 6 });
    await td.post(path(tournament.id, "seating/draw")).send({});

    const responses = await Promise.all([
      owner.put(`/api/registrations/${registrations[0].id}`).send({ isEliminated: true }),
      td.post(path(tournament.id, "seating/draw")).send({ scope: "all" }),
      td.post(path(tournament.id, "seating/balance")).send({}),
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
    await expectEachSeatedOnce(tournament.id, registrations.slice(1));
  });
});

describe("the unique indexes behind the lock", () => {
  it("refuse a second active seat or a second seat for one player as 409 SEAT_CONFLICT", async () => {
    const { tournament, registrations } = await game(2);
    const table = await createTable({ tournamentId: tournament.id, tableNumber: 1 });
    await createSeat({ tournamentId: tournament.id, tableId: table.id, registrationId: registrations[0].id, seatNumber: 1 });

    const sameSeat = await insertSeats(testDb(), [{ tournamentId: tournament.id, tableId: table.id, registrationId: registrations[1].id, seatNumber: 1 }]).catch(
      (error: unknown) => error,
    );
    const secondSeat = await insertSeats(testDb(), [{ tournamentId: tournament.id, tableId: table.id, registrationId: registrations[0].id, seatNumber: 2 }]).catch(
      (error: unknown) => error,
    );

    for (const error of [sameSeat, secondSeat]) {
      expect(toHttpError(error)).toMatchObject({ status: 409, code: "SEAT_CONFLICT" });
    }
    expect(await activeSeats(tournament.id)).toHaveLength(1);
  });
});
