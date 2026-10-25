/**
 * A tournament's prize pool and AP (server/routes/prize-pool.ts, spec §5.2 #19-#20, D11-D16): the
 * public breakdown worked out on the server with shared/domain, the manual AP total / manual prize
 * pool (mutually exclusive, allowed while locked, refused once completed or cancelled) and the AP
 * rates. Every change is logged to the public feed without user ids and audited with the actor.
 */
import { eq } from "drizzle-orm";
import type request from "supertest";
import { beforeEach, describe, expect, expectTypeOf, it } from "vitest";
import type { Json } from "@shared/api/common";
import type { ApUpdateResponse } from "@shared/api/prize-pool";
import { findForbiddenKeys } from "@shared/api/public";
import { activityLog, auditLog, tournamentRegistrations, tournaments } from "@shared/schema";
import type { MoneyResponse } from "../../server/services/prize-pool";
import { createPlayer, createRegistration, createTournament, type NewTournament } from "../factories";
import { anon, resetDb, signIn, testDb, UNKNOWN_ID } from "../helpers";
import { agentFor, type ClubStaffAgents, clubWithStaff, MANAGER_ROUTE, VISITORS } from "../helpers/club-staff";

beforeEach(resetDb);

/** A tournament in a club whose AP label is "AP", with `players` paid registrations of one buy-in each. */
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
    const player = await createPlayer({ name: `Player ${i + 1}`, phone: `021 555 01${i}`, email: `p${i}@example.test` });
    registrations.push(await createRegistration({ tournamentId: tournament.id, playerId: player.id, paymentConfirmed: true }));
  }
  return { staff: club, tournament, registrations };
}

const poolPath = (id: string) => `/api/tournaments/${id}/prize-pool`;
const row = async (id: string) => (await testDb().select().from(tournaments).where(eq(tournaments.id, id)))[0];
const activity = (id: string) => testDb().select().from(activityLog).where(eq(activityLog.tournamentId, id));
const audits = (id: string) => testDb().select().from(auditLog).where(eq(auditLog.targetId, id));

describe("response types", () => {
  it("serialise to the shared DTOs", () => {
    expectTypeOf<Json<MoneyResponse>>().toExtend<ApUpdateResponse>();
  });
});

