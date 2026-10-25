/**
 * The payout editor (round 5, item 1): PUT /api/tournaments/:id/prize-pool/payouts
 * (server/services/payouts.ts). A standard structure, or custom places each a percentage of the pool or
 * a fixed amount, changed mid-game (also while the pool is locked) until the tournament closes; stored
 * backwards-compatibly in custom_payouts; logged publicly with its reason and audited; and what every
 * screen and finalize then pay.
 */
import { eq } from "drizzle-orm";
import fc from "fast-check";
import type request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import type { ApUpdateResponse, PayoutPlaceInput } from "@shared/api/prize-pool";
import { findForbiddenKeys } from "@shared/api/public";
import { evenChop } from "@shared/domain/deal";
import { allocatePayouts, parseCustomPayouts, PAYOUT_STRUCTURES, type StandardPayoutKey } from "@shared/domain/payouts";
import { PRIZE_DIFFERENCE_CHOICES } from "@shared/domain/prize-difference";
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

  it("pays custom places exactly as set, the club keeping the leftover by default, logged with the reason and audited", async () => {
    const { staff, tournament } = await poolTournament();

    // $360: 50% is $180, $100 fixed, 10% is $36; the $44 left over the club keeps unless told otherwise.
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
    expect(body.prizePool.breakdown).toMatchObject({ net: 31_600, impliedRake: 8_400, difference: { choice: "club", cents: 4_400, keptByClubCents: 4_400 } });
    expect(body.prizePool.display).toMatchObject({ source: "live", totalCents: 31_600, undistributedCents: 0 });

    const [entry] = await activity(tournament.id);
    expect(entry).toMatchObject({
      eventType: "payouts_changed",
      description: "Payouts changed to Custom: 1st 50%, 2nd $100, 3rd 10%; $44 left over: the club keeps it (Short field)",
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
      prizeDifference: "club",
      difference: {
        choice: "club",
        availableCents: 36_000,
        setCents: 31_600,
        cents: 4_400,
        keptByClubCents: 4_400,
        addedToPrizesCents: 0,
        carriedOverCents: 0,
        addedByClubCents: 0,
      },
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
          prizeDifference: { before: null, after: null },
        },
      },
    ]);
  });

  it("pays the leftover where the TD chose: to 1st, shared across the places, or carried over to the season (round 5, item 16)", async () => {
    const { staff, tournament } = await poolTournament();
    const places = [percent(50), amount("100"), percent(10)];
    const paid = (response: { body: ApUpdateResponse }) => response.body.prizePool.breakdown.payouts.map((payout) => payout.amountCents);

    const first = await put(staff.owner.agent, tournament.id, { payoutStructure: "custom", places, prizeDifference: "first" });
    expect(first.status).toBe(200);
    expect((await row(tournament.id)).prizeDifference).toBe("first");
    expect(paid(first)).toEqual([22_400, 10_000, 3_600]);
    expect((await activity(tournament.id))[0].description).toBe("Payouts changed to Custom: 1st 50%, 2nd $100, 3rd 10%; $44 left over: it goes to 1st");

    // The choice alone is a change, logged on its own.
    const shared = await put(staff.owner.agent, tournament.id, { payoutStructure: "custom", places, prizeDifference: "pro_rata" });
    expect(paid(shared)).toEqual([20_600, 11_300, 4_100]);
    expect(shared.body.prizePool.breakdown.net).toBe(36_000);
    const carried = await put(staff.owner.agent, tournament.id, { payoutStructure: "custom", places, prizeDifference: "carry" });
    expect(paid(carried)).toEqual([18_000, 10_000, 3_600]);
    expect(carried.body.prizePool.breakdown).toMatchObject({ impliedRake: 4_000, difference: { carriedOverCents: 4_400 } });
    const descriptions = (await activity(tournament.id)).map((entry) => entry.description);
    expect(descriptions).toContain("Leftover prize money: Share it across the paid places; $44 left over: it is shared across the paid places");
    expect(descriptions).toContain("Leftover prize money: Carry it over; $44 left over: it is carried over to the next tournament");

    // Sending the same choice again writes nothing.
    const logged = descriptions.length;
    await put(staff.owner.agent, tournament.id, { payoutStructure: "custom", places, prizeDifference: "carry" });
    expect(await activity(tournament.id)).toHaveLength(logged);
  });

  it("names the season money is carried over to", async () => {
    const staff = await clubWithStaff({ rakeLabel: "AP" });
    const season = await createSeason({ clubId: staff.club.id, name: "Winter League" });
    const { tournament } = await poolTournament({ seasonId: season.id }, 8, staff);

    const response = await put(staff.owner.agent, tournament.id, { payoutStructure: "custom", places: [amount("200"), amount("100")], prizeDifference: "carry" });

    expect(response.body.prizePool.carryTarget).toBe("Winter League");
    expect((await activity(tournament.id))[0].description).toBe("Payouts changed to Custom: 1st $200, 2nd $100; $60 left over: it is carried over to Winter League");
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
    expect((await activity(tournament.id))[0].description).toBe("Payouts changed to Custom: 1st $300, 2nd $100; $40 added by the club");
  });

  it("pays a % place and a $ place that swap order at this pool as set, saying so everywhere and at finalize (R5REV1-PAY-01)", async () => {
    const { staff, tournament } = await poolTournament();

    // From the $360 pool: 1st 30% = $108 + $52 left over (added to 1st) = $160, 2nd $200.
    const response = await put(staff.owner.agent, tournament.id, { payoutStructure: "custom", places: [percent(30), amount("200")], prizeDifference: "first" });

    expect(response.status).toBe(200);
    expect(response.body.prizePool.breakdown.structure).toMatchObject({ used: "custom", warning: "From the $360 prize pool 2nd pays $200, more than 1st ($160)" });
    expect(response.body.prizePool.breakdown.payouts.map((place: { amountCents: number }) => place.amountCents)).toEqual([16_000, 20_000]);
    const preview = await staff.owner.agent.post(`/api/tournaments/${tournament.id}/finalize/preview`).send({});
    expect(preview.body.warnings).toContain("From the $360 prize pool 2nd pays $200, more than 1st ($160)");
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

  it("is what finalize pays, with the places and where the leftover went frozen in the snapshot", async () => {
    const { staff, tournament, registrations } = await poolTournament({}, 4);
    await bustAllBut(registrations, 1);
    // $180: the places pay $100, 20% ($36) and $20; the $24 left over goes to 1st, as the TD chose.
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
    expect(response.body.snapshot.paid.map((place: { amountCents: number }) => place.amountCents)).toEqual([12_400, 3_600, 2_000]);
    expect(response.body.snapshot.pool.difference).toMatchObject({ choice: "first", cents: 2_400, addedToPrizesCents: 2_400 });
    const prizes = await testDb().select().from(tournamentRegistrations).where(eq(tournamentRegistrations.tournamentId, tournament.id));
    expect(prizes.map((registration) => registration.prizeAmount).sort()).toEqual(["124.00", "20.00", "36.00", null].sort());
    expect((await activity(tournament.id)).map((entry) => entry.description)).toContain(
      "The prizes add up to $156, $24 less than the $180 available for prizes: it goes to 1st",
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
    expect(audit.data).toMatchObject({ netCents: 15_600, difference: { choice: "club", keptByClubCents: 2_400 } });
  });

  it("pays every standard structure exactly as before round 5", async () => {
    const { staff, tournament } = await poolTournament({ buyInAmount: "47.35" }, 7);

    for (const key of Object.keys(PAYOUT_STRUCTURES) as StandardPayoutKey[]) {
      const response = await put(staff.owner.agent, tournament.id, { payoutStructure: key });
      const { net, payouts } = (response.body as ApUpdateResponse).prizePool.breakdown;

      expect(payouts).toEqual(allocatePayouts(net, PAYOUT_STRUCTURES[key]));
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
    prizeDifference: fc.constantFrom(...PRIZE_DIFFERENCE_CHOICES),
  })
  .chain((game) => placesFor(game.players * game.buyInCents * 0.9).map((places) => ({ ...game, places })));

describe("payouts with fixed places, and deals (property)", () => {
  it("always pay the pool to the cent, and a deal always shares exactly what the places still in pay", async () => {
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
        expect(breakdown.net).toBe(breakdown.netAfterAp - difference.keptByClubCents - difference.carriedOverCents + difference.addedByClubCents);
        if (breakdown.structure.used === "custom" && breakdown.structure.places) {
          breakdown.payouts.slice(1).forEach((payout, index) => {
            const place = breakdown.structure.places?.[index + 1];
            const own = place?.kind === "amount" ? place.amountCents : Math.floor((breakdown.netAfterAp * (place?.basisPoints ?? 0)) / 1_000_000) * 100;
            // Only a share of the leftover is added below 1st, and only when the TD chose to share it.
            if (prizeDifference === "pro_rata") expect(payout.amountCents).toBeGreaterThanOrEqual(own);
            else expect(payout.amountCents).toBe(own);
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
