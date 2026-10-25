import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fnv1a32, fnv1aHex, mulberry32, randomIndex } from "./hash";

describe("fnv1a", () => {
  it("matches the published FNV-1a 32-bit test vectors", () => {
    expect(fnv1aHex("")).toBe("811c9dc5");
    expect(fnv1aHex("a")).toBe("e40c292c");
    expect(fnv1aHex("foobar")).toBe("bf9cf968");
    expect(fnv1a32("a")).toBe(0xe40c292c);
  });

  it("always gives 8 lower-case hex digits", () => {
    fc.assert(fc.property(fc.string(), (text) => /^[0-9a-f]{8}$/.test(fnv1aHex(text))));
  });
});

describe("mulberry32", () => {
  it("repeats the same sequence for the same seed, in [0, 1)", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const first = Array.from({ length: 50 }, () => a());
    expect(Array.from({ length: 50 }, () => b())).toEqual(first);
    for (const value of first) expect(value >= 0 && value < 1).toBe(true);
    expect(mulberry32(43)()).not.toBe(first[0]);
  });
});

describe("randomIndex", () => {
  it("stays in range whatever the generator returns", () => {
    expect(randomIndex(() => 0, 5)).toBe(0);
    expect(randomIndex(() => 0.999999, 5)).toBe(4);
    expect(randomIndex(() => 1, 5)).toBe(4);
    expect(randomIndex(() => -0.5, 5)).toBe(0);
    expect(randomIndex(() => Number.NaN, 5)).toBe(0);
    fc.assert(fc.property(fc.integer({ min: 1, max: 1000 }), fc.integer(), (size, seed) => {
      const index = randomIndex(mulberry32(seed), size);
      return Number.isInteger(index) && index >= 0 && index < size;
    }));
  });

  it("refuses an empty range", () => {
    expect(() => randomIndex(() => 0.5, 0)).toThrow(RangeError);
  });
});
