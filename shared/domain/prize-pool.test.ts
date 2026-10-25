import fc from "fast-check";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { Tournament, TournamentRegistration } from "../schema";
import { roundToCents, toBasisPoints } from "./money";
import { legacyFigures, legacyPayouts } from "@test/helpers/legacy-money";
import { PAYOUT_STRUCTURES } from "./payouts";
import {
  amountDueCents,
  computePrizePool as computeAnyPool,
  DEFAULT_RAKE_LABEL,
  hasPaid,
  highHandAwardsProblem,
  nextHighHandAward,
  paidPercentage,
  payoutsForDisplay,
  poolEntries,
  prizeMoneyCents,
  rakeLabel,
  recordedEntryCounts,
  splitHighHandAward,
  unawardedHighHandCents,
  type EntryInput,
  type PrizePoolBreakdown,
  type PrizePoolInput,
  type StoredResultInput,
  unpaidEntries,
} from "./prize-pool";

/** An entry whose payment the TD confirmed, unless it says otherwise. */
const paidUp = <T extends EntryInput>(entry: T): T => ({ paymentConfirmed: true, ...entry });

/**
 * Only paid entries are in a pool (round 6, poolEntries). The figures in this file are about everything
 * else, so their entries have paid unless they say they have not; "paid players only" below tests the
 * rule itself with computeAnyPool.
 */
const computePrizePool = (settings: PrizePoolInput, entries: readonly EntryInput[]) => computeAnyPool(settings, entries.map(paidUp));

/** The pool the club's rates alone would give (gross less the calculated AP): what the legacy screens worked out. */
const netFromRates = (pool: Pick<PrizePoolBreakdown, "gross" | "rake">) => pool.gross.total - pool.rake.calculated;

/** computePrizePool with the old float figures beside it (test/helpers/legacy-money.ts), for the parity checks. */
function poolAndLegacy(settings: PrizePoolInput, entries: readonly EntryInput[]) {
  return { ...computePrizePool(settings, entries), legacy: legacyFigures(settings, entries) };
}

/* ------------------------------------------------------------------------------------------------
 * Today's money code, copied from commit dddf8ad as reference implementations. Only the function
 * wrappers, parameter types and return statements are added; the bodies are unchanged.
 * ---------------------------------------------------------------------------------------------- */

/** The fields today's code reads, typed as the client pages declare them. */
interface LegacyTournament {
  buyInAmount: string;
  rebuyAmount: string | null;
  addonAmount: string | null;
  rakeType: string;
  rakeAmount: string;
  rebuyRakeType: string | null;
  rebuyRakeAmount: string | null;
  addonRakeType: string | null;
  addonRakeAmount: string | null;
  payoutStructure: string;
  manualPrizePool: string | null;
  highHandAmount: string | null;
  highHandRakeType: string | null;
  highHandRakeAmount: string | null;
  highHandPayouts: number | null;
}

interface LegacyRegistration {
  buyIns: number;
  rebuys: number;
  addons: number;
  enteringHighHands: boolean;
}

// The same literal is at server/routes.ts:878-884, tournament-details.tsx:321-327 and public-tournament-view.tsx:241-247.
const payoutStructures: Record<string, number[]> = {
  'standard': [0.50, 0.30, 0.20],
  'top3': [0.50, 0.30, 0.20],
  'top5': [0.40, 0.25, 0.20, 0.10, 0.05],
  'top8': [0.35, 0.22, 0.15, 0.12, 0.08, 0.04, 0.02, 0.02],
  'top9': [0.30, 0.20, 0.15, 0.12, 0.09, 0.06, 0.04, 0.02, 0.02],
};

/** server/routes.ts:842-897 and :928 (POST /api/tournaments/:id/finalize): the prize written per position. */
function referenceFinalize(tournament: LegacyTournament, registrations: LegacyRegistration[]) {
  // Calculate prize pool
  const totalBuyIns = registrations.reduce((sum, reg) => sum + reg.buyIns, 0);
  const totalRebuys = registrations.reduce((sum, reg) => sum + reg.rebuys, 0);
  const totalAddons = registrations.reduce((sum, reg) => sum + reg.addons, 0);

  const buyInTotal = totalBuyIns * parseFloat(tournament.buyInAmount);
  const rebuyTotal = totalRebuys * parseFloat(tournament.rebuyAmount || '0');
  const addonTotal = totalAddons * parseFloat(tournament.addonAmount || '0');
  const grossTotal = buyInTotal + rebuyTotal + addonTotal;

  // Calculate rake
  let buyInRake = 0;
  if (tournament.rakeType === 'percentage') {
    buyInRake = buyInTotal * (parseFloat(tournament.rakeAmount || '0') / 100);
  } else if (tournament.rakeType === 'fixed') {
    buyInRake = totalBuyIns * parseFloat(tournament.rakeAmount || '0');
  }

  let rebuyRake = 0;
  if (tournament.rebuyRakeType === 'percentage') {
    rebuyRake = rebuyTotal * (parseFloat(tournament.rebuyRakeAmount || '0') / 100);
  } else if (tournament.rebuyRakeType === 'fixed') {
    rebuyRake = totalRebuys * parseFloat(tournament.rebuyRakeAmount || '0');
  }

  let addonRake = 0;
  if (tournament.addonRakeType === 'percentage') {
    addonRake = addonTotal * (parseFloat(tournament.addonRakeAmount || '0') / 100);
  } else if (tournament.addonRakeType === 'fixed') {
    addonRake = totalAddons * parseFloat(tournament.addonRakeAmount || '0');
  }

  const rake = buyInRake + rebuyRake + addonRake;
  const netPrizePool = grossTotal - rake;

  const percentages = payoutStructures[tournament.payoutStructure] || payoutStructures['standard'];

  const prizes: (string | null)[] = [];
  for (let i = 0; i < registrations.length; i++) {
    const position = i + 1;

    // Calculate prize
    let prizeAmount = 0;
    if (position <= percentages.length) {
      prizeAmount = Math.round(netPrizePool * percentages[position - 1]);
    }

    prizes.push(prizeAmount > 0 ? prizeAmount.toString() : null);
  }
  return { grossTotal, rake, netPrizePool, prizes };
}

/** client/src/pages/tournament-details.tsx:277-336 (the admin page). */
function referenceAdminPage(tournament: LegacyTournament, registrations: LegacyRegistration[]) {
  const totalPlayers = registrations.length;
  const totalBuyIns = registrations.reduce((sum, reg) => sum + reg.buyIns, 0);
  const totalRebuys = registrations.reduce((sum, reg) => sum + reg.rebuys, 0);
  const totalAddons = registrations.reduce((sum, reg) => sum + reg.addons, 0);

  const buyInTotal = totalBuyIns * parseFloat(tournament.buyInAmount);
  const rebuyTotal = totalRebuys * parseFloat(tournament.rebuyAmount || '0');
  const addonTotal = totalAddons * parseFloat(tournament.addonAmount || '0');
  const grossTotal = buyInTotal + rebuyTotal + addonTotal;

  // Calculate buy-in rake
  let buyInRake = 0;
  if (tournament.rakeType === 'percentage') {
    buyInRake = buyInTotal * (parseFloat(tournament.rakeAmount) / 100);
  } else if (tournament.rakeType === 'fixed') {
    buyInRake = totalBuyIns * parseFloat(tournament.rakeAmount);
  }

  // Calculate rebuy rake
  let rebuyRake = 0;
  if (tournament.rebuyRakeType === 'percentage') {
    rebuyRake = rebuyTotal * (parseFloat(tournament.rebuyRakeAmount || '0') / 100);
  } else if (tournament.rebuyRakeType === 'fixed') {
    rebuyRake = totalRebuys * parseFloat(tournament.rebuyRakeAmount || '0');
  }

  // Calculate addon rake
  let addonRake = 0;
  if (tournament.addonRakeType === 'percentage') {
    addonRake = addonTotal * (parseFloat(tournament.addonRakeAmount || '0') / 100);
  } else if (tournament.addonRakeType === 'fixed') {
    addonRake = totalAddons * parseFloat(tournament.addonRakeAmount || '0');
  }

  const rake = buyInRake + rebuyRake + addonRake;
  const calculatedPrizePool = grossTotal - rake;
  const netPrizePool = tournament.manualPrizePool
    ? parseFloat(tournament.manualPrizePool)
    : calculatedPrizePool;

  // Calculate prize payouts based on payout structure
  const getPrizePayouts = () => {
    if (netPrizePool <= 0) return [];

    const percentages = payoutStructures[tournament.payoutStructure] || payoutStructures['standard'];

    return percentages.map((percentage, index) => ({
      position: index + 1,
      percentage: percentage * 100,
      amount: Math.round(netPrizePool * percentage),
    }));
  };

  const prizePayouts = getPrizePayouts();
  return {
    totalPlayers, totalBuyIns, totalRebuys, totalAddons, buyInTotal, rebuyTotal, addonTotal, grossTotal,
    buyInRake, rebuyRake, addonRake, rake, calculatedPrizePool, netPrizePool, prizePayouts,
  };
}

