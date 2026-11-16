/**
 * Prize money carried over between tournaments (round 5, item 16; server/services/carry-overs.ts). Since
 * round 7 nothing new is carried over: a leftover is the club's fee, whatever a TD chose before. Money
 * carried over before then can still be added to the next tournament of its season (or of the club) and
 * taken out again, and a correction of a tournament that carried money over takes it back to $0 while no
 * pool holds it, and leaves it in the pool that does (open or paid), frozen as carried over. It is logged
 * to the staff's feed and what the pools pay adds up to the cent.
 */
import { eq } from "drizzle-orm";
import type request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import type { ApUpdateResponse, CarryOversDto } from "@shared/api/prize-pool";
import { findForbiddenKeys } from "@shared/api/public";
import { activityLog, prizeCarryOvers, tournamentRegistrations, tournaments } from "@shared/schema";
import { createPlayer, createRegistration, createSeason, createTournament, type NewTournament } from "../factories";
import { anon, resetDb, testDb } from "../helpers";
import { carryOversOf, createCarryOver } from "../helpers/carry-overs";
import { clubWithStaff, type ClubStaffAgents } from "../helpers/club-staff";

beforeEach(resetDb);

/** A tournament of `staff`'s club with `players` paid $50 buy-ins and no AP, all busted but the last. */
async function game(staff: ClubStaffAgents, overrides: Partial<NewTournament> = {}, players = 4) {
  const tournament = await createTournament({ clubId: staff.club.id, status: "in_progress", buyInAmount: "50.00", ...overrides });
  for (let i = 0; i < players; i++) {
    const player = await createPlayer({ name: `Player ${i + 1}` });
    await createRegistration({
      tournamentId: tournament.id,
      playerId: player.id,
      paymentConfirmed: true,
      isEliminated: i < players - 1,
      eliminationTime: i < players - 1 ? new Date(Date.UTC(2026, 2, 1, 19, i)) : null,
    });
  }
  return tournament;
}

/** Custom places 1st $100, 2nd $50 (of a $200 pool: $50 left over), as a page loaded before round 7 asked to carry it over. */
const carryPlaces = { payoutStructure: "custom", places: [{ kind: "amount", amount: "100" }, { kind: "amount", amount: "50" }], prizeDifference: "carry" };

const base = (id: string) => `/api/tournaments/${id}/prize-pool`;
const setPayouts = (agent: request.Agent, id: string, body: object) => agent.put(`${base(id)}/payouts`).send(body);
const list = async (agent: request.Agent, id: string) => (await agent.get(`${base(id)}/carry-overs`)).body as CarryOversDto;
const apply = (agent: request.Agent, id: string, carryOverId: string) => agent.post(`${base(id)}/carry-overs/${carryOverId}`);
const takeOut = (agent: request.Agent, id: string, carryOverId: string) => agent.delete(`${base(id)}/carry-overs/${carryOverId}`);
const finalize = (agent: request.Agent, id: string, body: object = {}) => agent.post(`/api/tournaments/${id}/finalize`).send(body);
const descriptions = async (id: string) => (await testDb().select().from(activityLog).where(eq(activityLog.tournamentId, id))).map((entry) => entry.description);
const row = async (id: string) => (await testDb().select().from(tournaments).where(eq(tournaments.id, id)))[0];

describe("finalize since round 7", () => {
  it("carries nothing over: the leftover is the club's fee, whatever was stored before round 7", async () => {
    const staff = await clubWithStaff({ rakeLabel: "AP" });
    const season = await createSeason({ clubId: staff.club.id, name: "Winter League" });
    const source = await game(staff, { name: "Test Wednesday", seasonId: season.id });
    await setPayouts(staff.owner.agent, source.id, carryPlaces);
    await testDb().update(tournaments).set({ prizeDifference: "carry" }).where(eq(tournaments.id, source.id));

    const response = await finalize(staff.owner.agent, source.id);

    expect(response.status).toBe(200);
    expect(response.body.snapshot.paid.map((place: { amountCents: number }) => place.amountCents)).toEqual([10_000, 5_000]);
    expect(response.body.snapshot.pool.difference).toEqual({ availableCents: 20_000, setCents: 15_000, cents: 5_000, keptByClubCents: 5_000, addedByClubCents: 0 });
    expect(response.body.snapshot.pool).toMatchObject({ netCents: 15_000, impliedRakeCents: 5_000 });
    expect(await carryOversOf(source.id)).toEqual([]);
    expect(await descriptions(source.id)).toContain("Leftover $50 → AP: the prizes add up to $150 of the $200 available for prizes");
  });
});

