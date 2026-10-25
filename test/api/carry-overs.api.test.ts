/**
 * Prize money carried over between tournaments (round 5, item 16; server/services/carry-overs.ts):
 * finalize records what a tournament's TD chose to carry over, the next tournament of its season (or
 * of the club) adds it to its pool and can take it out again, and a correction may not change money
 * another pool already holds. Everything is logged publicly and what the pools pay adds up to the cent.
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

/** Custom places 1st $100, 2nd $50 (of a $200 pool: $50 left over), carried over. */
const carryPlaces = { payoutStructure: "custom", places: [{ kind: "amount", amount: "100" }, { kind: "amount", amount: "50" }], prizeDifference: "carry" };

const base = (id: string) => `/api/tournaments/${id}/prize-pool`;
const setPayouts = (agent: request.Agent, id: string, body: object) => agent.put(`${base(id)}/payouts`).send(body);
const list = async (agent: request.Agent, id: string) => (await agent.get(`${base(id)}/carry-overs`)).body as CarryOversDto;
const apply = (agent: request.Agent, id: string, carryOverId: string) => agent.post(`${base(id)}/carry-overs/${carryOverId}`);
const takeOut = (agent: request.Agent, id: string, carryOverId: string) => agent.delete(`${base(id)}/carry-overs/${carryOverId}`);
const finalize = (agent: request.Agent, id: string, body: object = {}) => agent.post(`/api/tournaments/${id}/finalize`).send(body);
const descriptions = async (id: string) => (await testDb().select().from(activityLog).where(eq(activityLog.tournamentId, id))).map((entry) => entry.description);
const row = async (id: string) => (await testDb().select().from(tournaments).where(eq(tournaments.id, id)))[0];

describe("finalize with Carry it over", () => {
  it("records the money for the season's next tournament, freezes where it went and says so", async () => {
    const staff = await clubWithStaff({ rakeLabel: "AP" });
    const season = await createSeason({ clubId: staff.club.id, name: "Winter League" });
    const source = await game(staff, { name: "Test Wednesday", seasonId: season.id });
    await setPayouts(staff.owner.agent, source.id, carryPlaces);

    const response = await finalize(staff.owner.agent, source.id);

    expect(response.status).toBe(200);
    expect(response.body.snapshot.paid.map((place: { amountCents: number }) => place.amountCents)).toEqual([10_000, 5_000]);
    expect(response.body.snapshot.pool.difference).toMatchObject({ choice: "carry", carriedOverCents: 5_000, carryTarget: "Winter League" });
    expect(response.body.snapshot.pool).toMatchObject({ netCents: 15_000, impliedRakeCents: 0 });
    expect(await carryOversOf(source.id)).toMatchObject([
      { sourceName: "Test Wednesday", targetSeasonId: season.id, amountCents: 5_000, appliedToTournamentId: null, createdBy: staff.owner.user.id },
    ]);
    expect(await descriptions(source.id)).toContain("The prizes add up to $150, $50 less than the $200 available for prizes: it is carried over to Winter League");
  });

  it("writes no carry-over when the club keeps the leftover", async () => {
    const staff = await clubWithStaff();
    const source = await game(staff);
    await setPayouts(staff.owner.agent, source.id, { ...carryPlaces, prizeDifference: "club" });

    expect((await finalize(staff.owner.agent, source.id)).status).toBe(200);
    expect(await carryOversOf(source.id)).toEqual([]);
  });
});

describe("adding carried-over money to a later pool", () => {
  async function carried() {
    const staff = await clubWithStaff({ rakeLabel: "AP" });
    const season = await createSeason({ clubId: staff.club.id, name: "Winter League" });
    const source = await game(staff, { name: "Test Wednesday", seasonId: season.id });
    await setPayouts(staff.owner.agent, source.id, carryPlaces);
    await finalize(staff.owner.agent, source.id);
    const [carryOver] = await carryOversOf(source.id);
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

    // Everyone sees it in the pool, without anyone's account.
    const publicPool = await (await anon()).get(base(next.id));
    expect(publicPool.body.breakdown.carriedIn).toHaveLength(1);
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

describe("correcting the results of a tournament that carried money over", () => {
  it("updates what it carries over while no pool holds it, and refuses to change money another pool holds", async () => {
    const staff = await clubWithStaff();
    const source = await game(staff, { name: "Test Wednesday" });
    await setPayouts(staff.owner.agent, source.id, carryPlaces);
    await finalize(staff.owner.agent, source.id);
    const [carryOver] = await carryOversOf(source.id);

    // The TD switches to keeping the leftover and corrects the results: nothing is carried over any more.
    await testDb().update(tournaments).set({ prizeDifference: "club" }).where(eq(tournaments.id, source.id));
    const preview = await staff.owner.agent.post(`/api/tournaments/${source.id}/finalize/preview`).send({ force: true });
    expect((await finalize(staff.owner.agent, source.id, { force: true, expectedPlanHash: preview.body.planHash })).status).toBe(200);
    expect((await carryOversOf(source.id))[0]).toMatchObject({ id: carryOver.id, amountCents: 0 });

    // Back to carrying it over, then a later tournament takes it.
    await testDb().update(tournaments).set({ prizeDifference: "carry" }).where(eq(tournaments.id, source.id));
    const again = await staff.owner.agent.post(`/api/tournaments/${source.id}/finalize/preview`).send({ force: true });
    expect((await finalize(staff.owner.agent, source.id, { force: true, expectedPlanHash: again.body.planHash })).status).toBe(200);
    const next = await game(staff, { name: "Friday Night" });
    expect((await apply(staff.owner.agent, next.id, carryOver.id)).status).toBe(200);

    // Now a correction that would change it is refused, and the preview says why.
    await testDb().update(tournaments).set({ prizeDifference: "club" }).where(eq(tournaments.id, source.id));
    const refusedPreview = await staff.owner.agent.post(`/api/tournaments/${source.id}/finalize/preview`).send({ force: true });
    const reason = "$50 this tournament carried over is already in Friday Night's prize pool: take it out there before changing what is carried over";
    expect(refusedPreview.body.warnings).toContain(reason);
    const refused = await finalize(staff.owner.agent, source.id, { force: true, expectedPlanHash: refusedPreview.body.planHash });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: "CONFLICT", error: reason });
    expect((await row(source.id)).prizePoolSnapshot?.pool.difference).toMatchObject({ carriedOverCents: 5_000 });
    expect((await testDb().select().from(prizeCarryOvers).where(eq(prizeCarryOvers.id, carryOver.id)))[0]).toMatchObject({ amountCents: 5_000, appliedToTournamentId: next.id });
  });
});
