/**
 * The payout editor (round 5, item 1): PUT /api/tournaments/:id/prize-pool/payouts
 * (server/services/payouts.ts). A standard structure, or custom places each a percentage of the pool or
 * a fixed amount, changed mid-game (also while the pool is locked) until the tournament closes; stored
 * backwards-compatibly in custom_payouts; logged to the staff's feed with its reason and audited; and what
 * every screen and finalize then pay. Since round 7 whatever the places leave of the money available is
 * the club's fee, whatever a TD chose before, and what they need beyond it the club adds.
 */
import { eq } from "drizzle-orm";
import fc from "fast-check";
import type request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import type { ApUpdateResponse, PayoutPlaceInput } from "@shared/api/prize-pool";
import { findForbiddenKeys } from "@shared/api/public";
import { evenChop } from "@shared/domain/deal";
import { allocatePayouts, parseCustomPayouts, PAYOUT_STRUCTURES, type StandardPayoutKey } from "@shared/domain/payouts";
import { activityLog, auditLog, tournamentRegistrations, tournaments } from "@shared/schema";
import { createPlayer, createRegistration, createSeason, createTournament, type NewTournament } from "../factories";
import { resetDb, signIn, UNKNOWN_ID, testDb } from "../helpers";
import { agentFor, clubWithStaff, MANAGER_ROUTE, VISITORS, type ClubStaffAgents } from "../helpers/club-staff";

beforeEach(resetDb);

/** A tournament in a club whose AP label is "AP", with `players` paid $50 buy-ins and 10% AP: 8 players pay a $360 pool. */
async function poolTournament(overrides: Partial<NewTournament> = {}, players = 8, staff?: ClubStaffAgents) {
  const club = staff ?? (await clubWithStaff({ rakeLabel: "AP" }));
  const tournament = await createTournament({
    clubId: club.club.id,
    status: "in_progress",
    buyInAmount: "50.00",
    rakeType: "percentage",
    rakeAmount: "10.00",
    ...overrides,
  });
  const registrations = [];
  for (let i = 0; i < players; i++) {
    const player = await createPlayer({ name: `Player ${i + 1}` });
    registrations.push(await createRegistration({ tournamentId: tournament.id, playerId: player.id, paymentConfirmed: true }));
  }
  return { staff: club, tournament, registrations };
}

const payoutsPath = (id: string) => `/api/tournaments/${id}/prize-pool/payouts`;
const put = (agent: request.Agent, id: string, body: object) => agent.put(payoutsPath(id)).send(body);
const row = async (id: string) => (await testDb().select().from(tournaments).where(eq(tournaments.id, id)))[0];
const activity = (id: string) => testDb().select().from(activityLog).where(eq(activityLog.tournamentId, id));
const audits = (id: string) => testDb().select().from(auditLog).where(eq(auditLog.targetId, id));

const percent = (value: number): PayoutPlaceInput => ({ kind: "percent", percent: value });
const amount = (value: string): PayoutPlaceInput => ({ kind: "amount", amount: value });

/** Busts every registration but the last `stillIn`, the first one first. */
async function bustAllBut(registrations: ReadonlyArray<{ id: string }>, stillIn: number) {
  for (let index = 0; index < registrations.length - stillIn; index++) {
    await testDb()
      .update(tournamentRegistrations)
      .set({ isEliminated: true, eliminationTime: new Date(Date.UTC(2026, 2, 1, 19, index)) })
      .where(eq(tournamentRegistrations.id, registrations[index].id));
  }
}

