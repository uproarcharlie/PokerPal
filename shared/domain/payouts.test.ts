import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  addPayoutPlace,
  allocatePayouts,
  changePlaceKind,
  CUSTOM_PAYOUTS_VERSION,
  describePayoutPlaces,
  PAYOUT_ALGORITHM,
  PAYOUT_PLACE_LIMITS,
  payoutPlacesProblems,
  placeAmounts,
  placeName,
  placesFromShares,
  placeValueText,
  previewPayoutPlaces,
  previewShares,
  removePayoutPlace,
  serializeCustomPayouts,
  type PayoutPlace,
  PAYOUT_STRUCTURE_KEYS,
  PAYOUT_STRUCTURE_LABELS,
  PAYOUT_STRUCTURES,
  parseCustomPayouts,
  resolvePayoutStructure,
  undistributedCents,
  type StandardPayoutKey,
} from "./payouts";
import { PRIZE_DIFFERENCE_CHOICES } from "./prize-difference";
import { legacyPayouts } from "@test/helpers/legacy-money";

/**
 * Today's payout tables, copied verbatim. The same literal appears three times at dddf8ad:
 * server/routes.ts:878-884, client/src/pages/tournament-details.tsx:321-327 and
 * client/src/pages/public-tournament-view.tsx:241-247.
 */
const LEGACY_PAYOUT_STRUCTURES: Record<string, number[]> = {
  'standard': [0.50, 0.30, 0.20],
  'top3': [0.50, 0.30, 0.20],
  'top5': [0.40, 0.25, 0.20, 0.10, 0.05],
  'top8': [0.35, 0.22, 0.15, 0.12, 0.08, 0.04, 0.02, 0.02],
  'top9': [0.30, 0.20, 0.15, 0.12, 0.09, 0.06, 0.04, 0.02, 0.02],
};

/** client/src/pages/tournament-details.tsx:318-336 (and public-tournament-view.tsx:238-256) at dddf8ad. */
function referenceGetPrizePayouts(netPrizePool: number, payoutStructure: string) {
  if (netPrizePool <= 0) return [];
  const percentages = LEGACY_PAYOUT_STRUCTURES[payoutStructure] || LEGACY_PAYOUT_STRUCTURES['standard'];
  return percentages.map((percentage, index) => ({
    position: index + 1,
    percentage: percentage * 100,
    amount: Math.round(netPrizePool * percentage),
  }));
}

const STANDARD_KEYS = Object.keys(PAYOUT_STRUCTURES) as StandardPayoutKey[];
const amounts = (payouts: { amountCents: number }[]) => payouts.map((p) => p.amountCents);
const total = (values: number[]) => values.reduce((sum, v) => sum + v, 0);

/** Valid custom shares: 1 to 12 positive whole basis points, never increasing, adding up to 10000. */
const customShares = fc
  .array(fc.integer({ min: 1, max: 10_000 }), { minLength: 1, maxLength: 12 })
  .map((weights) => {
    const weightTotal = total(weights);
    const shares = weights.map((w) => Math.max(1, Math.floor((w * 10_000) / weightTotal)));
    shares.sort((a, b) => b - a);
    shares[0] += 10_000 - total(shares);
    return shares;
  })
  .filter((shares) => shares.every((bp, i) => bp > 0 && (i === 0 || bp <= shares[i - 1])));

const anyShares = fc.oneof(
  fc.constantFrom(...STANDARD_KEYS).map((key) => PAYOUT_STRUCTURES[key]),
  customShares,
);

describe("payout tables", () => {
  it("names the v2 algorithm", () => {
    expect(PAYOUT_ALGORITHM).toBe("v2-floor-remainder-first");
  });

  it.each(STANDARD_KEYS)("%s adds up to 100%% and never increases", (key) => {
    const shares = PAYOUT_STRUCTURES[key];
    expect(total([...shares])).toBe(10_000);
    shares.forEach((bp, i) => {
      expect(Number.isInteger(bp)).toBe(true);
      if (i > 0) expect(bp).toBeLessThanOrEqual(shares[i - 1]);
    });
  });

  it("is exactly the legacy table: bp / 10000 is the same double as today's literal", () => {
    expect(Object.keys(PAYOUT_STRUCTURES)).toEqual(Object.keys(LEGACY_PAYOUT_STRUCTURES));
    for (const key of STANDARD_KEYS) {
      const fractions = PAYOUT_STRUCTURES[key].map((bp) => bp / 10_000);
      expect(fractions).toHaveLength(LEGACY_PAYOUT_STRUCTURES[key].length);
      fractions.forEach((fraction, i) => expect(Object.is(fraction, LEGACY_PAYOUT_STRUCTURES[key][i])).toBe(true));
    }
  });

  it("cannot be changed at runtime", () => {
    expect(Object.isFrozen(PAYOUT_STRUCTURES)).toBe(true);
    expect(Object.isFrozen(PAYOUT_STRUCTURES.top9)).toBe(true);
  });

  it("labels each option with the shares it really pays", () => {
    expect(PAYOUT_STRUCTURE_LABELS).toEqual({
      standard: "Standard (50/30/20)",
      top3: "Top 3 (50/30/20)",
      top5: "Top 5 (40/25/20/10/5)",
      top8: "Top 8 (35/22/15/12/8/4/2/2)",
      top9: "Top 9 (30/20/15/12/9/6/4/2/2)",
      custom: "Custom (pays Standard 50/30/20 until set up)",
    });
  });
});

