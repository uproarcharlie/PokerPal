/**
 * GET /api/dashboard/stats (server/routes/dashboard.ts): the dashboard's four numbers, for signed-in
 * staff only and only over the clubs they own or manage (every club for an admin: MONEY-23). The
 * prize money uses the same shared maths as finalize (money-14): each pot's own rake, fixed rake per
 * entry, the manual pool and AP total honoured, cancelled tournaments left out, and completed ones
 * counted at what they paid. A live pool counts what its places pay (round 7: each rounded down to whole
 * dollars, what they leave the club's fee), and what the club pays in for free entries.
 */
import type request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import type { DashboardStatsDto } from "@shared/api/dashboard";
import {
  createClub,
  createPlayer,
  createRegistration,
  createTournament,
  type NewRegistration,
  type NewTournament,
} from "../factories";
import { createClubManager } from "../factories/club-managers";
import { anon, resetDb, signIn } from "../helpers";
import { clubWithStaff } from "../helpers/club-staff";

beforeEach(resetDb);

const signInAdmin = () => signIn({ role: "admin" });

type Entry = Partial<
  Pick<NewRegistration, "buyIns" | "rebuys" | "addons" | "paymentConfirmed" | "freeEntry" | "freeEntryFunded" | "finalPosition" | "prizeAmount" | "playerId">
>;

/** A tournament in `clubId` with one registration (and one new player, unless given) per entry. */
async function tournamentWith(clubId: string, tournament: Partial<NewTournament>, entries: readonly Entry[] = []) {
  const created = await createTournament({ clubId, ...tournament });
  for (const entry of entries) {
    const playerId = entry.playerId ?? (await createPlayer()).id;
    await createRegistration({ tournamentId: created.id, paymentConfirmed: true, ...entry, playerId });
  }
  return created;
}

async function statsFor(agent: request.Agent): Promise<DashboardStatsDto> {
  const response = await agent.get("/api/dashboard/stats");
  expect(response.status).toBe(200);
  return response.body;
}

