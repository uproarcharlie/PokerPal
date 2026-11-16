import fc from "fast-check";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { Tournament, TournamentRegistration } from "../schema";
import {
  buildFinalizePlan,
  FINALIZE_SNAPSHOT_VERSION,
  planHashInput,
  type FinalizePlan,
  type FinalizePlanInput,
  type FinalizeRegistrationInput,
  type FinalizeTournamentInput,
  type PrizePoolSnapshot,
} from "./finalize";
import { PAYOUT_ALGORITHM } from "./payouts";
import { computePrizePool, payoutsForDisplay } from "./prize-pool";

const FINALIZED_AT = "2026-03-01T23:00:00.000Z";

/** tournaments.prize_difference: a choice stored before round 7, which no plan reads any more (a `Tournament` row carries it). */
type StoredChoice = { prizeDifference?: string | null };

function tournament(overrides: Partial<FinalizeTournamentInput & StoredChoice> = {}): FinalizeTournamentInput {
  return {
    status: "in_progress",
    buyInAmount: "50.00",
    rakeType: "none",
    rakeAmount: "0.00",
    payoutStructure: "standard",
    trackPoints: true,
    prizePoolLocked: true,
    ...overrides,
  };
}

/**
 * `count` paid registrations r01..rNN for players p01..pNN. Everyone but the last `stillIn` busted, the
 * first registration first, ten minutes apart.
 */
function field(count: number, stillIn = 1): FinalizeRegistrationInput[] {
  return Array.from({ length: count }, (_, i) => {
    const n = String(i + 1).padStart(2, "0");
    const busted = i < count - stillIn;
    return {
      id: `r${n}`,
      playerId: `p${n}`,
      buyIns: 1,
      rebuys: 0,
      addons: 0,
      knockouts: 0,
      paymentConfirmed: true,
      isEliminated: busted,
      eliminationTime: busted ? new Date(Date.UTC(2026, 2, 1, 19, 10 * (i + 1))) : null,
    };
  });
}

const names = (registrations: readonly FinalizeRegistrationInput[]) =>
  new Map(registrations.map((r) => [r.playerId, `Player ${r.playerId.slice(1)}`]));

function plan(overrides: Partial<FinalizePlanInput> = {}): FinalizePlan {
  const registrations = overrides.registrations ?? field(8);
  return buildFinalizePlan({
    tournament: tournament(),
    registrations,
    pointsSystem: null,
    allocations: [],
    playerNames: names(registrations),
    finalizedAt: FINALIZED_AT,
    rakeLabel: "AP",
    ...overrides,
  });
}

function okPlan(overrides: Partial<FinalizePlanInput> = {}) {
  const result = plan(overrides);
  if (!result.ok) throw new Error(`expected a plan, got ${result.problem}`);
  return result;
}

/** [registration, position, prize, points] per row. */
const table = (result: ReturnType<typeof okPlan>) =>
  result.rows.map((row) => [row.registrationId, row.finalPosition, row.prizeAmount, row.pointsAwarded]);

describe("buildFinalizePlan: only paid players (round 6)", () => {
  /** field(6) with r05 and r02 unpaid: r05 busted after a $25 re-buy, r02 busted first; r06 won. */
  function withUnpaid(): FinalizeRegistrationInput[] {
    return field(6).map((r) =>
      r.id === "r05"
        ? { ...r, paymentConfirmed: false, rebuys: 1, registrationTime: new Date(Date.UTC(2026, 2, 1, 18, 5)) }
        : r.id === "r02"
          ? { ...r, paymentConfirmed: null, registrationTime: new Date(Date.UTC(2026, 2, 1, 18, 2)) }
          : r,
    );
  }
  const priced = () => tournament({ rebuyAmount: "25.00" });

  it("refuses while anyone in the field has not paid, naming them in sign-up order with what they owe", () => {
    const result = plan({ tournament: priced(), registrations: withUnpaid() });

    expect(result).toMatchObject({ ok: false, problem: "UNPAID_PLAYERS" });
    expect(result.unpaid).toEqual([
      { registrationId: "r02", playerId: "p02", playerName: "Player 02", amountDueCents: 5_000 },
      { registrationId: "r05", playerId: "p05", playerName: "Player 05", amountDueCents: 7_500 },
    ]);
    // Their money is not in the pool: four paid buy-ins of $50.
    expect(result.prizePool.net).toBe(20_000);
    expect(result.prizePool.counts).toMatchObject({ registrations: 4, rebuys: 0 });
  });

  it("asks for the finishing order first: it is needed either way", () => {
    const registrations = withUnpaid().map((r) => (r.id === "r04" ? { ...r, isEliminated: false, eliminationTime: null } : r));
    expect(plan({ registrations })).toMatchObject({ ok: false, problem: "ACTIVE_PLAYERS_NEED_ORDER" });
    expect(plan({ registrations, finishOrder: ["r06", "r04"] })).toMatchObject({ ok: false, problem: "UNPAID_PLAYERS" });
  });

  it("leaves them out when told to: not ranked, paid or scored, and the snapshot says who", () => {
    const result = okPlan({
      tournament: priced(),
      registrations: withUnpaid(),
      pointsSystem: { participationPoints: 5, knockoutPoints: null },
      allocations: [{ position: 1, positionEnd: null, points: 100 }],
      excludeUnpaid: true,
    });

    expect(table(result)).toEqual([
      ["r06", 1, "100.00", 100],
      ["r04", 2, "60.00", 5],
      ["r03", 3, "40.00", 5],
      ["r01", 4, null, 5],
    ]);
    expect(result.snapshot.entrants).toBe(4);
    expect(result.snapshot.pool.netCents).toBe(20_000);
    expect(result.unpaid.map((player) => player.registrationId)).toEqual(["r02", "r05"]);
    expect(result.warnings).toContain("2 players who have not paid are left out, not ranked, paid or scored: Player 02, Player 05");
    expect(result.snapshot.warnings).toContain("2 players who have not paid are left out, not ranked, paid or scored: Player 02, Player 05");
  });

  it("orders only the paid players still in once the unpaid ones are left out", () => {
    const registrations = withUnpaid().map((r) => (r.id === "r05" ? { ...r, isEliminated: false, eliminationTime: null } : r));
    expect(plan({ registrations, finishOrder: ["r06", "r05"], excludeUnpaid: true })).toMatchObject({ ok: false, problem: "INVALID_FINISH_ORDER" });
    // One paid player is still in: no order is needed.
    const result = okPlan({ registrations, excludeUnpaid: true });
    expect(result.activePlayers.map((player) => player.registrationId)).toEqual(["r06"]);
    expect(result.rows[0]).toMatchObject({ registrationId: "r06", finalPosition: 1 });
  });

  it("pays more once a payment is confirmed: the player is ranked and the pool grows", () => {
    const confirmed = withUnpaid().map((r) => (r.id === "r05" ? { ...r, paymentConfirmed: true } : r));
    const result = okPlan({ tournament: priced(), registrations: confirmed, excludeUnpaid: true });

    expect(result.prizePool.netAfterAp).toBe(27_500);
    expect(table(result).map(([id]) => id)).toEqual(["r06", "r05", "r04", "r03", "r01"]);
    expect(result.unpaid.map((player) => player.registrationId)).toEqual(["r02"]);
  });

  it("clears what an earlier finalize stored for a player left out, and nothing for anyone else", () => {
    const snapshot = okPlan().snapshot;
    const registrations = withUnpaid().map((r, i) => ({ ...r, finalPosition: 6 - i, prizeAmount: i === 5 ? "200.00" : null, pointsAwarded: 1 }));
    const result = okPlan({ tournament: tournament({ status: "completed", prizePoolSnapshot: snapshot }), registrations, excludeUnpaid: true });

    expect(result.clearedRegistrationIds).toEqual(["r02", "r05"]);
    expect(okPlan().clearedRegistrationIds).toEqual([]);
  });

  it("pays a correction of a tournament completed before snapshots from its paid players only", () => {
    // Shown as it was paid (every entry counts), but a new finalize pays as today's rule has it.
    const result = okPlan({ tournament: tournament({ status: "completed", prizePoolSnapshot: null }), registrations: withUnpaid(), excludeUnpaid: true });
    expect(result.prizePool.net).toBe(20_000);
  });

  it("changes the plan hash when a player is left out or comes back paid", () => {
    const left = okPlan({ registrations: withUnpaid(), excludeUnpaid: true });
    const paid = okPlan({ registrations: withUnpaid().map((r) => ({ ...r, paymentConfirmed: true })) });
    expect(planHashInput(left.prizePool.net, left.rows)).not.toBe(planHashInput(paid.prizePool.net, paid.rows));
  });
});