describe("PAYOUT_STRUCTURE_KEYS (P2REV4-10)", () => {
  it("is every table, in menu order, then custom: built from the tables, so the API and the form never miss one", () => {
    expect(PAYOUT_STRUCTURE_KEYS).toEqual([...Object.keys(PAYOUT_STRUCTURES), "custom"]);
    expect(PAYOUT_STRUCTURE_KEYS).toEqual(Object.keys(PAYOUT_STRUCTURE_LABELS));
  });
});

describe("parseCustomPayouts", () => {
  it.each([
    ["[50,30,20]", [5000, 3000, 2000]],
    ["[100]", [10_000]],
    ["[33.34, 33.33, 33.33]", [3334, 3333, 3333]],
    [" [60, 40] ", [6000, 4000]],
    ["[25,25,25,25]", [2500, 2500, 2500, 2500]],
  ])("accepts %s", (raw, basisPoints) => {
    expect(parseCustomPayouts(raw)).toEqual({ ok: true, places: placesFromShares(basisPoints) });
  });

  it.each([
    [null, "Custom payouts are not set up"],
    [undefined, "Custom payouts are not set up"],
    ["", "Custom payouts are not set up"],
    ["   ", "Custom payouts are not set up"],
    ["[50,30,", "Custom payouts are not valid JSON"],
    ['{"1":50}', "Custom payouts must be a list of 1 to 50 percentages"],
    ["[]", "Custom payouts must be a list of 1 to 50 percentages"],
    [JSON.stringify(Array<number>(51).fill(2)), "Custom payouts must be a list of 1 to 50 percentages"],
    ['["50","50"]', "Place 1 must be a percentage above 0 and at most 100"],
    ["[100, 0]", "Place 2 must be a percentage above 0 and at most 100"],
    ["[110, -10]", "Place 1 must be a percentage above 0 and at most 100"],
    ["[1e999]", "Place 1 must be a percentage above 0 and at most 100"],
    ["[null]", "Place 1 must be a percentage above 0 and at most 100"],
    ["[50.005, 49.995]", "Place 1 has more than 2 decimal places"],
    ["[20, 30, 50]", "Place 2 pays more than place 1"],
    ["[50, 30]", "Custom payouts add up to 80%, not 100%"],
    ["[60, 30, 20]", "Custom payouts add up to 110%, not 100%"],
    ["[33.33, 33.33, 33.33]", "Custom payouts add up to 99.99%, not 100%"],
  ])("rejects %s", (raw, error) => {
    expect(parseCustomPayouts(raw)).toEqual({ ok: false, error });
  });
});

describe("resolvePayoutStructure", () => {
  it.each(STANDARD_KEYS)("pays %s as stored", (key) => {
    expect(resolvePayoutStructure(key, null)).toEqual({
      requested: key,
      used: key,
      basisPoints: PAYOUT_STRUCTURES[key],
    });
  });

  it.each([null, undefined, ""])("pays Standard without complaint when the structure is %j", (structure) => {
    expect(resolvePayoutStructure(structure, null)).toEqual({
      requested: "standard",
      used: "standard",
      basisPoints: PAYOUT_STRUCTURES.standard,
    });
  });

  it("honours a valid custom list", () => {
    expect(resolvePayoutStructure("custom", "[70,30]")).toEqual({
      requested: "custom",
      used: "custom",
      basisPoints: [7000, 3000],
    });
  });

  it("pays Standard and says why when the custom list is invalid", () => {
    expect(resolvePayoutStructure("custom", "[70,20]")).toEqual({
      requested: "custom",
      used: "standard",
      basisPoints: PAYOUT_STRUCTURES.standard,
      error: "Custom payouts add up to 90%, not 100%, so Standard is paid instead",
    });
    expect(resolvePayoutStructure("custom", null).error).toBe(
      "Custom payouts are not set up, so Standard is paid instead",
    );
  });

  it.each(["top4", "toString", "__proto__", "STANDARD"])("pays Standard for the unknown structure %s", (key) => {
    expect(resolvePayoutStructure(key, null)).toEqual({
      requested: key,
      used: "standard",
      basisPoints: PAYOUT_STRUCTURES.standard,
      error: `Unknown payout structure "${key}", so Standard is paid instead`,
    });
  });
});