/** client/src/pages/public-tournament-view.tsx:200-258 (the public page). */
function referencePublicPage(tournament: LegacyTournament, registrations: LegacyRegistration[]) {
  // Calculate prize pool
  const totalBuyIns = registrations.reduce((sum, reg) => sum + reg.buyIns, 0);
  const totalRebuys = registrations.reduce((sum, reg) => sum + reg.rebuys, 0);
  const totalAddons = registrations.reduce((sum, reg) => sum + reg.addons, 0);

  const buyInTotal = totalBuyIns * parseFloat(tournament.buyInAmount);
  const rebuyTotal = totalRebuys * parseFloat(tournament.rebuyAmount || '0');
  const addonTotal = totalAddons * parseFloat(tournament.addonAmount || '0');
  const grossTotal = buyInTotal + rebuyTotal + addonTotal;

  // Calculate rake
  let buyInRake = 0;
  if (tournament.rakeType === 'percentage') {
    buyInRake = buyInTotal * (parseFloat(tournament.rakeAmount || '0') / 100);
  } else if (tournament.rakeType === 'fixed') {
    buyInRake = totalBuyIns * parseFloat(tournament.rakeAmount || '0');
  }

  let rebuyRake = 0;
  if (tournament.rebuyRakeType === 'percentage') {
    rebuyRake = rebuyTotal * (parseFloat(tournament.rebuyRakeAmount || '0') / 100);
  } else if (tournament.rebuyRakeType === 'fixed') {
    rebuyRake = totalRebuys * parseFloat(tournament.rebuyRakeAmount || '0');
  }

  let addonRake = 0;
  if (tournament.addonRakeType === 'percentage') {
    addonRake = addonTotal * (parseFloat(tournament.addonRakeAmount || '0') / 100);
  } else if (tournament.addonRakeType === 'fixed') {
    addonRake = totalAddons * parseFloat(tournament.addonRakeAmount || '0');
  }

  const rake = buyInRake + rebuyRake + addonRake;
  const netPrizePool = grossTotal - rake;

  // Calculate prize payouts
  const getPrizePayouts = () => {
    if (netPrizePool <= 0) return [];

    const percentages = payoutStructures[tournament.payoutStructure] || payoutStructures['standard'];

    return percentages.map((percentage, index) => ({
      position: index + 1,
      percentage: percentage * 100,
      amount: Math.round(netPrizePool * percentage),
    }));
  };

  const prizePayouts = getPrizePayouts();
  return { grossTotal, rake, netPrizePool, prizePayouts };
}

/** server/routes.ts:1215-1228 (GET /api/dashboard/stats): one tournament's contribution to the total. */
function referenceDashboardNet(tournament: LegacyTournament, registrations: LegacyRegistration[]) {
  const buyInTotal = registrations.reduce((sum, reg) =>
    sum + (parseFloat(tournament.buyInAmount) * (reg.buyIns || 0)) +
        (parseFloat(tournament.rebuyAmount || '0') * (reg.rebuys || 0)) +
        (parseFloat(tournament.addonAmount || '0') * (reg.addons || 0)), 0
  );

  // Apply rake
  let netPool = buyInTotal;
  if (tournament.rakeType === 'percentage') {
    netPool = buyInTotal * (1 - parseFloat(tournament.rakeAmount || '0') / 100);
  } else if (tournament.rakeType === 'fixed') {
    netPool = buyInTotal - parseFloat(tournament.rakeAmount || '0');
  }
  return netPool;
}

/**
 * client/src/components/tournament/prize-pool-calculator.tsx:56-63; the admin page's "Award High Hand"
 * default (tournament-details.tsx:881-890) is the same code ending in `highHandPerWinner.toFixed(2)`.
 */
function referenceHighHand(tournament: LegacyTournament, registrations: LegacyRegistration[]) {
  const highHandEntrants = registrations.filter(r => r.enteringHighHands).length;
  const highHandGross = highHandEntrants * parseFloat(tournament.highHandAmount || '0');
  const highHandRakeAmount = tournament.highHandRakeType === 'percentage'
    ? highHandGross * (parseFloat(tournament.highHandRakeAmount || '0') / 100)
    : parseFloat(tournament.highHandRakeAmount || '0');
  const highHandNet = highHandGross - highHandRakeAmount;
  const highHandPerWinner = tournament.highHandPayouts && tournament.highHandPayouts > 0
    ? highHandNet / tournament.highHandPayouts
    : highHandNet;
  return { highHandGross, highHandRakeAmount, highHandNet, highHandPerWinner, defaultAward: highHandPerWinner.toFixed(2) };
}

/* ------------------------------------------------------------------------------------------------
 * Fixtures and generators
 * ---------------------------------------------------------------------------------------------- */

