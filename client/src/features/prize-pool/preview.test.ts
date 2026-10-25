import { describe, expect, it } from "vitest";
import { apTournament, entrants } from "@test/helpers/ap-dto";
import { mergeRakeRates } from "@shared/domain/rake-rates";
import { halfCents, previewAdjustment, previewRates, roundDownCents, stepCents, typedCents } from "./preview";

// 20 buy-ins ($2,000, 10% AP), 4 re-buys and 2 add-ons ($150, $5 AP each): $2,150 in, $230 AP, $1,920 to pay.
const night = apTournament();
const players = entrants(20, { rebuys: 4, addons: 2 });

describe("typedCents", () => {
  it("reads an amount the server accepts, and nothing else", () => {
    expect(typedCents("12")).toBe(1200);
    expect(typedCents(" 12.5 ")).toBe(1250);
    expect(typedCents("0")).toBe(0);
    expect(typedCents("")).toBeNull();
    expect(typedCents("1.234")).toBeNull();
    expect(typedCents("-5")).toBeNull();
    expect(typedCents("ten")).toBeNull();
  });
});

describe("previewAdjustment", () => {
  it("fixes the AP total, which then does not follow the rates, and pays the rest", () => {
    const money = previewAdjustment(night, players, "ap_override", 2000);
    expect(money?.breakdown.rake).toMatchObject({ calculated: 23_000, override: 2000, applied: 2000 });
    expect(money?.breakdown.net).toBe(213_000);
    expect(money?.display.rows.map((row) => row.amountCents)).toEqual([106_500, 63_900, 42_600]);
  });

  it("clears the manual pool when the AP total is fixed, and the AP total when the pool is, as the server does", () => {
    const pooled = apTournament({ manualPrizePool: "1500.00" });
    expect(previewAdjustment(pooled, players, "ap_override", 2000)?.breakdown.netSource).toBe("ap_override");

    const fixedAp = apTournament({ rakeOverride: "20.00" });
    const money = previewAdjustment(fixedAp, players, "manual_pool", 150_000);
    expect(money?.breakdown).toMatchObject({ netSource: "manual_pool", net: 150_000, impliedRake: 65_000 });
    expect(money?.breakdown.rake.override).toBeNull();
  });

  it("goes back to what the rates give", () => {
    const money = previewAdjustment(apTournament({ rakeOverride: "20.00" }), players, "calculated", null);
    expect(money?.breakdown).toMatchObject({ netSource: "calculated", net: 192_000 });
  });

  it("has nothing to show for a fixed amount not typed yet", () => {
    expect(previewAdjustment(night, players, "ap_override", null)).toBeNull();
    expect(previewAdjustment(night, players, "manual_pool", null)).toBeNull();
  });
});

describe("previewRates", () => {
  const rates = mergeRakeRates(night, { rakeType: "percentage", rakeAmount: "5.00" });
  if (!rates.ok) throw new Error("the rates should merge");

  it("works the pool out from the new rates, clearing the fixed AP total unless it is kept", () => {
    const fixedAp = apTournament({ rakeOverride: "20.00" });
    // 5% of $2,000 + $30 of re-buy and add-on AP.
    expect(previewRates(fixedAp, players, rates.rates, false).breakdown.rake).toMatchObject({ calculated: 13_000, applied: 13_000 });
    expect(previewRates(fixedAp, players, rates.rates, true).breakdown.rake).toMatchObject({ calculated: 13_000, applied: 2000 });
  });

  it("leaves a manual prize pool as it is", () => {
    expect(previewRates(apTournament({ manualPrizePool: "1500.00" }), players, rates.rates, false).breakdown.net).toBe(150_000);
  });
});

describe("the quick amounts", () => {
  it("halves the calculated AP to the cent below", () => {
    expect(halfCents(3500)).toBe(1750);
    expect(halfCents(35)).toBe(17);
    expect(halfCents(-10)).toBe(0);
  });

  it("steps $5 from what is typed, or from the starting amount, never below $0", () => {
    expect(stepCents(null, 3500, -500)).toBe(3000);
    expect(stepCents(2000, 3500, 500)).toBe(2500);
    expect(stepCents(200, 3500, -500)).toBe(0);
  });

  it("rounds a pool down to whole tens of dollars", () => {
    expect(roundDownCents(54_321)).toBe(54_000);
    expect(roundDownCents(54_000)).toBe(54_000);
    expect(roundDownCents(999)).toBe(0);
  });
});