describe("allocatePayouts (v2: floor to whole dollars, remainder to 1st)", () => {
  it("pays $475 as 238/142/95, where today's rounding pays $476", () => {
    expect(amounts(allocatePayouts(47_500, PAYOUT_STRUCTURES.standard))).toEqual([23_800, 14_200, 9_500]);
    expect(legacyPayouts(475, "standard").map((p) => p.amount)).toEqual([238, 143, 95]);
  });

  it("gives the leftover cents to 1st", () => {
    expect(amounts(allocatePayouts(47_550, PAYOUT_STRUCTURES.standard))).toEqual([23_850, 14_200, 9_500]);
    expect(amounts(allocatePayouts(10_001, PAYOUT_STRUCTURES.standard))).toEqual([5_001, 3_000, 2_000]);
  });

  it.each([
    // [structure, pool in dollars, today's total, v2 amounts]
    ["standard", 103, 104, [53, 30, 20]],
    ["top5", 101, 100, [41, 25, 20, 10, 5]],
    ["top9", 475, 477, [145, 95, 71, 57, 42, 28, 19, 9, 9]],
    ["top8", 1000, 1000, [350, 220, 150, 120, 80, 40, 20, 20]],
  ] as const)("%s pays a pool of %d dollars exactly (today: %d)", (key, pool, legacyTotal, expected) => {
    const v2 = allocatePayouts(pool * 100, PAYOUT_STRUCTURES[key]);
    expect(amounts(v2)).toEqual(expected.map((d) => d * 100));
    expect(total(amounts(v2))).toBe(pool * 100);
    expect(total(legacyPayouts(pool, key).map((p) => p.amount))).toBe(legacyTotal);
  });

  it("describes each place", () => {
    expect(allocatePayouts(100_000, PAYOUT_STRUCTURES.top5)[1]).toEqual({
      position: 2,
      basisPoints: 2500,
      percentage: 25,
      amountCents: 25_000,
    });
  });

  it("gives a pool under $1 entirely to 1st", () => {
    expect(amounts(allocatePayouts(50, PAYOUT_STRUCTURES.standard))).toEqual([50, 0, 0]);
    expect(amounts(allocatePayouts(199, PAYOUT_STRUCTURES.standard))).toEqual([199, 0, 0]);
  });

  it.each([0, -1, -47_500])("pays nothing from a pool of %d cents", (pool) => {
    expect(allocatePayouts(pool, PAYOUT_STRUCTURES.standard)).toEqual([]);
  });

  it.each([
    [[]],
    [[5000, 3000]],
    [[5000, 3000, 2000, 1]],
    [[3000, 5000, 2000]],
    [[5000, 5000, 0]],
    [[5000.5, 4999.5]],
    [[11_000, -1000]],
  ])("refuses the shares %j", (shares) => {
    expect(() => allocatePayouts(10_000, shares)).toThrow(RangeError);
  });

  it.each([12.5, Number.NaN, Number.MAX_SAFE_INTEGER])("refuses a pool of %d cents", (pool) => {
    expect(() => allocatePayouts(pool, PAYOUT_STRUCTURES.standard)).toThrow(RangeError);
  });

  describe("properties, for every pool from $0 to $100,000 in cents", () => {
    const pools = fc.integer({ min: 0, max: 10_000_000 });

    it("adds up to the pool exactly, to the cent", () => {
      fc.assert(
        fc.property(pools, anyShares, (pool, shares) => {
          const paid = amounts(allocatePayouts(pool, shares));
          expect(total(paid)).toBe(pool);
          expect(paid).toHaveLength(pool > 0 ? shares.length : 0);
        }),
        { numRuns: 2000 },
      );
    });

    it("never pays a negative amount and never pays a lower place more", () => {
      fc.assert(
        fc.property(pools, anyShares, (pool, shares) => {
          const paid = amounts(allocatePayouts(pool, shares));
          paid.forEach((amount, i) => {
            expect(amount).toBeGreaterThanOrEqual(0);
            if (i > 0) expect(amount).toBeLessThanOrEqual(paid[i - 1]);
          });
        }),
        { numRuns: 2000 },
      );
    });

    it("pays every place below 1st its share rounded down to whole dollars", () => {
      fc.assert(
        fc.property(pools, anyShares, (pool, shares) => {
          const paid = amounts(allocatePayouts(pool, shares));
          for (let i = 1; i < paid.length; i++) {
            expect(paid[i] % 100).toBe(0);
            // paid ≤ exact share < paid + $1, in exact integer arithmetic
            expect(paid[i] * 10_000).toBeLessThanOrEqual(pool * shares[i]);
            expect(pool * shares[i]).toBeLessThan((paid[i] + 100) * 10_000);
          }
          if (paid.length > 0) {
            // 1st gets at least its own share, plus under $1 of rounding per other place
            expect(paid[0] * 10_000).toBeGreaterThanOrEqual(pool * shares[0]);
            expect(paid[0] - pool * shares[0] / 10_000).toBeLessThan(100 * shares.length);
          }
        }),
        { numRuns: 2000 },
      );
    });
  });
});