/** "1234.05" for 123405, built without any of the code under test. */
function decimalString(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

function tournament(overrides: Partial<LegacyTournament & PrizePoolInput> = {}): LegacyTournament & PrizePoolInput {
  return {
    buyInAmount: "50.00",
    rebuyAmount: "40.00",
    addonAmount: "25.00",
    rakeType: "none",
    rakeAmount: "0.00",
    rebuyRakeType: "none",
    rebuyRakeAmount: "0.00",
    addonRakeType: "none",
    addonRakeAmount: "0.00",
    payoutStructure: "standard",
    manualPrizePool: null,
    highHandAmount: "10.00",
    highHandRakeType: "none",
    highHandRakeAmount: "0.00",
    highHandPayouts: 1,
    ...overrides,
  };
}

/** 10 players: 10 buy-ins ($500), 4 re-buys ($160), 3 add-ons ($75); 6 are in the high hand. */
const FIELD: LegacyRegistration[] = Array.from({ length: 10 }, (_, i) => ({
  buyIns: 1,
  rebuys: i < 2 ? 2 : 0,
  addons: i < 3 ? 1 : 0,
  enteringHighHands: i < 6,
}));
const FIELD_GROSS = { buyIn: 50_000, rebuy: 16_000, addon: 7_500, total: 73_500 };

type Component = "buyIn" | "rebuy" | "addon";

function withRake(component: Component, type: string | null, amount: string) {
  if (component === "buyIn") return tournament({ rakeType: type ?? "none", rakeAmount: amount });
  if (component === "rebuy") return tournament({ rebuyRakeType: type, rebuyRakeAmount: amount });
  return tournament({ addonRakeType: type, addonRakeAmount: amount });
}

const money = (maxCents: number) => fc.integer({ min: 0, max: maxCents }).map(decimalString);
const percent = fc.integer({ min: 0, max: 10_000 }).map(decimalString);
const rakeType = fc.constantFrom("none", "percentage", "fixed");
const rakeAmount = fc.oneof(percent, money(10_000));
const nullable = <T>(arbitrary: fc.Arbitrary<T>) => fc.option(arbitrary, { nil: null });

const legacyTournaments: fc.Arbitrary<LegacyTournament> = fc.record({
  buyInAmount: money(50_000),
  rebuyAmount: nullable(money(50_000)),
  addonAmount: nullable(money(50_000)),
  rakeType,
  rakeAmount,
  rebuyRakeType: nullable(rakeType),
  rebuyRakeAmount: nullable(rakeAmount),
  addonRakeType: nullable(rakeType),
  addonRakeAmount: nullable(rakeAmount),
  payoutStructure: fc.constantFrom("standard", "top3", "top5", "top8", "top9", "custom", "unknown"),
  manualPrizePool: nullable(money(1_000_000)),
  highHandAmount: nullable(money(5_000)),
  highHandRakeType: nullable(rakeType),
  highHandRakeAmount: nullable(rakeAmount),
  highHandPayouts: nullable(fc.integer({ min: 0, max: 4 })),
});

const registrationLists = (counts: { rebuys: number; addons: number } = { rebuys: 5, addons: 2 }) =>
  fc.array(
    fc.record({
      buyIns: fc.integer({ min: 0, max: 3 }),
      rebuys: fc.integer({ min: 0, max: counts.rebuys }),
      addons: fc.integer({ min: 0, max: counts.addons }),
      enteringHighHands: fc.boolean(),
    }),
    { maxLength: 80 },
  );

const PARITY_RUNS = { numRuns: 1000 };

/** Whether a component's exact AP is a whole number of cents (so no rounding happens). */
function isWholeCents(type: string | null, amount: string | null, subtotalCents: number): boolean {
  return type !== "percentage" || (subtotalCents * toBasisPoints(amount)) % 10_000 === 0;
}

/* ------------------------------------------------------------------------------------------------
 * Tests
 * ---------------------------------------------------------------------------------------------- */

describe("computePrizePool: the AP for each rake type on each component", () => {
  it.each([
    // component, type, amount, AP in cents, today's float AP
    ["buyIn", "none", "10.00", 0, 0],
    ["buyIn", "flat", "10.00", 0, 0],
    ["buyIn", "percentage", "10.00", 5_000, 50],
    ["buyIn", "percentage", "2.5", 1_250, 12.5],
    ["buyIn", "percentage", "0.00", 0, 0],
    ["buyIn", "fixed", "5.00", 5_000, 50],
    ["buyIn", "fixed", "2.50", 2_500, 25],
    ["rebuy", "none", "10.00", 0, 0],
    ["rebuy", null, "10.00", 0, 0],
    ["rebuy", "percentage", "10.00", 1_600, 16],
    ["rebuy", "percentage", "2.5", 400, 4],
    ["rebuy", "fixed", "5.00", 2_000, 20],
    ["addon", "none", "10.00", 0, 0],
    ["addon", null, "10.00", 0, 0],
    ["addon", "percentage", "10.00", 750, 7.5],
    ["addon", "percentage", "2.5", 188, 1.875], // 187.5 cents: halves round up
    ["addon", "fixed", "5.00", 1_500, 15],
  ] as const)("%s, %s %s → %d cents", (component, type, amount, expectedCents, expectedFloat) => {
    const pool = poolAndLegacy(withRake(component, type, amount), FIELD);

    expect(pool.gross).toEqual(FIELD_GROSS);
    expect(pool.rake[component]).toBe(expectedCents);
    for (const other of ["buyIn", "rebuy", "addon"] as const) {
      if (other !== component) expect(pool.rake[other]).toBe(0);
    }
    expect(pool.rake.calculated).toBe(expectedCents);
    expect(pool.rake.applied).toBe(expectedCents);
    expect(pool.rake.override).toBeNull();
    expect(netFromRates(pool)).toBe(73_500 - expectedCents);
    expect(pool.net).toBe(73_500 - expectedCents);
    expect(pool.netSource).toBe("calculated");
    expect(pool.impliedRake).toBe(expectedCents);
    expect(pool.legacy.rake[component]).toBeCloseTo(expectedFloat, 10);
  });

  it("adds the three components together", () => {
    const pool = computePrizePool(
      tournament({
        rakeType: "percentage",
        rakeAmount: "10.00",
        rebuyRakeType: "fixed",
        rebuyRakeAmount: "5.00",
        addonRakeType: "percentage",
        addonRakeAmount: "2.5",
      }),
      FIELD,
    );
    expect(pool.rake).toEqual({ buyIn: 5_000, rebuy: 2_000, addon: 188, calculated: 7_188, override: null, applied: 7_188 });
    expect(pool.net).toBe(66_312);
  });

  it("treats a missing rake amount as no AP, where today's admin page shows NaN", () => {
    const settings = tournament({ rakeType: "percentage", rakeAmount: null as unknown as string });
    expect(computePrizePool(settings, FIELD).rake.buyIn).toBe(0);
    expect(referenceAdminPage(settings, FIELD).rake).toBeNaN();
    expect(referenceFinalize(settings, FIELD).rake).toBe(0);
  });

  it("lets AP exceed the gross: the pool goes negative and pays nothing", () => {
    const pool = computePrizePool(tournament({ rakeType: "fixed", rakeAmount: "60.00" }), FIELD);
    expect(pool.net).toBe(13_500);
    const steep = computePrizePool(tournament({ buyInAmount: "5.00", rebuyAmount: null, addonAmount: null, rakeType: "fixed", rakeAmount: "6.00" }), FIELD);
    expect(steep.net).toBe(-1_000);
    expect(steep.payouts).toEqual([]);
  });
});

describe("computePrizePool: the AP override and the manual prize pool", () => {
  const rated = { rakeType: "percentage", rakeAmount: "10.00" }; // calculated AP $50

  it("replaces the calculated AP with the manual AP total", () => {
    const pool = computePrizePool(tournament({ ...rated, rakeOverride: "20.00" }), FIELD);
    expect(pool.rake).toEqual({ buyIn: 5_000, rebuy: 0, addon: 0, calculated: 5_000, override: 2_000, applied: 2_000 });
    expect(netFromRates(pool)).toBe(68_500);
    expect(pool.netAfterAp).toBe(71_500);
    expect(pool.net).toBe(71_500);
    expect(pool.netSource).toBe("ap_override");
    expect(pool.impliedRake).toBe(2_000);
    expect(pool.payouts.map((p) => p.amountCents)).toEqual([35_800, 21_400, 14_300]);
  });

  it("counts an override of 0.00 as set: no AP is taken", () => {
    const pool = computePrizePool(tournament({ ...rated, rakeOverride: "0.00" }), FIELD);
    expect(pool.rake.applied).toBe(0);
    expect(pool.net).toBe(73_500);
    expect(pool.netSource).toBe("ap_override");
  });

  it.each([null, undefined, "", "  "])("ignores an override of %j", (rakeOverride) => {
    const pool = computePrizePool(tournament({ ...rated, rakeOverride }), FIELD);
    expect(pool.rake.override).toBeNull();
    expect(pool.net).toBe(68_500);
    expect(pool.netSource).toBe("calculated");
  });

  it("is fixed: it does not grow with more entries", () => {
    const settings = tournament({ ...rated, rakeOverride: "20.00" });
    const bigger = computePrizePool(settings, [...FIELD, ...FIELD]);
    expect(bigger.rake.calculated).toBe(10_000);
    expect(bigger.rake.applied).toBe(2_000);
  });

  it("never touches the high-hand pot", () => {
    const highHand = { highHandRakeType: "percentage", highHandRakeAmount: "10.00" };
    const without = computePrizePool(tournament({ ...rated, ...highHand }), FIELD);
    const withOverride = computePrizePool(tournament({ ...rated, ...highHand, rakeOverride: "0.00" }), FIELD);
    expect(withOverride.highHand).toEqual(without.highHand);
    expect(withOverride.highHand.rake).toBe(600);
  });

  it("puts a manual prize pool ahead of the override", () => {
    const pool = poolAndLegacy(tournament({ ...rated, rakeOverride: "20.00", manualPrizePool: "600.00" }), FIELD);
    expect(pool.manualPrizePool).toBe(60_000);
    expect(pool.net).toBe(60_000);
    expect(pool.netSource).toBe("manual_pool");
    expect(pool.rake.applied).toBe(2_000);
    expect(pool.impliedRake).toBe(13_500);
    expect(pool.legacy.net).toBe(600);
  });

  it("reports the money a club adds when the manual pool is above the gross", () => {
    const pool = computePrizePool(tournament({ manualPrizePool: "1000.00" }), FIELD);
    expect(pool.impliedRake).toBe(-26_500);
  });

  it("counts a manual pool of 0.00 as set, as today: nothing is paid", () => {
    const pool = computePrizePool(tournament({ manualPrizePool: "0.00" }), FIELD);
    expect(pool.net).toBe(0);
    expect(pool.payouts).toEqual([]);
    expect(referenceAdminPage(tournament({ manualPrizePool: "0.00" }), FIELD).netPrizePool).toBe(0);
  });

  it("always applies manual pool > AP override > calculated", () => {
    fc.assert(
      fc.property(
        legacyTournaments,
        registrationLists(),
        nullable(fc.integer({ min: 0, max: 1_000_000 })),
        nullable(fc.integer({ min: 0, max: 100_000 })),
        (settings, registrations, manualCents, overrideCents) => {
          const pool = computePrizePool(
            {
              ...settings,
              manualPrizePool: manualCents === null ? null : decimalString(manualCents),
              rakeOverride: overrideCents === null ? null : decimalString(overrideCents),
            },
            registrations,
          );
          const calculated = pool.rake.buyIn + pool.rake.rebuy + pool.rake.addon;
          expect(pool.rake.calculated).toBe(calculated);
          expect(pool.rake.applied).toBe(overrideCents ?? calculated);
          expect(pool.netAfterAp).toBe(pool.gross.total - (overrideCents ?? calculated));
          if (manualCents !== null) {
            expect(pool.net).toBe(manualCents);
            expect(pool.netSource).toBe("manual_pool");
          } else if (overrideCents !== null) {
            expect(pool.net).toBe(pool.gross.total - overrideCents);
            expect(pool.netSource).toBe("ap_override");
          } else {
            expect(pool.net).toBe(pool.gross.total - calculated);
            expect(pool.netSource).toBe("calculated");
          }
          expect(pool.impliedRake).toBe(pool.gross.total - pool.net);
        },
      ),
      PARITY_RUNS,
    );
  });
});

describe("computePrizePool: the high-hand pot", () => {
  it.each([
    // type, amount, rake in cents, today's rake in dollars
    ["percentage", "10.00", 600, 6],
    ["percentage", "2.5", 150, 1.5],
    ["fixed", "5.00", 500, 5],
    ["none", "5.00", 0, 5], // CHANGED: today any non-percentage type deducts the amount as a flat fee
    [null, "5.00", 0, 5],
    ["none", "0.00", 0, 0],
  ] as const)("%s %s takes %d cents of a $60 pot", (type, amount, rakeCents, legacyRake) => {
    const pool = poolAndLegacy(tournament({ highHandRakeType: type, highHandRakeAmount: amount }), FIELD);
    expect(pool.highHand).toMatchObject({ entrants: 6, gross: 6_000, rake: rakeCents, net: 6_000 - rakeCents });
    expect(pool.legacy.highHand.rake).toBeCloseTo(legacyRake, 10);
  });

  it.each([
    [4, 4, 1_500, 1_500],
    [7, 7, 857, 858],
    [1, 1, 6_000, 6_000],
    [0, 1, 6_000, 6_000],
    [null, 1, 6_000, 6_000],
  ] as const)("splits the pot between %j winners, the last taking the remainder", (highHandPayouts, winners, first, last) => {
    const pool = computePrizePool(tournament({ highHandPayouts }), FIELD);
    expect(pool.highHand.winners).toBe(winners);
    const awards: number[] = [];
    for (let i = 0; i < winners; i++) awards.push(nextHighHandAward(pool.highHand, awards) ?? -1);
    expect(awards[0]).toBe(first);
    expect(awards.at(-1)).toBe(last);
    expect(awards.reduce((sum, award) => sum + award, 0)).toBe(pool.highHand.net);
  });

  it("awards nothing when the pot is empty or the rake exceeds it", () => {
    const pool = computePrizePool(tournament({ highHandRakeType: "fixed", highHandRakeAmount: "100.00" }), FIELD);
    expect(pool.highHand).toMatchObject({ net: -4_000 });
    expect(nextHighHandAward(pool.highHand, [])).toBe(0);
    const empty = computePrizePool(tournament({ highHandAmount: null }), FIELD);
    expect(empty.highHand).toMatchObject({ gross: 0, net: 0 });
    expect(nextHighHandAward(empty.highHand, [])).toBe(0);
  });

  it("stays out of the main pool", () => {
    const plain = computePrizePool(tournament({ highHandAmount: null }), FIELD);
    const withHighHand = computePrizePool(tournament({ highHandAmount: "20.00", highHandRakeType: "fixed", highHandRakeAmount: "5.00" }), FIELD);
    expect(withHighHand.net).toBe(plain.net);
    expect(withHighHand.gross).toEqual(plain.gross);
  });
});

describe("computePrizePool: paid players only (round 6, the owner's decision of 2026-10-26)", () => {
  const settings = () =>
    tournament({ rebuyAmount: "25.00", addonAmount: "20.00", highHandAmount: "10.00", highHandRakeType: "none", rakeType: "fixed", rakeAmount: "5.00" });
  const entry = (id: string, paymentConfirmed: boolean | null | undefined, extra: Partial<EntryInput> = {}): EntryInput & { id: string } => ({
    id,
    registrationTime: new Date(Number(id.slice(1)) * 60_000),
    buyIns: 1,
    paymentConfirmed,
    ...extra,
  });

  it("counts only the entries whose payment is confirmed: their buy-ins, re-buys, add-ons and high-hand entry", () => {
    const entries = [
      entry("r1", true, { rebuys: 1, addons: 1, enteringHighHands: true }),
      entry("r2", true),
      // Unpaid: still playing (a re-buy, the high hand), but none of it is in the pool until the TD confirms it.
      entry("r3", false, { rebuys: 2, addons: 1, enteringHighHands: true }),
      entry("r4", null),
    ];
    const pool = computeAnyPool(settings(), entries);
    expect(pool.counts).toEqual({ registrations: 2, buyIns: 2, rebuys: 1, addons: 1, highHandEntrants: 1 });
    expect(pool.gross).toEqual({ buyIn: 10_000, rebuy: 2_500, addon: 2_000, total: 14_500 });
    expect(pool.rake.applied).toBe(1_000);
    expect(pool.net).toBe(13_500);
    expect(pool.highHand).toMatchObject({ entrants: 1, gross: 1_000, net: 1_000 });
    expect(poolEntries(settings(), entries).map((e) => e.id)).toEqual(["r1", "r2"]);
  });

  it("raises the pool as each payment is confirmed", () => {
    const entries = [entry("r1", true), entry("r2", false), entry("r3", false)];
    const before = computeAnyPool(settings(), entries).net;
    const after = computeAnyPool(settings(), entries.map((e) => (e.id === "r2" ? { ...e, paymentConfirmed: true } : e))).net;
    expect([before, after]).toEqual([4_500, 9_000]);
  });

  it("is $0 until anyone has paid, and counts nothing for entries that carry no payment status (a public list)", () => {
    expect(computeAnyPool(settings(), [entry("r1", false), entry("r2", false)])).toMatchObject({ net: 0, payouts: [] });
    expect(computeAnyPool(settings(), [{ buyIns: 3 }, { id: "x", buyIns: 1 }]).counts.buyIns).toBe(0);
  });

  it("leaves the waiting list out (round 5, item 15): unpaid sign-ups beyond Max players are neither in the pool nor unpaid players", () => {
    // 20 sign-ups for 18 places, the first 15 paid: 15 in the pool, 3 in the field still to pay, 2 waiting.
    const entries = Array.from({ length: 20 }, (_, i) => entry(`r${i + 10}`, i < 15));
    const max = tournament({ maxPlayers: 18 });
    expect(computeAnyPool(max, entries).counts).toMatchObject({ registrations: 15, buyIns: 15 });
    expect(unpaidEntries(max, entries).map((e) => e.id)).toEqual(["r25", "r26", "r27"]);
    expect(unpaidEntries(tournament(), entries)).toHaveLength(5);
    // A registration list from the API carries its place on the list.
    const listed = entries.map((e, i) => ({ ...e, waitingListPosition: i >= 18 ? i - 17 : null }));
    expect(unpaidEntries(max, listed)).toHaveLength(3);
  });

  it("still counts every entry recorded in the field for a re-pricing, paid or not", () => {
    const entries = [entry("r1", true, { rebuys: 2 }), entry("r2", false, { rebuys: 1, enteringHighHands: true }), entry("r3", false)];
    expect(recordedEntryCounts(tournament({ maxPlayers: 2 }), entries)).toEqual({ registrations: 2, buyIns: 2, rebuys: 3, addons: 0, highHandEntrants: 1 });
    expect(computeAnyPool(tournament({ maxPlayers: 2 }), entries).counts).toEqual({ registrations: 1, buyIns: 1, rebuys: 2, addons: 0, highHandEntrants: 0 });
  });

  it("changes no tournament completed before snapshots: it counts its field as it was paid", () => {
    // Before Phase 2 nobody had to confirm a payment: these were the prizes, though never recorded.
    const legacy = { ...settings(), status: "completed", prizePoolSnapshot: null };
    const entries = [entry("r1", false), entry("r2", null), entry("r3", true)];
    const pool = computeAnyPool(legacy, entries);
    expect(pool.counts.buyIns).toBe(3);
    expect(payoutsForDisplay(legacy, pool, entries).source).toBe("unrecorded");
    expect(prizeMoneyCents(legacy, [{ buyIns: 3, paymentConfirmed: false }], 0)).toBe(13_500);
    // Finalized since: shown from its snapshot; while it runs, paid players only.
    expect(computeAnyPool({ ...legacy, prizePoolSnapshot: { pool: { netCents: 4_500 }, paid: [] } }, entries).counts.buyIns).toBe(1);
    expect(computeAnyPool({ ...legacy, status: "in_progress" }, entries).counts.buyIns).toBe(1);
  });

  it("is the pool of the paid entries alone, whatever else has signed up", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ buyIns: fc.integer({ min: 0, max: 3 }), rebuys: fc.integer({ min: 0, max: 3 }), paymentConfirmed: fc.option(fc.boolean()) }), { maxLength: 12 }),
        (entries) => {
          expect(computeAnyPool(settings(), entries)).toEqual(computeAnyPool(settings(), entries.filter(hasPaid)));
        },
      ),
    );
  });
});