describe("buildFinalizePlan: positions and prizes", () => {
  it("places the last player in first and the rest by elimination, paying 50/30/20 of the pool", () => {
    const result = okPlan();

    expect(table(result)).toEqual([
      ["r08", 1, "200.00", null],
      ["r07", 2, "120.00", null],
      ["r06", 3, "80.00", null],
      ["r05", 4, null, null],
      ["r04", 5, null, null],
      ["r03", 6, null, null],
      ["r02", 7, null, null],
      ["r01", 8, null, null],
    ]);
    expect(result.rows[0]).toMatchObject({ playerId: "p08", playerName: "Player 08", amountCents: 20_000 });
    expect(result.activePlayers).toEqual([{ registrationId: "r08", playerId: "p08", playerName: "Player 08" }]);
  });

  it("pays each place its share rounded down to whole dollars, the rest to the club's fee (v3: $475 → 237/142/95)", () => {
    const result = okPlan({
      tournament: tournament({ rakeType: "percentage", rakeAmount: "5.00" }),
      registrations: field(10),
    });

    expect(result.rows.slice(0, 4).map((row) => row.prizeAmount)).toEqual(["237.00", "142.00", "95.00", null]);
    expect(result.rows.reduce((sum, row) => sum + row.amountCents, 0)).toBe(47_400);
    expect(result.snapshot.pool).toMatchObject({ netCents: 47_400, impliedRakeCents: 2_600 });
    expect(result.snapshot.pool.difference).toEqual({ availableCents: 47_500, setCents: 47_400, cents: 100, keptByClubCents: 100, addedByClubCents: 0 });
  });

  it("gives the cents the rounding leaves to the club's fee, never to 1st", () => {
    // 3 x $33.55 = $100.65: 50.325 → 50, 30.195 → 30, 20.13 → 20; the $0.65 is the club's.
    const result = okPlan({ tournament: tournament({ buyInAmount: "33.55" }), registrations: field(3) });

    expect(result.rows.map((row) => row.prizeAmount)).toEqual(["50.00", "30.00", "20.00"]);
    expect(result.snapshot.pool.difference?.keptByClubCents).toBe(65);
    // A leftover is the club's fee, said in the pool's summary: no warning.
    expect(result.warnings.some((warning) => warning.includes("Leftover"))).toBe(false);
  });

  it("pays the manual prize pool when one is set (money-01)", () => {
    const result = okPlan({ tournament: tournament({ manualPrizePool: "300.00" }) });

    expect(result.rows.slice(0, 3).map((row) => row.prizeAmount)).toEqual(["150.00", "90.00", "60.00"]);
    expect(result.prizePool.netSource).toBe("manual_pool");
  });

  it("pays from the gross less the manual AP total when one is set", () => {
    const result = okPlan({ tournament: tournament({ rakeType: "percentage", rakeAmount: "10.00", rakeOverride: "20.00" }) });

    // $400 gross less a fixed $20 AP (the 10% rate would take $40).
    expect(result.rows.slice(0, 3).map((row) => row.prizeAmount)).toEqual(["190.00", "114.00", "76.00"]);
  });

  it("pays a valid custom structure (money-02), and Standard with a warning for an invalid one", () => {
    const custom = okPlan({ tournament: tournament({ payoutStructure: "custom", customPayouts: "[60,40]" }) });
    const invalid = okPlan({ tournament: tournament({ payoutStructure: "custom", customPayouts: "[60,30]" }) });

    expect(custom.rows.slice(0, 3).map((row) => row.prizeAmount)).toEqual(["240.00", "160.00", null]);
    expect(invalid.rows.slice(0, 3).map((row) => row.prizeAmount)).toEqual(["200.00", "120.00", "80.00"]);
    expect(invalid.warnings).toContain("Custom payouts add up to 90%, not 100%, so Standard is paid instead");
  });

  it("leaves unfilled places unpaid (D28), and books what they would pay as the club's fee (R7FREV0-MONEY-01)", () => {
    const result = okPlan({ registrations: field(2) });

    expect(table(result)).toEqual([
      ["r02", 1, "50.00", null],
      ["r01", 2, "30.00", null],
    ]);
    expect(result.warnings).toContain("Only 2 players are in the prize pool: places below 2nd are not paid, so the $20 they would pay goes to AP");
    expect(result.snapshot.paid.map((place) => place.position)).toEqual([1, 2]);
    // The pool is what is paid: $80 of the $100 that came in, the $20 3rd would pay is the club's.
    expect(result.prizePool.net).toBe(8_000);
    expect(result.snapshot.pool).toMatchObject({
      grossCents: 10_000,
      netCents: 8_000,
      impliedRakeCents: 2_000,
      difference: { availableCents: 10_000, setCents: 8_000, cents: 2_000, keptByClubCents: 2_000, addedByClubCents: 0 },
    });
    expect(result.rows.reduce((sum, row) => sum + row.amountCents, 0)).toBe(result.snapshot.pool.netCents);
  });

  it("pays nobody when the pool is $0 or less, and says so", () => {
    const result = okPlan({ tournament: tournament({ rakeType: "fixed", rakeAmount: "60.00" }), registrations: field(3) });

    expect(result.rows.map((row) => row.prizeAmount)).toEqual([null, null, null]);
    expect(result.warnings).toContain("The prize pool is $0 or less, so nobody is paid");
  });

  it("finalizes a tournament with no registrations", () => {
    const result = okPlan({ registrations: [] });

    expect(result.rows).toEqual([]);
    expect(result.snapshot).toMatchObject({ entrants: 0, paid: [] });
    expect(result.warnings).not.toContain("The prize pool is $0 or less, so nobody is paid");
  });

  it("never ranks, pays, scores or counts the waiting list (round 5, item 15)", () => {
    // 4 played; 2 more signed up beyond Max players 4 and were never accepted.
    const registrations = [
      ...field(4),
      ...["r05", "r06"].map((id, i) => ({ id, playerId: `p0${5 + i}`, buyIns: 1, paymentConfirmed: false, isEliminated: false, registrationTime: new Date(Date.UTC(2026, 2, 1, 18, i)) })),
    ];
    const result = okPlan({ tournament: tournament({ maxPlayers: 4 }), registrations });

    expect(table(result).map(([id]) => id)).toEqual(["r04", "r03", "r02", "r01"]);
    expect(result.prizePool.net).toBe(20_000);
    expect(result.snapshot.entrants).toBe(4);
    expect(result.warnings).toContain("2 sign-ups on the waiting list are not ranked, paid or counted in the pool");
    expect(result.unpaid).toEqual([]);
  });

  it("warns when a % place and a $ place pay out of order at this pool (R5REV1-PAY-01)", () => {
    const customPayouts = '{"v":2,"places":[{"percent":30},{"amountCents":20000}]}';
    // The $80 leftover is the club's, whatever was chosen before round 7: 30% of $400 is $120, below 2nd's $200.
    for (const prizeDifference of [null, "first"]) {
      const result = okPlan({ tournament: tournament({ payoutStructure: "custom", customPayouts, prizeDifference }) });
      expect(result.rows.slice(0, 2).map((row) => row.prizeAmount)).toEqual(["120.00", "200.00"]);
      expect(result.warnings).toContain("At this prize pool 2nd pays $200, more than 1st ($120)");
    }
    // In order at this pool, nothing is said.
    const inOrder = '{"v":2,"places":[{"percent":60},{"amountCents":20000}]}';
    expect(okPlan({ tournament: tournament({ payoutStructure: "custom", customPayouts: inOrder }) }).warnings.some((warning) => warning.startsWith("From the"))).toBe(false);
  });

  it("names a player it cannot find", () => {
    const result = okPlan({ registrations: field(2), playerNames: new Map() });

    expect(result.rows.map((row) => row.playerName)).toEqual(["Unknown player", "Unknown player"]);
  });
});