describe("legacyPayouts (today's Math.round per place)", () => {
  it("matches today's getPrizePayouts for every structure and pool", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -100_000, max: 10_000_000 }).map((cents) => cents / 100),
        fc.constantFrom(...STANDARD_KEYS, "custom", "unknown", ""),
        (pool, structure) => {
          expect(legacyPayouts(pool, structure)).toEqual(referenceGetPrizePayouts(pool, structure));
        },
      ),
      { numRuns: 2000 },
    );
  });

  it("pays Standard for a custom structure, as today", () => {
    expect(legacyPayouts(1000, "custom").map((p) => p.amount)).toEqual([500, 300, 200]);
    expect(legacyPayouts(1000, null).map((p) => p.amount)).toEqual([500, 300, 200]);
  });

  it("pays nothing from an empty or negative pool", () => {
    expect(legacyPayouts(0, "standard")).toEqual([]);
    expect(legacyPayouts(-5, "standard")).toEqual([]);
  });
});

describe("undistributedCents", () => {
  it("is what the places beyond the entrants would have been paid", () => {
    const payouts = allocatePayouts(10_000, PAYOUT_STRUCTURES.standard);
    expect(undistributedCents(payouts, 2)).toBe(2_000);
    expect(undistributedCents(payouts, 1)).toBe(5_000);
    expect(undistributedCents(payouts, 3)).toBe(0);
    expect(undistributedCents(payouts, 9)).toBe(0);
    expect(undistributedCents([], 0)).toBe(0);
  });
});

/* ---------- round 5: places as a percentage or a fixed amount ---------- */

const pct = (percent: number): PayoutPlace => ({ kind: "percent", basisPoints: Math.round(percent * 100) });
const usd = (dollars: number): PayoutPlace => ({ kind: "amount", amountCents: Math.round(dollars * 100) });
const v2 = (places: unknown[]) => JSON.stringify({ v: CUSTOM_PAYOUTS_VERSION, places });

/** `raw` with each kind's places sorted biggest first, each keeping its slot: places payoutPlacesProblems keeps in order. */
function ordered(raw: readonly PayoutPlace[]): PayoutPlace[] {
  const percents = raw.filter((p): p is Extract<PayoutPlace, { kind: "percent" }> => p.kind === "percent").sort((a, b) => b.basisPoints - a.basisPoints);
  const fixed = raw.filter((p): p is Extract<PayoutPlace, { kind: "amount" }> => p.kind === "amount").sort((a, b) => b.amountCents - a.amountCents);
  let pi = 0;
  let ai = 0;
  return raw.map((p) => (p.kind === "percent" ? percents[pi++] : fixed[ai++]));
}

describe("payoutPlacesProblems", () => {
  it("accepts percentages and amounts together, the percentages adding up to 100% or less", () => {
    expect(payoutPlacesProblems([pct(50), usd(300), pct(10)])).toEqual([]);
    expect(payoutPlacesProblems([usd(500), usd(300), usd(200)])).toEqual([]);
    expect(payoutPlacesProblems([pct(60), pct(30)])).toEqual([]);
    expect(payoutPlacesProblems([pct(100)])).toEqual([]);
  });

  it("pays 1 to 50 places", () => {
    expect(payoutPlacesProblems([])).toEqual([{ place: null, message: "Pay 1 to 50 places" }]);
    expect(payoutPlacesProblems(Array.from({ length: 51 }, () => usd(1)))).toEqual([{ place: null, message: "Pay 1 to 50 places" }]);
    expect(payoutPlacesProblems(Array.from({ length: 50 }, () => usd(1)))).toEqual([]);
  });

  it.each([
    [{ kind: "percent", basisPoints: 0 }],
    [{ kind: "percent", basisPoints: -100 }],
    [{ kind: "percent", basisPoints: 10_001 }],
    [{ kind: "percent", basisPoints: 1234.5 }],
    [{ kind: "percent", basisPoints: Number.NaN }],
  ] as PayoutPlace[][])("refuses the share %j", (place) => {
    expect(payoutPlacesProblems([usd(100), place])).toEqual([
      { place: 2, message: "Place 2 must be a percentage above 0 and at most 100, with at most 2 decimal places" },
    ]);
  });

  it.each([[0], [-1], [100_000_001], [12.5], [Number.POSITIVE_INFINITY]])("refuses an amount of %d cents", (cents) => {
    expect(payoutPlacesProblems([{ kind: "amount", amountCents: cents }])).toEqual([
      { place: 1, message: "Place 1 must be an amount above $0 and at most $1,000,000" },
    ]);
    expect(PAYOUT_PLACE_LIMITS.maxAmountCents).toBe(100_000_000);
  });

  it("refuses percentages over 100% together", () => {
    expect(payoutPlacesProblems([pct(60), usd(100), pct(50)])).toEqual([{ place: null, message: "The percentages add up to 110%, over 100%" }]);
  });

  it("never pays a lower place a bigger share, or a bigger amount, than a place of its kind above it", () => {
    expect(payoutPlacesProblems([pct(20), pct(30)])).toEqual([{ place: 2, message: "Place 2 pays a bigger share than a place above it" }]);
    expect(payoutPlacesProblems([usd(100), usd(200)])).toEqual([{ place: 2, message: "Place 2 pays more than a place above it" }]);
    // Each kind is compared only with its own: a fixed 2nd may pay less or more than a 3rd's share.
    expect(payoutPlacesProblems([pct(50), usd(100), pct(40)])).toEqual([]);
  });
});

