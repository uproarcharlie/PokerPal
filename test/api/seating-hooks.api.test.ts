/**
 * Seats follow the game (phase4-contracts §3.1 rule 6, spec D3): a bust, whichever way the TD records
 * it, releases the player's seat; undoing it, or a re-buy that brings them back, puts them back in the
 * seat they were busted from when it is still there and free, and otherwise leaves them waiting as
 * unseated. A seat a bust left held (a path that did not release it) is released by the next seating
 * write, and removing a registration takes its seats with it.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import type request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import type { SeatingDto, SeatingMutationDto } from "@shared/api/seating";
import {
  activityLog,
  pendingActions,
  tournamentRegistrations,
  tournamentSeats,
  tournamentTables,
  type TournamentRegistration,
  type TournamentTable,
} from "@shared/schema";
import { createTournament } from "../factories";
import { createSeat, createTable, registerPlayers } from "../factories/seating";
import { resetDb, testDb } from "../helpers";
import { clubWithStaff } from "../helpers/club-staff";

beforeEach(resetDb);

/** In play: Alice at Table 2 seat 4, Bob at Table 1 seat 1, Cara waiting; a $50 re-buy on sale. */
async function liveGame() {
  const staff = await clubWithStaff();
  const tournament = await createTournament({ clubId: staff.club.id, status: "in_progress", rebuyAmount: "50.00" });
  const [alice, bob, cara] = await registerPlayers(tournament.id, ["Alice", "Bob", "Cara"]);
  const tables = [await createTable({ tournamentId: tournament.id, tableNumber: 1 }), await createTable({ tournamentId: tournament.id, tableNumber: 2 })];
  await seat(tables[1], alice, 4);
  await seat(tables[0], bob, 1);
  return { staff, tournament, alice, bob, cara, tables, td: staff.manager.agent };
}

const seat = (table: TournamentTable, registration: TournamentRegistration, seatNumber: number) =>
  createSeat({ tournamentId: table.tournamentId, tableId: table.id, registrationId: registration.id, seatNumber });

const seatingOf = async (td: request.Agent, tournamentId: string) =>
  (await td.get(`/api/tournaments/${tournamentId}/seating`)).body as SeatingDto;

const seatRowsOf = (registrationId: string) =>
  testDb().select().from(tournamentSeats).where(eq(tournamentSeats.registrationId, registrationId)).orderBy(asc(tournamentSeats.assignedAt));

async function activity(tournamentId: string) {
  const rows = await testDb().select().from(activityLog).where(eq(activityLog.tournamentId, tournamentId)).orderBy(asc(activityLog.timestamp));
  return rows.map(({ eventType, description }) => [eventType, description]);
}

const bust = (td: request.Agent, registration: TournamentRegistration, eliminatedBy?: string) =>
  td.put(`/api/registrations/${registration.id}`).send(eliminatedBy ? { isEliminated: true, eliminatedBy } : { isEliminated: true });
const unbust = (td: request.Agent, registration: TournamentRegistration) =>
  td.put(`/api/registrations/${registration.id}`).send({ isEliminated: false });

describe("a bust", () => {
  it("releases the player's seat as eliminated, logging only the elimination", async () => {
    const game = await liveGame();
    const { tournament, alice, bob, td } = game;

    const response = await bust(td, alice, bob.playerId);

    expect(response.status).toBe(200);
    expect((await seatRowsOf(alice.id)).map((row) => [row.seatNumber, row.releaseReason, row.releasedAt !== null])).toEqual([[4, "eliminated", true]]);
    const seating = await seatingOf(td, tournament.id);
    expect(seating.seatByRegistrationId[alice.id]).toBeUndefined();
    expect(seating.tables[1].seats[3]).toMatchObject({ seatNumber: 4, registrationId: null });
    expect(await activity(tournament.id)).toEqual([["elimination", "Alice was eliminated by Bob"]]);
  });

  it("confirmed from a player's knockout claim releases the seat too", async () => {
    const game = await liveGame();
    const { tournament, alice, bob, td } = game;
    const [claim] = await testDb()
      .insert(pendingActions)
      .values({ tournamentId: tournament.id, playerId: bob.playerId, actionType: "knockout", targetPlayerId: alice.playerId })
      .returning();

    const response = await td.post(`/api/pending-actions/${claim.id}/confirm`).send({});

    expect(response.status).toBe(200);
    expect((await seatRowsOf(alice.id)).map((row) => row.releaseReason)).toEqual(["eliminated"]);
  });

  it("of a player with no seat changes no seat", async () => {
    const game = await liveGame();
    const { tournament, cara, td } = game;

    expect((await bust(td, cara)).status).toBe(200);
    expect(await seatRowsOf(cara.id)).toEqual([]);
    expect((await seatingOf(td, tournament.id)).stats).toMatchObject({ activePlayers: 2, seated: 2, unseated: 0 });
  });
});