describe("PUT /api/tournaments/:id/prize-pool/payouts", () => {
  it.each(VISITORS)("answers a %s as the authorization rules say", async (visitor) => {
    const { staff, tournament } = await poolTournament({}, 2);

    const response = await put(await agentFor(visitor, staff), tournament.id, { payoutStructure: "top5" });

    expect(response.status).toBe(MANAGER_ROUTE[visitor]);
    expect((await row(tournament.id)).payoutStructure).toBe(response.status === 200 ? "top5" : "standard");
  });

  it("pays custom places exactly as set, the leftover going to the club's fee, logged with the reason and audited", async () => {
    const { staff, tournament } = await poolTournament();

    // $360: 50% is $180, $100 fixed, 10% is $36; the $44 left over is the club's (round 7).
    const response = await put(staff.manager.agent, tournament.id, {
      payoutStructure: "custom",
      places: [percent(50), amount("100"), percent(10)],
      reason: " Short field ",
    });

    expect(response.status).toBe(200);
    const stored = await row(tournament.id);
    expect(stored).toMatchObject({
      payoutStructure: "custom",
      customPayouts: '{"v":2,"places":[{"percent":50},{"amountCents":10000},{"percent":10}]}',
      prizeDifference: null,
    });
    const body = response.body as ApUpdateResponse;
    expect(body.tournament).toMatchObject({ id: tournament.id, payoutStructure: "custom", customPayouts: stored.customPayouts, viewer: { canManage: true } });
    expect(body.prizePool.breakdown.structure).toEqual({
      requested: "custom",
      used: "custom",
      basisPoints: [5696, 3165, 1139],
      places: [
        { kind: "percent", basisPoints: 5000 },
        { kind: "amount", amountCents: 10_000 },
        { kind: "percent", basisPoints: 1000 },
      ],
    });
    expect(body.prizePool.breakdown.payouts.map((payout) => [payout.amountCents, payout.kind])).toEqual([
      [18_000, "percent"],
      [10_000, "amount"],
      [3_600, "percent"],
    ]);
    expect(body.prizePool.breakdown).toMatchObject({ net: 31_600, impliedRake: 8_400 });
    expect(body.prizePool.breakdown.difference).toEqual({ availableCents: 36_000, setCents: 31_600, cents: 4_400, keptByClubCents: 4_400, addedByClubCents: 0 });
    expect(body.prizePool.display).toMatchObject({ source: "live", totalCents: 31_600, undistributedCents: 0 });

    const [entry] = await activity(tournament.id);
    expect(entry).toMatchObject({
      eventType: "payouts_changed",
      description: "Payouts changed to Custom: 1st 50%, 2nd $100, 3rd 10%; Leftover $44 → AP (Short field)",
      playerId: null,
    });
    expect(JSON.parse(entry.eventData ?? "")).toEqual({
      payoutStructure: "custom",
      places: [
        { kind: "percent", basisPoints: 5000 },
        { kind: "amount", amountCents: 10_000 },
        { kind: "percent", basisPoints: 1000 },
      ],
      reason: "Short field",
      difference: { availableCents: 36_000, setCents: 31_600, cents: 4_400, keptByClubCents: 4_400, addedByClubCents: 0 },
    });
    expect(findForbiddenKeys(entry)).toEqual([]);
    expect(await audits(tournament.id)).toMatchObject([
      {
        action: "tournament.payouts",
        actorUserId: staff.manager.user.id,
        targetType: "tournament",
        data: {
          before: { payoutStructure: "standard", customPayouts: null },
          after: { payoutStructure: "custom", customPayouts: stored.customPayouts },
          reason: "Short field",
          netCents: 31_600,
        },
      },
    ]);
    expect((await audits(tournament.id))[0].data).not.toHaveProperty("prizeDifference");
  });

  it("gives the leftover to the club's fee whatever choice a page loaded before round 7 sends, writing and logging nothing for the choice", async () => {
    const { staff, tournament } = await poolTournament();
    const places = [percent(50), amount("100"), percent(10)];
    const paid = (response: { body: ApUpdateResponse }) => response.body.prizePool.breakdown.payouts.map((payout) => payout.amountCents);

    const first = await put(staff.owner.agent, tournament.id, { payoutStructure: "custom", places, prizeDifference: "first" });
    expect(first.status).toBe(200);
    expect(paid(first)).toEqual([18_000, 10_000, 3_600]);
    expect(first.body.prizePool.breakdown.difference).toMatchObject({ cents: 4_400, keptByClubCents: 4_400 });
    expect((await activity(tournament.id))[0].description).toBe("Payouts changed to Custom: 1st 50%, 2nd $100, 3rd 10%; Leftover $44 → AP");

    // Another choice alone is no change: the places are what is stored.
    for (const prizeDifference of ["pro_rata", "carry", "club"]) {
      const again = await put(staff.owner.agent, tournament.id, { payoutStructure: "custom", places, prizeDifference });
      expect(again.status).toBe(200);
      expect(paid(again)).toEqual([18_000, 10_000, 3_600]);
      expect(again.body.prizePool.breakdown).toMatchObject({ net: 31_600, impliedRake: 8_400 });
    }
    expect((await row(tournament.id)).prizeDifference).toBeNull();
    expect(await activity(tournament.id)).toHaveLength(1);
    expect(await audits(tournament.id)).toHaveLength(1);
  });

  it("pays a tournament whose leftover was set before round 7 to go to 1st, the places or a later game as if it were the club's", async () => {
    const staff = await clubWithStaff({ rakeLabel: "AP" });
    const season = await createSeason({ clubId: staff.club.id, name: "Winter League" });
    const customPayouts = '{"v":2,"places":[{"amountCents":20000},{"amountCents":10000}]}';

    for (const prizeDifference of ["first", "pro_rata", "carry"] as const) {
      const { tournament } = await poolTournament({ seasonId: season.id, payoutStructure: "custom", customPayouts, prizeDifference }, 8, staff);

      const response = await staff.owner.agent.get(`/api/tournaments/${tournament.id}/prize-pool`);

      expect(response.status).toBe(200);
      expect(response.body.breakdown.payouts.map((payout: { amountCents: number }) => payout.amountCents)).toEqual([20_000, 10_000]);
      // $360 available, $300 paid: the $60 left is the club's; nothing is carried over, so no game is named.
      expect(response.body.breakdown).toMatchObject({ net: 30_000, impliedRake: 10_000 });
      expect(response.body.breakdown.difference).toEqual({ availableCents: 36_000, setCents: 30_000, cents: 6_000, keptByClubCents: 6_000, addedByClubCents: 0 });
      expect(response.body).not.toHaveProperty("carryTarget");
      expect(response.body.display).toMatchObject({ source: "live", totalCents: 30_000 });
    }
  });

  it("stores percentages adding up to 100% as the classic list every earlier build reads", async () => {
    const { staff, tournament } = await poolTournament();

    const response = await put(staff.owner.agent, tournament.id, { payoutStructure: "custom", places: [percent(60), percent(40)] });

    expect(response.status).toBe(200);
    expect((await row(tournament.id)).customPayouts).toBe("[60,40]");
    expect(response.body.prizePool.breakdown.structure).toEqual({ requested: "custom", used: "custom", basisPoints: [6000, 4000] });
    expect((await activity(tournament.id))[0].description).toBe("Payouts changed to Custom: 1st 60%, 2nd 40%");
  });

  it("switches to a standard structure, keeping the custom places for when Custom is picked again", async () => {
    const { staff, tournament } = await poolTournament({ payoutStructure: "custom", customPayouts: "[70,30]" });

    const response = await put(staff.owner.agent, tournament.id, { payoutStructure: "top5", reason: "Bigger field" });

    expect(response.status).toBe(200);
    expect(await row(tournament.id)).toMatchObject({ payoutStructure: "top5", customPayouts: "[70,30]" });
    expect(response.body.prizePool.breakdown.structure).toEqual({ requested: "top5", used: "top5", basisPoints: [4000, 2500, 2000, 1000, 500] });
    expect((await activity(tournament.id))[0].description).toBe("Payouts changed to Top 5 (40/25/20/10/5) (Bigger field)");
    expect((await audits(tournament.id))[0].data).toMatchObject({
      before: { payoutStructure: "custom", customPayouts: "[70,30]" },
      after: { payoutStructure: "top5", customPayouts: "[70,30]" },
    });
  });

  it("writes and logs nothing for what is stored, however the stored list is spaced", async () => {
    const { staff, tournament } = await poolTournament({ payoutStructure: "custom", customPayouts: "[50, 30, 20]" });

    const same = await put(staff.owner.agent, tournament.id, { payoutStructure: "custom", places: [percent(50), percent(30), percent(20)], reason: "Again" });
    await put(staff.owner.agent, tournament.id, { payoutStructure: "top3" });
    const again = await put(staff.owner.agent, tournament.id, { payoutStructure: "top3" });

    expect(same.status).toBe(200);
    expect(again.status).toBe(200);
    expect((await row(tournament.id)).customPayouts).toBe("[50, 30, 20]");
    expect((await activity(tournament.id)).map((entry) => entry.description)).toEqual(["Payouts changed to Top 3 (50/30/20)"]);
    expect(await audits(tournament.id)).toHaveLength(1);
  });

  it("pays fixed places that need more than the pool as set, the club adding the rest (round 5, item 16)", async () => {
    const { staff, tournament } = await poolTournament();

    const response = await put(staff.owner.agent, tournament.id, { payoutStructure: "custom", places: [amount("300"), amount("100")] });

    expect(response.status).toBe(200);
    expect((await row(tournament.id)).customPayouts).toBe('{"v":2,"places":[{"amountCents":30000},{"amountCents":10000}]}');
    expect(response.body.prizePool.breakdown.structure).toEqual({
      requested: "custom",
      used: "custom",
      basisPoints: [7500, 2500],
      places: [
        { kind: "amount", amountCents: 30_000 },
        { kind: "amount", amountCents: 10_000 },
      ],
    });
    expect(response.body.prizePool.breakdown).toMatchObject({ net: 40_000, impliedRake: 0, difference: { cents: -4_000, addedByClubCents: 4_000 } });
    expect(response.body.prizePool.display.rows.map((place: { amountCents: number }) => place.amountCents)).toEqual([30_000, 10_000]);
    expect((await activity(tournament.id))[0].description).toBe("Payouts changed to Custom: 1st $300, 2nd $100; Added by the club: $40");
  });

  it("pays a % place and a $ place that swap order at this pool as set, saying so everywhere and at finalize (R5REV1-PAY-01)", async () => {
    const { staff, tournament } = await poolTournament();

    // From the $360 available: 1st 30% = $108, 2nd $200; the $52 left is the club's, so the prize pool is $308.
    const response = await put(staff.owner.agent, tournament.id, { payoutStructure: "custom", places: [percent(30), amount("200")] });

    expect(response.status).toBe(200);
    expect(response.body.prizePool.breakdown.structure).toMatchObject({ used: "custom", warning: "At this prize pool 2nd pays $200, more than 1st ($108)" });
    expect(response.body.prizePool.breakdown.payouts.map((place: { amountCents: number }) => place.amountCents)).toEqual([10_800, 20_000]);
    const preview = await staff.owner.agent.post(`/api/tournaments/${tournament.id}/finalize/preview`).send({});
    expect(preview.body.warnings).toContain("At this prize pool 2nd pays $200, more than 1st ($108)");
  });

  it("is allowed while the pool is locked, and refused once the tournament is completed or cancelled", async () => {
    const { staff, tournament: locked } = await poolTournament({ prizePoolLocked: true }, 2);
    const { tournament: completed } = await poolTournament({ status: "completed" }, 2, staff);
    const { tournament: cancelled } = await poolTournament({ status: "cancelled" }, 2, staff);

    expect((await put(staff.owner.agent, locked.id, { payoutStructure: "top3" })).status).toBe(200);
    for (const closed of [completed, cancelled]) {
      const response = await put(staff.owner.agent, closed.id, { payoutStructure: "custom", places: [percent(100)] });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe("TOURNAMENT_CLOSED");
      expect(await row(closed.id)).toMatchObject({ payoutStructure: "standard", customPayouts: null });
    }
  });

  it.each([
    ["no places for Custom", { payoutStructure: "custom" }, [["places"]]],
    // A place (or a list) its own rule refuses is not judged again by the domain's rules: one issue each.
    ["no places at all", { payoutStructure: "custom", places: [] }, [["places"]]],
    ["percentages over 100%", { payoutStructure: "custom", places: [percent(60), percent(50)] }, [["places"]]],
    ["a place paying a bigger share than the one above", { payoutStructure: "custom", places: [percent(30), percent(40)] }, [["places", 1]]],
    ["a fixed place paying more than the one above", { payoutStructure: "custom", places: [amount("100"), amount("150")] }, [["places", 1]]],
    ["more than 2 decimal places", { payoutStructure: "custom", places: [percent(12.345)] }, [["places", 0]]],
    ["a $0 place", { payoutStructure: "custom", places: [percent(90), amount("0")] }, [["places", 1]]],
    ["an amount that is not one", { payoutStructure: "custom", places: [amount("ten")] }, [["places", 0, "amount"]]],
    ["an unknown structure", { payoutStructure: "top4" }, [["payoutStructure"]]],
  ])("answers 400 VALIDATION for %s, the issue at the place", async (_case, body, paths) => {
    const { staff, tournament } = await poolTournament({}, 1);

    const response = await put(staff.owner.agent, tournament.id, body);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION");
    expect((response.body.details as Array<{ path: unknown[] }>).map((issue) => issue.path)).toEqual(paths);
    expect(await activity(tournament.id)).toHaveLength(0);
  });

  it("answers 404 for an unknown tournament", async () => {
    const { agent } = await signIn();

    expect((await put(agent, UNKNOWN_ID, { payoutStructure: "standard" })).status).toBe(404);
  });

  it("is what finalize pays, with the places and the leftover kept by the club frozen in the snapshot, whatever an old page chose", async () => {
    const { staff, tournament, registrations } = await poolTournament({}, 4);
    await bustAllBut(registrations, 1);
    // $180: the places pay $100, 20% ($36) and $20; the $24 left over is the club's, though a page loaded before round 7 said "first".
    await put(staff.owner.agent, tournament.id, { payoutStructure: "custom", places: [amount("100"), percent(20), amount("20")], prizeDifference: "first" });

    const response = await staff.owner.agent.post(`/api/tournaments/${tournament.id}/finalize`);

    expect(response.status).toBe(200);
    expect(response.body.snapshot.pool.structure).toMatchObject({
      requested: "custom",
      used: "custom",
      places: [
        { kind: "amount", amountCents: 10_000 },
        { kind: "percent", basisPoints: 2000 },
        { kind: "amount", amountCents: 2_000 },
      ],
    });
    expect(response.body.snapshot.paid.map((place: { amountCents: number }) => place.amountCents)).toEqual([10_000, 3_600, 2_000]);
    expect(response.body.snapshot.algorithm).toBe("v3-floor-remainder-fee");
    expect(response.body.snapshot.pool.difference).toEqual({ availableCents: 18_000, setCents: 15_600, cents: 2_400, keptByClubCents: 2_400, addedByClubCents: 0 });
    const prizes = await testDb().select().from(tournamentRegistrations).where(eq(tournamentRegistrations.tournamentId, tournament.id));
    expect(prizes.map((registration) => registration.prizeAmount).sort()).toEqual(["100.00", "20.00", "36.00", null].sort());
    expect((await activity(tournament.id)).map((entry) => entry.description)).toContain(
      "Leftover $24 → AP: the prizes add up to $156 of the $180 available for prizes",
    );
  });

  it("finalizes the prizes exactly as set when the club keeps the leftover", async () => {
    const { staff, tournament, registrations } = await poolTournament({}, 4);
    await bustAllBut(registrations, 1);
    await put(staff.owner.agent, tournament.id, { payoutStructure: "custom", places: [amount("100"), percent(20), amount("20")] });

    const response = await staff.owner.agent.post(`/api/tournaments/${tournament.id}/finalize`);

    expect(response.status).toBe(200);
    expect(response.body.snapshot.paid.map((place: { amountCents: number }) => place.amountCents)).toEqual([10_000, 3_600, 2_000]);
    expect(response.body.snapshot.pool).toMatchObject({ netCents: 15_600, impliedRakeCents: 4_400, difference: { keptByClubCents: 2_400 } });
    const [audit] = (await audits(tournament.id)).filter((entry) => entry.action === "tournament.finalize");
    expect(audit.data).toMatchObject({ netCents: 15_600, difference: { cents: 2_400, keptByClubCents: 2_400, addedByClubCents: 0 } });
  });

  it("pays every standard structure by the shared v3 rule, the rounding remainder to the club's fee (round 7)", async () => {
    const { staff, tournament } = await poolTournament({ buyInAmount: "47.35" }, 7);

    for (const key of Object.keys(PAYOUT_STRUCTURES) as StandardPayoutKey[]) {
      const response = await put(staff.owner.agent, tournament.id, { payoutStructure: key });
      const { net, netAfterAp, payouts, difference } = (response.body as ApUpdateResponse).prizePool.breakdown;

      // Top 8 and Top 9 have more places than the 7 players: those places are not paid, and what they would pay is the club's too (R7FREV0-MONEY-01).
      const places = allocatePayouts(netAfterAp, PAYOUT_STRUCTURES[key]);
      const unfilled = places.slice(7).reduce((sum, place) => sum + place.amountCents, 0);
      expect(payouts).toEqual(places.slice(0, 7));
      expect(payouts.every((payout) => payout.amountCents % 100 === 0)).toBe(true);
      expect(net).toBe(payouts.reduce((sum, payout) => sum + payout.amountCents, 0));
      expect(difference.keptByClubCents).toBe(netAfterAp - net);
      expect(difference.keptByClubCents - unfilled).toBeLessThan(100 * places.length);
    }
  });
});