describe("computePrizePool: entries and payouts", () => {
  it("counts null entries as 0, as today's `sum + null` does", () => {
    const pool = computePrizePool(tournament(), [
      { buyIns: null, rebuys: null, addons: null, enteringHighHands: null },
      { buyIns: 1 },
      {},
    ]);
    expect(pool.counts).toEqual({ registrations: 3, buyIns: 1, rebuys: 0, addons: 0, highHandEntrants: 0 });
    expect(pool.gross.total).toBe(5_000);
  });

  it("pays nothing before anyone has entered", () => {
    const pool = poolAndLegacy(tournament(), []);
    expect(pool.gross.total).toBe(0);
    expect(pool.net).toBe(0);
    expect(pool.payouts).toEqual([]);
    expect(pool.legacy.payouts).toEqual([]);
  });

  it("pays a $475 pool exactly, where today's code pays $476", () => {
    const field = Array.from({ length: 19 }, () => ({ buyIns: 1 }));
    const pool = poolAndLegacy(tournament({ buyInAmount: "25.00" }), field);
    expect(pool.net).toBe(47_500);
    expect(pool.algorithm).toBe("v2-floor-remainder-first");
    expect(pool.payouts.map((p) => p.amountCents)).toEqual([23_800, 14_200, 9_500]);
    expect(pool.legacy.payouts.map((p) => p.amount)).toEqual([238, 143, 95]);
    expect(referenceFinalize(tournament({ buyInAmount: "25.00" }), field.map(() => FIELD[5])).prizes.slice(0, 3)).toEqual(["238", "143", "95"]);
  });

  it("honours a valid custom structure; today's figures still pay Standard", () => {
    const pool = poolAndLegacy(tournament({ payoutStructure: "custom", customPayouts: "[60,40]" }), FIELD);
    expect(pool.structure).toEqual({ requested: "custom", used: "custom", basisPoints: [6_000, 4_000] });
    expect(pool.payouts.map((p) => p.amountCents)).toEqual([44_100, 29_400]);
    expect(pool.legacy.payouts.map((p) => p.amount)).toEqual([368, 221, 147]);
  });

  it("pays a custom structure with fixed places (round 5) exactly as set: shares of the whole pool, fixed amounts", () => {
    const customPayouts = '{"v":2,"places":[{"percent":50},{"amountCents":20000},{"amountCents":10000}]}';
    const pool = computePrizePool(tournament({ payoutStructure: "custom", customPayouts }), FIELD);
    // 50% of $735 is $367.50, paid as $367; the $68 the places leave the club keeps unless the TD chose otherwise.
    expect(pool.net).toBe(66_700);
    expect(pool.payouts.map((p) => p.amountCents)).toEqual([36_700, 20_000, 10_000]);
    expect(pool.impliedRake).toBe(6_800);
    expect(pool.structure).toEqual({
      requested: "custom",
      used: "custom",
      basisPoints: [5_502, 2_999, 1_499],
      places: [
        { kind: "percent", basisPoints: 5_000 },
        { kind: "amount", amountCents: 20_000 },
        { kind: "amount", amountCents: 10_000 },
      ],
    });
  });

  it("pays fixed places that need more than the pool as set: the club adds the rest (round 5, item 16)", () => {
    const customPayouts = '{"v":2,"places":[{"amountCents":50000},{"amountCents":40000}]}';
    const pool = computePrizePool(tournament({ payoutStructure: "custom", customPayouts }), FIELD);
    expect(pool.structure.used).toBe("custom");
    expect(pool.structure.error).toBeUndefined();
    expect(pool.net).toBe(90_000);
    expect(pool.payouts.map((p) => p.amountCents)).toEqual([50_000, 40_000]);
    expect(pool.difference).toMatchObject({ availableCents: 73_500, setCents: 90_000, cents: -16_500, addedByClubCents: 16_500 });
    expect(pool.impliedRake).toBe(-16_500);
  });

  it("pays Standard with a reason when the custom structure is invalid", () => {
    const pool = computePrizePool(tournament({ payoutStructure: "custom", customPayouts: "[60,30]" }), FIELD);
    expect(pool.structure.used).toBe("standard");
    expect(pool.structure.error).toBe("Custom payouts add up to 90%, not 100%, so Standard is paid instead");
    expect(pool.payouts).toHaveLength(3);
  });

  it("returns the whole breakdown", () => {
    const pool = computePrizePool(
      tournament({ rakeType: "percentage", rakeAmount: "10.00", payoutStructure: "top5", highHandPayouts: 2 }),
      FIELD,
    );
    expect(pool).toEqual({
      algorithm: "v2-floor-remainder-first",
      counts: { registrations: 10, buyIns: 10, rebuys: 4, addons: 3, highHandEntrants: 6 },
      gross: { buyIn: 50_000, rebuy: 16_000, addon: 7_500, total: 73_500 },
      rake: { buyIn: 5_000, rebuy: 0, addon: 0, calculated: 5_000, override: null, applied: 5_000 },
      netAfterAp: 68_500,
      manualPrizePool: null,
      net: 68_500,
      netSource: "calculated",
      impliedRake: 5_000,
      structure: { requested: "top5", used: "top5", basisPoints: PAYOUT_STRUCTURES.top5 },
      payouts: [
        { position: 1, basisPoints: 4_000, percentage: 40, amountCents: 27_500 },
        { position: 2, basisPoints: 2_500, percentage: 25, amountCents: 17_100 },
        { position: 3, basisPoints: 2_000, percentage: 20, amountCents: 13_700 },
        { position: 4, basisPoints: 1_000, percentage: 10, amountCents: 6_800 },
        { position: 5, basisPoints: 500, percentage: 5, amountCents: 3_400 },
      ],
      difference: {
        choice: "club",
        availableCents: 68_500,
        setCents: 68_500,
        cents: 0,
        keptByClubCents: 0,
        addedToPrizesCents: 0,
        carriedOverCents: 0,
        addedByClubCents: 0,
      },
      carriedIn: [],
      carriedInCents: 0,
      highHand: { entrants: 6, gross: 6_000, rake: 0, net: 6_000, winners: 2 },
    });
  });

  it("splits every pool from $0 to $100,000 exactly, to the cent, never negative, never favouring a lower place", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.constantFrom("standard", "top3", "top5", "top8", "top9"),
        (cents, payoutStructure) => {
          const pool = computePrizePool(tournament({ manualPrizePool: decimalString(cents), payoutStructure }), FIELD);
          const paid = pool.payouts.map((p) => p.amountCents);
          expect(pool.net).toBe(cents);
          expect(paid.reduce((sum, amount) => sum + amount, 0)).toBe(cents);
          paid.forEach((amount, i) => {
            expect(amount).toBeGreaterThanOrEqual(0);
            if (i > 0) expect(amount).toBeLessThanOrEqual(paid[i - 1]);
          });
        },
      ),
      { numRuns: 2000 },
    );
  });

  it("splits any tournament's pool exactly", () => {
    fc.assert(
      fc.property(legacyTournaments, registrationLists(), (settings, registrations) => {
        const pool = computePrizePool(settings, registrations);
        const paid = pool.payouts.reduce((sum, p) => sum + p.amountCents, 0);
        expect(paid).toBe(pool.net > 0 ? pool.net : 0);
      }),
      PARITY_RUNS,
    );
  });
});

