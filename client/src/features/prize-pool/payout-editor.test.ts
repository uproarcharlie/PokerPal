import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { toPayoutPlaces } from "@shared/api/prize-pool";
import { previewPayoutPlaces } from "@shared/domain/payouts";
import { settleDifference } from "@shared/domain/prize-difference";
import {
  addedRow,
  editorMoney,
  payoutsFormSchema,
  placeOfRow,
  placesOfRows,
  payoutsSaveCheck,
  placesProblem,
  rowOf,
  rowsOfStructure,
  sameAsStored,
  startingValues,
  structureName,
  structureSplit,
  sumLine,
  switchedRow,
  unpaidPlacesNote,
  type PayoutEditorValues,
  type PayoutRowValues,
} from "./payout-editor";

const percent = (value: string): PayoutRowValues => ({ kind: "percent", value });
const amount = (value: string): PayoutRowValues => ({ kind: "amount", value });
const custom = (...places: PayoutRowValues[]): PayoutEditorValues => ({ payoutStructure: "custom", places, reason: "" });

describe("the payout editor's boxes", () => {
  it("show a place as the number typed: whole dollars without cents", () => {
    expect(rowOf({ kind: "percent", basisPoints: 3333 })).toEqual(percent("33.33"));
    expect(rowOf({ kind: "amount", amountCents: 30_000 })).toEqual(amount("300"));
    expect(rowOf({ kind: "amount", amountCents: 1_250 })).toEqual(amount("12.50"));
  });

  it("read a box as the place the domain pays, and one not typed yet as nothing", () => {
    expect(placeOfRow(percent("12.5"))).toEqual({ kind: "percent", basisPoints: 1250 });
    expect(placeOfRow(amount(" 300 "))).toEqual({ kind: "amount", amountCents: 30_000 });
    expect(placeOfRow(percent(""))).toEqual({ kind: "percent", basisPoints: Number.NaN });
    expect(placeOfRow(amount("ten"))).toEqual({ kind: "amount", amountCents: Number.NaN });
    // The live sum still shows while a box is half typed.
    expect(previewPayoutPlaces(50_000, placesOfRows([percent("50"), amount("")]))).toMatchObject({ placedCents: 25_000, leftoverCents: 25_000 });
  });

  it("open on the stored structure, with the stored custom places or else Standard's", () => {
    expect(startingValues({ payoutStructure: "top5", customPayouts: null })).toEqual({
      payoutStructure: "top5",
      places: [percent("50"), percent("30"), percent("20")],
      reason: "",
    });
    const stored = startingValues({ payoutStructure: "custom", customPayouts: '{"v":2,"places":[{"percent":60},{"amountCents":15000}]}' });
    expect(stored.places).toEqual([percent("60"), amount("150")]);
    // Nothing asks where a leftover goes any more (round 7): it is the club's fee.
    expect(stored).not.toHaveProperty("prizeDifference");
    // An unknown structure, or custom places that cannot be read, open on what is paid: Standard.
    expect(startingValues({ payoutStructure: "top4", customPayouts: "[70,20]" })).toMatchObject({
      payoutStructure: "standard",
      places: [percent("50"), percent("30"), percent("20")],
    });
  });

  it("name the structures and their splits from the shared tables", () => {
    expect(structureName("top5")).toBe("Top 5");
    expect(structureName("custom")).toBe("Custom");
    expect(structureSplit("top5")).toBe("40 / 25 / 20 / 10 / 5");
    expect(rowsOfStructure("top3")).toEqual([percent("50"), percent("30"), percent("20")]);
  });

  it("add a place at half the last, of its kind, or an empty box below one not typed yet", () => {
    expect(addedRow([percent("50"), percent("30")])).toEqual(percent("15"));
    expect(addedRow([amount("300"), amount("150")])).toEqual(amount("75"));
    expect(addedRow([percent("50"), amount("")])).toEqual(amount(""));
  });

  it("switch a place between % and $ keeping what it pays from the pool", () => {
    const rows = [percent("50"), percent("30"), percent("20")];
    expect(switchedRow(rows, 1, "amount", 73_500)).toEqual(amount("220"));
    expect(switchedRow([percent("50"), amount("220")], 1, "percent", 73_500)).toEqual(percent("29.93"));
    expect(switchedRow([percent("")], 0, "amount", 73_500)).toEqual(amount(""));
    expect(switchedRow(rows, 0, "percent", 73_500)).toBe(rows[0]);
  });
});