describe("GET /api/tournaments/:id/prize-pool", () => {
  it("works the pool out on the server with the shared maths, for anyone, without personal data", async () => {
    const { tournament } = await poolTournament();

    const response = await (await anon()).get(poolPath(tournament.id));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      tournamentId: tournament.id,
      status: "in_progress",
      rakeLabel: "AP",
      locked: false,
      estimated: true,
      breakdown: {
        algorithm: "v2-floor-remainder-first",
        counts: { registrations: 8, buyIns: 8 },
        gross: { total: 40_000 },
        rake: { calculated: 4_000, override: null, applied: 4_000 },
        net: 36_000,
        netSource: "calculated",
        structure: { used: "standard", basisPoints: [5000, 3000, 2000] },
      },
      display: {
        source: "live",
        rows: [
          { position: 1, amountCents: 18_000, percentage: 50 },
          { position: 2, amountCents: 10_800, percentage: 30 },
          { position: 3, amountCents: 7_200, percentage: 20 },
        ],
        totalCents: 36_000,
      },
      adjustment: null,
    });
    expect(response.body.breakdown).not.toHaveProperty("legacy");
    expect(findForbiddenKeys(response.body)).toEqual([]);
  });

  it('labels the rake "Rake" for a club without a label, and stops calling the pool an estimate once locked', async () => {
    const { tournament } = await poolTournament({ prizePoolLocked: true }, 2, await clubWithStaff());

    const response = await (await anon()).get(poolPath(tournament.id));

    expect(response.body).toMatchObject({ rakeLabel: "Rake", locked: true, estimated: false });
  });

  it("shows a finalized tournament's payouts from its snapshot, with the players' names", async () => {
    // $135 pays $67 + $40 + $27, and the leftover $1 to 1st.
    const { staff, tournament, registrations } = await poolTournament({}, 3);
    await testDb()
      .update(tournamentRegistrations)
      .set({ isEliminated: true, eliminationTime: new Date("2026-03-01T20:00:00Z") })
      .where(eq(tournamentRegistrations.id, registrations[0].id));
    await testDb()
      .update(tournamentRegistrations)
      .set({ isEliminated: true, eliminationTime: new Date("2026-03-01T21:00:00Z") })
      .where(eq(tournamentRegistrations.id, registrations[1].id));
    expect((await staff.owner.agent.post(`/api/tournaments/${tournament.id}/finalize`)).status).toBe(200);
    // Settings changed after finalizing must not change what is shown as paid (D20).
    await testDb().update(tournaments).set({ buyInAmount: "500.00" }).where(eq(tournaments.id, tournament.id));

    const response = await (await anon()).get(poolPath(tournament.id));

    expect(response.body.display).toEqual({
      source: "snapshot",
      rows: [
        { position: 1, amountCents: 6_800, percentage: 50, registrationId: registrations[2].id, playerName: "Player 3" },
        { position: 2, amountCents: 4_000, percentage: 30, registrationId: registrations[1].id, playerName: "Player 2" },
        { position: 3, amountCents: 2_700, percentage: 20, registrationId: registrations[0].id, playerName: "Player 1" },
      ],
      totalCents: 13_500,
      undistributedCents: 0,
    });
    expect(response.body).toMatchObject({ status: "completed", estimated: false });
  });

  it("shows a tournament finalized before snapshots by its stored prizes", async () => {
    const { tournament, registrations } = await poolTournament({ status: "completed" }, 2);
    await testDb()
      .update(tournamentRegistrations)
      .set({ finalPosition: 1, prizeAmount: "60.00" })
      .where(eq(tournamentRegistrations.id, registrations[1].id));

    const response = await (await anon()).get(poolPath(tournament.id));

    expect(response.body.display).toEqual({
      source: "stored",
      rows: [{ position: 1, amountCents: 6_000, percentage: null, registrationId: registrations[1].id, playerName: "Player 2" }],
      totalCents: 6_000,
      undistributedCents: 0,
    });
  });

  it("answers 404 for an unknown tournament", async () => {
    const response = await (await anon()).get(poolPath(UNKNOWN_ID));

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Tournament not found", code: "NOT_FOUND" });
  });
});