describe("parseCustomPayouts: the per-place form", () => {
  it("reads percentages and fixed amounts", () => {
    expect(parseCustomPayouts(v2([{ percent: 50 }, { amountCents: 30_000 }, { percent: 10 }]))).toEqual({
      ok: true,
      places: [pct(50), usd(300), pct(10)],
    });
    expect(parseCustomPayouts(v2([{ percent: 33.33 }]))).toEqual({ ok: true, places: [{ kind: "percent", basisPoints: 3333 }] });
  });

  it.each([
    [JSON.stringify({ v: 1, places: [{ percent: 100 }] }), "Custom payouts must be a list of 1 to 50 percentages"],
    [JSON.stringify({ v: 2 }), "Custom payouts must be a list of 1 to 50 percentages"],
    [JSON.stringify("[50,50]"), "Custom payouts must be a list of 1 to 50 percentages"],
    [JSON.stringify(null), "Custom payouts must be a list of 1 to 50 percentages"],
    [v2([{ percent: 50, amountCents: 100 }]), "Place 1 must be a percentage or an amount"],
    [v2([{ dollars: 50 }]), "Place 1 must be a percentage or an amount"],
    [v2([{ percent: "50" }]), "Place 1 must be a percentage or an amount"],
    [v2([{ amountCents: "500" }]), "Place 1 must be a percentage or an amount"],
    [v2([null]), "Place 1 must be a percentage or an amount"],
    [v2([[50]]), "Place 1 must be a percentage or an amount"],
    [v2([{ percent: 50.005 }]), "Place 1 must be a percentage above 0 and at most 100, with at most 2 decimal places"],
    [v2([{ amountCents: 0.5 }]), "Place 1 must be an amount above $0 and at most $1,000,000"],
    [v2([]), "Pay 1 to 50 places"],
    [v2([{ percent: 70 }, { percent: 40 }]), "The percentages add up to 110%, over 100%"],
  ])("refuses %s", (raw, error) => {
    expect(parseCustomPayouts(raw)).toEqual({ ok: false, error });
  });

  it("still holds the classic list to exactly 100%", () => {
    expect(parseCustomPayouts("[50,30]")).toEqual({ ok: false, error: "Custom payouts add up to 80%, not 100%" });
  });
});

describe("serializeCustomPayouts", () => {
  it("stores a classic share table as the array every build since Phase 2 reads", () => {
    expect(serializeCustomPayouts([pct(50), pct(30), pct(20)])).toBe("[50,30,20]");
    expect(serializeCustomPayouts([pct(33.34), pct(33.33), pct(33.33)])).toBe("[33.34,33.33,33.33]");
  });

  it("stores the per-place form when a place is fixed or the percentages leave something for 1st", () => {
    expect(serializeCustomPayouts([pct(50), usd(300)])).toBe('{"v":2,"places":[{"percent":50},{"amountCents":30000}]}');
    expect(serializeCustomPayouts([pct(60), pct(30)])).toBe('{"v":2,"places":[{"percent":60},{"percent":30}]}');
  });

  it("reads back exactly what it wrote, for any valid places", () => {
    const place = fc.oneof(
      fc.integer({ min: 1, max: 2_000 }).map((bp): PayoutPlace => ({ kind: "percent", basisPoints: bp })),
      fc.integer({ min: 1, max: 1_000_000 }).map((cents): PayoutPlace => ({ kind: "amount", amountCents: cents })),
    );
    fc.assert(
      fc.property(fc.array(place, { minLength: 1, maxLength: 12 }), (raw) => {
        const percents = raw.filter((p) => p.kind === "percent").sort((a, b) => (b as { basisPoints: number }).basisPoints - (a as { basisPoints: number }).basisPoints);
        const amounts = raw.filter((p) => p.kind === "amount").sort((a, b) => (b as { amountCents: number }).amountCents - (a as { amountCents: number }).amountCents);
        let pi = 0;
        let ai = 0;
        const places = raw.map((p) => (p.kind === "percent" ? percents[pi++] : amounts[ai++]));
        fc.pre(payoutPlacesProblems(places).length === 0);
        expect(parseCustomPayouts(serializeCustomPayouts(places))).toEqual({ ok: true, places });
      }),
      { numRuns: 500 },
    );
  });
});