describe("an undone bust", () => {
  it("puts the player back in the seat they were busted from", async () => {
    const game = await liveGame();
    const { tournament, alice, td } = game;
    await bust(td, alice);

    const response = await unbust(td, alice);

    expect(response.status).toBe(200);
    expect((await seatingOf(td, tournament.id)).seatByRegistrationId[alice.id]).toEqual({ tableNumber: 2, seatNumber: 4 });
    const rows = await seatRowsOf(alice.id);
    expect(rows.map((row) => [row.seatNumber, row.releaseReason])).toEqual([[4, "eliminated"], [4, null]]);
    expect(rows[1].assignedBy).toBeNull();
    expect(await activity(tournament.id)).toEqual([
      ["elimination", "Alice was eliminated"],
      ["player_restored", "Alice was restored to active"],
      ["seat_assigned", "Alice is back at Table 2, Seat 4"],
    ]);
    const [entry] = await testDb()
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.tournamentId, tournament.id), eq(activityLog.eventType, "seat_assigned")));
    expect(entry.playerId).toBe(alice.playerId);
  });

  it("leaves the player waiting when someone took the seat meanwhile", async () => {
    const game = await liveGame();
    const { tournament, alice, cara, tables, td } = game;
    await bust(td, alice);
    await td.post(`/api/tournaments/${tournament.id}/seating/assign`).send({ registrationId: cara.id, tableId: tables[1].id, seatNumber: 4 });

    await unbust(td, alice);

    const seating = await seatingOf(td, tournament.id);
    expect(seating.seatByRegistrationId[alice.id]).toBeUndefined();
    expect(seating.seatByRegistrationId[cara.id]).toEqual({ tableNumber: 2, seatNumber: 4 });
    expect(seating.unseated.map((entry) => entry.registrationId)).toEqual([alice.id]);
    expect((await activity(tournament.id)).slice(-2)).toEqual([
      ["seat_assigned", "Cara seated at Table 2, Seat 4"],
      ["player_restored", "Alice was restored to active"],
    ]);
  });

  it("leaves the player waiting when the table was broken or the seat no longer exists", async () => {
    const broken = await liveGame();
    await bust(broken.td, broken.alice);
    await broken.td.post(`/api/tournaments/${broken.tournament.id}/tables/${broken.tables[1].id}/break`).send({});
    await unbust(broken.td, broken.alice);

    const shrunk = await liveGame();
    await bust(shrunk.td, shrunk.alice);
    await shrunk.td.patch(`/api/tournaments/${shrunk.tournament.id}/tables/${shrunk.tables[1].id}`).send({ seatCount: 3 });
    await unbust(shrunk.td, shrunk.alice);

    for (const game of [broken, shrunk]) {
      const seating = await seatingOf(game.td, game.tournament.id);
      expect(seating.seatByRegistrationId[game.alice.id]).toBeUndefined();
      expect(seating.unseated.map((entry) => entry.registrationId)).toContain(game.alice.id);
    }
  });

  it("does not take back a seat the player had left before they were busted", async () => {
    const game = await liveGame();
    const { tournament, alice, td } = game;
    await td.post(`/api/tournaments/${tournament.id}/seating/unseat`).send({ registrationId: alice.id });
    await bust(td, alice);

    await unbust(td, alice);

    expect((await seatingOf(td, tournament.id)).seatByRegistrationId[alice.id]).toBeUndefined();
    expect((await seatRowsOf(alice.id)).map((row) => row.releaseReason)).toEqual(["unseated"]);
  });

  it("finds the seat even when a bust left another player's seat held", async () => {
    const game = await liveGame();
    const { tournament, alice, bob, td } = game;
    await bust(td, alice);
    // Bob is marked out by a path that left his seat held; Alice's own seat is still free.
    await testDb().update(tournamentRegistrations).set({ isEliminated: true }).where(eq(tournamentRegistrations.id, bob.id));

    await unbust(td, alice);

    expect((await seatingOf(td, tournament.id)).seatByRegistrationId).toEqual({ [alice.id]: { tableNumber: 2, seatNumber: 4 } });
    expect((await seatRowsOf(bob.id)).map((row) => row.releaseReason)).toEqual(["eliminated"]);
  });
});