describe("PUT /api/tournaments/:id/prize-pool/adjustment", () => {
  const adjust = (agent: request.Agent, id: string, body: object) => agent.put(`${poolPath(id)}/adjustment`).send(body);

  it.each(VISITORS)("answers a %s as the authorization rules say", async (visitor) => {
    const { staff, tournament } = await poolTournament({}, 2);

    const response = await adjust(await agentFor(visitor, staff), tournament.id, { mode: "ap_override", amount: 5 });

    expect(response.status).toBe(MANAGER_ROUTE[visitor]);
    expect((await row(tournament.id)).rakeOverride).toBe(response.status === 200 ? "5.00" : null);
  });

  it("sets a manual AP total: the pool is the gross less it, and a manual pool is cleared (D12, D13)", async () => {
    const { staff, tournament } = await poolTournament({ manualPrizePool: "500.00" });

    const response = await adjust(staff.manager.agent, tournament.id, { mode: "ap_override", amount: "20", reason: " Low turnout " });

    expect(response.status).toBe(200);
    const stored = await row(tournament.id);
    expect(stored).toMatchObject({
      rakeOverride: "20.00",
      manualPrizePool: null,
      prizePoolAdjustmentReason: "Low turnout",
      prizePoolAdjustedBy: staff.manager.user.id,
    });
    expect(stored.prizePoolAdjustedAt).toBeInstanceOf(Date);
    expect(response.body.tournament).toMatchObject({ id: tournament.id, rakeOverride: "20.00", manualPrizePool: null, viewer: { canManage: true } });
    expect(response.body.prizePool).toMatchObject({
      breakdown: { rake: { calculated: 4_000, override: 2_000, applied: 2_000 }, net: 38_000, netSource: "ap_override" },
      display: { rows: [{ amountCents: 19_000 }, { amountCents: 11_400 }, { amountCents: 7_600 }] },
      adjustment: { reason: "Low turnout", adjustedAt: stored.prizePoolAdjustedAt?.toISOString() },
    });
    expect(response.body.tournament).not.toHaveProperty("prizePoolAdjustedBy");

    const [entry] = await activity(tournament.id);
    expect(entry).toMatchObject({
      eventType: "prize_pool_adjusted",
      description: "AP set manually to $20 (the rates give $40) - Low turnout",
      playerId: null,
    });
    expect(JSON.parse(entry.eventData ?? "")).toEqual({
      mode: "ap_override",
      amountCents: 2_000,
      netCents: 38_000,
      previousNetCents: 50_000,
      reason: "Low turnout",
    });
    expect(findForbiddenKeys(entry)).toEqual([]);
    expect(await audits(tournament.id)).toMatchObject([
      {
        action: "prize_pool.adjust",
        actorUserId: staff.manager.user.id,
        targetType: "tournament",
        data: { mode: "ap_override", amountCents: 2_000, previous: { manualPrizePool: "500.00", rakeOverride: null } },
      },
    ]);
  });

  it("refuses an AP total above the gross (D16)", async () => {
    const { staff, tournament } = await poolTournament({}, 2);

    const response = await adjust(staff.owner.agent, tournament.id, { mode: "ap_override", amount: "100.01" });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: "AP_EXCEEDS_GROSS", details: { grossCents: 10_000 } });
    expect(response.body.error).toBe("The AP cannot be more than the $100 taken in");
    expect((await row(tournament.id)).rakeOverride).toBeNull();
    expect((await adjust(staff.owner.agent, tournament.id, { mode: "ap_override", amount: "100" })).status).toBe(200);
  });

  it("sets a manual prize pool, which may be more than the gross, and clears the AP total", async () => {
    const { staff, tournament } = await poolTournament({ rakeOverride: "10.00" }, 2);

    const response = await adjust(staff.owner.agent, tournament.id, { mode: "manual_pool", amount: 250 });

    expect(response.status).toBe(200);
    expect(await row(tournament.id)).toMatchObject({ manualPrizePool: "250.00", rakeOverride: null });
    expect(response.body.prizePool.breakdown).toMatchObject({ net: 25_000, netSource: "manual_pool", impliedRake: -15_000 });
    expect((await activity(tournament.id))[0].description).toBe("Prize pool set manually to $250 (calculated $90)");
  });

  it("goes back to the calculated pool, clearing both", async () => {
    const { staff, tournament } = await poolTournament({ manualPrizePool: "250.00" }, 2);

    const response = await adjust(staff.owner.agent, tournament.id, { mode: "calculated", reason: "Correction" });

    expect(response.status).toBe(200);
    expect(await row(tournament.id)).toMatchObject({ manualPrizePool: null, rakeOverride: null, prizePoolAdjustmentReason: "Correction" });
    expect((await activity(tournament.id))[0].description).toBe("Prize pool back to the calculated $90 - Correction");
  });

  it("is allowed while the pool is locked (D14), and refused once the tournament is completed or cancelled", async () => {
    const { staff, tournament: locked } = await poolTournament({ prizePoolLocked: true }, 2);
    const { tournament: completed } = await poolTournament({ status: "completed" }, 2, staff);
    const { tournament: cancelled } = await poolTournament({ status: "cancelled" }, 2, staff);

    expect((await adjust(staff.owner.agent, locked.id, { mode: "ap_override", amount: 5 })).status).toBe(200);
    for (const closed of [completed, cancelled]) {
      const response = await adjust(staff.owner.agent, closed.id, { mode: "manual_pool", amount: 5 });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe("TOURNAMENT_CLOSED");
      expect((await row(closed.id)).manualPrizePool).toBeNull();
    }
  });

  it("writes and logs nothing for a change that changes nothing", async () => {
    const { staff, tournament } = await poolTournament({}, 2);

    await adjust(staff.owner.agent, tournament.id, { mode: "calculated" });
    await adjust(staff.owner.agent, tournament.id, { mode: "ap_override", amount: 5, reason: "Promo" });
    const again = await adjust(staff.owner.agent, tournament.id, { mode: "ap_override", amount: "5.00" });

    expect(again.status).toBe(200);
    expect(await activity(tournament.id)).toHaveLength(1);
    expect(await audits(tournament.id)).toHaveLength(1);
  });

  it.each([
    [{ mode: "ap_override" }],
    [{ mode: "ap_override", amount: "-5" }],
    [{ mode: "manual_pool", amount: "12.345" }],
    [{ mode: "everything", amount: 5 }],
    [{}],
  ])("answers 400 for %j", async (body) => {
    const { staff, tournament } = await poolTournament({}, 1);

    const response = await adjust(staff.owner.agent, tournament.id, body);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION");
  });

  it("is what finalize pays", async () => {
    const { staff, tournament, registrations } = await poolTournament({}, 2);
    await testDb()
      .update(tournamentRegistrations)
      .set({ isEliminated: true, eliminationTime: new Date("2026-03-01T20:00:00Z") })
      .where(eq(tournamentRegistrations.id, registrations[0].id));
    await adjust(staff.owner.agent, tournament.id, { mode: "ap_override", amount: 0 });

    const response = await staff.owner.agent.post(`/api/tournaments/${tournament.id}/finalize`);

    expect(response.body.snapshot.paid.map((place: { amountCents: number }) => place.amountCents)).toEqual([5_000, 3_000]);
  });

  it("answers 404 for an unknown tournament", async () => {
    const { agent } = await signIn();

    expect((await adjust(agent, UNKNOWN_ID, { mode: "calculated" })).status).toBe(404);
  });
});