describe("buildFinalizePlan: the finishing order", () => {
  it("needs an explicit order when two or more players are still in, and lists them for the picker (bug-07)", () => {
    const result = plan({ registrations: field(5, 3) });

    expect(result).toMatchObject({ ok: false, problem: "ACTIVE_PLAYERS_NEED_ORDER" });
    expect(result.activePlayers.map((p) => p.registrationId)).toEqual(["r03", "r04", "r05"]);
    expect(result.prizePool.net).toBe(25_000);
  });

  it("uses the given order and reports it as explicit", () => {
    const result = okPlan({ registrations: field(5, 3), finishOrder: ["r04", "r05", "r03"] });

    expect(result.rows.map((row) => row.registrationId)).toEqual(["r04", "r05", "r03", "r02", "r01"]);
    expect(result.snapshot.finishOrderSource).toBe("explicit");
    expect(result.activePlayers.map((p) => p.registrationId)).toEqual(["r04", "r05", "r03"]);
  });

  it("refuses an order that is not exactly the players still in", () => {
    expect(plan({ registrations: field(5, 3), finishOrder: ["r04", "r05"] })).toMatchObject({
      ok: false,
      problem: "INVALID_FINISH_ORDER",
    });
  });

  it("suggests the order a previous finalize stored for the players still in", () => {
    const registrations = field(4, 3).map((r) => ({ ...r, finalPosition: { r02: 3, r03: 1, r04: 2 }[r.id] ?? null }));
    const result = plan({ registrations, tournament: tournament({ status: "completed" }) });

    expect(result.activePlayers.map((p) => p.registrationId)).toEqual(["r03", "r04", "r02"]);
  });
});