describe("computePrizePool: where a difference goes (round 5, item 16)", () => {
  const custom = '{"v":2,"places":[{"percent":50},{"amountCents":20000},{"amountCents":10000}]}';
  const paid = (pool: PrizePoolBreakdown) => pool.payouts.map((p) => p.amountCents);
  // A 10% AP on the buy-ins ($50) leaves $685 of FIELD's $735 for prizes.
  const reduced = (prizeDifference: string | null) =>
    computePrizePool(tournament({ rakeType: "percentage", rakeAmount: "10.00", manualPrizePool: "600.00", prizeDifference }), FIELD);

  it("a manual pool below what is available: the club keeps the difference by default, as it always has", () => {
    for (const choice of [null, "club", "not a choice"]) {
      const pool = reduced(choice);
      expect(pool.net).toBe(60_000);
      expect(paid(pool)).toEqual([30_000, 18_000, 12_000]);
      expect(pool.impliedRake).toBe(13_500);
      expect(pool.difference).toEqual({
        choice: "club",
        availableCents: 68_500,
        setCents: 60_000,
        cents: 8_500,
        keptByClubCents: 8_500,
        addedToPrizesCents: 0,
        carriedOverCents: 0,
        addedByClubCents: 0,
      });
    }
  });

  it("adds it to 1st, or shares it across the places in whole dollars (the cents to 1st)", () => {
    const first = reduced("first");
    expect(first.net).toBe(68_500);
    expect(paid(first)).toEqual([38_500, 18_000, 12_000]);
    expect(first.impliedRake).toBe(5_000);
    expect(first.structure.basisPoints).toEqual([5_620, 2_628, 1_752]);
    const shared = reduced("pro_rata");
    expect(paid(shared)).toEqual([34_300, 20_500, 13_700]);
    expect(shared.difference).toMatchObject({ addedToPrizesCents: 8_500, keptByClubCents: 0 });
  });

  it("carries it over: the prizes stay as set and the club's take is only its AP", () => {
    const pool = reduced("carry");
    expect(pool.net).toBe(60_000);
    expect(paid(pool)).toEqual([30_000, 18_000, 12_000]);
    expect(pool.structure.basisPoints).toEqual(PAYOUT_STRUCTURES.standard);
    expect(pool.difference).toMatchObject({ carriedOverCents: 8_500, keptByClubCents: 0 });
    expect(pool.impliedRake).toBe(5_000);
  });

  it("settles custom places' leftover by the same choice", () => {
    const choose = (prizeDifference: string) => computePrizePool(tournament({ payoutStructure: "custom", customPayouts: custom, prizeDifference }), FIELD);
    expect(paid(choose("first"))).toEqual([43_500, 20_000, 10_000]);
    expect(paid(choose("pro_rata"))).toEqual([40_500, 22_000, 11_000]);
    expect(paid(choose("carry"))).toEqual([36_700, 20_000, 10_000]);
    expect(choose("carry").difference.carriedOverCents).toBe(6_800);
  });

  it("a manual pool above what is available is a guarantee: the club adds the difference", () => {
    const pool = computePrizePool(tournament({ rakeType: "percentage", rakeAmount: "10.00", manualPrizePool: "1000.00", prizeDifference: "carry" }), FIELD);
    expect(pool.net).toBe(100_000);
    expect(pool.difference).toMatchObject({ cents: -31_500, addedByClubCents: 31_500, carriedOverCents: 0, keptByClubCents: 0 });
    expect(pool.impliedRake).toBe(-26_500);
  });

  it("adds money carried over from earlier tournaments to what is available, each named", () => {
    const carriedIn = [
      { carryOverId: "c1", fromTournamentId: "t0", fromName: "Test Wednesday", amountCents: 5_000 },
      { carryOverId: "c2", fromTournamentId: null, fromName: "Old Friday", amountCents: 2_500 },
      { carryOverId: "c3", fromName: "Junk", amountCents: -100 },
      "not an entry",
    ];
    const pool = computePrizePool(tournament({ carriedIn }), FIELD);
    expect(pool.carriedIn.map((entry) => entry.carryOverId)).toEqual(["c1", "c2"]);
    expect(pool.carriedInCents).toBe(7_500);
    expect(pool.netAfterAp).toBe(81_000);
    expect(pool.net).toBe(81_000);
    expect(pool.impliedRake).toBe(0);
    expect(paid(pool).reduce((sum, amount) => sum + amount, 0)).toBe(81_000);
    expect(computePrizePool(tournament({ carriedIn: "nonsense" }), FIELD).carriedInCents).toBe(0);
  });

  it("leaves every tournament without a choice or a carry-in paying exactly as before", () => {
    fc.assert(
      fc.property(legacyTournaments, registrationLists(), (settings, registrations) => {
        const before = computePrizePool(settings, registrations);
        const club = computePrizePool({ ...settings, prizeDifference: "club", carriedIn: [] }, registrations);
        expect(club).toEqual(before);
        if (before.manualPrizePool === null && !before.structure.places) {
          // A share table splits all of what is available: no choice can change it.
          for (const prizeDifference of ["first", "pro_rata", "carry"]) {
            expect(computePrizePool({ ...settings, prizeDifference }, registrations).payouts).toEqual(before.payouts);
          }
        }
      }),
      PARITY_RUNS,
    );
  });

  it("always pays exactly what is available, less what the club keeps or carries over, plus what it adds, to the cent", () => {
    const place = fc.oneof(
      fc.integer({ min: 1, max: 4_000 }).map((percent) => ({ percent: percent / 100 })),
      fc.integer({ min: 1, max: 2_000 }).map((dollars) => ({ amountCents: dollars * 100 })),
    );
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 60 }),
        fc.option(fc.integer({ min: 0, max: 500_000 }), { nil: null }),
        fc.array(place, { minLength: 1, maxLength: 6 }),
        fc.constantFrom("club", "first", "pro_rata", "carry"),
        fc.integer({ min: 0, max: 50_000 }),
        (players, manual, raw, prizeDifference, carried) => {
          const percents = raw.filter((p) => "percent" in p).sort((a, b) => (b as { percent: number }).percent - (a as { percent: number }).percent);
          const fixed = raw.filter((p) => "amountCents" in p).sort((a, b) => (b as { amountCents: number }).amountCents - (a as { amountCents: number }).amountCents);
          let pi = 0;
          let ai = 0;
          const places = raw.map((p) => ("percent" in p ? percents[pi++] : fixed[ai++]));
          const total = places.reduce((sum, p) => sum + ("percent" in p ? (p as { percent: number }).percent : 0), 0);
          fc.pre(total <= 100);
          const settings = tournament({
            rakeType: "percentage",
            rakeAmount: "10.00",
            payoutStructure: "custom",
            customPayouts: JSON.stringify({ v: 2, places }),
            manualPrizePool: manual === null ? null : decimalString(manual),
            prizeDifference,
            carriedIn: carried > 0 ? [{ carryOverId: "c1", fromTournamentId: null, fromName: "Earlier", amountCents: carried }] : [],
          });
          const pool = computePrizePool(settings, Array.from({ length: players }, () => ({ buyIns: 1 })));
          const { difference } = pool;
          const sum = pool.payouts.reduce((all, p) => all + p.amountCents, 0);
          expect(sum).toBe(pool.net > 0 ? pool.net : 0);
          expect(pool.netAfterAp).toBe(pool.gross.total + carried - pool.rake.applied);
          expect(pool.net).toBe(pool.netAfterAp - difference.keptByClubCents - difference.carriedOverCents + difference.addedByClubCents);
          expect(pool.impliedRake).toBe(pool.gross.total + carried - pool.net - difference.carriedOverCents);
          if (pool.net > 0) expect(pool.payouts.reduce((all, p) => all + p.basisPoints, 0)).toBe(10_000);
        },
      ),
      { numRuns: 1000 },
    );
  });
});

