import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  centsToDecimalString,
  centsToDollars,
  formatMoney,
  isAmountSet,
  parseAmount,
  percentOfCents,
  roundToCents,
  toBasisPoints,
  toCents,
} from "./money";

/** "1234.05" for 123405, built without any of the code under test. */
function decimalString(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

describe("parseAmount (the old parseFloat semantics)", () => {
  it.each([
    ["50.00", 50],
    ["5", 5],
    ["  7.25 ", 7.25],
    ["12abc", 12],
    ["abc", 0],
    ["", 0],
    [null, 0],
    [undefined, 0],
    [12.5, 12.5],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
  ] as const)("%j → %d", (input, expected) => {
    expect(parseAmount(input)).toBe(expected);
  });

  it("is exactly parseFloat(value || '0') for every decimal string", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 9_999_999_999 }), (cents) => {
        const text = decimalString(cents);
        expect(parseAmount(text)).toBe(parseFloat(text || "0"));
      }),
    );
  });
});

describe("isAmountSet", () => {
  it.each([
    ["0.00", true],
    ["0", true],
    ["12.50", true],
    ["", false],
    ["   ", false],
    [null, false],
    [undefined, false],
    [0, true],
    [Number.NaN, false],
  ] as const)("%j → %s", (input, expected) => {
    expect(isAmountSet(input)).toBe(expected);
  });
});

describe("toCents", () => {
  it.each([
    ["50.00", 5000],
    ["5", 500],
    ["5.", 500],
    [".5", 50],
    ["0.1", 10],
    ["  12.34  ", 1234],
    ["+3", 300],
    ["-2.50", -250],
    ["1.005", 101],
    ["1.004", 100],
    ["-1.005", -101],
    ["99999999.99", 9_999_999_999],
    ["12abc", 1200],
    ["1e3", 100_000],
    ["abc", 0],
    [".", 0],
    ["", 0],
    [null, 0],
    [undefined, 0],
    [12.345, 1235],
    [0.1 + 0.2, 30],
  ] as const)("%j → %d", (input, expected) => {
    expect(toCents(input)).toBe(expected);
  });

  it("never returns negative zero", () => {
    expect(Object.is(toCents("-0.004"), 0)).toBe(true);
    expect(Object.is(toCents("-0"), 0)).toBe(true);
  });

  it("falls back to parseFloat for more whole digits than it can scale exactly", () => {
    expect(Math.abs(toCents("12345678901234") - 1_234_567_890_123_400)).toBeLessThan(100);
  });

  it("adds exactly where floats drift", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(toCents("0.10") + toCents("0.20")).toBe(toCents("0.30"));
    let floatSum = 0;
    let centSum = 0;
    for (let i = 0; i < 1000; i++) {
      floatSum += parseAmount("0.10");
      centSum += toCents("0.10");
    }
    expect(floatSum).not.toBe(100);
    expect(centSum).toBe(10_000);
  });

  it("reads back every decimal(10,2) string exactly, with or without trailing zeros", () => {
    fc.assert(
      fc.property(fc.integer({ min: -9_999_999_999, max: 9_999_999_999 }), (cents) => {
        expect(toCents(centsToDecimalString(cents))).toBe(cents);
        expect(toCents(String(cents / 100))).toBe(cents);
      }),
    );
  });

  it("agrees with Math.round(parseFloat(x) * 100) on every 2-decimal string", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 9_999_999_999 }), (cents) => {
        const text = decimalString(cents);
        expect(toCents(text)).toBe(Math.round(parseFloat(text) * 100));
      }),
    );
  });
});

describe("toBasisPoints", () => {
  it.each([
    ["10.00", 1000],
    ["10", 1000],
    ["2.5", 250],
    ["12.75", 1275],
    ["0", 0],
    [null, 0],
  ] as const)("%j → %d", (input, expected) => {
    expect(toBasisPoints(input)).toBe(expected);
  });
});

describe("roundToCents", () => {
  it.each([
    [474.99999999999994, 47_500],
    [0.505, 51],
    [1.005, 101],
    [-0.505, -51],
    [2.675, 268],
    [12, 1200],
    [Number.NaN, 0],
    [Number.NEGATIVE_INFINITY, 0],
  ])("%d → %d", (input, expected) => {
    expect(roundToCents(input)).toBe(expected);
  });

  it("never returns negative zero", () => {
    expect(Object.is(roundToCents(-0.001), 0)).toBe(true);
  });
});

describe("percentOfCents", () => {
  it.each([
    [120_000, 1000, 12_000],
    [1010, 500, 51], // 5% of $10.10 is 50.5 cents: halves round up
    [2100, 250, 53], // 2.5% of $21 is 52.5 cents
    [2100, 249, 52],
    [0, 1000, 0],
    [1010, -500, -51],
  ])("%d cents × %d bp → %d", (cents, basisPoints, expected) => {
    expect(percentOfCents(cents, basisPoints)).toBe(expected);
  });

  it("matches exact rational rounding for any realistic amount and rate", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100_000_000 }), fc.integer({ min: 0, max: 10_000 }), (cents, bp) => {
        const result = percentOfCents(cents, bp);
        // The nearest whole cent, halves up: cents×bp/10000 − result is in [−0.5, 0.5).
        const error = cents * bp - result * 10_000;
        expect(error).toBeGreaterThanOrEqual(-5000);
        expect(error).toBeLessThan(5000);
      }),
    );
  });

  it("refuses inputs it cannot compute exactly", () => {
    expect(() => percentOfCents(1.5, 1000)).toThrow(RangeError);
    expect(() => percentOfCents(Number.MAX_SAFE_INTEGER, 10_000)).toThrow(RangeError);
  });
});

describe("conversions and formatting", () => {
  it("converts cents to dollars", () => {
    expect(centsToDollars(23_750)).toBe(237.5);
    expect(centsToDollars(5)).toBe(0.05);
  });

  it.each([
    [23_800, "238.00"],
    [5, "0.05"],
    [0, "0.00"],
    [-550, "-5.50"],
    [9_999_999_999, "99999999.99"],
  ])("stores %d cents as %s", (cents, expected) => {
    expect(centsToDecimalString(cents)).toBe(expected);
  });

  it("refuses to store a fraction of a cent", () => {
    expect(() => centsToDecimalString(1.5)).toThrow(RangeError);
  });

  it.each([
    [47_500, {}, "$475"],
    [47_550, {}, "$475.50"],
    [123_456_789, {}, "$1,234,567.89"],
    [147_500, {}, "$1,475"],
    [-500, {}, "-$5"],
    [-2_505, {}, "-$25.05"],
    [47_500, { forceCents: true }, "$475.00"],
    [0, {}, "$0"],
    [Number.NaN, {}, "$0"],
  ])("formats %d cents %j as %s", (cents, options, expected) => {
    expect(formatMoney(cents, options)).toBe(expected);
  });

  it("formats without options", () => {
    expect(formatMoney(1050)).toBe("$10.50");
  });
});