describe("buildFinalizePlan: points", () => {
  const pointsSystem = { participationPoints: 10, knockoutPoints: 5 };
  const allocations = [
    { position: 1, points: 100 },
    { position: 2, points: 75 },
    { position: 3, points: 50 },
    { position: 4, positionEnd: 6, points: 25 },
  ];

  it("awards allocations by place or range, participation as the fallback, plus knockout points", () => {
    const registrations = field(8).map((r) => ({ ...r, knockouts: { r08: 4, r07: 1, r06: 1 }[r.id] ?? 0 }));
    const result = okPlan({ registrations, pointsSystem, allocations });

    expect(result.rows.map((row) => row.pointsAwarded)).toEqual([120, 80, 55, 25, 25, 25, 10, 10]);
  });

  it("awards none when the tournament does not track points", () => {
    const result = okPlan({ tournament: tournament({ trackPoints: false }), pointsSystem, allocations });

    expect(result.rows.every((row) => row.pointsAwarded === null)).toBe(true);
  });

  it("freezes the rules it scored with in the snapshot", () => {
    const result = okPlan({ pointsSystem, allocations });

    expect(result.snapshot.points).toEqual({
      trackPoints: true,
      pointsSystem: { participationPoints: 10, knockoutPoints: 5 },
      allocations: [
        { position: 1, positionEnd: null, points: 100 },
        { position: 2, positionEnd: null, points: 75 },
        { position: 3, positionEnd: null, points: 50 },
        { position: 4, positionEnd: 6, points: 25 },
      ],
    });
  });

  describe("a correction scores with the rules the first finalize froze (P2REV1-01)", () => {
    /** The first finalize, then the tournament as it is stored after it. */
    function finalizedOnce() {
      const first = okPlan({ pointsSystem, allocations });
      const stored = field(8).map((r) => {
        const result = first.rows.find((row) => row.registrationId === r.id)!;
        return { ...r, finalPosition: result.finalPosition, pointsAwarded: result.pointsAwarded };
      });
      return { first, stored, completed: tournament({ status: "completed", prizePoolSnapshot: first.snapshot }) };
    }
    /** The whole order with the top two swapped. */
    const swapTopTwo = ["r07", "r08", "r06", "r05", "r04", "r03", "r02", "r01"];

    it.each([
      ["the points system was deleted", { pointsSystem: null, allocations: [] }],
      ["points tracking was switched off", { tournament: "trackPoints off" as const }],
      ["allocations were added since", { allocations: [...allocations, { position: 7, positionEnd: 8, points: 999 }] }],
    ])("whatever has changed since: %s", (_case, change) => {
      const { stored, completed } = finalizedOnce();
      const live = {
        pointsSystem: "pointsSystem" in change ? change.pointsSystem : pointsSystem,
        allocations: "allocations" in change ? change.allocations : allocations,
        tournament: "tournament" in change ? { ...completed, trackPoints: false } : completed,
      };

      const corrected = okPlan({ ...live, registrations: stored, finishOrder: swapTopTwo });

      expect(corrected.rows.map((row) => [row.registrationId, row.pointsAwarded])).toEqual([
        ["r07", 100],
        ["r08", 75],
        ["r06", 50],
        ["r05", 25],
        ["r04", 25],
        ["r03", 25],
        ["r02", 10],
        ["r01", 10],
      ]);
      expect(corrected.snapshot.points).toEqual(completed.prizePoolSnapshot!.points);
      expect(corrected.warnings.some((warning) => warning.startsWith("Season points change"))).toBe(false);
    });

    it("warns, naming them, when a legacy correction would change the points of players whose place stays", () => {
      const { stored } = finalizedOnce();
      const legacy = tournament({ status: "completed", prizePoolSnapshot: null });

      const corrected = okPlan({ tournament: legacy, registrations: stored, pointsSystem: null, allocations: [], finishOrder: swapTopTwo });

      expect(corrected.warnings).toContain(
        "Season points change for 6 players whose place stays the same: Player 06 50 → none, Player 05 25 → none, Player 04 25 → none and 3 more",
      );
    });
  });
});

describe("buildFinalizePlan: warnings", () => {
  it("warns that the pool is not locked", () => {
    expect(okPlan({ tournament: tournament({ prizePoolLocked: false }) }).warnings).toContain("The prize pool is not locked");
    expect(okPlan().warnings).toEqual([]);
  });

  it("names the club's AP label when the AP is set manually", () => {
    const result = okPlan({ tournament: tournament({ rakeType: "percentage", rakeAmount: "10.00", rakeOverride: "20.00" }) });

    expect(result.warnings).toEqual(["AP is set manually to $20 (the rates give $40)"]);
  });

  it("says when the pool is set manually", () => {
    const result = okPlan({ tournament: tournament({ manualPrizePool: "300.00", rakeOverride: "5.00" }) });

    // The $95 it leaves is the club's fee, said in the pool's summary.
    expect(result.warnings).toEqual(["The prize pool is set manually to $300 (calculated $395)"]);
  });

  it("lists the player requests finalizing would discard, with what each re-buy or add-on costs (P2REV1-02)", () => {
    const result = okPlan({
      tournament: tournament({ rebuyAmount: "25.00", addonAmount: null }),
      pendingRequests: [
        { id: "pa2", actionType: "rebuy", playerName: "Bob" },
        { id: "pa1", actionType: "knockout", playerName: "Alice", targetPlayerName: "Carl" },
        { id: "pa3", actionType: "addon", playerName: "Dee" },
      ],
    });

    expect(result.warnings).toEqual([
      "3 player requests still waiting will be discarded: Bob's re-buy ($25), Alice's knockout of Carl, Dee's add-on. Confirm or dismiss them under Confirm Actions first",
    ]);
    expect(result.pendingRequestIds).toEqual(["pa1", "pa2", "pa3"]);
  });

  it("warns that finalizing again overwrites the stored results", () => {
    const again = okPlan({ tournament: tournament({ status: "completed", prizePoolSnapshot: okPlan().snapshot }) });
    const legacy = okPlan({ tournament: tournament({ status: "completed", prizePoolSnapshot: null }) });

    expect(again.warnings[0]).toBe("Finalizing again replaces the stored positions, prizes and points");
    expect(legacy.warnings[0]).toBe(
      "This tournament was finalized before payouts were recorded in full: its stored prizes will be overwritten",
    );
  });
});

