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
const custom = (...places: PayoutRowValues[]): PayoutEditorValues => ({ payoutStructure: "custom", places, prizeDifference: "club", reason: "" });

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
    expect(startingValues({ payoutStructure: "top5", customPayouts: null, prizeDifference: null })).toEqual({
      payoutStructure: "top5",
      places: [percent("50"), percent("30"), percent("20")],
      prizeDifference: "club",
      reason: "",
    });
    const stored = startingValues({ payoutStructure: "custom", customPayouts: '{"v":2,"places":[{"percent":60},{"amountCents":15000}]}', prizeDifference: "carry" });
    expect(stored.places).toEqual([percent("60"), amount("150")]);
    expect(stored.prizeDifference).toBe("carry");
    // An unknown structure, or custom places that cannot be read, open on what is paid: Standard; an unknown choice, the club keeping it.
    expect(startingValues({ payoutStructure: "top4", customPayouts: "[70,20]", prizeDifference: "rest" as never })).toMatchObject({
      payoutStructure: "standard",
      places: [percent("50"), percent("30"), percent("20")],
      prizeDifference: "club",
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
    expect(payoutsFormSchema.parse({ payoutStructure: "top5", places: [percent("")], prizeDifference: "club", reason: "  " })).toEqual({
      payoutStructure: "top5",
      prizeDifference: "club",
    });
  });

  it("sends custom places as the request schema wants them", () => {
    expect(payoutsFormSchema.parse({ ...custom(percent("50"), amount("300"), percent("12.5")), prizeDifference: "carry", reason: " Short field " })).toEqual({
      payoutStructure: "custom",
      places: [
        { kind: "percent", percent: 50 },
        { kind: "amount", amount: "300.00" },
        { kind: "percent", percent: 12.5 },
      ],
      prizeDifference: "carry",
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
  const difference = (setCents: number, availableCents: number, choice: "club" | "first" | "pro_rata" | "carry" = "club") =>
    settleDifference([setCents], setCents, availableCents, choice).difference;

  it("say what is left over and where it goes, what the club adds, or that the prizes add up", () => {
    expect(sumLine(difference(63_500, 73_500), "Winter League")).toEqual({ tone: "leftover", text: "$100 left over is kept by the club" });
    expect(sumLine(difference(63_500, 73_500, "first"), "Winter League").text).toBe("$100 left over goes to 1st");
    expect(sumLine(difference(63_500, 73_500, "pro_rata"), "Winter League").text).toBe("$100 left over is shared across the paid places");
    expect(sumLine(difference(63_500, 73_500, "carry"), "Winter League").text).toBe("$100 left over is carried over to Winter League");
    expect(sumLine(difference(78_500, 73_500), "x")).toEqual({ tone: "over", text: "Added by the club: $50" });
    expect(sumLine(difference(73_500, 73_500), "x")).toEqual({ tone: "exact", text: "Adds up to the $735 available for prizes exactly" });
    expect(sumLine(difference(0, 0), "x").tone).toBe("empty");
  });

  it("say when there are more places than players", () => {
    expect(unpaidPlacesNote(5, 3)).toBe("Only 3 players have paid: places below 3rd are paid only once more players pay.");
    expect(unpaidPlacesNote(3, 1)).toBe("Only 1 player has paid: places below 1st are paid only once more players pay.");
    expect(unpaidPlacesNote(3, 3)).toBeNull();
    expect(unpaidPlacesNote(3, 0)).toBeNull();
  });

  it("know when nothing would change: the same structure, places and choice", () => {
    const stored = { payoutStructure: "custom", customPayouts: "[50, 30, 20]", prizeDifference: null };
    expect(sameAsStored(custom(percent("50"), percent("30"), percent("20")), stored)).toBe(true);
    expect(sameAsStored({ ...custom(percent("50"), percent("30"), percent("20")), prizeDifference: "first" }, stored)).toBe(false);
    expect(sameAsStored({ ...custom(percent("50"), percent("30"), percent("20")), prizeDifference: "first" }, { ...stored, prizeDifference: "first" })).toBe(true);
    expect(sameAsStored(custom(percent("50"), percent("30"), amount("20")), stored)).toBe(false);
    expect(sameAsStored({ payoutStructure: "top3", places: [], prizeDifference: "club", reason: "" }, stored)).toBe(false);
    const standard = { payoutStructure: "standard", customPayouts: null, prizeDifference: null };
    expect(sameAsStored({ payoutStructure: "standard", places: [], prizeDifference: "club", reason: "Again" }, standard)).toBe(true);
    expect(sameAsStored(custom(percent("50"), percent("30"), percent("20")), { ...stored, customPayouts: null })).toBe(false);
  });
});

describe("what Save asks first (R5REV-HOST-06, round 5 item 16)", () => {
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

  it("asks nothing for a leftover (the editor asks where it goes as the TD types), prizes that add up, or places with a problem", () => {
    // The owner's example: 1st $600, 2nd $300, 3rd $150 with $1,260 available.
    expect(check(126_000, 126_000, { kind: "amount", amount: "600" }, { kind: "amount", amount: "300" }, { kind: "amount", amount: "150" })).toBeNull();
    expect(check(73_500, 73_500, { kind: "percent", percent: 50 }, { kind: "percent", percent: 30 }, { kind: "percent", percent: 20 })).toBeNull();
    expect(payoutsSaveCheck(null)).toBeNull();
  });
});
