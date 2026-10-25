/**
 * Auto-seat (round 5, item 9; round5-contracts §3.2 rule 3): once a tournament has tables in play,
 * every new registration, QR sign-up or desk, is seated inside the registration's own transaction at
 * the table with the fewest players, in a random empty seat, so tables stay balanced as players roll
 * in. "Once they've paid" seats them as their payment is confirmed; "off" leaves them to the TD. With
 * every seat taken the player waits and the TD is told ("seat_waiting", staff-only). Sign-ups on the
 * waiting list (past max players, not accepted) are seated once accepted. Two sign-ups at once never
 * take one seat.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { ActivityDto } from "@shared/api/public";
import type { PaymentConfirmedDto, RegistrationCreatedDto } from "@shared/api/registrations";
import type { SeatingDto } from "@shared/api/seating";
import { activityLog, tournamentRegistrations, tournamentSeats, type Tournament, type TournamentRegistration, type TournamentTable } from "@shared/schema";
import { createPlayer, createTournament, type NewTournament } from "../factories";
import { createSeat, createTable, registerPlayers } from "../factories/seating";
import { anon, resetDb, testDb } from "../helpers";
import { clubWithStaff } from "../helpers/club-staff";
import { signUpTokenFor } from "../helpers/sign-up";

beforeEach(resetDb);

async function game({ tables = [9], players = 0, tournament: overrides = {} }: { tables?: number[]; players?: number; tournament?: Partial<NewTournament> } = {}) {
  const staff = await clubWithStaff();
  const tournament = await createTournament({ clubId: staff.club.id, status: "in_progress", ...overrides });
  const created: TournamentTable[] = [];
  for (let index = 0; index < tables.length; index++) {
    const seatCount = tables[index];
    created.push(await createTable({ tournamentId: tournament.id, tableNumber: index + 1, seatCount }));
  }
  const registrations = await registerPlayers(tournament.id, Array.from({ length: players }, (_, i) => `Seated ${i + 1}`));
  return { staff, tournament, tables: created, registrations, td: staff.manager.agent };
}

/** Seats `registrations` at `table`, in seats 1, 2, 3… */
async function seatInOrder(table: TournamentTable, registrations: readonly TournamentRegistration[]) {
  for (let index = 0; index < registrations.length; index++) {
    await createSeat({ tournamentId: table.tournamentId, tableId: table.id, registrationId: registrations[index].id, seatNumber: index + 1 });
  }
}

/** The QR page's sign-up of a new player (they typed their details in: POST /api/players gave a token). */
async function qrSignUp(tournament: Pick<Tournament, "id">, name: string) {
  const player = await createPlayer({ name });
  return (await anon()).post(`/api/tournaments/${tournament.id}/registrations`).send({ playerId: player.id, signUpToken: signUpTokenFor(player.id) });
}

const seatingOf = async (game: { td: { get: (path: string) => PromiseLike<{ body: unknown }> }; tournament: Tournament }) =>
  (await game.td.get(`/api/tournaments/${game.tournament.id}/seating`)).body as SeatingDto;

const activeSeats = (tournamentId: string) =>
  testDb().select().from(tournamentSeats).where(and(eq(tournamentSeats.tournamentId, tournamentId), isNull(tournamentSeats.releasedAt)));

async function activity(tournamentId: string) {
  const rows = await testDb().select().from(activityLog).where(eq(activityLog.tournamentId, tournamentId)).orderBy(asc(activityLog.timestamp));
  return rows.map(({ eventType, description, eventData }) => ({ eventType, description, data: eventData ? (JSON.parse(eventData) as Record<string, unknown>) : null }));
}

const occupancy = (seating: SeatingDto) => seating.tables.filter((table) => table.status === "active").map((table) => table.occupied);