/**
 * Custom places the payout editor can send for a pool of about `poolCents`: percentages never increasing
 * and adding up to at most 40%, amounts never increasing and adding up to at most 45% of the pool, so
 * most fit it; one run in four triples the amounts, so some need more than the pool (the club adds it).
 */
const placesFor = (poolCents: number) =>
  fc
    .tuple(fc.array(fc.boolean(), { minLength: 1, maxLength: 6 }), fc.nat({ max: 3 }))
    .chain(([kinds, over]) =>
      fc
        .tuple(
          fc.array(fc.integer({ min: 1, max: Math.floor(4_000 / kinds.length) }), { minLength: kinds.length, maxLength: kinds.length }),
          fc.array(fc.integer({ min: 1, max: Math.max(1, Math.floor((poolCents * 0.45) / kinds.length)) }), {
            minLength: kinds.length,
            maxLength: kinds.length,
          }),
        )
        .map(([shares, cents]) => {
          const percents = [...shares].sort((a, b) => b - a);
          const amounts = [...cents].sort((a, b) => b - a).map((value) => (over === 0 ? value * 3 : value));
          let p = 0;
          let a = 0;
          return kinds.map((isPercent): PayoutPlaceInput => (isPercent ? percent(percents[p++] / 100) : amount((amounts[a++] / 100).toFixed(2))));
        }),
    );