describe("buildFinalizePlan: the snapshot", () => {
  it("freezes the pool, the structure and every paid place, with no user ids", () => {
    const result = okPlan({
      tournament: tournament({ rakeType: "percentage", rakeAmount: "5.00", prizePoolLocked: false }),
      registrations: field(10),
    });

    expect(result.snapshot).toEqual({
      v: FINALIZE_SNAPSHOT_VERSION,
      algorithm: PAYOUT_ALGORITHM,
      finalizedAt: FINALIZED_AT,
      entrants: 10,
      finishOrderSource: "eliminations",
      pool: {
        grossCents: 50_000,
        rakeCalculatedCents: 2_500,
        rakeOverrideCents: null,
        manualPrizePoolCents: null,
        netCents: 47_400,
        netSource: "calculated",
        impliedRakeCents: 2_600,
        structure: { requested: "standard", used: "standard", basisPoints: [5000, 3000, 2000] },
        difference: { availableCents: 47_500, setCents: 47_400, cents: 100, keptByClubCents: 100, addedByClubCents: 0 },
      },
      points: { trackPoints: true, pointsSystem: null, allocations: [] },
      paid: [
        { position: 1, registrationId: "r10", playerId: "p10", playerName: "Player 10", basisPoints: 5000, amountCents: 23_700 },
        { position: 2, registrationId: "r09", playerId: "p09", playerName: "Player 09", basisPoints: 3000, amountCents: 14_200 },
        { position: 3, registrationId: "r08", playerId: "p08", playerName: "Player 08", basisPoints: 2000, amountCents: 9_500 },
      ],
      warnings: ["The prize pool is not locked"],
    });
  });

  it("records why a requested structure was not used", () => {
    const result = okPlan({ tournament: tournament({ payoutStructure: "winner" }) });

    expect(result.snapshot.pool.structure).toEqual({
      requested: "winner",
      used: "standard",
      basisPoints: [5000, 3000, 2000],
      error: 'Unknown payout structure "winner", so Standard is paid instead',
    });
  });

  it("keeps zero amounts for paid places when the pool is empty", () => {
    const result = okPlan({ tournament: tournament({ manualPrizePool: "0.00" }), registrations: field(3) });

    expect(result.snapshot.paid.map((place) => place.amountCents)).toEqual([0, 0, 0]);
  });
});

describe("planHashInput", () => {
  it("covers the pool and every row finalize writes, so any change to what is paid changes it", () => {
    const base = okPlan();
    const input = planHashInput(base.prizePool.net, base.rows);

    expect(input).toBe(planHashInput(okPlan({ finalizedAt: "2027-01-01T00:00:00.000Z" }).prizePool.net, okPlan().rows));
    expect(JSON.parse(input)).toEqual([40_000, table(base), []]);

    const rebuy = okPlan({ registrations: field(8).map((r, i) => (i === 0 ? { ...r, rebuys: 1 } : r)), tournament: tournament({ rebuyAmount: "50.00" }) });
    expect(planHashInput(rebuy.prizePool.net, rebuy.rows)).not.toBe(input);
  });

  it("covers the requests finalize would discard, in any order, so one arriving after the preview changes it (P2REV1-02)", () => {
    const base = okPlan();

    expect(planHashInput(base.prizePool.net, base.rows, ["pa2", "pa1"])).toBe(planHashInput(base.prizePool.net, base.rows, ["pa1", "pa2"]));
    expect(planHashInput(base.prizePool.net, base.rows, ["pa1"])).not.toBe(planHashInput(base.prizePool.net, base.rows));
  });
});

describe("buildFinalizePlan: properties", () => {
  it("accounts for every cent: the rows and the club's leftover add up to what came in, however few players (R7FREV0-MONEY-01)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 30 }),
        fc.integer({ min: 0, max: 100_000 }),
        fc.constantFrom("standard", "top5", "top8", "top9"),
        (players, buyInCents, payoutStructure) => {
          const buyInAmount = `${Math.floor(buyInCents / 100)}.${String(buyInCents % 100).padStart(2, "0")}`;
          const result = okPlan({ tournament: tournament({ buyInAmount, payoutStructure }), registrations: field(players) });
          const paid = result.rows.reduce((sum, row) => sum + row.amountCents, 0);

          // Places with no player are not paid, and what they would pay is the club's: the pool frozen is what is paid.
          expect(paid + result.prizePool.difference.keptByClubCents).toBe(players * buyInCents);
          expect(result.snapshot.pool.netCents).toBe(paid);
          expect(result.snapshot.pool.impliedRakeCents).toBe(result.prizePool.difference.keptByClubCents);
          expect(result.snapshot.paid.reduce((sum, place) => sum + place.amountCents, 0)).toBe(paid);
          expect(result.rows.every((row) => row.amountCents % 100 === 0)).toBe(true);
          expect(result.rows.every((row) => row.amountCents >= 0)).toBe(true);
          expect(result.rows.map((row) => row.finalPosition)).toEqual(result.rows.map((_, i) => i + 1));
        },
      ),
    );
  });
});

describe("input types", () => {
  it("accepts database rows as they are", () => {
    expectTypeOf<Tournament>().toExtend<FinalizeTournamentInput>();
    expectTypeOf<TournamentRegistration>().toExtend<FinalizeRegistrationInput>();
  });
});