describe("a QR sign-up while tables are in play", () => {
  it("is seated in the same transaction, answered with the seat, recorded as the app's and logged as an auto seat", async () => {
    const world = await game({ tables: [9] });

    const response = await qrSignUp(world.tournament, "Test Player 16");

    expect(response.status).toBe(201);
    const body = response.body as RegistrationCreatedDto;
    expect(body.seating).toMatchObject({ status: "seated", seat: { tableId: world.tables[0].id, tableNumber: 1, tableName: "Table 1" } });
    const seatNumber = body.seating.status === "seated" ? body.seating.seat.seatNumber : 0;
    expect(seatNumber).toBeGreaterThanOrEqual(1);
    expect(seatNumber).toBeLessThanOrEqual(9);
    const [row] = await activeSeats(world.tournament.id);
    expect(row).toMatchObject({ registrationId: body.id, tableId: world.tables[0].id, seatNumber, assignedBy: null });
    expect((await activity(world.tournament.id)).slice(-2)).toEqual([
      { eventType: "registration", description: "Test Player 16 registered for the tournament", data: null },
      {
        eventType: "seat_assigned",
        description: `Test Player 16 seated at Table 1, Seat ${seatNumber}`,
        data: { registrationId: body.id, from: null, to: { tableNumber: 1, seatNumber }, tableNumber: 1, seatNumber, auto: true },
      },
    ]);
    // The seat finder and the TV's seats show them at once.
    const finder = (await (await anon()).get(`/api/public/tournaments/${world.tournament.id}/seating`)).body as { players: Array<{ player: { name: string }; seatNumber: number }> };
    expect(finder.players).toEqual([expect.objectContaining({ player: expect.objectContaining({ name: "Test Player 16" }), seatNumber })]);
  });

  it("goes to the open table with the fewest players", async () => {
    const world = await game({ tables: [9, 9], players: 4 });
    for (let index = 0; index < world.registrations.length; index++) {
      const registration = world.registrations[index];
      await createSeat({ tournamentId: world.tournament.id, tableId: world.tables[index < 3 ? 0 : 1].id, registrationId: registration.id, seatNumber: index + 1 });
    }

    const response = await qrSignUp(world.tournament, "Late Larry");

    expect((response.body as RegistrationCreatedDto).seating).toMatchObject({ status: "seated", seat: { tableNumber: 2 } });
    expect(occupancy(await seatingOf(world))).toEqual([3, 2]);
  });

  it("keeps the tables within one player of each other over 20 sign-ups, and never seats two players in one seat", async () => {
    const world = await game({ tables: [9, 9, 9] });

    for (let i = 1; i <= 20; i++) {
      const response = await qrSignUp(world.tournament, `Arrival ${i}`);
      expect((response.body as RegistrationCreatedDto).seating.status).toBe("seated");
      const counts = occupancy(await seatingOf(world));
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    }
    const rows = await activeSeats(world.tournament.id);
    expect(rows).toHaveLength(20);
    expect(new Set(rows.map((row) => `${row.tableId}:${row.seatNumber}`)).size).toBe(20);
  });

  it("at a desk (staff) is seated too, and the staff answer says so", async () => {
    const world = await game({ tables: [6] });
    const player = await createPlayer({ name: "Desk Dana" });

    const response = await world.td.post(`/api/tournaments/${world.tournament.id}/registrations`).send({ playerId: player.id, paymentConfirmed: true });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ paymentConfirmed: true, seating: { status: "seated", seat: { tableNumber: 1 } } });
  });
});

describe("when nobody can be seated", () => {
  it("before any table is in play, the player waits (setup seats them) and nothing is logged about a seat", async () => {
    const world = await game({ tables: [] });

    const response = await qrSignUp(world.tournament, "Early Eve");

    expect((response.body as RegistrationCreatedDto).seating).toEqual({ status: "waiting", reason: "no_tables" });
    expect((await activity(world.tournament.id)).map((entry) => entry.eventType)).toEqual(["registration"]);
  });

  it("with every seat taken, the player waits, the TD is told (staff-only), and the advisor says to open a table", async () => {
    const world = await game({ tables: [2], players: 2 });
    await seatInOrder(world.tables[0], world.registrations);

    const response = await qrSignUp(world.tournament, "Test Player 17");

    expect((response.body as RegistrationCreatedDto).seating).toEqual({ status: "waiting", reason: "tables_full" });
    expect((await activity(world.tournament.id)).at(-1)).toMatchObject({
      eventType: "seat_waiting",
      description: "Test Player 17 is waiting for a seat: every table is full",
    });
    const seating = await seatingOf(world);
    expect(seating.unseated.map((entry) => entry.player.name)).toEqual(["Test Player 17"]);
    expect(seating.advisor.advice[0]).toMatchObject({ kind: "open_table", tableNumber: 2 });
    const publicFeed = (await (await anon()).get(`/api/tournaments/${world.tournament.id}/activity`)).body as ActivityDto[];
    expect(publicFeed.map((entry) => entry.eventType)).not.toContain("seat_waiting");
    const staffFeed = (await world.td.get(`/api/tournaments/${world.tournament.id}/activity`)).body as ActivityDto[];
    expect(staffFeed.map((entry) => entry.eventType)).toContain("seat_waiting");
  });

  it("two QR sign-ups at once for the last open seat: one is seated, the other waits; no seat taken twice, no error", async () => {
    const world = await game({ tables: [3], players: 2 });
    await seatInOrder(world.tables[0], world.registrations);

    const responses = await Promise.all([qrSignUp(world.tournament, "Racer One"), qrSignUp(world.tournament, "Racer Two")]);

    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    const outcomes = responses.map((response) => (response.body as RegistrationCreatedDto).seating);
    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(["seated", "waiting"]);
    expect(outcomes).toContainEqual({ status: "waiting", reason: "tables_full" });
    expect(outcomes).toContainEqual(expect.objectContaining({ status: "seated", seat: expect.objectContaining({ seatNumber: 3 }) }));
    const rows = await activeSeats(world.tournament.id);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.seatNumber)).size).toBe(3);
  });

  it("many QR sign-ups at once fill every open seat exactly once and leave the rest waiting", async () => {
    const world = await game({ tables: [4, 4] });

    const responses = await Promise.all(Array.from({ length: 11 }, (_, i) => qrSignUp(world.tournament, `Rush ${i + 1}`)));

    expect(responses.every((response) => response.status === 201)).toBe(true);
    const statuses = responses.map((response) => (response.body as RegistrationCreatedDto).seating.status);
    expect(statuses.filter((status) => status === "seated")).toHaveLength(8);
    const rows = await activeSeats(world.tournament.id);
    expect(new Set(rows.map((row) => `${row.tableId}:${row.seatNumber}`)).size).toBe(8);
    expect(occupancy(await seatingOf(world))).toEqual([4, 4]);
    expect((await activity(world.tournament.id)).filter((entry) => entry.eventType === "seat_waiting")).toHaveLength(3);
  });
});