describe("parity with today's code at dddf8ad (pool.legacy, bit for bit)", () => {
  it("one answer that finalize, the admin page, the public page and the dashboard all agree on", () => {
    const settings = tournament({ rebuyAmount: null, addonAmount: null, rakeType: "percentage", rakeAmount: "10.00" });
    const field = Array.from({ length: 10 }, () => ({ buyIns: 1, rebuys: 0, addons: 0, enteringHighHands: false }));
    const pool = computePrizePool(settings, field);

    expect(pool.net).toBe(45_000);
    expect(referenceFinalize(settings, field).netPrizePool).toBe(450);
    expect(referenceAdminPage(settings, field).netPrizePool).toBe(450);
    expect(referencePublicPage(settings, field).netPrizePool).toBe(450);
    expect(referenceDashboardNet(settings, field)).toBe(450);
    expect(referenceFinalize(settings, field).prizes.slice(0, 3)).toEqual(["225", "135", "90"]);
    expect(pool.payouts.map((p) => p.amountCents)).toEqual([22_500, 13_500, 9_000]);
  });

  it("matches finalize: gross, AP, net and the prize written for each position", () => {
    fc.assert(
      fc.property(legacyTournaments, registrationLists(), (settings, registrations) => {
        const pool = poolAndLegacy(settings, registrations);
        const today = referenceFinalize(settings, registrations);
        expect(pool.legacy.gross.total).toBe(today.grossTotal);
        expect(pool.legacy.rake.total).toBe(today.rake);
        expect(pool.legacy.calculatedNet).toBe(today.netPrizePool);
        const places = legacyPayouts(pool.legacy.calculatedNet, settings.payoutStructure);
        const prizes = registrations.map((_, i) => {
          const amount = places[i]?.amount ?? 0;
          return amount > 0 ? amount.toString() : null;
        });
        expect(prizes).toEqual(today.prizes);
      }),
      PARITY_RUNS,
    );
  });

  it("matches the admin page: every figure and the payout table, manual pool included", () => {
    fc.assert(
      fc.property(legacyTournaments, registrationLists(), (settings, registrations) => {
        const pool = poolAndLegacy(settings, registrations);
        const today = referenceAdminPage(settings, registrations);
        expect(pool.counts.registrations).toBe(today.totalPlayers);
        expect(pool.counts.buyIns).toBe(today.totalBuyIns);
        expect(pool.counts.rebuys).toBe(today.totalRebuys);
        expect(pool.counts.addons).toBe(today.totalAddons);
        expect(pool.legacy.gross).toEqual({
          buyIn: today.buyInTotal,
          rebuy: today.rebuyTotal,
          addon: today.addonTotal,
          total: today.grossTotal,
        });
        expect(pool.legacy.rake.buyIn).toBe(today.buyInRake);
        expect(pool.legacy.rake.rebuy).toBe(today.rebuyRake);
        expect(pool.legacy.rake.addon).toBe(today.addonRake);
        expect(pool.legacy.rake.total).toBe(today.rake);
        expect(pool.legacy.calculatedNet).toBe(today.calculatedPrizePool);
        expect(pool.legacy.net).toBe(today.netPrizePool);
        expect(pool.legacy.payouts).toEqual(today.prizePayouts);
      }),
      PARITY_RUNS,
    );
  });

  it("matches the public page: gross, AP, net and the payout table", () => {
    fc.assert(
      fc.property(legacyTournaments, registrationLists(), (settings, registrations) => {
        const pool = poolAndLegacy(settings, registrations);
        const today = referencePublicPage(settings, registrations);
        expect(pool.legacy.gross.total).toBe(today.grossTotal);
        expect(pool.legacy.rake.total).toBe(today.rake);
        expect(pool.legacy.calculatedNet).toBe(today.netPrizePool);
        expect(legacyPayouts(pool.legacy.calculatedNet, settings.payoutStructure)).toEqual(today.prizePayouts);
      }),
      PARITY_RUNS,
    );
  });

  it("matches the high-hand calculator and the Award High Hand default", () => {
    fc.assert(
      fc.property(legacyTournaments, registrationLists(), (settings, registrations) => {
        const pool = poolAndLegacy(settings, registrations);
        const today = referenceHighHand(settings, registrations);
        expect(pool.counts.highHandEntrants).toBe(registrations.filter((r) => r.enteringHighHands).length);
        expect(pool.legacy.highHand).toEqual({
          gross: today.highHandGross,
          rake: today.highHandRakeAmount,
          net: today.highHandNet,
          perWinner: today.highHandPerWinner,
        });
        expect(pool.legacy.highHand.perWinner.toFixed(2)).toBe(today.defaultAward);
      }),
      PARITY_RUNS,
    );
  });

  describe("the dashboard, whose formula differs from the other three", () => {
    const noRake = { rakeType: "none", rebuyRakeType: "none", addonRakeType: "none" } as const;

    it("agrees to the cent when no AP is taken", () => {
      fc.assert(
        fc.property(legacyTournaments, registrationLists(), (settings, registrations) => {
          const plain = { ...settings, ...noRake };
          expect(roundToCents(referenceDashboardNet(plain, registrations))).toBe(netFromRates(computePrizePool(plain, registrations)));
        }),
        PARITY_RUNS,
      );
    });

    it("agrees within a cent on a percentage of buy-ins when there are no re-buys or add-ons", () => {
      fc.assert(
        fc.property(legacyTournaments, registrationLists({ rebuys: 0, addons: 0 }), percent, (settings, registrations, rate) => {
          const plain = { ...settings, ...noRake, rakeType: "percentage", rakeAmount: rate };
          const today = roundToCents(referenceDashboardNet(plain, registrations));
          expect(Math.abs(today - netFromRates(computePrizePool(plain, registrations)))).toBeLessThanOrEqual(1);
        }),
        PARITY_RUNS,
      );
    });

    // Where the dashboard disagrees with finalize, the shared module follows finalize (spec §2 item 9).
    it.each([
      ["takes fixed AP once per tournament, not per entry", { rakeType: "fixed", rakeAmount: "5.00" }, 73_000, 68_500],
      ["applies the buy-in percentage to re-buys and add-ons", { rakeType: "percentage", rakeAmount: "10.00" }, 66_150, 68_500],
      ["ignores re-buy and add-on AP", { rebuyRakeType: "fixed", rebuyRakeAmount: "5.00" }, 73_500, 71_500],
    ] as const)("today it %s", (_, overrides, dashboardCents, sharedCents) => {
      const settings = tournament(overrides);
      expect(roundToCents(referenceDashboardNet(settings, FIELD))).toBe(dashboardCents);
      expect(netFromRates(computePrizePool(settings, FIELD))).toBe(sharedCents);
      expect(roundToCents(referenceFinalize(settings, FIELD).netPrizePool)).toBe(sharedCents);
    });
  });
});

