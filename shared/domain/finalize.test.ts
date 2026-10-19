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
} from "./finalize";
import { PAYOUT_ALGORITHM } from "./payouts";

const FINALIZED_AT = "2026-03-01T23:00:00.000Z";

function tournament(overrides: Partial<FinalizeTournamentInput> = {}): FinalizeTournamentInput {
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

  it("pays the pool exactly with the v2 rule: shares floored to dollars, the leftover to 1st ($475 → 238/142/95)", () => {
    const result = okPlan({
      tournament: tournament({ rakeType: "percentage", rakeAmount: "5.00" }),
      registrations: field(10),
    });

    expect(result.rows.slice(0, 4).map((row) => row.prizeAmount)).toEqual(["238.00", "142.00", "95.00", null]);
    expect(result.rows.reduce((sum, row) => sum + row.amountCents, 0)).toBe(47_500);
  });

  it("gives the leftover cents to 1st", () => {
    // 3 x $33.55 = $100.65: 50.325 → 50, 30.195 → 30, 20.13 → 20, and $0.65 + $0 to 1st.
    const result = okPlan({ tournament: tournament({ buyInAmount: "33.55" }), registrations: field(3) });

    expect(result.rows.map((row) => row.prizeAmount)).toEqual(["50.65", "30.00", "20.00"]);
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

  it("leaves unfilled places unpaid and says how much is not paid out (D28)", () => {
    const result = okPlan({ registrations: field(2) });

    expect(table(result)).toEqual([
      ["r02", 1, "50.00", null],
      ["r01", 2, "30.00", null],
    ]);
    expect(result.warnings).toContain("Only 2 players: $20 of the pool is not paid out");
    expect(result.snapshot.paid.map((place) => place.position)).toEqual([1, 2]);
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

  it("counts unpaid registrations toward the pool, as today (D27), and warns about them", () => {
    const registrations = field(4).map((r, i) => ({ ...r, paymentConfirmed: i >= 2 }));
    const result = okPlan({ registrations });

    expect(result.rows.slice(0, 3).map((row) => row.prizeAmount)).toEqual(["100.00", "60.00", "40.00"]);
    expect(result.warnings).toContain("2 payments not confirmed");
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
        netCents: 47_500,
        netSource: "calculated",
        impliedRakeCents: 2_500,
        structure: { requested: "standard", used: "standard", basisPoints: [5000, 3000, 2000] },
      },
      points: { trackPoints: true, pointsSystem: null, allocations: [] },
      paid: [
        { position: 1, registrationId: "r10", playerId: "p10", playerName: "Player 10", basisPoints: 5000, amountCents: 23_800 },
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
  it("pays every pool exactly: the rows plus what is not paid out add up to the pool", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 30 }),
        fc.integer({ min: 0, max: 100_000 }),
        fc.constantFrom("standard", "top5", "top8", "top9"),
        (players, buyInCents, payoutStructure) => {
          const buyInAmount = `${Math.floor(buyInCents / 100)}.${String(buyInCents % 100).padStart(2, "0")}`;
          const result = okPlan({ tournament: tournament({ buyInAmount, payoutStructure }), registrations: field(players) });
          const paid = result.rows.reduce((sum, row) => sum + row.amountCents, 0);
          const unpaid = result.prizePool.payouts.slice(players).reduce((sum, place) => sum + place.amountCents, 0);

          expect(paid + unpaid).toBe(players * buyInCents);
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