describe("the tournament's auto-seat setting", () => {
  it("“once they've paid”: a QR sign-up waits, and is seated as the desk confirms the payment (once)", async () => {
    const world = await game({ tables: [9], tournament: { autoSeat: "once_paid" } });

    const signUp = await qrSignUp(world.tournament, "Paying Pat");
    const id = (signUp.body as RegistrationCreatedDto).id;
    const confirm = await world.td.patch(`/api/registrations/${id}/confirm-payment`);
    const again = await world.td.patch(`/api/registrations/${id}/confirm-payment`);

    expect((signUp.body as RegistrationCreatedDto).seating).toEqual({ status: "waiting", reason: "awaiting_payment" });
    expect(confirm.status).toBe(200);
    expect((confirm.body as PaymentConfirmedDto).seating).toMatchObject({ status: "seated", seat: { tableNumber: 1 } });
    expect((again.body as PaymentConfirmedDto).seating).toBeNull();
    expect(await activeSeats(world.tournament.id)).toHaveLength(1);
    expect((await activity(world.tournament.id)).map((entry) => entry.eventType)).toEqual(["registration", "payment_confirmed", "seat_assigned"]);
  });

  it("“once they've paid”: a desk registration marked paid is seated straight away", async () => {
    const world = await game({ tables: [9], tournament: { autoSeat: "once_paid" } });
    const player = await createPlayer({ name: "Cash Carl" });

    const response = await world.td.post(`/api/tournaments/${world.tournament.id}/registrations`).send({ playerId: player.id, paymentConfirmed: true });

    expect((response.body as RegistrationCreatedDto).seating).toMatchObject({ status: "seated" });
  });

  it("“once they've paid” with every table full: the payment is confirmed, the player waits and the TD is told", async () => {
    const world = await game({ tables: [2], players: 2, tournament: { autoSeat: "once_paid" } });
    await seatInOrder(world.tables[0], world.registrations);
    const id = ((await qrSignUp(world.tournament, "Full Fran")).body as RegistrationCreatedDto).id;

    const confirm = await world.td.patch(`/api/registrations/${id}/confirm-payment`);

    expect((confirm.body as PaymentConfirmedDto).seating).toEqual({ status: "waiting", reason: "tables_full" });
    expect((await activity(world.tournament.id)).at(-1)).toMatchObject({ eventType: "seat_waiting" });
  });

  it("“off”: nobody is seated automatically, not even on payment", async () => {
    const world = await game({ tables: [9], tournament: { autoSeat: "off" } });

    const signUp = await qrSignUp(world.tournament, "Manual Max");
    const confirm = await world.td.patch(`/api/registrations/${(signUp.body as RegistrationCreatedDto).id}/confirm-payment`);

    expect((signUp.body as RegistrationCreatedDto).seating).toEqual({ status: "waiting", reason: "off" });
    expect((confirm.body as PaymentConfirmedDto).seating).toBeNull();
    expect(await activeSeats(world.tournament.id)).toHaveLength(0);
  });

  it("“when they register”: confirming the payment of a player left out of a paid-players-only draw seats them", async () => {
    const world = await game({ tables: [9], players: 1 });
    await testDb().update(tournamentRegistrations).set({ paymentConfirmed: false }).where(eq(tournamentRegistrations.id, world.registrations[0].id));

    const confirm = await world.td.patch(`/api/registrations/${world.registrations[0].id}/confirm-payment`);

    expect((confirm.body as PaymentConfirmedDto).seating).toMatchObject({ status: "seated", seat: { tableNumber: 1 } });
  });

  it("never seats anyone in a tournament that is over (a payment reconciled afterwards)", async () => {
    const world = await game({ tables: [9], players: 1, tournament: { autoSeat: "once_paid" } });
    await testDb().update(tournamentRegistrations).set({ paymentConfirmed: false }).where(eq(tournamentRegistrations.id, world.registrations[0].id));
    await world.td.put(`/api/tournaments/${world.tournament.id}`).send({ status: "cancelled" });

    const confirm = await world.td.patch(`/api/registrations/${world.registrations[0].id}/confirm-payment`);

    expect(confirm.status).toBe(200);
    expect((confirm.body as PaymentConfirmedDto).seating).toBeNull();
    expect(await activeSeats(world.tournament.id)).toHaveLength(0);
  });
});