describe("placeAmounts", () => {
  it("pays each share of the whole pool in whole dollars and each fixed place its amount, adding nothing to 1st", () => {
    expect(placeAmounts(100_000, [pct(50), usd(300), pct(10)])).toEqual([50_000, 30_000, 10_000]);
    // 50% of $475.50 is $237.75, paid as $237; 30% is $142.65, paid as $142.
    expect(placeAmounts(47_550, [pct(50), pct(30), usd(95)])).toEqual([23_700, 14_200, 9_500]);
  });

  it("pays fixed places their amount whatever the pool: the difference is settled elsewhere", () => {
    expect(placeAmounts(50_000, [usd(300), usd(200), usd(100)])).toEqual([30_000, 20_000, 10_000]);
  });

  it.each([0, -500])("pays a share nothing from a pool of %d cents, a fixed place still its amount", (pool) => {
    expect(placeAmounts(pool, [usd(300), pct(10)])).toEqual([30_000, 0]);
  });

  it("throws for places payoutPlacesProblems refuses, or a pool that is not whole cents", () => {
    expect(() => placeAmounts(10_000, [])).toThrow(RangeError);
    expect(() => placeAmounts(10_000, [pct(20), pct(30)])).toThrow(RangeError);
    expect(() => placeAmounts(12.5, [pct(100)])).toThrow(RangeError);
    expect(() => placeAmounts(Number.MAX_SAFE_INTEGER, [pct(100)])).toThrow(RangeError);
  });

  it("never pays a share more than its share of the pool, and every fixed place exactly its amount", () => {
    const place = fc.oneof(
      fc.integer({ min: 1, max: 3_000 }).map((bp): PayoutPlace => ({ kind: "percent", basisPoints: bp })),
      fc.integer({ min: 100, max: 100_000 }).map((cents): PayoutPlace => ({ kind: "amount", amountCents: cents })),
    );
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5_000_000 }), fc.array(place, { minLength: 1, maxLength: 8 }), (pool, raw) => {
        const places = ordered(raw);
        fc.pre(payoutPlacesProblems(places).length === 0);
        const paid = placeAmounts(pool, places);
        places.forEach((p, i) => {
          if (p.kind === "amount") expect(paid[i]).toBe(p.amountCents);
          else {
            expect(paid[i] % 100).toBe(0);
            expect(paid[i] * 10_000).toBeLessThanOrEqual(pool * p.basisPoints);
            expect((paid[i] + 100) * 10_000).toBeGreaterThan(pool * p.basisPoints);
          }
        });
      }),
      { numRuns: 2000 },
    );
  });
});

describe("resolvePayoutStructure with places", () => {
  it("pays an all-percentage per-place form adding up to 100% exactly like the classic list", () => {
    expect(resolvePayoutStructure("custom", v2([{ percent: 70 }, { percent: 30 }]), 100_000)).toEqual({
      requested: "custom",
      used: "custom",
      basisPoints: [7000, 3000],
    });
  });

  it("keeps the places and each one's share of what they pay as set from the pool resolved against", () => {
    expect(resolvePayoutStructure("custom", serializeCustomPayouts([pct(50), usd(300), pct(10)]), 100_000)).toEqual({
      requested: "custom",
      used: "custom",
      basisPoints: [5556, 3333, 1111],
      places: [pct(50), usd(300), pct(10)],
    });
    expect(resolvePayoutStructure("custom", serializeCustomPayouts([pct(60), pct(30)]), 100_000).basisPoints).toEqual([6667, 3333]);
  });

  it("gives 1st the whole share when the places pay nothing yet", () => {
    expect(resolvePayoutStructure("custom", serializeCustomPayouts([pct(60), pct(30)]), 0).basisPoints).toEqual([10_000, 0]);
  });

  it("pays fixed places that need more than the pool as set (round 5, item 16: the club adds the rest), never Standard", () => {
    expect(resolvePayoutStructure("custom", serializeCustomPayouts([usd(600), usd(400)]), 80_000)).toEqual({
      requested: "custom",
      used: "custom",
      basisPoints: [6000, 4000],
      places: [usd(600), usd(400)],
    });
  });
});

