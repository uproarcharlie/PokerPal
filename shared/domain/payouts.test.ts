import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  allocatePayouts,
  PAYOUT_ALGORITHM,
  PAYOUT_STRUCTURE_KEYS,
  PAYOUT_STRUCTURE_LABELS,
  PAYOUT_STRUCTURES,
  parseCustomPayouts,
  resolvePayoutStructure,
  undistributedCents,
  type StandardPayoutKey,
} from "./payouts";
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
    expect(parseCustomPayouts(raw)).toEqual({ ok: true, basisPoints });
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