describe("buildFinalizePlan: a deal (round 5)", () => {
  // 8 × $50 = $400, Standard 50/30/20: $200 / $120 / $80. Three still in: r06, r07, r08.
  const stillIn = () => field(8, 3);
  const order = ["r08", "r07", "r06"];
  const chop = (r08: number, r07: number, r06: number, reason = "Chip chop at 3 handed") => ({
    reason,
    amounts: [
      { registrationId: "r08", amountCents: r08 },
      { registrationId: "r07", amountCents: r07 },
      { registrationId: "r06", amountCents: r06 },
    ],
  });

  it("says what a deal shares: the players still in and what their places pay together", () => {
    const result = okPlan({ registrations: stillIn(), finishOrder: order });
    expect(result.dealable).toEqual({
      totalCents: 40_000,
      players: [
        { registrationId: "r08", playerId: "p08", playerName: "Player 08", position: 1, plannedCents: 20_000 },
        { registrationId: "r07", playerId: "p07", playerName: "Player 07", position: 2, plannedCents: 12_000 },
        { registrationId: "r06", playerId: "p06", playerName: "Player 06", position: 3, plannedCents: 8_000 },
      ],
    });
    expect(result.snapshot.deal).toBeUndefined();
    expect(okPlan().dealable).toBeNull();
  });

  it("knows the total before the finish order is given", () => {
    const result = plan({ registrations: stillIn() });
    expect(result.ok).toBe(false);
    expect(result.dealable).toEqual({
      totalCents: 40_000,
      players: ["r06", "r07", "r08"].map((id) => ({ registrationId: id, playerId: `p${id.slice(1)}`, playerName: `Player ${id.slice(1)}`, position: null, plannedCents: null })),
    });
  });

  it("pays the deal's amounts, keeps positions and points, and freezes the deal in the snapshot", () => {
    const without = okPlan({ registrations: stillIn(), finishOrder: order });
    const result = okPlan({ registrations: stillIn(), finishOrder: order, deal: chop(15_000, 13_000, 12_000) });
    expect(table(result).slice(0, 4)).toEqual([
      ["r08", 1, "150.00", without.rows[0].pointsAwarded],
      ["r07", 2, "130.00", without.rows[1].pointsAwarded],
      ["r06", 3, "120.00", without.rows[2].pointsAwarded],
      ["r05", 4, null, without.rows[3].pointsAwarded],
    ]);
    expect(result.snapshot.deal).toEqual({
      reason: "Chip chop at 3 handed",
      totalCents: 40_000,
      players: [
        { registrationId: "r08", playerId: "p08", playerName: "Player 08", position: 1, plannedCents: 20_000, amountCents: 15_000 },
        { registrationId: "r07", playerId: "p07", playerName: "Player 07", position: 2, plannedCents: 12_000, amountCents: 13_000 },
        { registrationId: "r06", playerId: "p06", playerName: "Player 06", position: 3, plannedCents: 8_000, amountCents: 12_000 },
      ],
    });
    expect(result.snapshot.paid.map((place) => [place.position, place.amountCents, place.basisPoints])).toEqual([
      [1, 15_000, 5000],
      [2, 13_000, 3000],
      [3, 12_000, 2000],
    ]);
    expect(result.snapshot.pool.netCents).toBe(40_000);
    expect(result.warnings).toContain("Deal: the 3 players still in share $400 as agreed (Chip chop at 3 handed)");
    expect(planHashInput(result.prizePool.net, result.rows)).not.toBe(planHashInput(without.prizePool.net, without.rows));
  });

  it("can pay a player who finishes below the paid places, who is then in the snapshot's paid places", () => {
    const four = field(8, 4);
    const result = okPlan({
      registrations: four,
      finishOrder: ["r08", "r07", "r06", "r05"],
      deal: {
        reason: "Bubble save",
        amounts: [
          { registrationId: "r08", amountCents: 18_000 },
          { registrationId: "r07", amountCents: 11_000 },
          { registrationId: "r06", amountCents: 7_000 },
          { registrationId: "r05", amountCents: 4_000 },
        ],
      },
    });
    expect(result.snapshot.paid.map((place) => [place.registrationId, place.position, place.amountCents, place.basisPoints])).toEqual([
      ["r08", 1, 18_000, 5000],
      ["r07", 2, 11_000, 3000],
      ["r06", 3, 7_000, 2000],
      ["r05", 4, 4_000, 0],
    ]);
  });

  it("refuses a deal that does not share exactly what the players still in would be paid", () => {
    const result = plan({ registrations: stillIn(), finishOrder: order, deal: chop(15_000, 13_000, 11_000) });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem).toBe("DEAL_INVALID");
    expect(result.dealProblems).toEqual([{ code: "DEAL_TOTAL", message: "The deal must share $400 (it is $10 short)" }]);
    expect(result.dealable?.totalCents).toBe(40_000);
  });

  it("asks for the finish order first", () => {
    const result = plan({ registrations: stillIn(), deal: chop(15_000, 13_000, 12_000) });
    expect(result.ok === false && result.problem).toBe("ACTIVE_PLAYERS_NEED_ORDER");
  });

  it("warns a correction made without the deal the tournament was finalized with", () => {
    const first = okPlan({ registrations: stillIn(), finishOrder: order, deal: chop(15_000, 13_000, 12_000) });
    const correction = okPlan({
      tournament: tournament({ status: "completed", prizePoolSnapshot: first.snapshot }),
      registrations: stillIn(),
      finishOrder: order,
    });
    expect(correction.warnings).toContain("It was finalized with a deal (Chip chop at 3 handed): without one, the players still in are paid their places' payouts");
    const again = okPlan({
      tournament: tournament({ status: "completed", prizePoolSnapshot: first.snapshot }),
      registrations: stillIn(),
      finishOrder: order,
      deal: chop(15_000, 13_000, 12_000),
    });
    expect(again.warnings.some((warning) => warning.startsWith("It was finalized with a deal"))).toBe(false);
  });

  it("freezes a custom structure's fixed places with the shares they paid", () => {
    const customPayouts = '{"v":2,"places":[{"percent":50},{"amountCents":10000}]}';
    const result = okPlan({ tournament: tournament({ payoutStructure: "custom", customPayouts }), registrations: stillIn(), finishOrder: order });
    expect(result.snapshot.pool.structure).toEqual({
      requested: "custom",
      used: "custom",
      basisPoints: [6667, 3333],
      places: [
        { kind: "percent", basisPoints: 5000 },
        { kind: "amount", amountCents: 10_000 },
      ],
    });
    expect(result.snapshot.paid.map((place) => place.amountCents)).toEqual([20_000, 10_000]);
  });
});