describe("a re-buy that brings a busted player back", () => {
  it("puts them back in their seat", async () => {
    const game = await liveGame();
    const { tournament, alice, td } = game;
    await bust(td, alice);

    const response = await td.post(`/api/registrations/${alice.id}/counts`).send({ rebuys: 1 });

    expect(response.status).toBe(200);
    expect((await seatingOf(td, tournament.id)).seatByRegistrationId[alice.id]).toEqual({ tableNumber: 2, seatNumber: 4 });
    expect((await activity(tournament.id)).slice(-3)).toEqual([
      ["rebuy", "Alice made 1 re-buy"],
      ["reentry", "Alice is back in with a re-buy"],
      ["seat_assigned", "Alice is back at Table 2, Seat 4"],
    ]);
  });

  it("of a player who is still in changes no seat", async () => {
    const game = await liveGame();
    const { alice, td } = game;

    await td.post(`/api/registrations/${alice.id}/counts`).send({ rebuys: 1 });

    expect((await seatRowsOf(alice.id)).map((row) => row.releaseReason)).toEqual([null]);
  });
});

describe("seats left held", () => {
  it("are released by the next seating write, so the seat can be drawn again", async () => {
    const staff = await clubWithStaff();
    const tournament = await createTournament({ clubId: staff.club.id, status: "in_progress" });
    const [gone, waiting] = await registerPlayers(tournament.id, ["Gone", "Waiting"]);
    const table = await createTable({ tournamentId: tournament.id, tableNumber: 1, seatCount: 2 });
    const broken = await createTable({ tournamentId: tournament.id, tableNumber: 2, status: "broken" });
    await seat(table, gone, 1);
    const [extra] = await registerPlayers(tournament.id, ["Extra"]);
    await seat(table, extra, 2);
    await seat(broken, waiting, 1);
    await testDb().update(tournamentRegistrations).set({ isEliminated: true }).where(eq(tournamentRegistrations.id, gone.id));

    const response = await staff.manager.agent.post(`/api/tournaments/${tournament.id}/seating/draw`).send({});

    expect(response.status).toBe(200);
    expect((response.body as SeatingMutationDto).seating.seatByRegistrationId).toEqual({
      [extra.id]: { tableNumber: 1, seatNumber: 2 },
      [waiting.id]: { tableNumber: 1, seatNumber: 1 },
    });
    expect((await seatRowsOf(gone.id)).map((row) => row.releaseReason)).toEqual(["eliminated"]);
    expect((await seatRowsOf(waiting.id)).map((row) => row.releaseReason)).toEqual(["table_broken", null]);
    const activeOnBroken = await testDb()
      .select()
      .from(tournamentSeats)
      .where(and(eq(tournamentSeats.tableId, broken.id), isNull(tournamentSeats.releasedAt)));
    expect(activeOnBroken).toEqual([]);
  });
});

describe("removing a registration", () => {
  it("takes its seats with it", async () => {
    const game = await liveGame();
    const { tournament, cara, tables, td } = game;
    await td.post(`/api/tournaments/${tournament.id}/seating/assign`).send({ registrationId: cara.id, tableId: tables[0].id, seatNumber: 2 });

    const response = await td.delete(`/api/registrations/${cara.id}`);

    expect(response.status).toBe(204);
    expect(await seatRowsOf(cara.id)).toEqual([]);
    expect((await seatingOf(td, tournament.id)).tables[0].seats[1]).toMatchObject({ registrationId: null });
    expect(await testDb().select().from(tournamentTables).where(eq(tournamentTables.tournamentId, tournament.id))).toHaveLength(2);
  });
});