describe("payoutsFormSchema", () => {
  it("sends a standard structure without places, and a blank reason as none", () => {
    expect(payoutsFormSchema.parse({ payoutStructure: "top5", places: [percent("")], reason: "  " })).toEqual({ payoutStructure: "top5" });
  });

  it("sends custom places as the request schema wants them", () => {
    expect(payoutsFormSchema.parse({ ...custom(percent("50"), amount("300"), percent("12.5")), reason: " Short field " })).toEqual({
      payoutStructure: "custom",
      places: [
        { kind: "percent", percent: 50 },
        { kind: "amount", amount: "300.00" },
        { kind: "percent", percent: 12.5 },
      ],
      reason: "Short field",
    });
  });

  it("says which box is not a number, then the shared rules, each at its place", () => {
    const issues = (values: PayoutEditorValues) => {
      const result = payoutsFormSchema.safeParse(values);
      return result.success ? [] : result.error.issues.map((issue) => [issue.path.join("."), issue.message]);
    };
    expect(issues(custom(percent("50"), percent(""), amount("abc")))).toEqual([
      ["places.1.value", "Enter a percentage, e.g. 25 or 12.5"],
      ["places.2.value", "Enter an amount, e.g. 300 or 12.50"],
    ]);
    expect(issues(custom(percent("30"), percent("40")))).toEqual([["places.1.value", "Place 2 pays a bigger share than a place above it"]]);
    // A place its own rule refuses is not judged again by the shared rules: one message for it.
    expect(issues(custom(percent("150")))).toEqual([["places.0.value", "At most 100%"]]);
    expect(issues(custom(percent("60"), percent("50")))).toEqual([["places", "The percentages add up to 110%, over 100%"]]);
    expect(placesProblem(custom(percent("60"), percent("50")))).toBe("The percentages add up to 110%, over 100%");
    expect(placesProblem(custom(percent("60"), percent("40")))).toBeUndefined();
  });

  it("sends exactly the places the editor shows for any boxes it accepts", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.integer({ min: 1, max: 10_000 }).map((bp): PayoutRowValues => percent(String(bp / 100))),
            fc.integer({ min: 1, max: 100_000_000 }).map((cents): PayoutRowValues => rowOf({ kind: "amount", amountCents: cents })),
          ),
          { minLength: 1, maxLength: 8 },
        ),
        (rows) => {
          const parsed = payoutsFormSchema.safeParse(custom(...rows));
          if (!parsed.success) return;
          expect(toPayoutPlaces(parsed.data.places ?? [])).toEqual(placesOfRows(rows));
        },
      ),
    );
  });
});

describe("the money the editor works from", () => {
  it("takes percentages of a manual pool, else of what is available, and measures the prizes against what is available", () => {
    expect(editorMoney({ manualPrizePool: null, netAfterAp: 73_500 })).toEqual({ poolCents: 73_500, availableCents: 73_500 });
    expect(editorMoney({ manualPrizePool: 60_000, netAfterAp: 73_500 })).toEqual({ poolCents: 60_000, availableCents: 73_500 });
  });
});

describe("the editor's sentences", () => {
  it("say what is left over for the club's fee under its name for it, what the club adds, or that the prizes add up (round 7)", () => {
    expect(sumLine(settleDifference(63_500, 73_500), "AP")).toEqual({ tone: "leftover", text: "Leftover $100 → AP" });
    // The rounding of each place to whole dollars is part of the leftover too.
    expect(sumLine(settleDifference(73_400, 73_550), "Rake").text).toBe("Leftover $1.50 → Rake");
    expect(sumLine(settleDifference(78_500, 73_500), "AP")).toEqual({ tone: "over", text: "Added by the club: $50" });
    expect(sumLine(settleDifference(73_500, 73_500), "AP")).toEqual({ tone: "exact", text: "Adds up to the $735 available for prizes exactly" });
    expect(sumLine(settleDifference(0, 0), "AP").tone).toBe("empty");
  });

  it("say when there are more places than players", () => {
    expect(unpaidPlacesNote(5, 3, "AP")).toBe("Only 3 players have paid: places below 3rd are paid only once more players pay. Until then, what they would pay goes to AP.");
    expect(unpaidPlacesNote(3, 1, "Rake")).toBe("Only 1 player has paid: places below 1st are paid only once more players pay. Until then, what they would pay goes to Rake.");
    expect(unpaidPlacesNote(3, 3, "AP")).toBeNull();
    expect(unpaidPlacesNote(3, 0, "AP")).toBeNull();
  });

  it("know when nothing would change: the same structure and places", () => {
    const stored = { payoutStructure: "custom", customPayouts: "[50, 30, 20]" };
    expect(sameAsStored(custom(percent("50"), percent("30"), percent("20")), stored)).toBe(true);
    expect(sameAsStored(custom(percent("50"), percent("30"), amount("20")), stored)).toBe(false);
    expect(sameAsStored({ payoutStructure: "top3", places: [], reason: "" }, stored)).toBe(false);
    const standard = { payoutStructure: "standard", customPayouts: null };
    expect(sameAsStored({ payoutStructure: "standard", places: [], reason: "Again" }, standard)).toBe(true);
    expect(sameAsStored(custom(percent("50"), percent("30"), percent("20")), { ...stored, customPayouts: null })).toBe(false);
  });
});

describe("what Save asks first (R5REV-HOST-06)", () => {
  const check = (pool: number, available: number, ...places: Parameters<typeof toPayoutPlaces>[0]) =>
    payoutsSaveCheck(previewPayoutPlaces(pool, toPayoutPlaces(places), { availableCents: available }).difference);

  it("says what the club adds when the prizes typed are more than the money available", () => {
    expect(check(72_000, 72_000, { kind: "amount", amount: "600" }, { kind: "percent", percent: 30 }, { kind: "percent", percent: 20 })).toEqual({
      title: "The club adds $240",
      description:
        'The prizes add up to $960, $240 more than the $720 available for prizes. They are paid as set and the club adds $240 ("Added by the club"), less if more players enter.',
      confirmLabel: "Save: the club adds $240",
    });
  });

  it("asks nothing for a leftover (the club's fee, said in the sum line as the TD types), prizes that add up, or places with a problem", () => {
    // The owner's example: 1st $600, 2nd $300, 3rd $150 with $1,260 available.
    expect(check(126_000, 126_000, { kind: "amount", amount: "600" }, { kind: "amount", amount: "300" }, { kind: "amount", amount: "150" })).toBeNull();
    expect(check(73_500, 73_500, { kind: "percent", percent: 50 }, { kind: "percent", percent: 30 }, { kind: "percent", percent: 20 })).toBeNull();
    expect(payoutsSaveCheck(null)).toBeNull();
  });
});