describe("max players (items 12 and 15)", () => {
  it("an unpaid entry beyond max players is not seated, the advisor plans no seat for them, and they are flagged", async () => {
    const world = await game({ tables: [9], players: 4, tournament: { maxPlayers: 4 } });
    const player = await createPlayer({ name: "Extra Ed" });

    const response = await world.td.post(`/api/tournaments/${world.tournament.id}/registrations`).send({ playerId: player.id });

    const body = response.body as RegistrationCreatedDto;
    expect(body.seating).toEqual({ status: "waiting", reason: "awaiting_payment" });
    const seating = await seatingOf(world);
    // The four paid players sit (they were drawn before); the extra is waiting but not counted.
    expect(seating.advisor).toMatchObject({ overCapacity: 1, waiting: 4 });
    expect(seating.advisor.advice).toEqual([expect.objectContaining({ kind: "seat_waiting", players: 4 })]);
  });

  it("the waiting list behind a full field does not make the advisor open a table", async () => {
    const world = await game({ tables: [2], players: 2, tournament: { maxPlayers: 2 } });
    await seatInOrder(world.tables[0], world.registrations);
    const player = await createPlayer({ name: "Queued Quinn" });

    await world.td.post(`/api/tournaments/${world.tournament.id}/registrations`).send({ playerId: player.id });

    const seating = await seatingOf(world);
    // On the waiting list, not waiting for a seat: nobody seats them until they are accepted.
    expect(seating.unseated).toEqual([]);
    expect(seating.advisor).toMatchObject({ overCapacity: 1, waiting: 0, advice: [] });
  });
});

describe("a player coming back into play", () => {
  it("re-entering with a re-buy, their seat taken, is auto-seated elsewhere and logged as back in", async () => {
    const world = await game({ tables: [9, 9], players: 2, tournament: { rebuyAmount: "50.00" } });
    const [alice, bob] = world.registrations;
    await createSeat({ tournamentId: world.tournament.id, tableId: world.tables[0].id, registrationId: alice.id, seatNumber: 4 });
    await createSeat({ tournamentId: world.tournament.id, tableId: world.tables[1].id, registrationId: bob.id, seatNumber: 1 });
    await world.td.put(`/api/registrations/${alice.id}`).send({ isEliminated: true });
    const taker = ((await qrSignUp(world.tournament, "Seat Taker")).body as RegistrationCreatedDto).id;
    await world.td.post(`/api/tournaments/${world.tournament.id}/seating/assign`).send({ registrationId: taker, tableId: world.tables[0].id, seatNumber: 4 });

    const response = await world.td.post(`/api/registrations/${alice.id}/counts`).send({ rebuys: 1 });

    expect(response.status).toBe(200);
    const spot = (await seatingOf(world)).seatByRegistrationId[alice.id];
    expect(spot).toBeDefined();
    expect(`${spot.tableNumber}:${spot.seatNumber}`).not.toBe("1:4");
    expect((await activity(world.tournament.id)).at(-1)).toMatchObject({
      eventType: "seat_assigned",
      description: `Seated 1 is back in, seated at Table ${spot.tableNumber}, Seat ${spot.seatNumber}`,
      data: expect.objectContaining({ auto: true }),
    });
  });
});