const gameArbitrary = fc
  .record({
    players: fc.integer({ min: 2, max: 8 }),
    buyInCents: fc.integer({ min: 500, max: 20_000 }),
    stillIn: fc.integer({ min: 2, max: 4 }),
    /** How the players still in split what they share: by these weights, whatever is left to the first. */
    dealWeights: fc.array(fc.nat({ max: 100 }), { minLength: 4, maxLength: 4 }),
    /** What a page loaded before round 7 may still send: it changes nothing (the leftover is the club's). */
    prizeDifference: fc.constantFrom(undefined, "club", "first", "pro_rata", "carry"),
  })
  .chain((game) => placesFor(game.players * game.buyInCents * 0.9).map((places) => ({ ...game, places })));

describe("payouts with fixed places, and deals (property)", () => {
  it("always pay each place as set, account for the money available to the cent, and a deal always shares exactly what the places still in pay", async () => {
    const staff = await clubWithStaff({ rakeLabel: "AP" });
    await fc.assert(
      fc.asyncProperty(gameArbitrary, async ({ players, buyInCents, places, stillIn, dealWeights, prizeDifference }) => {
        const { tournament, registrations } = await poolTournament({ buyInAmount: (buyInCents / 100).toFixed(2) }, players, staff);
        const saved = await put(staff.owner.agent, tournament.id, { payoutStructure: "custom", places, prizeDifference });
        expect(saved.status).toBe(200);
        const stored = parseCustomPayouts((await row(tournament.id)).customPayouts);
        expect(stored.ok).toBe(true);

        const { breakdown } = (saved.body as ApUpdateResponse).prizePool;
        const { difference } = breakdown;
        expect(breakdown.payouts.reduce((sum, payout) => sum + payout.amountCents, 0)).toBe(breakdown.net > 0 ? breakdown.net : 0);
        // The prizes, the club's fee (its AP and the leftover) and what it adds account for every cent paid in.
        expect(breakdown.net + breakdown.rake.applied + difference.keptByClubCents - difference.addedByClubCents).toBe(breakdown.gross.total);
        expect(difference.keptByClubCents * difference.addedByClubCents).toBe(0);
        if (breakdown.structure.used === "custom" && breakdown.structure.places) {
          breakdown.payouts.forEach((payout, index) => {
            const place = breakdown.structure.places?.[index];
            const own = place?.kind === "amount" ? place.amountCents : Math.floor((breakdown.netAfterAp * (place?.basisPoints ?? 0)) / 1_000_000) * 100;
            // Every place, 1st included, pays exactly its own amount: nothing left over is added to any place.
            expect(payout.amountCents).toBe(own);
          });
        }

        const dealers = Math.min(stillIn, players);
        await bustAllBut(registrations, dealers);
        const preview = await staff.owner.agent
          .post(`/api/tournaments/${tournament.id}/finalize/preview`)
          .send({ finishOrder: registrations.slice(-dealers).map((r) => r.id) });
        const { dealable } = preview.body;
        expect(dealable.players).toHaveLength(dealers);
        const ids: string[] = dealable.players.map((player: { registrationId: string }) => player.registrationId);
        const weights = dealWeights.slice(0, dealers);
        const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
        const split =
          totalWeight === 0
            ? evenChop(dealable.totalCents, ids)
            : ids.map((registrationId, index) => ({ registrationId, amountCents: Math.floor((dealable.totalCents * weights[index]) / totalWeight) }));
        split[0].amountCents += dealable.totalCents - split.reduce((sum, share) => sum + share.amountCents, 0);
        const finalized = await staff.owner.agent.post(`/api/tournaments/${tournament.id}/finalize`).send({
          finishOrder: registrations.slice(-dealers).map((r) => r.id),
          deal: { amounts: split.map(({ registrationId, amountCents }) => ({ registrationId, amount: (amountCents / 100).toFixed(2) })), reason: "Chip chop" },
        });
        expect(finalized.status).toBe(200);
        const results = await testDb().select().from(tournamentRegistrations).where(eq(tournamentRegistrations.tournamentId, tournament.id));
        const cents = (value: string | null) => (value === null ? 0 : Math.round(Number(value) * 100));
        const paidOut = results.reduce((sum, result) => sum + cents(result.prizeAmount), 0);
        const planned = breakdown.payouts.slice(0, players).reduce((sum, payout) => sum + payout.amountCents, 0);
        expect(paidOut).toBe(planned);
        for (const { registrationId, amountCents } of split) {
          expect(cents(results.find((result) => result.id === registrationId)?.prizeAmount ?? null)).toBe(amountCents);
        }
        const dealt = results.filter((result) => !result.isEliminated).reduce((sum, result) => sum + cents(result.prizeAmount), 0);
        expect(dealt).toBe(dealable.totalCents);
      }),
      { numRuns: 25 },
    );
  });
});