describe("adding money carried over before round 7 to a later pool", () => {
  /** What a finalize before round 7 carried over to the Winter League: $50 from Test Wednesday. */
  async function carried() {
    const staff = await clubWithStaff({ rakeLabel: "AP" });
    const season = await createSeason({ clubId: staff.club.id, name: "Winter League" });
    const { source, carryOver } = await createCarryOver({ clubId: staff.club.id, seasonId: season.id, sourceName: "Test Wednesday", amountCents: 5_000 });
    return { staff, season, source, carryOver };
  }

  it("lists it for the season's next tournament, adds it to the pool, and pays it at finalize", async () => {
    const { staff, season, source, carryOver } = await carried();
    const next = await game(staff, { name: "Friday Night", seasonId: season.id });

    expect(await list(staff.manager.agent, next.id)).toEqual({
      available: [
        {
          id: carryOver.id,
          fromTournamentId: source.id,
          fromName: "Test Wednesday",
          carriedAt: expect.any(String),
          amountCents: 5_000,
          seasonName: "Winter League",
        },
      ],
      carriedIn: [],
    });

    const response = await apply(staff.manager.agent, next.id, carryOver.id);

    expect(response.status).toBe(200);
    const body = response.body as ApUpdateResponse;
    expect(body.prizePool.breakdown).toMatchObject({ netAfterAp: 25_000, net: 25_000, carriedInCents: 5_000 });
    expect(body.tournament.carriedIn).toEqual([{ carryOverId: carryOver.id, fromTournamentId: source.id, fromName: "Test Wednesday", amountCents: 5_000 }]);
    expect((await carryOversOf(source.id))[0]).toMatchObject({ appliedToTournamentId: next.id, appliedBy: staff.manager.user.id });
    expect(await descriptions(next.id)).toEqual(["$50 carried over from Test Wednesday added to the prize pool (now $250)"]);
    expect((await list(staff.manager.agent, next.id)).available).toEqual([]);

    // Everyone sees it in the pool, without anyone's account (round 6: the public prize pool, by name only).
    const publicPool = await (await anon()).get(`/api/public/tournaments/${next.id}/prizes`);
    expect(publicPool.body).toMatchObject({ poolCents: 25_000, carriedIn: [{ fromName: "Test Wednesday", amountCents: 5_000 }] });
    expect(findForbiddenKeys(publicPool.body)).toEqual([]);
    const publicTournament = await (await anon()).get(`/api/tournaments/${next.id}`);
    expect(publicTournament.body.carriedIn).toHaveLength(1);
    expect(findForbiddenKeys(publicTournament.body)).toEqual([]);

    // Adding it again changes nothing.
    expect((await apply(staff.manager.agent, next.id, carryOver.id)).status).toBe(200);
    expect(await descriptions(next.id)).toHaveLength(1);

    const finalized = await finalize(staff.owner.agent, next.id);
    expect(finalized.status).toBe(200);
    expect(finalized.body.snapshot.pool).toMatchObject({ netCents: 25_000, carriedIn: [{ carryOverId: carryOver.id, amountCents: 5_000 }] });
    const prizes = await testDb().select().from(tournamentRegistrations).where(eq(tournamentRegistrations.tournamentId, next.id));
    const paid = prizes.reduce((sum, registration) => sum + Math.round(Number(registration.prizeAmount ?? 0) * 100), 0);
    expect(paid).toBe(25_000);
  });

  it("takes it out again, free for another tournament", async () => {
    const { staff, season, source, carryOver } = await carried();
    const next = await game(staff, { seasonId: season.id });
    await apply(staff.owner.agent, next.id, carryOver.id);

    const response = await takeOut(staff.owner.agent, next.id, carryOver.id);

    expect(response.status).toBe(200);
    expect(response.body.prizePool.breakdown).toMatchObject({ net: 20_000, carriedInCents: 0 });
    expect((await row(next.id)).carriedIn).toBeNull();
    expect((await carryOversOf(source.id))[0]).toMatchObject({ appliedToTournamentId: null, appliedAt: null, appliedBy: null });
    expect(await descriptions(next.id)).toContain("$50 carried over from Test Wednesday taken out of the prize pool (now $200)");
    expect((await list(staff.owner.agent, next.id)).available).toHaveLength(1);
    expect((await takeOut(staff.owner.agent, next.id, carryOver.id)).status).toBe(404);
  });

  it("lets only one tournament take it, even when two try at once", async () => {
    const { staff, season, carryOver } = await carried();
    const one = await game(staff, { seasonId: season.id });
    const two = await game(staff, { seasonId: season.id });

    const answers = await Promise.all([apply(staff.owner.agent, one.id, carryOver.id), apply(staff.manager.agent, two.id, carryOver.id)]);

    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409]);
    expect(answers.find((answer) => answer.status === 409)?.body).toMatchObject({ code: "CONFLICT", error: expect.stringMatching(/already in .*'s prize pool/) });
    const pools = await Promise.all([row(one.id), row(two.id)]);
    expect(pools.filter((pool) => pool.carriedIn !== null)).toHaveLength(1);
  });

  it("is not offered to another season, another club, or the tournament that carried it over", async () => {
    const { staff, carryOver, source } = await carried();
    const otherSeason = await createSeason({ clubId: staff.club.id, name: "Summer League" });
    const elsewhere = await game(staff, { seasonId: otherSeason.id });
    const noSeason = await game(staff);
    const otherClub = await clubWithStaff();
    const foreign = await game(otherClub);

    expect((await list(staff.owner.agent, elsewhere.id)).available).toEqual([]);
    expect((await list(staff.owner.agent, noSeason.id)).available).toEqual([]);
    const wrongSeason = await apply(staff.owner.agent, elsewhere.id, carryOver.id);
    expect(wrongSeason.status).toBe(404);
    expect(wrongSeason.body.error).toBe("That money was carried over to Winter League: only its tournaments can add it");
    expect((await apply(otherClub.owner.agent, foreign.id, carryOver.id)).status).toBe(404);
    // The source is completed anyway; an unknown carry-over is a 404 too.
    expect((await apply(staff.owner.agent, source.id, carryOver.id)).status).toBe(409);
    expect((await apply(staff.owner.agent, noSeason.id, "unknown-id")).status).toBe(404);
  });

  it("offers money carried over with no season to any later tournament of the club", async () => {
    const staff = await clubWithStaff();
    const target = await game(staff, { seasonId: (await createSeason({ clubId: staff.club.id })).id });
    const { carryOver } = await createCarryOver({ clubId: staff.club.id, amountCents: 2_500 });

    expect((await list(staff.owner.agent, target.id)).available.map((offer) => offer.id)).toEqual([carryOver.id]);
    expect((await apply(staff.owner.agent, target.id, carryOver.id)).status).toBe(200);
  });

  it("can be taken out of a cancelled tournament, never a completed one, and added only to an open one", async () => {
    const staff = await clubWithStaff();
    const cancelled = await game(staff, { status: "cancelled" });
    const completed = await game(staff, { status: "completed" });
    const { carryOver: inCancelled } = await createCarryOver({ clubId: staff.club.id, appliedTo: cancelled });
    const { carryOver: inCompleted } = await createCarryOver({ clubId: staff.club.id, appliedTo: completed });
    const { carryOver: free } = await createCarryOver({ clubId: staff.club.id });

    expect((await takeOut(staff.owner.agent, cancelled.id, inCancelled.id)).status).toBe(200);
    const closed = await takeOut(staff.owner.agent, completed.id, inCompleted.id);
    expect(closed.status).toBe(409);
    expect(closed.body.code).toBe("TOURNAMENT_CLOSED");
    expect((await apply(staff.owner.agent, cancelled.id, free.id)).body.code).toBe("TOURNAMENT_CLOSED");
  });
});

describe("correcting the results of a tournament that carried money over before round 7", () => {
  /** Test Wednesday, finalized before round 7 with $50 carried over to the club's next tournament, Friday Night, which has added it. */
  async function carriedAndAdded() {
    const staff = await clubWithStaff({ rakeLabel: "AP" });
    const source = await game(staff, { name: "Test Wednesday" });
    await setPayouts(staff.owner.agent, source.id, carryPlaces);
    expect((await finalize(staff.owner.agent, source.id)).status).toBe(200);
    // As a finalize before round 7 left it: $50 carried over to the club's next tournament, and the snapshot saying so.
    const [carryOver] = await testDb()
      .insert(prizeCarryOvers)
      .values({ sourceTournamentId: source.id, sourceName: source.name, targetSeasonId: null, amountCents: 5_000, createdBy: staff.owner.user.id })
      .returning();
    const snapshot = (await row(source.id)).prizePoolSnapshot;
    if (!snapshot) throw new Error("Finalize kept no snapshot");
    const legacy = { availableCents: 20_000, setCents: 15_000, cents: 5_000, keptByClubCents: 0, addedByClubCents: 0, choice: "carry", carriedOverCents: 5_000, carryTarget: "the next tournament" };
    await testDb().update(tournaments).set({ prizeDifference: "carry", prizePoolSnapshot: { ...snapshot, pool: { ...snapshot.pool, difference: legacy } } }).where(eq(tournaments.id, source.id));
    const next = await game(staff, { name: "Friday Night" });
    expect((await apply(staff.owner.agent, next.id, carryOver.id)).status).toBe(200);
    return { staff, source, carryOver, next };
  }

  const correct = async (agent: request.Agent, id: string) => {
    const preview = await agent.post(`/api/tournaments/${id}/finalize/preview`).send({ force: true });
    return { preview, corrected: await finalize(agent, id, { force: true, expectedPlanHash: preview.body.planHash }) };
  };

  it("leaves money another pool holds there, open or already paid, and freezes it as carried over (R7FREV0-CARRY-01)", async () => {
    const { staff, source, carryOver, next } = await carriedAndAdded();
    const held = "$50 this tournament carried over is in Friday Night's prize pool: it stays there, so it is not part of this prize pool";
    const frozen = { availableCents: 15_000, setCents: 15_000, cents: 0, keptByClubCents: 0, addedByClubCents: 0, carriedOverCents: 5_000, carryTarget: "Friday Night" };

    // While Friday Night is open: the preview can be finalized as it shows, and the correction goes through.
    const first = await correct(staff.owner.agent, source.id);
    expect(first.preview.body).toMatchObject({ ok: true, prizePool: { breakdown: { difference: frozen, impliedRake: 0 } } });
    expect(first.preview.body.warnings).toContain(held);
    expect(first.corrected.status).toBe(200);
    expect(first.corrected.body.snapshot.pool).toMatchObject({ netCents: 15_000, impliedRakeCents: 0, difference: frozen });
    expect((await carryOversOf(source.id))[0]).toMatchObject({ id: carryOver.id, amountCents: 5_000, appliedToTournamentId: next.id });
    expect(await descriptions(source.id)).toContain("$50 stays carried over to Friday Night");

    // Friday Night paid it out: the money can never be taken out there now, and a correction still goes through.
    expect((await finalize(staff.owner.agent, next.id)).status).toBe(200);
    const again = await correct(staff.owner.agent, source.id);
    expect(again.preview.body.ok).toBe(true);
    expect(again.corrected.status).toBe(200);
    expect(again.corrected.body.snapshot.pool.difference).toEqual(frozen);
    expect((await carryOversOf(source.id))[0]).toMatchObject({ amountCents: 5_000, appliedToTournamentId: next.id });
    expect((await row(next.id)).prizePoolSnapshot?.pool.carriedIn).toEqual([expect.objectContaining({ carryOverId: carryOver.id, amountCents: 5_000 })]);
  });

  it("takes it back to $0 once it is taken out of the other pool: the leftover is then the club's", async () => {
    const { staff, source, carryOver, next } = await carriedAndAdded();
    expect((await takeOut(staff.owner.agent, next.id, carryOver.id)).status).toBe(200);

    const { preview, corrected } = await correct(staff.owner.agent, source.id);
    expect(preview.body.warnings.filter((warning: string) => warning.includes("carried over is in"))).toEqual([]);
    expect(corrected.status).toBe(200);
    expect(corrected.body.snapshot.pool.difference).toEqual({ availableCents: 20_000, setCents: 15_000, cents: 5_000, keptByClubCents: 5_000, addedByClubCents: 0 });
    expect((await carryOversOf(source.id))[0]).toMatchObject({ id: carryOver.id, amountCents: 0, appliedToTournamentId: null });
    expect((await list(staff.owner.agent, next.id)).available).toEqual([]);
  });

  it("is a changed plan when the money is taken out of the other pool after the preview", async () => {
    const { staff, source, carryOver, next } = await carriedAndAdded();
    const preview = await staff.owner.agent.post(`/api/tournaments/${source.id}/finalize/preview`).send({ force: true });
    expect((await takeOut(staff.owner.agent, next.id, carryOver.id)).status).toBe(200);

    const refused = await finalize(staff.owner.agent, source.id, { force: true, expectedPlanHash: preview.body.planHash });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("PLAN_CHANGED");
    expect((await carryOversOf(source.id))[0]).toMatchObject({ amountCents: 5_000, appliedToTournamentId: null });
  });
});