describe("buildFinalizePlan: what the prizes leave is the club's fee (round 7)", () => {
  // Eight $50 buy-ins: $400 available. Custom places 1st $150, 2nd $100, 3rd $50 leave $100.
  const fixed = '{"v":2,"places":[{"amountCents":15000},{"amountCents":10000},{"amountCents":5000}]}';
  const custom = (overrides: Partial<FinalizeTournamentInput & StoredChoice> = {}) => tournament({ payoutStructure: "custom", customPayouts: fixed, ...overrides });
  const prizes = (result: ReturnType<typeof okPlan>) => result.rows.slice(0, 3).map((row) => row.amountCents);

  it("pays exactly the prizes set, and freezes the leftover as the club's fee", () => {
    const result = okPlan({ tournament: custom() });
    expect(prizes(result)).toEqual([15_000, 10_000, 5_000]);
    expect(result.snapshot.pool).toMatchObject({ netCents: 30_000, impliedRakeCents: 10_000 });
    expect(result.snapshot.pool.difference).toEqual({ availableCents: 40_000, setCents: 30_000, cents: 10_000, keptByClubCents: 10_000, addedByClubCents: 0 });
  });

  it("pays every choice stored before round 7 as the club's: nothing to 1st, the places or a later tournament", () => {
    const club = okPlan({ tournament: custom() });
    for (const prizeDifference of ["first", "pro_rata", "carry"]) {
      const result = okPlan({ tournament: custom({ prizeDifference }) });
      expect(result.rows).toEqual(club.rows);
      expect(result.snapshot).toEqual(club.snapshot);
    }
  });

  it("pays prizes above what came in as set, and warns that the club adds the rest", () => {
    const result = okPlan({ tournament: tournament({ manualPrizePool: "500.00" }) });
    expect(result.rows.slice(0, 3).map((row) => row.amountCents)).toEqual([25_000, 15_000, 10_000]);
    expect(result.snapshot.pool.difference).toMatchObject({ cents: -10_000, addedByClubCents: 10_000 });
    expect(result.warnings).toContain("The prizes add up to $500, $100 more than the $400 available for prizes: the club adds $100");
  });

  it("freezes money carried in from an earlier tournament, and names it", () => {
    const carriedIn = [{ carryOverId: "c1", fromTournamentId: "t0", fromName: "Test Wednesday", amountCents: 5_000 }];
    const result = okPlan({ tournament: tournament({ carriedIn }) });
    expect(result.snapshot.pool.netCents).toBe(45_000);
    expect(result.snapshot.pool.carriedIn).toEqual(carriedIn);
    expect(result.snapshot.pool).not.toHaveProperty("difference");
    expect(result.warnings).toContain("$50 carried over from Test Wednesday is in the prize pool");
  });

  it("records nothing new for a tournament with no difference, nothing carried in and no free entry", () => {
    const result = okPlan();
    expect(result.snapshot.pool).not.toHaveProperty("difference");
    expect(result.snapshot.pool).not.toHaveProperty("carriedIn");
    expect(result.snapshot.pool).not.toHaveProperty("freeEntries");
  });

  it("lets a deal share only what the places pay: the leftover is not the players'", () => {
    const registrations = field(8, 3);
    const finishOrder = ["r08", "r07", "r06"];
    const deal = (amounts: number[]) => ({
      reason: "Even chop",
      amounts: finishOrder.map((registrationId, i) => ({ registrationId, amountCents: amounts[i] })),
    });
    expect(okPlan({ tournament: custom({ prizeDifference: "first" }), registrations, finishOrder }).dealable?.totalCents).toBe(30_000);
    expect(plan({ tournament: custom(), registrations, finishOrder, deal: deal([13_400, 13_300, 13_300]) })).toMatchObject({ ok: false, problem: "DEAL_INVALID" });
    const dealt = okPlan({ tournament: custom(), registrations, finishOrder, deal: deal([10_000, 10_000, 10_000]) });
    expect(dealt.rows.slice(0, 3).map((row) => row.amountCents)).toEqual([10_000, 10_000, 10_000]);
  });

  it("hashes the difference, so a leftover that changes after the preview is a changed plan", () => {
    const kept = okPlan({ tournament: custom() });
    const hashOf = (result: ReturnType<typeof okPlan>) => planHashInput(result.prizePool.net, result.rows, result.pendingRequestIds, result.prizePool.difference);
    expect(JSON.parse(hashOf(kept)).at(-1)).toEqual([10_000, 0]);
    // With no difference the hash is what it always was.
    const plain = okPlan();
    expect(planHashInput(plain.prizePool.net, plain.rows, plain.pendingRequestIds, plain.prizePool.difference)).toBe(
      planHashInput(plain.prizePool.net, plain.rows, plain.pendingRequestIds),
    );
  });
});

describe("buildFinalizePlan: correcting a tournament paid before round 7", () => {
  // Ten $50 buy-ins less 5% AP: $475 for prizes on Standard. v2 paid 1st the $1 the rounding left.
  const v2Snapshot = (overrides: Partial<PrizePoolSnapshot> = {}): PrizePoolSnapshot => {
    const first = okPlan({ tournament: tournament({ rakeType: "percentage", rakeAmount: "5.00" }), registrations: field(10) }).snapshot;
    return {
      ...first,
      algorithm: "v2-floor-remainder-first",
      pool: { ...first.pool, netCents: 47_500, impliedRakeCents: 2_500, difference: undefined },
      paid: first.paid.map((place, i) => ({ ...place, amountCents: [23_800, 14_200, 9_500][i] ?? place.amountCents })),
      ...overrides,
    };
  };
  const completed = (snapshot: PrizePoolSnapshot) => tournament({ status: "completed", rakeType: "percentage", rakeAmount: "5.00", prizePoolSnapshot: snapshot });

  it("says that a correction re-pays the places by today's rule, with each change (R7FREV0-MONEY-02)", () => {
    const result = okPlan({ tournament: completed(v2Snapshot()), registrations: field(10) });

    expect(result.rows.slice(0, 3).map((row) => row.amountCents)).toEqual([23_700, 14_200, 9_500]);
    expect(result.snapshot.algorithm).toBe(PAYOUT_ALGORITHM);
    expect(result.warnings).toContain("It was paid by an earlier payout rule, and correcting pays the places by today's (1st $238 → $237): $474 in all, not $475");
  });

  it("compares a deal's players by what their places paid, not what the deal paid them", () => {
    const deal = {
      reason: "Chop",
      totalCents: 38_000,
      players: [
        { registrationId: "r10", playerId: "p10", playerName: "Player 10", position: 1, plannedCents: 23_800, amountCents: 19_000 },
        { registrationId: "r09", playerId: "p09", playerName: "Player 09", position: 2, plannedCents: 14_200, amountCents: 19_000 },
      ],
    };
    const base = v2Snapshot();
    const dealt = { ...base, deal, paid: base.paid.map((place, i) => (i < 2 ? { ...place, amountCents: 19_000 } : place)) };
    const result = okPlan({ tournament: completed(dealt), registrations: field(10) });
    expect(result.warnings).toContain("It was paid by an earlier payout rule, and correcting pays the places by today's (1st $238 → $237): $474 in all, not $475");
  });

  it("says nothing more when the places pay as they did", () => {
    const paidNow = okPlan({ tournament: tournament({ rakeType: "percentage", rakeAmount: "5.00" }), registrations: field(10) }).snapshot;
    const result = okPlan({ tournament: completed(paidNow), registrations: field(10) });
    expect(result.warnings.filter((warning) => /payout rule|places pay/.test(warning))).toEqual([]);
  });

  it("names the places a correction pays differently even under today's rule", () => {
    const paidNow = okPlan({ tournament: tournament({ rakeType: "percentage", rakeAmount: "5.00" }), registrations: field(10) }).snapshot;
    // A player's payment taken back since: 9 in the pool, $427.50 for prizes, paid as $213/$128/$85.
    const registrations = field(10).map((r) => (r.id === "r01" ? { ...r, paymentConfirmed: false } : r));
    const result = okPlan({ tournament: completed(paidNow), registrations, excludeUnpaid: true });
    expect(result.warnings).toContain("Correcting changes what the places pay (1st $237 → $213, 2nd $142 → $128, 3rd $95 → $85): $426 in all, not $474");
  });
});

