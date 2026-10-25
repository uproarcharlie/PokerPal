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
    expect(result.warnings).not.toContain("2 payments not confirmed");
  });

  it("warns when a % place and a $ place pay out of order at this pool (R5REV1-PAY-01)", () => {
    const customPayouts = '{"v":2,"places":[{"percent":30},{"amountCents":20000}]}';
    const result = okPlan({ tournament: tournament({ payoutStructure: "custom", customPayouts, prizeDifference: "first" }) });

    expect(result.rows.slice(0, 2).map((row) => row.prizeAmount)).toEqual(["200.00", "200.00"]);
    const swapped = '{"v":2,"places":[{"percent":30},{"amountCents":25000}]}';
    expect(okPlan({ tournament: tournament({ payoutStructure: "custom", customPayouts: swapped, prizeDifference: "first" }) }).warnings).toContain(
      "From the $400 prize pool 2nd pays $250, more than 1st ($150)",
    );
    // Left with the club, the $80 leftover is not 1st's: 30% of $400 is $120, below 2nd's $200.
    expect(okPlan({ tournament: tournament({ payoutStructure: "custom", customPayouts }) }).warnings).toContain(
      "From the $320 prize pool 2nd pays $200, more than 1st ($120)",
    );
    expect(result.warnings.some((warning) => warning.startsWith("From the"))).toBe(false);
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

    expect(result.warnings).toEqual([
      "The prize pool is set manually to $300 (calculated $395)",
      "The prizes add up to $300, $95 less than the $395 available for prizes: the club keeps it",
    ]);
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
    const result = okPlan({ tournament: tournament({ payoutStructure: "custom", customPayouts, prizeDifference: "first" }), registrations: stillIn(), finishOrder: order });
    expect(result.snapshot.pool.structure).toEqual({
      requested: "custom",
      used: "custom",
      basisPoints: [7500, 2500],
      places: [
        { kind: "percent", basisPoints: 5000 },
        { kind: "amount", amountCents: 10_000 },
      ],
    });
    expect(result.snapshot.paid.map((place) => place.amountCents)).toEqual([30_000, 10_000]);
  });
});

describe("buildFinalizePlan: where a difference goes (round 5, item 16)", () => {
  // Eight $50 buy-ins: $400 available. Custom places 1st $150, 2nd $100, 3rd $50 leave $100.
  const fixed = '{"v":2,"places":[{"amountCents":15000},{"amountCents":10000},{"amountCents":5000}]}';
  const custom = (overrides: Partial<FinalizeTournamentInput> = {}) => tournament({ payoutStructure: "custom", customPayouts: fixed, ...overrides });
  const prizes = (result: ReturnType<typeof okPlan>) => result.rows.slice(0, 3).map((row) => row.amountCents);

  it("pays exactly the prizes set, and freezes what the club kept", () => {
    const result = okPlan({ tournament: custom() });
    expect(prizes(result)).toEqual([15_000, 10_000, 5_000]);
    expect(result.snapshot.pool).toMatchObject({ netCents: 30_000, impliedRakeCents: 10_000 });
    expect(result.snapshot.pool.difference).toEqual({
      choice: "club",
      availableCents: 40_000,
      setCents: 30_000,
      cents: 10_000,
      keptByClubCents: 10_000,
      addedToPrizesCents: 0,
      carriedOverCents: 0,
      addedByClubCents: 0,
    });
    expect(result.warnings).toContain("The prizes add up to $300, $100 less than the $400 available for prizes: the club keeps it");
  });

  it("freezes a carry-over with where it goes, and says so", () => {
    const result = okPlan({ tournament: custom({ prizeDifference: "carry" }), carryTarget: "Winter League" });
    expect(prizes(result)).toEqual([15_000, 10_000, 5_000]);
    expect(result.snapshot.pool.difference).toMatchObject({ choice: "carry", carriedOverCents: 10_000, carryTarget: "Winter League" });
    expect(result.snapshot.pool.impliedRakeCents).toBe(0);
    expect(result.warnings).toContain("The prizes add up to $300, $100 less than the $400 available for prizes: it is carried over to Winter League");
    expect(okPlan({ tournament: custom({ prizeDifference: "carry" }) }).snapshot.pool.difference?.carryTarget).toBe("the next tournament");
    expect(okPlan({ tournament: custom() }).snapshot.pool.difference).not.toHaveProperty("carryTarget");
  });

  it("pays the leftover to 1st, or shares it, when chosen", () => {
    expect(prizes(okPlan({ tournament: custom({ prizeDifference: "first" }) }))).toEqual([25_000, 10_000, 5_000]);
    expect(prizes(okPlan({ tournament: custom({ prizeDifference: "pro_rata" }) }))).toEqual([20_100, 13_300, 6_600]);
  });

  it("pays prizes above what came in as set: the club adds the rest", () => {
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

  it("records nothing new for a tournament with no difference and nothing carried in", () => {
    const result = okPlan();
    expect(result.snapshot.pool).not.toHaveProperty("difference");
    expect(result.snapshot.pool).not.toHaveProperty("carriedIn");
  });

  it("lets a deal share what the places pay once the leftover is settled", () => {
    const registrations = field(8, 3);
    const finishOrder = ["r08", "r07", "r06"];
    const deal = (amounts: number[]) => ({
      reason: "Even chop",
      amounts: finishOrder.map((registrationId, i) => ({ registrationId, amountCents: amounts[i] })),
    });
    // Kept by the club, the $100 is not the players' to share: the deal shares $300.
    expect(okPlan({ tournament: custom(), registrations, finishOrder }).dealable?.totalCents).toBe(30_000);
    expect(plan({ tournament: custom(), registrations, finishOrder, deal: deal([13_400, 13_300, 13_300]) })).toMatchObject({ ok: false, problem: "DEAL_INVALID" });
    // Added to 1st, it is: the deal shares $400, and finalize pays it exactly.
    const dealt = okPlan({ tournament: custom({ prizeDifference: "first" }), registrations, finishOrder, deal: deal([13_400, 13_300, 13_300]) });
    expect(dealt.snapshot.deal?.totalCents).toBe(40_000);
    expect(dealt.rows.slice(0, 3).map((row) => row.amountCents)).toEqual([13_400, 13_300, 13_300]);
    expect(dealt.snapshot.pool.difference).toMatchObject({ addedToPrizesCents: 10_000 });
  });

  it("hashes where the difference goes, so a change of choice after the preview is a changed plan", () => {
    const kept = okPlan({ tournament: custom() });
    const carried = okPlan({ tournament: custom({ prizeDifference: "carry" }) });
    expect(kept.rows).toEqual(carried.rows);
    const hashOf = (result: ReturnType<typeof okPlan>) => planHashInput(result.prizePool.net, result.rows, result.pendingRequestIds, result.snapshot.pool.difference);
    expect(hashOf(kept)).not.toBe(hashOf(carried));
    // With no difference the hash is what it always was.
    const plain = okPlan();
    expect(planHashInput(plain.prizePool.net, plain.rows, plain.pendingRequestIds, plain.prizePool.difference)).toBe(
      planHashInput(plain.prizePool.net, plain.rows, plain.pendingRequestIds),
    );
  });
});
