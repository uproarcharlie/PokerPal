import { describe, expect, expectTypeOf, it } from "vitest";
import type { Tournament } from "../schema";
import { mergeRakeRates, RAKE_COMPONENTS, type RakeRates } from "./rake-rates";

/** A tournament's rates as Postgres returns them. */
const stored: RakeRates = {
  rakeType: "percentage",
  rakeAmount: "10.00",
  rebuyRakeType: "fixed",
  rebuyRakeAmount: "5.00",
  addonRakeType: "none",
  addonRakeAmount: "0.00",
  highHandRakeType: "none",
  highHandRakeAmount: "0.00",
};

describe("mergeRakeRates", () => {
  it("changes only the components sent and returns every column", () => {
    expect(mergeRakeRates(stored, { rakeAmount: "12.50" })).toEqual({
      ok: true,
      rates: { ...stored, rakeAmount: "12.50" },
    });
  });

  it("switches a component's type when the amount comes with it", () => {
    const merged = mergeRakeRates(stored, { addonRakeType: "fixed", addonRakeAmount: "2.00" });

    expect(merged).toEqual({ ok: true, rates: { ...stored, addonRakeType: "fixed", addonRakeAmount: "2.00" } });
  });

  it('stores "0.00" for a component switched to none, so an amount typed earlier is not kept', () => {
    const merged = mergeRakeRates(stored, { rebuyRakeType: "none" });

    expect(merged).toEqual({ ok: true, rates: { ...stored, rebuyRakeType: "none", rebuyRakeAmount: "0.00" } });
    expect(mergeRakeRates(stored, { addonRakeAmount: "9.00" })).toMatchObject({ rates: { addonRakeAmount: "0.00" } });
  });

  it("needs a new amount when a type changes, so 10% never silently becomes $10 per entry", () => {
    expect(mergeRakeRates(stored, { rakeType: "fixed" })).toEqual({ ok: false, code: "AMOUNT_REQUIRED", field: "rakeAmount" });
  });

  it("needs an amount for a percentage or fixed rate that has none", () => {
    expect(mergeRakeRates({ ...stored, highHandRakeAmount: null }, { highHandRakeType: "fixed" })).toEqual({
      ok: false,
      code: "AMOUNT_REQUIRED",
      field: "highHandRakeAmount",
    });
    expect(mergeRakeRates({ rakeType: "percentage", rakeAmount: "  " }, { rakeType: "percentage" })).toMatchObject({
      ok: false,
      code: "AMOUNT_REQUIRED",
      field: "rakeAmount",
    });
  });

  it("accepts a type resent unchanged without an amount", () => {
    expect(mergeRakeRates(stored, { rakeType: "percentage" })).toEqual({ ok: true, rates: stored });
  });

  it("refuses a percentage over 100, naming the field", () => {
    expect(mergeRakeRates(stored, { rebuyRakeType: "percentage", rebuyRakeAmount: "100.01" })).toEqual({
      ok: false,
      code: "PERCENT_OVER_100",
      field: "rebuyRakeAmount",
    });
    expect(mergeRakeRates(stored, { rakeAmount: "100.00" })).toMatchObject({ ok: true });
  });

  it("allows a fixed amount over 100", () => {
    expect(mergeRakeRates(stored, { rebuyRakeAmount: "150.00" })).toMatchObject({ ok: true, rates: { rebuyRakeAmount: "150.00" } });
  });

  it("keeps a legacy row's missing type as it is", () => {
    const legacy: RakeRates = { rakeType: "none", rakeAmount: "0", rebuyRakeType: null, rebuyRakeAmount: null };

    expect(mergeRakeRates(legacy, { rakeType: "fixed", rakeAmount: "3.00" })).toEqual({
      ok: true,
      rates: {
        rakeType: "fixed",
        rakeAmount: "3.00",
        rebuyRakeType: null,
        rebuyRakeAmount: null,
        addonRakeType: null,
        addonRakeAmount: null,
        highHandRakeType: null,
        highHandRakeAmount: null,
      },
    });
  });

  it("reads numbers as well as decimal text", () => {
    expect(mergeRakeRates({ rakeType: "fixed", rakeAmount: 4 }, {})).toMatchObject({ rates: { rakeAmount: "4" } });
  });

  it("covers the four components, and accepts a tournament row as the stored rates", () => {
    expect(RAKE_COMPONENTS.map((c) => c.type)).toEqual(["rakeType", "rebuyRakeType", "addonRakeType", "highHandRakeType"]);
    expectTypeOf<Tournament>().toExtend<RakeRates>();
  });
});
