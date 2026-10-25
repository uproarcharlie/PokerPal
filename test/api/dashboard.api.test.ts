/**
 * GET /api/dashboard/stats (server/routes/dashboard.ts): the dashboard's four numbers, for signed-in
 * staff only and only over the clubs they own or manage (every club for an admin: MONEY-23). The
 * prize money uses the same shared maths as finalize (money-14): each pot's own rake, fixed rake per
 * entry, the manual pool and AP total honoured, cancelled tournaments left out, and completed ones
 * counted at what they paid.
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

type Entry = Partial<Pick<NewRegistration, "buyIns" | "rebuys" | "addons" | "paymentConfirmed" | "finalPosition" | "prizeAmount" | "playerId">>;

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
    await tournamentWith(otherClub.id, { status: "in_progress", buyInAmount: "10.00" }, [{}, {}]);
    for (let index = 0; index < 4; index++) await createPlayer();

    expect(await statsFor((await signInAdmin()).agent)).toEqual({
      activeTournaments: 3,
      totalPlayers: 6,
      totalPrizePool: 20,
      activeClubs: 3,
    });
  });

  it("counts only the clubs an owner or manager runs: their tournaments, the players registered in them, their pools", async () => {
    const staff = await clubWithStaff();
    const other = await clubWithStaff();
    const regular = await createPlayer();
    await tournamentWith(staff.club.id, { status: "registration", buyInAmount: "20.00" }, [{ playerId: regular.id }, {}]);
    // Completed with no prize recorded: counted at its calculated $20 pool (P2-PRODDATA-01).
    await tournamentWith(staff.club.id, { status: "completed", buyInAmount: "20.00" }, [{ playerId: regular.id }]);
    await tournamentWith(other.club.id, { status: "in_progress", buyInAmount: "10.00" }, [{ playerId: regular.id }, {}, {}]);
    await createPlayer();

    const mine = { activeTournaments: 1, totalPlayers: 2, totalPrizePool: 60, activeClubs: 1 };
    expect(await statsFor(staff.owner.agent)).toEqual(mine);
    expect(await statsFor(staff.manager.agent)).toEqual(mine);
    expect(await statsFor(staff.stranger.agent)).toEqual({ activeTournaments: 0, totalPlayers: 0, totalPrizePool: 0, activeClubs: 0 });

    await createClubManager({ clubId: other.club.id, userId: staff.manager.user.id });
    expect(await statsFor(staff.manager.agent)).toEqual({ activeTournaments: 2, totalPlayers: 4, totalPrizePool: 90, activeClubs: 2 });
    expect(await statsFor((await signInAdmin()).agent)).toEqual({ activeTournaments: 2, totalPlayers: 5, totalPrizePool: 90, activeClubs: 2 });
  });

  it("computes an open tournament's pool with each pot's own rake, fixed rake per entry, as finalize does (money-14)", async () => {
    const club = await createClub();
    // Buy-ins $60 less 3 x $5 = $45, plus rebuys 2 x $10 with no rebuy rake = $65.
    await tournamentWith(
      club.id,
      { status: "registration", buyInAmount: "20.00", rakeType: "fixed", rakeAmount: "5.00", rebuyAmount: "10.00", rebuyRakeType: "none" },
      [{ rebuys: 2 }, {}, {}],
    );
    // Buy-ins $100 less 10% = $90, plus a $50 rebuy with no rebuy rake = $140.
    await tournamentWith(
      club.id,
      { status: "in_progress", buyInAmount: "50.00", rakeType: "percentage", rakeAmount: "10.00", rebuyAmount: "50.00", rebuyRakeType: "none" },
      [{ rebuys: 1 }, {}],
    );

    expect((await statsFor((await signInAdmin()).agent)).totalPrizePool).toBe(205);
  });

  it("takes every pot's rake, counts unpaid entries as finalize does, and never counts a pool below zero", async () => {
    const club = await createClub();
    // 5 buy-ins $250 less 10% = $225; 2 re-buys $50 less 50% = $25; 1 add-on $20 less $5 = $15: $265.
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
      [{ buyIns: 2 }, { rebuys: 2 }, { addons: 1 }, { paymentConfirmed: false }],
    );
    // 1 x $5 less a fixed $7.50 per entry is below zero: it adds nothing.
    await tournamentWith(club.id, { status: "scheduled", buyInAmount: "5.00", rakeType: "fixed", rakeAmount: "7.50" }, [{}]);

    expect((await statsFor((await signInAdmin()).agent)).totalPrizePool).toBe(265);
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

  it("counts a live pool's difference added to the prizes, and money carried into it, as finalize pays them (round 5, item 16)", async () => {
    const club = await createClub();
    // $60 in, prizes set at $50: the $10 left over goes to 1st, so the pool pays $60.
    await tournamentWith(club.id, { status: "in_progress", buyInAmount: "20.00", manualPrizePool: "50.00", prizeDifference: "first" }, [{}, {}, {}]);
    // $60 in and $40 carried over from an earlier tournament: a $100 pool.
    const carriedIn = [{ carryOverId: "co-1", fromTournamentId: null, fromName: "Test Wednesday", amountCents: 4_000 }];
    await tournamentWith(club.id, { status: "registration", buyInAmount: "20.00", carriedIn }, [{}, {}, {}]);

    expect((await statsFor((await signInAdmin()).agent)).totalPrizePool).toBe(160);
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
    // Results entered by hand before Phase 2: positions, no prizeAmount. Its $60 pool, not $0.
    await tournamentWith(club.id, { status: "completed", buyInAmount: "20.00" }, [{ finalPosition: 1 }, { finalPosition: 2 }, { finalPosition: 3 }]);

    expect((await statsFor((await signInAdmin()).agent)).totalPrizePool).toBe(60);
  });

  it("counts a finalized tournament at its snapshot", async () => {
    const club = await createClub();
    const tournament = await tournamentWith(club.id, { status: "in_progress", buyInAmount: "33.55" }, [{}, {}, {}]);
    const { agent } = await signIn({ role: "admin" });
    expect((await agent.post(`/api/tournaments/${tournament.id}/finalize`).send({})).status).toBe(409);
    // Three players still in: the TD gives the order, and finalize pays $100.65 exactly.
    const preview = await agent.post(`/api/tournaments/${tournament.id}/finalize/preview`).send({});
    const order = preview.body.activePlayers.map((p: { registrationId: string }) => p.registrationId);
    expect((await agent.post(`/api/tournaments/${tournament.id}/finalize`).send({ finishOrder: order })).status).toBe(200);

    expect((await statsFor(agent)).totalPrizePool).toBe(101);
  });

  it("leaves cancelled tournaments out of the total prize pool (money-14)", async () => {
    const club = await createClub();
    await tournamentWith(club.id, { status: "cancelled", buyInAmount: "10.00" }, [{}, {}]);

    expect((await statsFor((await signInAdmin()).agent)).totalPrizePool).toBe(0);
  });
});
