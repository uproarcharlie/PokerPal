/**
 * Max players caps the players a tournament ACCEPTS, never its sign-ups (round 5, item 15; the
 * owner: "you can have more than the max entries but the admin should not be able to accept more
 * than the max"). Sign-ups past it are a numbered waiting list; accepting (confirming a payment, or
 * anything else that puts a waiting-list entry in the field) is 409 TOURNAMENT_FULL once Max players
 * are in, for owners and admins alike, with no override. The waiting list is not seated and not
 * counted in the prize pool, the TV's figures or finalize (R5REV-HOST-05).
 */
import { and, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { PaymentConfirmedDto, RegistrationCreatedDto } from "@shared/api/registrations";
import type { SeatingDto } from "@shared/api/seating";
import type { TournamentListItemDto } from "@shared/api/tournaments";
import { tournamentRegistrations, tournaments, tournamentSeats, type Tournament, type TournamentRegistration } from "@shared/schema";
import { createPlayer, createRegistration, createTournament, type NewTournament } from "../factories";
import { createSeat, createTable } from "../factories/seating";
import { anon, resetDb, signIn, testDb } from "../helpers";
import { clubWithStaff } from "../helpers/club-staff";
import { signUpTokenFor } from "../helpers/sign-up";

beforeEach(resetDb);

const FULL_MESSAGE = "2 of 2 players accepted: raise Max players to accept more";

/** A 2-player tournament at the owner's club: Alice and Bob accepted (paid), then `late` sign-ups a minute apart. */
async function fullField(late: string[] = ["Carol"], overrides: Partial<NewTournament> = {}) {
  const staff = await clubWithStaff();
  const tournament = await createTournament({ clubId: staff.club.id, status: "in_progress", maxPlayers: 2, buyInAmount: "50.00", rebuyAmount: "20.00", ...overrides });
  const at = (minute: number) => new Date(Date.UTC(2026, 9, 25, 7, minute));
  const entry = async (name: string, minute: number, paid: boolean) =>
    createRegistration({ tournamentId: tournament.id, playerId: (await createPlayer({ name })).id, paymentConfirmed: paid, registrationTime: at(minute) });
  const accepted = [await entry("Alice", 0, true), await entry("Bob", 1, true)];
  const waiting: TournamentRegistration[] = [];
  for (let index = 0; index < late.length; index++) waiting.push(await entry(late[index], 2 + index, false));
  return { staff, tournament, accepted, waiting, owner: staff.owner.agent, td: staff.manager.agent };
}

const row = async (id: string) => (await testDb().select().from(tournamentRegistrations).where(eq(tournamentRegistrations.id, id)))[0];
const positions = async (tournament: Pick<Tournament, "id">) =>
  ((await (await anon()).get(`/api/tournaments/${tournament.id}/registrations`)).body as Array<{ waitingListPosition: number | null }>).map(
    (entry) => entry.waitingListPosition,
  );

describe("accepting a player past Max players (409 TOURNAMENT_FULL, no override)", () => {
  it("is refused at the payment desk for the club's owner, its manager and a platform admin", async () => {
    const { waiting, owner, td } = await fullField();
    const { agent: admin } = await signIn({ role: "admin" });

    for (const agent of [owner, td, admin]) {
      const response = await agent.patch(`/api/registrations/${waiting[0].id}/confirm-payment`);
      expect(response.status).toBe(409);
      expect(response.body).toEqual({ error: FULL_MESSAGE, code: "TOURNAMENT_FULL" });
    }
    expect(await row(waiting[0].id)).toMatchObject({ paymentConfirmed: false });
  });

  it("is refused by an edit that ticks the payment too", async () => {
    const { waiting, owner } = await fullField();

    const response = await owner.put(`/api/registrations/${waiting[0].id}`).send({ paymentConfirmed: true });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("TOURNAMENT_FULL");
  });

  it("is refused for a waiting-list entry's re-buy, bust or knockout: they would be in the field", async () => {
    const { accepted, waiting, owner } = await fullField();

    const rebuy = await owner.post(`/api/registrations/${waiting[0].id}/counts`).send({ rebuys: 1 });
    const bust = await owner.put(`/api/registrations/${waiting[0].id}`).send({ isEliminated: true });
    const knockout = await owner.put(`/api/registrations/${accepted[0].id}`).send({ isEliminated: true, eliminatedBy: waiting[0].playerId });

    for (const response of [rebuy, bust, knockout]) {
      expect(response.status).toBe(409);
      expect(response.body.code).toBe("TOURNAMENT_FULL");
    }
    expect(await row(waiting[0].id)).toMatchObject({ rebuys: 0, isEliminated: false, knockouts: 0 });
    expect(await row(accepted[0].id)).toMatchObject({ isEliminated: false });
  });

  it("lets the next on the list be accepted once an accepted entry is removed, or Max players is raised", async () => {
    const { tournament, accepted, waiting, owner } = await fullField(["Carol", "Dan"]);
    expect(await positions(tournament)).toEqual([null, null, 1, 2]);
    expect((await owner.patch(`/api/registrations/${waiting[0].id}/confirm-payment`)).status).toBe(409);

    expect((await owner.delete(`/api/registrations/${accepted[1].id}`)).status).toBe(204);
    expect(await positions(tournament)).toEqual([null, null, 1]);
    const carol = await owner.patch(`/api/registrations/${waiting[0].id}/confirm-payment`);
    expect(carol.status).toBe(200);
    expect((carol.body as PaymentConfirmedDto).waitingListPosition).toBeNull();
    expect((await owner.patch(`/api/registrations/${waiting[1].id}/confirm-payment`)).status).toBe(409);

    expect((await owner.put(`/api/tournaments/${tournament.id}`).send({ maxPlayers: 3 })).status).toBe(200);
    expect(await positions(tournament)).toEqual([null, null, null]);
    expect((await owner.patch(`/api/registrations/${waiting[1].id}/confirm-payment`)).status).toBe(200);
  });

  it("puts a late payer in ahead of an earlier sign-up who has not paid: accepting is what counts", async () => {
    const { tournament, waiting, owner } = await fullField(["Carol", "Dan"], { maxPlayers: 3 });
    expect(await positions(tournament)).toEqual([null, null, null, 1]);

    expect((await owner.patch(`/api/registrations/${waiting[1].id}/confirm-payment`)).status).toBe(200);

    expect(await positions(tournament)).toEqual([null, null, 1, null]);
  });

  it("always takes the payment of a player who has already played", async () => {
    const { tournament, owner } = await fullField([]);
    const played = await createRegistration({ tournamentId: tournament.id, playerId: (await createPlayer()).id, isEliminated: true, eliminationTime: new Date() });

    const response = await owner.patch(`/api/registrations/${played.id}/confirm-payment`);

    expect(response.status).toBe(200);
    expect(await row(played.id)).toMatchObject({ paymentConfirmed: true });
  });
});

describe("the tournaments list", () => {
  it("counts the waiting list apart from the field, as the registrations number it, for anyone", async () => {
    const { tournament } = await fullField(["Carol", "Dan"]);
    // A player who has played is in the field by right, unpaid: the list is unchanged behind a full field.
    await createRegistration({ tournamentId: tournament.id, playerId: (await createPlayer({ name: "Eve" })).id, paymentConfirmed: false, isEliminated: true });
    const listed = async () =>
      ((await (await anon()).get("/api/tournaments")).body as TournamentListItemDto[]).find((item) => item.id === tournament.id);

    expect(await listed()).toMatchObject({ registeredCount: 5, waitingListCount: 2 });
    expect((await positions(tournament)).filter((position) => position !== null)).toHaveLength(2);

    await testDb().update(tournaments).set({ maxPlayers: 4 }).where(eq(tournaments.id, tournament.id));
    expect(await listed()).toMatchObject({ registeredCount: 5, waitingListCount: 1 });
    expect((await positions(tournament)).filter((position) => position !== null)).toHaveLength(1);
  });
});

describe("what the waiting list is left out of", () => {
  it("the prize pool, the TV's entries, players left and chips", async () => {
    const { tournament } = await fullField(["Carol", "Dan"]);

    const pool = (await (await anon()).get(`/api/tournaments/${tournament.id}/prize-pool`)).body;
    const live = (await (await anon()).get(`/api/public/tournaments/${tournament.id}/display`)).body;

    expect(pool.breakdown.counts).toMatchObject({ registrations: 2, buyIns: 2 });
    expect(pool.breakdown.net).toBe(10_000);
    expect(live.stats).toMatchObject({ entrants: 2, remaining: 2 });
  });

  it("seating: a sign-up on the list is not auto-seated, is not waiting for a seat, and sits down once accepted", async () => {
    const { tournament, accepted, owner, td } = await fullField([]);
    const table = await createTable({ tournamentId: tournament.id, tableNumber: 1, seatCount: 9 });
    for (let index = 0; index < accepted.length; index++) {
      await createSeat({ tournamentId: tournament.id, tableId: table.id, registrationId: accepted[index].id, seatNumber: index + 1 });
    }
    const player = await createPlayer({ name: "Late Lou" });

    const signUp = await (await anon()).post(`/api/tournaments/${tournament.id}/registrations`).send({ playerId: player.id, signUpToken: signUpTokenFor(player.id) });

    const created = signUp.body as RegistrationCreatedDto;
    expect(created).toMatchObject({ waitingListPosition: 1, seating: { status: "waiting", reason: "awaiting_payment" } });
    const seating = (await td.get(`/api/tournaments/${tournament.id}/seating`)).body as SeatingDto;
    expect(seating.unseated).toEqual([]);
    expect(seating.stats).toMatchObject({ activePlayers: 2, seated: 2, unseated: 0 });
    expect(seating.advisor.overCapacity).toBe(1);
    // A TD's move cannot seat them either.
    const moved = await td.post(`/api/tournaments/${tournament.id}/seating/assign`).send({ registrationId: created.id, tableId: table.id, seatNumber: 5 });
    expect(moved.status).toBe(409);

    await owner.put(`/api/tournaments/${tournament.id}`).send({ maxPlayers: 3 });
    const confirmed = await owner.patch(`/api/registrations/${created.id}/confirm-payment`);
    expect((confirmed.body as PaymentConfirmedDto).seating).toMatchObject({ status: "seated", seat: { tableNumber: 1 } });
    const seats = await testDb()
      .select()
      .from(tournamentSeats)
      .where(and(eq(tournamentSeats.registrationId, created.id), isNull(tournamentSeats.releasedAt)));
    expect(seats).toHaveLength(1);
  });

  it("finalize: the waiting list is not ranked, paid or scored", async () => {
    const { tournament, accepted, owner } = await fullField(["Carol"], { prizePoolLocked: true });
    await owner.put(`/api/registrations/${accepted[0].id}`).send({ isEliminated: true });

    const preview = await owner.post(`/api/tournaments/${tournament.id}/finalize/preview`).send({});

    expect(preview.status).toBe(200);
    expect(preview.body.rows.map((entry: { playerName: string }) => entry.playerName)).toEqual(["Bob", "Alice"]);
    expect(preview.body.warnings).toContain("1 sign-up on the waiting list is not ranked, paid or counted in the pool");
  });
});