describe("the payout editor's helpers", () => {
  it.each([
    [1, "1st"],
    [2, "2nd"],
    [3, "3rd"],
    [4, "4th"],
    [11, "11th"],
    [12, "12th"],
    [13, "13th"],
    [21, "21st"],
    [22, "22nd"],
    [23, "23rd"],
    [101, "101st"],
    [111, "111th"],
  ])("names place %d %s", (position, name) => {
    expect(placeName(position)).toBe(name);
  });

  it("words a structure for the activity feed", () => {
    expect(placeValueText(pct(33.33))).toBe("33.33%");
    expect(placeValueText(usd(1250))).toBe("$1,250");
    expect(describePayoutPlaces([pct(50), pct(30), usd(200)])).toBe("1st 50%, 2nd 30%, 3rd $200");
  });

  it("starts from a share table", () => {
    expect(placesFromShares(PAYOUT_STRUCTURES.standard)).toEqual([pct(50), pct(30), pct(20)]);
  });

  it("adds a place at half the last one, of its kind, never below 1% or $1, and no more than 50", () => {
    expect(addPayoutPlace([])).toEqual([pct(100)]);
    expect(addPayoutPlace([pct(50), pct(30)])).toEqual([pct(50), pct(30), pct(15)]);
    expect(addPayoutPlace([pct(50), pct(25)])).toEqual([pct(50), pct(25), pct(12)]);
    expect(addPayoutPlace([pct(1)])).toEqual([pct(1), pct(1)]);
    expect(addPayoutPlace([usd(500), usd(125)])).toEqual([usd(500), usd(125), usd(62)]);
    expect(addPayoutPlace([usd(1)])).toEqual([usd(1), usd(1)]);
    const full = Array.from({ length: 50 }, () => usd(1));
    expect(addPayoutPlace(full)).toEqual(full);
  });

  it("removes a place, the ones below moving up, but never the last one", () => {
    expect(removePayoutPlace([pct(50), usd(300), pct(10)], 1)).toEqual([pct(50), pct(10)]);
    expect(removePayoutPlace([pct(100)], 0)).toEqual([pct(100)]);
    expect(removePayoutPlace([pct(60), pct(40)], 5)).toEqual([pct(60), pct(40)]);
    expect(removePayoutPlace([pct(60), pct(40)], -1)).toEqual([pct(60), pct(40)]);
  });

  it("switches a place between a share and an amount, keeping what it pays from the pool", () => {
    expect(changePlaceKind([pct(50), pct(30)], 1, "amount", 100_050)).toEqual([pct(50), usd(300)]);
    expect(changePlaceKind([pct(50), usd(300)], 1, "percent", 100_000)).toEqual([pct(50), pct(30)]);
    expect(changePlaceKind([pct(50), usd(333)], 1, "percent", 100_000)).toEqual([pct(50), pct(33.3)]);
    expect(changePlaceKind([pct(50), usd(5000)], 1, "percent", 100_000)).toEqual([pct(50), pct(100)]);
    expect(changePlaceKind([pct(0.01)], 0, "amount", 100_000)).toEqual([usd(1)]);
  });

  it("with no pool yet, takes $1 per 1% and 1% per $1", () => {
    expect(changePlaceKind([pct(30)], 0, "amount", 0)).toEqual([usd(30)]);
    expect(changePlaceKind([usd(25)], 0, "percent", 0)).toEqual([pct(25)]);
    expect(changePlaceKind([usd(250)], 0, "percent", Number.NaN)).toEqual([pct(100)]);
  });

  it("leaves the places alone for the same kind or a place that is not there", () => {
    expect(changePlaceKind([pct(100)], 0, "percent", 100_000)).toEqual([pct(100)]);
    expect(changePlaceKind([pct(100)], 3, "amount", 100_000)).toEqual([pct(100)]);
  });

  describe("previewShares (a share table in the editor)", () => {
    it("splits the pool as v2 does and settles what a manual pool leaves of the money available", () => {
      expect(previewShares(47_500, PAYOUT_STRUCTURES.standard)).toEqual({
        amounts: [23_800, 14_200, 9_500],
        difference: { choice: "club", availableCents: 47_500, setCents: 47_500, cents: 0, keptByClubCents: 0, addedToPrizesCents: 0, carriedOverCents: 0, addedByClubCents: 0 },
      });
      expect(previewShares(40_000, PAYOUT_STRUCTURES.standard, { availableCents: 50_000, choice: "first" }).amounts).toEqual([30_000, 12_000, 8_000]);
      expect(previewShares(40_000, PAYOUT_STRUCTURES.standard, { availableCents: 30_000 }).difference.addedByClubCents).toBe(10_000);
      expect(previewShares(0, PAYOUT_STRUCTURES.standard).amounts).toEqual([0, 0, 0]);
      expect(previewShares(Number.NaN, PAYOUT_STRUCTURES.top3).amounts).toEqual([0, 0, 0]);
    });
  });

  describe("previewPayoutPlaces (the live sum check)", () => {
    it("shows what each place pays as set, what is left over and, by default, that the club keeps it", () => {
      const preview = previewPayoutPlaces(100_000, [pct(50), usd(300), pct(10)]);
      expect(preview).toEqual({
        rows: [
          { position: 1, place: pct(50), amountCents: 50_000, setCents: 50_000 },
          { position: 2, place: usd(300), amountCents: 30_000, setCents: 30_000 },
          { position: 3, place: pct(10), amountCents: 10_000, setCents: 10_000 },
        ],
        placedCents: 90_000,
        leftoverCents: 10_000,
        overCents: 0,
        difference: {
          choice: "club",
          availableCents: 100_000,
          setCents: 90_000,
          cents: 10_000,
          keptByClubCents: 10_000,
          addedToPrizesCents: 0,
          carriedOverCents: 0,
          addedByClubCents: 0,
        },
        problems: [],
        warnings: [],
      });
    });

    it("pays percentages adding up to 100% as the share table they are stored as: the rounding to 1st, nothing left over", () => {
      const preview = previewPayoutPlaces(100_000, [pct(33.34), pct(33.33), pct(33.33)]);
      expect(preview.rows.map((row) => row.amountCents)).toEqual([33_400, 33_300, 33_300]);
      expect(preview).toMatchObject({ placedCents: 100_000, leftoverCents: 0 });
      expect(preview.difference?.cents).toBe(0);
    });

    it("pays the leftover as the TD chose: to 1st, shared across the places, or carried over", () => {
      const places = [pct(50), usd(300), pct(10)];
      const first = previewPayoutPlaces(100_000, places, { choice: "first" });
      expect(first.rows.map((row) => row.amountCents)).toEqual([60_000, 30_000, 10_000]);
      expect(first.rows.map((row) => row.setCents)).toEqual([50_000, 30_000, 10_000]);
      expect(previewPayoutPlaces(100_000, places, { choice: "pro_rata" }).rows.map((row) => row.amountCents)).toEqual([55_600, 33_300, 11_100]);
      const carried = previewPayoutPlaces(100_000, places, { choice: "carry" });
      expect(carried.rows.map((row) => row.amountCents)).toEqual([50_000, 30_000, 10_000]);
      expect(carried.difference).toMatchObject({ carriedOverCents: 10_000, keptByClubCents: 0 });
    });

    it("measures the places against the money available, which may differ from the pool their percentages are of", () => {
      // A manual pool of $1,000 with $1,200 available: 50% + 30% of $1,000 leave $400.
      const preview = previewPayoutPlaces(100_000, [pct(50), pct(30)], { availableCents: 120_000, choice: "club" });
      expect(preview).toMatchObject({ placedCents: 80_000, leftoverCents: 40_000, overCents: 0 });
      expect(preview.difference).toMatchObject({ availableCents: 120_000, keptByClubCents: 40_000 });
    });

    it("warns when, from this pool, a % place and a $ place swap order: 2nd would pay more than 1st (R5REV1-PAY-01)", () => {
      const preview = previewPayoutPlaces(100_000, [pct(30), usd(600)]);
      expect(preview.rows.map((row) => row.amountCents)).toEqual([30_000, 60_000]);
      expect(preview.problems).toEqual([]);
      expect(preview.warnings).toEqual([{ place: 2, message: "From the $1,000 prize pool 2nd pays $600, more than 1st ($300)" }]);
      // A bigger pool puts them back in order; the leftover added to 1st can too.
      expect(previewPayoutPlaces(300_000, [pct(30), usd(600)]).warnings).toEqual([]);
      expect(previewPayoutPlaces(100_000, [pct(40), usd(500)]).warnings).toHaveLength(1);
      expect(previewPayoutPlaces(100_000, [pct(40), usd(500)], { choice: "first" }).warnings).toEqual([]);
      expect(previewPayoutPlaces(0, [pct(30), usd(600)]).warnings).toEqual([]);
    });

    it("pays places that add up to more than is available as set, the club adding the rest", () => {
      const preview = previewPayoutPlaces(50_000, [usd(300), usd(250)]);
      expect(preview).toMatchObject({ placedCents: 55_000, leftoverCents: 0, overCents: 5_000, problems: [] });
      expect(preview.difference).toMatchObject({ cents: -5_000, addedByClubCents: 5_000 });
      expect(preview.rows.map((row) => row.amountCents)).toEqual([30_000, 25_000]);
    });

    it("counts the places that are still valid while another has a problem, and shows no amounts", () => {
      const preview = previewPayoutPlaces(100_000, [pct(50), { kind: "amount", amountCents: 0 }]);
      expect(preview.placedCents).toBe(50_000);
      expect(preview.leftoverCents).toBe(50_000);
      expect(preview.difference).toBeNull();
      expect(preview.rows.map((row) => row.amountCents)).toEqual([null, null]);
      expect(preview.problems).toEqual([{ place: 2, message: "Place 2 must be an amount above $0 and at most $1,000,000" }]);
      expect(previewPayoutPlaces(Number.NaN, [{ kind: "percent", basisPoints: 12.5 }]).placedCents).toBe(0);
    });

    it("always pays the money available to the cent, or the places as set plus what the club adds", () => {
      const place = fc.oneof(
        fc.integer({ min: 1, max: 3_000 }).map((bp): PayoutPlace => ({ kind: "percent", basisPoints: bp })),
        fc.integer({ min: 100, max: 100_000 }).map((cents): PayoutPlace => ({ kind: "amount", amountCents: cents })),
      );
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 5_000_000 }),
          fc.integer({ min: 0, max: 5_000_000 }),
          fc.array(place, { minLength: 1, maxLength: 8 }),
          fc.constantFrom(...PRIZE_DIFFERENCE_CHOICES),
          (pool, available, raw, choice) => {
            const places = ordered(raw);
            fc.pre(payoutPlacesProblems(places).length === 0);
            const preview = previewPayoutPlaces(pool, places, { availableCents: available, choice });
            const paid = preview.rows.map((row) => row.amountCents as number);
            const difference = preview.difference;
            if (!difference) throw new Error("no difference worked out");
            const kept = difference.keptByClubCents + difference.carriedOverCents;
            expect(total(paid)).toBe(available - kept + difference.addedByClubCents);
            expect(total(paid)).toBe(preview.placedCents + difference.addedToPrizesCents);
            expect(preview.leftoverCents - preview.overCents).toBe(difference.cents);
          },
        ),
        { numRuns: 1000 },
      );
    });
  });
});