describe("exact cents against today's floats", () => {
  it("gives the same gross and per-component AP to the cent, and a net within 2 cents (equal unless AP has a half cent)", () => {
    fc.assert(
      fc.property(legacyTournaments, registrationLists(), (settings, registrations) => {
        const pool = poolAndLegacy(settings, registrations);
        for (const key of ["buyIn", "rebuy", "addon", "total"] as const) {
          expect(pool.gross[key]).toBe(roundToCents(pool.legacy.gross[key]));
        }
        for (const key of ["buyIn", "rebuy", "addon"] as const) {
          expect(pool.rake[key]).toBe(roundToCents(pool.legacy.rake[key]));
        }
        const floatNet = roundToCents(pool.legacy.calculatedNet);
        expect(Math.abs(netFromRates(pool) - floatNet)).toBeLessThanOrEqual(2);
        const wholeCents =
          isWholeCents(settings.rakeType, settings.rakeAmount, pool.gross.buyIn) &&
          isWholeCents(settings.rebuyRakeType, settings.rebuyRakeAmount, pool.gross.rebuy) &&
          isWholeCents(settings.addonRakeType, settings.addonRakeAmount, pool.gross.addon);
        if (wholeCents) expect(netFromRates(pool)).toBe(floatNet);
        if (settings.manualPrizePool !== null) {
          expect(pool.manualPrizePool).toBe(roundToCents(pool.legacy.net));
        }
      }),
      PARITY_RUNS,
    );
  });

  it("rounds a half-cent AP per component, so the net can differ from today's float by a cent", () => {
    // 2.5% of a $21 buy-in is 52.5 cents (53), and 2.5% of a $21 re-buy is another 52.5 cents (53).
    const settings = tournament({
      buyInAmount: "21.00",
      rebuyAmount: "21.00",
      addonAmount: null,
      rakeType: "percentage",
      rakeAmount: "2.5",
      rebuyRakeType: "percentage",
      rebuyRakeAmount: "2.5",
    });
    const pool = poolAndLegacy(settings, [{ buyIns: 1, rebuys: 1 }]);
    expect(pool.rake.calculated).toBe(106);
    expect(netFromRates(pool)).toBe(4_094);
    expect(roundToCents(pool.legacy.calculatedNet)).toBe(4_095);
  });

  it("agrees with the high-hand figures to the cent for percentage and fixed rake", () => {
    fc.assert(
      fc.property(legacyTournaments, registrationLists(), rakeType, (settings, registrations, type) => {
        const pool = poolAndLegacy({ ...settings, highHandRakeType: type }, registrations);
        expect(pool.highHand.gross).toBe(roundToCents(pool.legacy.highHand.gross));
        if (type !== "none") expect(pool.highHand.rake).toBe(roundToCents(pool.legacy.highHand.rake));
      }),
      PARITY_RUNS,
    );
  });
});

describe("payoutsForDisplay", () => {
  const nineteen = Array.from({ length: 19 }, () => ({ buyIns: 1 }));
  const pool475 = computePrizePool(tournament({ buyInAmount: "25.00" }), nineteen);

  it("shows a completed tournament's stored prizes, in finishing order, never recomputed", () => {
    const registrations: StoredResultInput[] = [
      { id: "a", finalPosition: 2, prizeAmount: "143.00" },
      { id: "b", finalPosition: 1, prizeAmount: "238.00" },
      { id: "c", finalPosition: 3, prizeAmount: "95.00" },
      { id: "d", finalPosition: 4, prizeAmount: null },
      { id: "e", finalPosition: null, prizeAmount: "10.00" },
      { id: "f", finalPosition: 5, prizeAmount: "0.00" },
    ];
    expect(payoutsForDisplay({ status: "completed" }, pool475, registrations)).toEqual({
      source: "stored",
      rows: [
        { position: 1, amountCents: 23_800, percentage: null, registrationId: "b" },
        { position: 2, amountCents: 14_300, percentage: null, registrationId: "a" },
        { position: 3, amountCents: 9_500, percentage: null, registrationId: "c" },
      ],
      totalCents: 47_600,
      undistributedCents: 0,
    });
  });

  it("says a completed tournament's prizes were not recorded when it had a pool but no prize is stored (P2-PRODDATA-01)", () => {
    // Prod's hand-entered results: positions set, no prizeAmount, a $360 pool. Never "$0.00 paid".
    const unpaid: StoredResultInput[] = [
      { id: "a", finalPosition: null },
      { id: "b", finalPosition: 1, prizeAmount: null },
      { id: "c", finalPosition: 2, prizeAmount: "0.00" },
    ];

    const unrecorded = { source: "unrecorded", rows: [], totalCents: 0, undistributedCents: 0 };
    expect(payoutsForDisplay({ status: "completed" }, pool475, unpaid)).toEqual(unrecorded);
    expect(payoutsForDisplay({ status: "completed" }, pool475, [])).toEqual(unrecorded);
  });

  it("shows a completed tournament with nothing in its pool as paying nothing (a free game), never recomputing", () => {
    const free = computePrizePool(tournament({ buyInAmount: "0.00" }), nineteen);
    const nothing = { source: "stored", rows: [], totalCents: 0, undistributedCents: 0 };
    expect(payoutsForDisplay({ status: "completed" }, free, [{ id: "a", finalPosition: 1, prizeAmount: null }])).toEqual(nothing);
  });

  it("shows a completed tournament's snapshot ahead of the stored prizes, leaving out places paid nothing", () => {
    const snapshot = {
      pool: { netCents: 40_000 },
      paid: [
        { position: 2, registrationId: "a", basisPoints: 3000, amountCents: 14_200 },
        { position: 1, registrationId: "b", basisPoints: 5000, amountCents: 23_800 },
        { position: 3, registrationId: "c", basisPoints: 2000, amountCents: 0 },
      ],
    };
    const stored: StoredResultInput[] = [{ id: "b", finalPosition: 1, prizeAmount: "999.00" }];

    expect(payoutsForDisplay({ status: "completed", prizePoolSnapshot: snapshot }, pool475, stored)).toEqual({
      source: "snapshot",
      rows: [
        { position: 1, amountCents: 23_800, percentage: 50, registrationId: "b" },
        { position: 2, amountCents: 14_200, percentage: 30, registrationId: "a" },
      ],
      totalCents: 38_000,
      undistributedCents: 2_000,
    });
    expect(payoutsForDisplay({ status: "completed", prizePoolSnapshot: null }, pool475, stored).source).toBe("stored");
    expect(payoutsForDisplay({ status: "in_progress", prizePoolSnapshot: snapshot }, pool475, stored).source).toBe("live");
  });

  it("shows no prizes for a cancelled tournament, which finalize refuses and the dashboard counts as $0 (P2REV1-MONEY-04)", () => {
    const snapshot = { pool: { netCents: 47_500 }, paid: [{ position: 1, registrationId: "a", basisPoints: 10_000, amountCents: 47_500 }] };
    const cancelled = { source: "cancelled", rows: [], totalCents: 0, undistributedCents: 0 };
    expect(payoutsForDisplay({ status: "cancelled" }, pool475, [{ id: "b", finalPosition: 1, prizeAmount: "999.00" }])).toEqual(cancelled);
    expect(payoutsForDisplay({ status: "cancelled", prizePoolSnapshot: snapshot }, pool475, [])).toEqual(cancelled);
    expect(prizeMoneyCents({ ...tournament(), status: "cancelled" }, [{ buyIns: 19 }], 0)).toBe(0);
  });

  it.each(["in_progress", "registration", "scheduled", null, undefined])(
    "shows the live v2 payouts for a %s tournament",
    (status) => {
      expect(payoutsForDisplay({ status }, pool475, [{ id: "b", finalPosition: 1, prizeAmount: "999.00" }])).toEqual({
        source: "live",
        rows: [
          { position: 1, amountCents: 23_800, percentage: 50 },
          { position: 2, amountCents: 14_200, percentage: 30 },
          { position: 3, amountCents: 9_500, percentage: 20 },
        ],
        totalCents: 47_500,
        undistributedCents: 0,
      });
    },
  );

  it("shows only the places finalize would pay while there are fewer entrants than places (MONEY-REV-01)", () => {
    // Top 9 with 8 players at $100: the 9th place's $16 has nobody to go to.
    const eight = Array.from({ length: 8 }, () => ({ buyIns: 1 }));
    const pool = computePrizePool(tournament({ buyInAmount: "100.00", payoutStructure: "top9" }), eight);
    const display = payoutsForDisplay({ status: "in_progress" }, pool, []);

    expect(display.rows.map((row) => row.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(display.totalCents).toBe(78_400);
    expect(display.undistributedCents).toBe(1_600);
    expect(display.totalCents + display.undistributedCents).toBe(pool.net);
    expect(paidPercentage(display.rows)).toBe(98);
  });

  it("pays every place once there are as many entrants as places", () => {
    const pool = computePrizePool(tournament({ buyInAmount: "20.00" }), [{ buyIns: 1 }, { buyIns: 1 }]);
    const display = payoutsForDisplay({ status: "registration" }, pool, []);

    expect(display.rows.map((row) => row.position)).toEqual([1, 2]);
    expect(display.undistributedCents).toBe(800);
    expect(paidPercentage(display.rows)).toBe(80);
    expect(paidPercentage(payoutsForDisplay({ status: "registration" }, pool475, []).rows)).toBe(100);
  });
});

describe("splitHighHandAward (CQ-P2-02)", () => {
  it("gives the new winner half, the earlier winner keeping any odd cent, and the two still add up", () => {
    expect(splitHighHandAward(5_000)).toEqual({ shareCents: 2_500, keepCents: 2_500 });
    expect(splitHighHandAward(5_001)).toEqual({ shareCents: 2_500, keepCents: 2_501 });
    expect(splitHighHandAward(1)).toEqual({ shareCents: 0, keepCents: 1 });
    expect(splitHighHandAward(0)).toEqual({ shareCents: 0, keepCents: 0 });
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000_000 }), (awarded) => {
        const { shareCents, keepCents } = splitHighHandAward(awarded);
        expect(shareCents + keepCents).toBe(awarded);
        expect(keepCents - shareCents).toBeGreaterThanOrEqual(0);
        expect(keepCents - shareCents).toBeLessThanOrEqual(1);
      }),
    );
  });
});