describe("PUT /api/tournaments/:id/prize-pool/rates", () => {
  const rates = (agent: request.Agent, id: string, body: object) => agent.put(`${poolPath(id)}/rates`).send(body);

  it.each(VISITORS)("answers a %s as the authorization rules say", async (visitor) => {
    const { staff, tournament } = await poolTournament({}, 1);

    const response = await rates(await agentFor(visitor, staff), tournament.id, { rakeAmount: "12.5" });

    expect(response.status).toBe(MANAGER_ROUTE[visitor]);
    expect((await row(tournament.id)).rakeAmount).toBe(response.status === 200 ? "12.50" : "10.00");
  });

  it("changes only the rates sent, clears the AP total, and logs it for staff only", async () => {
    const { staff, tournament } = await poolTournament({ rakeOverride: "20.00", rebuyRakeType: "fixed", rebuyRakeAmount: "5.00" });

    const response = await rates(staff.manager.agent, tournament.id, { rakeType: "fixed", rakeAmount: "4", reason: "New season" });

    expect(response.status).toBe(200);
    expect(await row(tournament.id)).toMatchObject({
      rakeType: "fixed",
      rakeAmount: "4.00",
      rebuyRakeType: "fixed",
      rebuyRakeAmount: "5.00",
      rakeOverride: null,
    });
    expect(response.body.prizePool.breakdown).toMatchObject({ rake: { buyIn: 3_200, override: null }, net: 36_800 });
    const [entry] = await activity(tournament.id);
    expect(entry).toMatchObject({
      eventType: "rake_rates_changed",
      description: "AP rates changed: buy-ins 10% → $4 per entry; the manual AP total is cleared - New season",
    });
    expect(await audits(tournament.id)).toMatchObject([
      { action: "prize_pool.rates", actorUserId: staff.manager.user.id, data: { before: { rakeType: "percentage" }, after: { rakeType: "fixed" }, clearedOverride: true } },
    ]);

    const publicFeed = await (await anon()).get(`/api/tournaments/${tournament.id}/activity`);
    const staffFeed = await staff.manager.agent.get(`/api/tournaments/${tournament.id}/activity`);
    expect(publicFeed.body).toEqual([]);
    expect(staffFeed.body.map((e: { eventType: string }) => e.eventType)).toEqual(["rake_rates_changed"]);
  });

  it("keeps the AP total when asked", async () => {
    const { staff, tournament } = await poolTournament({ rakeOverride: "20.00" }, 2);

    await rates(staff.owner.agent, tournament.id, { rakeAmount: "5", keepOverride: true });

    expect(await row(tournament.id)).toMatchObject({ rakeAmount: "5.00", rakeOverride: "20.00" });
  });

  it("keeps the AP total when Edit Tournament changes an AP rate with keepRakeOverride, and clears it without (P4REV2-MONEY-01)", async () => {
    const kept = await poolTournament({ rakeOverride: "20.00" }, 2);
    const cleared = await poolTournament({ rakeOverride: "20.00" }, 2);
    const edit = { rakeAmount: "5" };

    const keeping = await kept.staff.owner.agent.put(`/api/tournaments/${kept.tournament.id}`).send({ ...edit, keepRakeOverride: true });
    const clearing = await cleared.staff.owner.agent.put(`/api/tournaments/${cleared.tournament.id}`).send(edit);

    expect([keeping.status, clearing.status]).toEqual([200, 200]);
    expect(keeping.body).toMatchObject({ rakeAmount: "5.00", rakeOverride: "20.00" });
    expect(await row(kept.tournament.id)).toMatchObject({ rakeAmount: "5.00", rakeOverride: "20.00" });
    expect(await row(cleared.tournament.id)).toMatchObject({ rakeAmount: "5.00", rakeOverride: null });
    expect((await activity(kept.tournament.id)).map((entry) => entry.description)).toEqual(["AP rates changed: buy-ins 10% → 5%"]);
    expect((await activity(cleared.tournament.id)).map((entry) => entry.description)).toEqual(["AP rates changed: buy-ins 10% → 5%; the manual AP total is cleared"]);
    expect((await audits(kept.tournament.id)).map((entry) => entry.data)).toMatchObject([{ clearedOverride: false }]);
  });

  it('stores "0.00" for a rate switched to none', async () => {
    const { staff, tournament } = await poolTournament({}, 1);

    await rates(staff.owner.agent, tournament.id, { rakeType: "none" });

    expect(await row(tournament.id)).toMatchObject({ rakeType: "none", rakeAmount: "0.00" });
  });

  it("names the field of a percentage over 100 or a missing amount", async () => {
    const { staff, tournament } = await poolTournament({}, 1);

    const over = await rates(staff.owner.agent, tournament.id, { rebuyRakeType: "percentage", rebuyRakeAmount: 150 });
    const missing = await rates(staff.owner.agent, tournament.id, { addonRakeType: "fixed" });

    expect(over.status).toBe(400);
    expect(over.body).toMatchObject({ code: "PERCENT_OVER_100", details: { field: "rebuyRakeAmount" } });
    expect(missing.body).toMatchObject({ code: "AMOUNT_REQUIRED", details: { field: "addonRakeAmount" } });
    expect(await activity(tournament.id)).toEqual([]);
  });

  it("refuses a fixed rate above the price of its entry, which would take the pool below zero (P4REV2R2-MONEY-01)", async () => {
    const { staff, tournament } = await poolTournament({ rebuyAmount: "25.00", addonAmount: "25.00" }, 1);
    const agent = staff.owner.agent;

    const overRebuy = await rates(agent, tournament.id, { rebuyRakeType: "fixed", rebuyRakeAmount: "30.00" });
    const overBuyIn = await rates(agent, tournament.id, { rakeType: "fixed", rakeAmount: "50.01" });
    const atPrice = await rates(agent, tournament.id, { addonRakeType: "fixed", addonRakeAmount: "25.00" });

    expect(overRebuy.status).toBe(400);
    expect(overRebuy.body).toEqual({
      error: "$30 per re-buy is more than a re-buy costs ($25): the prize pool would go below zero",
      code: "AMOUNT_OVER_PRICE",
      details: { field: "rebuyRakeAmount" },
    });
    expect(overBuyIn.body).toMatchObject({ code: "AMOUNT_OVER_PRICE", details: { field: "rakeAmount" } });
    expect(atPrice.status).toBe(200);
    expect(await row(tournament.id)).toMatchObject({ rebuyRakeType: "none", rakeType: "percentage", addonRakeType: "fixed", addonRakeAmount: "25.00" });
  });

  it("answers 400 for a request with no rate in it, and writes nothing for rates resent unchanged", async () => {
    const { staff, tournament } = await poolTournament({}, 1);

    expect((await rates(staff.owner.agent, tournament.id, { keepOverride: true })).status).toBe(400);
    expect((await rates(staff.owner.agent, tournament.id, { rakeType: "percentage", rakeAmount: "10" })).status).toBe(200);
    expect(await activity(tournament.id)).toEqual([]);
  });

  it("is refused once the tournament is completed or cancelled", async () => {
    const { staff, tournament } = await poolTournament({ status: "completed" }, 1);

    const response = await rates(staff.owner.agent, tournament.id, { rakeAmount: "5" });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("TOURNAMENT_CLOSED");
  });

  it("keeps the manual AP total when only the high-hand rake changes, on both ways of changing rates (MONEY-P2REV-01)", async () => {
    // 10 × $50 at 10%, a manual AP total of $20: the main pool is $480 whatever the high hand's fee.
    const { staff, tournament } = await poolTournament(
      { rakeOverride: "20.00", enableHighHand: true, highHandAmount: "10.00", highHandRakeType: "fixed", highHandRakeAmount: "10.00" },
      10,
    );

    const viaRates = await rates(staff.owner.agent, tournament.id, { highHandRakeAmount: "5.00" });
    const viaTournament = await staff.owner.agent.put(`/api/tournaments/${tournament.id}`).send({ highHandRakeAmount: "4.00" });

    expect([viaRates.status, viaTournament.status]).toEqual([200, 200]);
    expect(await row(tournament.id)).toMatchObject({ highHandRakeAmount: "4.00", rakeOverride: "20.00" });
    expect(viaTournament.body.rakeOverride).toBe("20.00");
    expect((await (await anon()).get(poolPath(tournament.id))).body.breakdown.net).toBe(48_000);
    expect((await activity(tournament.id)).map((entry) => entry.description)).toEqual([
      "AP rates changed: high hand $10 → $5",
      "AP rates changed: high hand $5 → $4",
    ]);
  });

  it("treats a stored 'none' rate as unchanged whatever amount was kept beside it (MONEY-P2REV-04)", async () => {
    // The old create form kept a typed amount after switching back to no rake.
    const open = await poolTournament({ rakeType: "none", rakeAmount: "5.00", rakeOverride: "20.00" }, 2);
    const closed = await poolTournament({ status: "completed", rakeType: "none", rakeAmount: "5.00" }, 2);
    const resend = { rakeType: "none", rakeAmount: "5.00" };

    const onOpen = await open.staff.owner.agent.put(`/api/tournaments/${open.tournament.id}`).send(resend);
    const onClosed = await closed.staff.owner.agent.put(`/api/tournaments/${closed.tournament.id}`).send(resend);

    expect([onOpen.status, onClosed.status]).toEqual([200, 200]);
    expect(await row(open.tournament.id)).toMatchObject({ rakeOverride: "20.00" });
    expect(await activity(open.tournament.id)).toEqual([]);
    expect(await audits(open.tournament.id)).toEqual([]);
  });
});