describe("buildFinalizePlan: money carried over before round 7 that another pool holds (R7FREV0-CARRY-01)", () => {
  // Eight $50 buy-ins, a manual pool of $320: $80 was carried over to Week 5, which has added it.
  const carry = () => tournament({ status: "completed", manualPrizePool: "320.00", prizePoolSnapshot: null });
  const carriedOver = { cents: 8_000, target: "Week 5" };

  it("leaves it out of what the pool leaves the club, and freezes it as carried over", () => {
    const result = okPlan({ tournament: carry(), carriedOver });

    expect(result.rows.slice(0, 3).map((row) => row.amountCents)).toEqual([16_000, 9_600, 6_400]);
    expect(result.snapshot.pool.netCents).toBe(32_000);
    expect(result.snapshot.pool.impliedRakeCents).toBe(0);
    expect(result.snapshot.pool.difference).toEqual({
      availableCents: 32_000,
      setCents: 32_000,
      cents: 0,
      keptByClubCents: 0,
      addedByClubCents: 0,
      carriedOverCents: 8_000,
      carryTarget: "Week 5",
    });
    expect(result.warnings).toContain("$80 this tournament carried over is in Week 5's prize pool: it stays there, so it is not part of this prize pool");
  });

  it("is the club's once no pool holds it", () => {
    const result = okPlan({ tournament: carry() });
    expect(result.snapshot.pool.difference).toMatchObject({ cents: 8_000, keptByClubCents: 8_000 });
    expect(result.snapshot.pool.difference).not.toHaveProperty("carriedOverCents");
  });

  it("changes the plan hash when the money is taken out of the other pool or added to it", () => {
    const hashOf = (result: ReturnType<typeof okPlan>) => planHashInput(result.prizePool.net, result.rows, result.pendingRequestIds, result.prizePool.difference);
    expect(hashOf(okPlan({ tournament: carry(), carriedOver }))).not.toBe(hashOf(okPlan({ tournament: carry() })));
  });

  it("adds what the prizes need beyond the rest, when that is less than they pay", () => {
    const result = okPlan({ tournament: carry(), carriedOver: { cents: 10_000, target: "Week 5" } });
    expect(result.snapshot.pool.difference).toMatchObject({ availableCents: 30_000, cents: -2_000, addedByClubCents: 2_000, carriedOverCents: 10_000 });
    expect(result.snapshot.pool.impliedRakeCents).toBe(-2_000);
  });
});

describe("buildFinalizePlan: free entries (round 7, item 6)", () => {
  // Eight $50 entries, two of them free (r02 funded by the club, r03 not): $350 is in the pool.
  const withFree = () =>
    field(8).map((r) => (r.id === "r02" ? { ...r, freeEntry: true, freeEntryFunded: true } : r.id === "r03" ? { ...r, freeEntry: true, paymentConfirmed: false } : r));

  it("ranks, pays and scores a free entry as an accepted player, and freezes what the club paid in", () => {
    const result = okPlan({ registrations: withFree(), pointsSystem: { participationPoints: 5, knockoutPoints: null }, allocations: [] });
    expect(result.unpaid).toEqual([]);
    expect(result.snapshot.entrants).toBe(8);
    expect(result.prizePool.gross.total).toBe(30_000);
    expect(result.prizePool.netAfterAp).toBe(35_000);
    expect(result.rows.find((row) => row.registrationId === "r03")?.pointsAwarded).toBe(5);
    expect(result.snapshot.pool.freeEntries).toEqual({ entries: 2, funded: 1, addedCents: 5_000 });
    expect(result.snapshot.pool.impliedRakeCents).toBe(-5_000);
  });

  it("pays exactly what the live display shows: finalize pays the displayed payouts", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ paid: fc.boolean(), free: fc.boolean(), funded: fc.boolean(), rebuys: fc.integer({ min: 0, max: 2 }) }), { minLength: 1, maxLength: 20 }),
        fc.constantFrom("standard", "top5", "top9"),
        fc.integer({ min: 0, max: 2_500 }),
        (players, payoutStructure, rake) => {
          const registrations = field(players.length).map((r, i) => {
            const { paid, free, funded, rebuys } = players[i];
            return { ...r, paymentConfirmed: paid || free, freeEntry: free, freeEntryFunded: free && funded, rebuys };
          });
          const settings = tournament({ buyInAmount: "33.33", rebuyAmount: "17.50", payoutStructure, rakeType: "percentage", rakeAmount: (rake / 100).toFixed(2) });
          const result = okPlan({ tournament: settings, registrations, excludeUnpaid: true });
          const shown = payoutsForDisplay(settings, computePrizePool(settings, registrations), registrations);
          expect(result.rows.slice(0, shown.rows.length).map((row) => row.amountCents)).toEqual(shown.rows.map((row) => row.amountCents));
          expect(result.rows.slice(shown.rows.length).every((row) => row.amountCents === 0)).toBe(true);
          expect(result.snapshot.pool.netCents).toBe(result.prizePool.net);
          // What is paid is the pool shown, and with the club's fee it accounts for every cent that came in.
          const paid = result.rows.reduce((sum, row) => sum + row.amountCents, 0);
          const { gross, difference, freeEntries } = result.prizePool;
          expect(shown.totalCents).toBe(paid);
          expect(result.snapshot.pool.netCents).toBe(paid);
          expect(paid + result.prizePool.rake.applied + difference.keptByClubCents - difference.addedByClubCents).toBe(gross.total + freeEntries.addedCents);
        },
      ),
      { numRuns: 300 },
    );
  });
});