describe("nextHighHandAward (MONEY-36)", () => {
  it("splits what is left over the winners still to come, the last taking the remainder", () => {
    const pot = { net: 10_001, winners: 2 };

    expect(nextHighHandAward(pot, [])).toBe(5_000);
    expect(nextHighHandAward(pot, [5_000])).toBe(5_001);
    expect(nextHighHandAward(pot, [5_000, 5_001])).toBeNull();
  });

  it("keeps the awards adding up to the pot when it grew between them", () => {
    // $100 when the first winner is paid, $160 by the second award.
    expect(nextHighHandAward({ net: 10_000, winners: 2 }, [])).toBe(5_000);
    expect(nextHighHandAward({ net: 16_000, winners: 2 }, [5_000])).toBe(11_000);
  });

  it("awards nothing once the pot is used up, and the whole pot to a single winner", () => {
    expect(nextHighHandAward({ net: 0, winners: 1 }, [])).toBe(0);
    expect(nextHighHandAward({ net: 5_000, winners: 3 }, [6_000])).toBe(0);
    expect(nextHighHandAward({ net: 7_777, winners: 1 }, [])).toBe(7_777);
  });

  it("never pays more than the pot, however the winners are split", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000 }), fc.integer({ min: 1, max: 4 }), (net, winners) => {
        const awards: number[] = [];
        for (let i = 0; i < winners; i++) awards.push(nextHighHandAward({ net, winners }, awards) as number);
        expect(nextHighHandAward({ net, winners }, awards)).toBeNull();
        expect(awards.reduce((sum, amount) => sum + amount, 0)).toBe(net);
      }),
    );
  });
});

describe("highHandAwardsProblem (MONEY-P2REV-05)", () => {
  it("lets anything through before the first award", () => {
    expect(highHandAwardsProblem({ net: 0, winners: 1 }, [])).toBeNull();
  });

  it("refuses a pot smaller than what was already awarded", () => {
    // 10 entrants × $10, one $100 award, then an entry is unticked: $90 left against $100 paid.
    expect(highHandAwardsProblem({ net: 9_000, winners: 2 }, [10_000])).toEqual({
      code: "HIGH_HAND_OVER_POOL",
      awardedCents: 10_000,
      potCents: 9_000,
    });
  });

  it("refuses a pot that changes once every prize is awarded, so no money is left that nobody can win", () => {
    expect(highHandAwardsProblem({ net: 13_000, winners: 1 }, [10_000])).toMatchObject({ code: "HIGH_HAND_AWARDED" });
    expect(highHandAwardsProblem({ net: 10_000, winners: 1 }, [10_000])).toBeNull();
  });

  it("refuses fewer prizes than winners, and lets a pot grow while prizes are still to come", () => {
    expect(highHandAwardsProblem({ net: 20_000, winners: 1 }, [10_000, 10_000])).toMatchObject({ code: "HIGH_HAND_AWARDED" });
    expect(highHandAwardsProblem({ net: 16_000, winners: 2 }, [5_000])).toBeNull();
  });
});

describe("unawardedHighHandCents (R6REV0-MONEY-01)", () => {
  it("is what a pot that grew after the last prize was awarded holds beyond the awards", () => {
    // 8 paid × $5 = $40 to one winner, then a ninth entrant's payment is confirmed: $45 in the pot.
    expect(unawardedHighHandCents({ net: 4_500, winners: 1 }, [4_000])).toBe(500);
    expect(unawardedHighHandCents({ net: 9_000, winners: 2 }, [4_000, 4_000])).toBe(1_000);
  });

  it("is nothing while prizes are still to come, before any award, or when the awards add up to the pot or more", () => {
    expect(unawardedHighHandCents({ net: 9_000, winners: 2 }, [4_000])).toBe(0);
    expect(unawardedHighHandCents({ net: 4_500, winners: 1 }, [])).toBe(0);
    expect(unawardedHighHandCents({ net: 4_000, winners: 1 }, [4_000])).toBe(0);
    expect(unawardedHighHandCents({ net: 4_000, winners: 1 }, [5_000])).toBe(0);
  });
});

describe("amountDueCents (money-18)", () => {
  const prices = { buyInAmount: "50.00", rebuyAmount: "40.00", addonAmount: "25.50", highHandAmount: "20.00" };
  const entry = { buyIns: 1, rebuys: 0, addons: 0, enteringHighHands: false };

  it("counts every buy-in, re-buy and add-on at the tournament's prices", () => {
    expect(amountDueCents(prices, entry)).toBe(5000);
    expect(amountDueCents(prices, { ...entry, buyIns: 2, rebuys: 3, addons: 1 })).toBe(2 * 5000 + 3 * 4000 + 2550);
  });

  it("adds the high-hand entry exactly when the pot counts it: when the player entered (P2REV4-CQ-08)", () => {
    expect(amountDueCents(prices, { ...entry, enteringHighHands: true })).toBe(7000);
    const highHand = tournament({ highHandAmount: "20.00" });
    const entrants = [{ buyIns: 1, enteringHighHands: true }, { buyIns: 1, enteringHighHands: false }];
    const owed = entrants.reduce((sum, e) => sum + amountDueCents(highHand, e) - amountDueCents(highHand, { ...e, enteringHighHands: false }), 0);
    expect(owed).toBe(computePrizePool(highHand, entrants).highHand.gross);
  });

  it("treats unset prices and null counts as zero, as the prize pool does", () => {
    const bare = { buyInAmount: "30.00", rebuyAmount: null, addonAmount: null, highHandAmount: null };
    expect(amountDueCents(bare, { buyIns: 1, rebuys: 4, addons: 2, enteringHighHands: true })).toBe(3000);
    expect(amountDueCents(prices, { buyIns: null, rebuys: null, addons: null, enteringHighHands: null })).toBe(0);
  });

  it("is exact in cents where float dollars are not", () => {
    expect(amountDueCents({ ...prices, buyInAmount: "0.10", addonAmount: "0.20" }, { ...entry, addons: 1 })).toBe(30);
  });
});

describe("prizeMoneyCents: one tournament's share of a total such as the dashboard's", () => {
  const entries = [{ buyIns: 2 }, { buyIns: 1, rebuys: 2 }, { buyIns: 1, addons: 1 }, { buyIns: 1 }].map(paidUp);
  const open = tournament({ buyInAmount: "50.00", rebuyAmount: "25.00", addonAmount: "20.00", rakeType: "percentage", rakeAmount: "10.00" });

  it("counts an open tournament's current pool, with each pot's own rake", () => {
    // 5 buy-ins $250 less 10%, plus $50 of re-buys and a $20 add-on with no rake of their own.
    expect(prizeMoneyCents({ ...open, status: "registration" }, entries, 0)).toBe(29_500);
  });

  it("gives the same answer for one row of totals as for the registrations", () => {
    expect(prizeMoneyCents({ ...open, status: "in_progress" }, [{ buyIns: 5, rebuys: 2, addons: 1, paymentConfirmed: true }], 0)).toBe(
      prizeMoneyCents({ ...open, status: "in_progress" }, entries, 0),
    );
  });

  it("counts only paid entries (round 6): a row of totals counts when it is marked paid", () => {
    const unpaid = { buyIns: 3, rebuys: 1, addons: 1, paymentConfirmed: false };
    expect(prizeMoneyCents({ ...open, status: "in_progress" }, [...entries, unpaid], 0)).toBe(29_500);
    expect(prizeMoneyCents({ ...open, status: "in_progress" }, [{ buyIns: 5, rebuys: 2, addons: 1 }], 0)).toBe(0);
  });

  it("never counts an open pool below zero", () => {
    expect(prizeMoneyCents({ ...tournament({ rakeType: "fixed", rakeAmount: "60.00" }), status: "scheduled" }, [paidUp({ buyIns: 1 })], 0)).toBe(0);
  });

  it("counts what a completed tournament paid: its snapshot, else its stored prizes, never its rates", () => {
    const snapshot = { pool: { netCents: 12_345 }, paid: [{ position: 1, registrationId: "a", basisPoints: 10_000, amountCents: 12_345 }] };

    expect(prizeMoneyCents({ ...open, status: "completed", prizePoolSnapshot: snapshot }, entries, 99_900)).toBe(12_345);
    expect(prizeMoneyCents({ ...open, status: "completed" }, entries, 15_000)).toBe(15_000);
  });

  it("counts a completed tournament whose prizes were never recorded by its calculated pool, as before Phase 2 (P2-PRODDATA-01)", () => {
    expect(prizeMoneyCents({ ...open, status: "completed" }, entries, 0)).toBe(29_500);
    const free = tournament({ buyInAmount: "0.00", rebuyAmount: null, addonAmount: null });
    expect(prizeMoneyCents({ ...free, status: "completed" }, entries, 0)).toBe(0);
  });

  it("leaves cancelled tournaments out", () => {
    expect(prizeMoneyCents({ ...open, status: "cancelled" }, entries, 15_000)).toBe(0);
  });
});

describe("rakeLabel", () => {
  it.each([
    [undefined, "Rake"],
    [null, "Rake"],
    [{}, "Rake"],
    [{ rakeLabel: null }, "Rake"],
    [{ rakeLabel: "" }, "Rake"],
    [{ rakeLabel: "   " }, "Rake"],
    [{ rakeLabel: "AP" }, "AP"],
    [{ rakeLabel: " Admin fee " }, "Admin fee"],
  ])("labels %j as %s", (club, expected) => {
    expect(rakeLabel(club)).toBe(expected);
  });

  it("defaults to Rake", () => {
    expect(DEFAULT_RAKE_LABEL).toBe("Rake");
  });
});

describe("input types", () => {
  it("accepts database rows as they are", () => {
    expectTypeOf<Tournament>().toExtend<PrizePoolInput>();
    expectTypeOf<TournamentRegistration>().toExtend<EntryInput>();
    expectTypeOf<TournamentRegistration>().toExtend<StoredResultInput>();
  });
});