describe("GET /api/dashboard/stats", () => {
  it("is not served to anonymous visitors or deactivated accounts (MONEY-23)", async () => {
    const { deactivated } = await clubWithStaff();

    const anonymous = await (await anon()).get("/api/dashboard/stats");

    expect(anonymous.status).toBe(401);
    expect(anonymous.body).toEqual({ error: "Authentication required", code: "UNAUTHENTICATED" });
    expect((await deactivated.agent.get("/api/dashboard/stats")).status).toBe(401);
  });

  it("reports zeros when there is nothing yet, and to someone who runs no club", async () => {
    const club = await createClub();
    await tournamentWith(club.id, { status: "registration" }, [{}]);
    const { agent } = await signIn();

    expect(await statsFor((await signInAdmin()).agent)).toMatchObject({ activeTournaments: 1, activeClubs: 1 });
    expect(await statsFor(agent)).toEqual({ activeTournaments: 0, totalPlayers: 0, totalPrizePool: 0, activeClubs: 0 });
  });

  it("counts every club's tournaments, players and pools for an admin", async () => {
    const [club, otherClub] = [await createClub(), await createClub()];
    await createClub();
    for (const status of ["scheduled", "registration", "in_progress", "completed", "cancelled"]) {
      await tournamentWith(club.id, { status });
    }
    // $20 for prizes, but 2 players fill only 2 of Standard's 3 places: $10 + $6 is paid, 3rd's $4 is the club's (R7FREV0-MONEY-01).
    await tournamentWith(otherClub.id, { status: "in_progress", buyInAmount: "10.00" }, [{}, {}]);
    for (let index = 0; index < 4; index++) await createPlayer();

    expect(await statsFor((await signInAdmin()).agent)).toEqual({
      activeTournaments: 3,
      totalPlayers: 6,
      totalPrizePool: 16,
      activeClubs: 3,
    });
  });

  it("counts only the clubs an owner or manager runs: their tournaments, the players registered in them, their pools", async () => {
    const staff = await clubWithStaff();
    const other = await clubWithStaff();
    const regular = await createPlayer();
    // $40, 2 players: $20 + $12 is paid (the places with a player only, R7FREV0-MONEY-01).
    await tournamentWith(staff.club.id, { status: "registration", buyInAmount: "20.00" }, [{ playerId: regular.id }, {}]);
    // Completed with no prize recorded: counted at what its calculated $20 pool pays its 1 player, $10 (P2-PRODDATA-01).
    await tournamentWith(staff.club.id, { status: "completed", buyInAmount: "20.00" }, [{ playerId: regular.id }]);
    // $30, 3 players: every place is paid.
    await tournamentWith(other.club.id, { status: "in_progress", buyInAmount: "10.00" }, [{ playerId: regular.id }, {}, {}]);
    await createPlayer();

    const mine = { activeTournaments: 1, totalPlayers: 2, totalPrizePool: 42, activeClubs: 1 };
    expect(await statsFor(staff.owner.agent)).toEqual(mine);
    expect(await statsFor(staff.manager.agent)).toEqual(mine);
    expect(await statsFor(staff.stranger.agent)).toEqual({ activeTournaments: 0, totalPlayers: 0, totalPrizePool: 0, activeClubs: 0 });

    await createClubManager({ clubId: other.club.id, userId: staff.manager.user.id });
    expect(await statsFor(staff.manager.agent)).toEqual({ activeTournaments: 2, totalPlayers: 4, totalPrizePool: 72, activeClubs: 2 });
    expect(await statsFor((await signInAdmin()).agent)).toEqual({ activeTournaments: 2, totalPlayers: 5, totalPrizePool: 72, activeClubs: 2 });
  });

  it("computes an open tournament's pool with each pot's own rake, fixed rake per entry, as finalize does (money-14)", async () => {
    const club = await createClub();
    // Buy-ins $60 less 3 x $5 = $45, plus rebuys 2 x $10 with no rebuy rake = $65, paid out as $32 + $19 + $13 = $64 (round 7).
    await tournamentWith(
      club.id,
      { status: "registration", buyInAmount: "20.00", rakeType: "fixed", rakeAmount: "5.00", rebuyAmount: "10.00", rebuyRakeType: "none" },
      [{ rebuys: 2 }, {}, {}],
    );
    // Buy-ins $100 less 10% = $90, plus a $50 rebuy with no rebuy rake = $140; its 2 players are paid $70 + $42.
    await tournamentWith(
      club.id,
      { status: "in_progress", buyInAmount: "50.00", rakeType: "percentage", rakeAmount: "10.00", rebuyAmount: "50.00", rebuyRakeType: "none" },
      [{ rebuys: 1 }, {}],
    );

    expect((await statsFor((await signInAdmin()).agent)).totalPrizePool).toBe(176);
  });

  it("takes every pot's rake, counts only paid entries as finalize does (round 6), and never counts a pool below zero", async () => {
    const club = await createClub();
    // 4 paid buy-ins $200 less 10% = $180; 2 re-buys $50 less 50% = $25; 1 add-on $20 less $5 = $15: $220.
    // The unpaid sign-up's buy-in, re-buy and add-on are not in the pool.
    await tournamentWith(
      club.id,
      {
        status: "registration",
        buyInAmount: "50.00",
        rebuyAmount: "25.00",
        addonAmount: "20.00",
        rakeType: "percentage",
        rakeAmount: "10.00",
        rebuyRakeType: "percentage",
        rebuyRakeAmount: "50.00",
        addonRakeType: "fixed",
        addonRakeAmount: "5.00",
      },
      [{ buyIns: 2 }, { rebuys: 2 }, { addons: 1 }, { paymentConfirmed: false, rebuys: 1, addons: 1 }],
    );
    // 1 x $5 less a fixed $7.50 per entry is below zero: it adds nothing.
    await tournamentWith(club.id, { status: "scheduled", buyInAmount: "5.00", rakeType: "fixed", rakeAmount: "7.50" }, [{}]);

    expect((await statsFor((await signInAdmin()).agent)).totalPrizePool).toBe(220);
  });

  it("adds a player's money once the payment is confirmed (round 6)", async () => {
    const club = await createClub();
    const tournament = await tournamentWith(club.id, { status: "in_progress", buyInAmount: "20.00" }, [{}, { paymentConfirmed: false }, { paymentConfirmed: false }]);
    const { agent } = await signInAdmin();
    // 1 paid player: 1st's $10 of the $20 is what is paid.
    expect((await statsFor(agent)).totalPrizePool).toBe(10);

    const registrations = await agent.get(`/api/tournaments/${tournament.id}/registrations`);
    const unpaid = registrations.body.find((r: { paymentConfirmed: boolean }) => !r.paymentConfirmed);
    expect((await agent.patch(`/api/registrations/${unpaid.id}/confirm-payment`)).status).toBe(200);

    // 2 paid: $40, paid as $20 + $12.
    expect((await statsFor(agent)).totalPrizePool).toBe(32);
  });

  it("honours a manual prize pool and a manual AP total, as finalize does", async () => {
    const club = await createClub();
    await tournamentWith(club.id, { status: "registration", buyInAmount: "20.00", manualPrizePool: "500.00" }, [{}, {}, {}]);
    // $60 gross less a fixed $10 AP total (the 50% rate would take $30).
    await tournamentWith(
      club.id,
      { status: "in_progress", buyInAmount: "20.00", rakeType: "percentage", rakeAmount: "50.00", rakeOverride: "10.00" },
      [{}, {}, {}],
    );

    expect((await statsFor((await signInAdmin()).agent)).totalPrizePool).toBe(550);
  });

  it("counts a live pool at the prizes set, whatever a TD chose for a leftover before round 7, with money carried into it", async () => {
    const club = await createClub();
    // $60 in, prizes set at $50: the $10 left over is the club's fee, though "first" was stored before round 7, so the pool pays $50.
    await tournamentWith(club.id, { status: "in_progress", buyInAmount: "20.00", manualPrizePool: "50.00", prizeDifference: "first" }, [{}, {}, {}]);
    // $60 in and $40 carried over from an earlier tournament: a $100 pool.
    const carriedIn = [{ carryOverId: "co-1", fromTournamentId: null, fromName: "Test Wednesday", amountCents: 4_000 }];
    await tournamentWith(club.id, { status: "registration", buyInAmount: "20.00", carriedIn }, [{}, {}, {}]);

    expect((await statsFor((await signInAdmin()).agent)).totalPrizePool).toBe(150);
  });

  it("counts a free entry's buy-in only when the club pays it in, in full, and its re-buys as paid (round 7)", async () => {
    const club = await createClub();
    // 3 paid $25 buy-ins less $5 AP each = $60; a funded free entry adds its $25 with no AP = $85; two free entries the club
    // does not pay in for add nothing but one's $15 re-buy = $100; an unpaid sign-up adds nothing.
    await tournamentWith(
      club.id,
      { status: "in_progress", buyInAmount: "25.00", rakeType: "fixed", rakeAmount: "5.00", rebuyAmount: "15.00", rebuyRakeType: "none" },
      [{}, {}, {}, { freeEntry: true, freeEntryFunded: true }, { freeEntry: true }, { freeEntry: true, rebuys: 1 }, { paymentConfirmed: false }],
    );

    expect((await statsFor((await signInAdmin()).agent)).totalPrizePool).toBe(100);
  });

  it("counts what a completed tournament paid, never a recomputed pool (money-14, spec D20)", async () => {
    const club = await createClub();
    // A $180 pool (4 x $50 less 10%) that paid $100 and $50: it adds the $150 paid.
    await tournamentWith(
      club.id,
      { status: "completed", buyInAmount: "50.00", rakeType: "percentage", rakeAmount: "10.00" },
      [{ finalPosition: 1, prizeAmount: "100.00" }, { finalPosition: 2, prizeAmount: "50.00" }, { finalPosition: 3 }, {}],
    );

    expect((await statsFor((await signInAdmin()).agent)).totalPrizePool).toBe(150);
  });

  it("counts a completed tournament whose prizes were never recorded at its calculated pool, as before Phase 2 (P2-PRODDATA-01)", async () => {
    const club = await createClub();
    // Results entered by hand before Phase 2: positions, no prizeAmount. Its $60 pool, not $0, with the
    // payment nobody confirmed then still in it: counting only paid players changes no completed tournament.
    await tournamentWith(club.id, { status: "completed", buyInAmount: "20.00" }, [
      { finalPosition: 1 },
      { finalPosition: 2 },
      { finalPosition: 3, paymentConfirmed: false },
    ]);

    expect((await statsFor((await signInAdmin()).agent)).totalPrizePool).toBe(60);
  });

  it("counts a finalized tournament at its snapshot", async () => {
    const club = await createClub();
    const tournament = await tournamentWith(club.id, { status: "in_progress", buyInAmount: "33.55" }, [{}, {}, {}]);
    const { agent } = await signIn({ role: "admin" });
    expect((await agent.post(`/api/tournaments/${tournament.id}/finalize`).send({})).status).toBe(409);
    // Three players still in: the TD gives the order, and finalize pays $50 + $30 + $20 of the $100.65 (round 7: the 65 cents are the club's).
    const preview = await agent.post(`/api/tournaments/${tournament.id}/finalize/preview`).send({});
    const order = preview.body.activePlayers.map((p: { registrationId: string }) => p.registrationId);
    expect((await agent.post(`/api/tournaments/${tournament.id}/finalize`).send({ finishOrder: order })).status).toBe(200);

    expect((await statsFor(agent)).totalPrizePool).toBe(100);
  });

  it("leaves cancelled tournaments out of the total prize pool (money-14)", async () => {
    const club = await createClub();
    await tournamentWith(club.id, { status: "cancelled", buyInAmount: "10.00" }, [{}, {}]);

    expect((await statsFor((await signInAdmin()).agent)).totalPrizePool).toBe(0);
  });
});
