import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  carriedInCents,
  differenceLines,
  differenceNote,
  differenceSentence,
  FREE_ENTRIES_ADDED_LABEL,
  leftoverText,
  readCarriedIn,
  settleDifference,
} from "./prize-difference";

describe("settleDifference (round 7: a leftover is the club's fee)", () => {
  it("adds what the prizes leave of the money available to the club's fee", () => {
    expect(settleDifference(105_000, 120_000)).toEqual({ availableCents: 120_000, setCents: 105_000, cents: 15_000, keptByClubCents: 15_000, addedByClubCents: 0 });
  });

  it("has the club add a shortfall", () => {
    expect(settleDifference(105_000, 90_000)).toEqual({ availableCents: 90_000, setCents: 105_000, cents: -15_000, keptByClubCents: 0, addedByClubCents: 15_000 });
  });

  it("does nothing when the prizes are exactly what is available", () => {
    expect(settleDifference(105_000, 105_000)).toMatchObject({ cents: 0, keptByClubCents: 0, addedByClubCents: 0 });
  });

  it("refuses amounts that are not whole cents", () => {
    expect(() => settleDifference(0.5, 1)).toThrow(RangeError);
    expect(() => settleDifference(100, Number.NaN)).toThrow(RangeError);
  });

  it("always accounts for every cent: prizes + kept by the club − added by the club = available", () => {
    fc.assert(
      fc.property(fc.integer({ min: -100_000, max: 100_000_000 }), fc.integer({ min: -100_000, max: 100_000_000 }), (setCents, available) => {
        const difference = settleDifference(setCents, available);
        expect(setCents + difference.keptByClubCents - difference.addedByClubCents).toBe(available);
        expect(Math.min(difference.keptByClubCents, difference.addedByClubCents)).toBe(0);
      }),
      { numRuns: 1000 },
    );
  });
});

describe("carried in", () => {
  it("reads only well-formed entries with a positive whole amount", () => {
    const entries = [
      { carryOverId: "c1", fromTournamentId: "t1", fromName: "Test Wednesday", amountCents: 5_000 },
      { carryOverId: "c2", fromTournamentId: 7, fromName: "Old", amountCents: 100 },
      { carryOverId: "c3", fromName: "Zero", amountCents: 0 },
      { carryOverId: "c4", fromName: "Half", amountCents: 0.5 },
      { fromName: "No id", amountCents: 100 },
      null,
      [1],
    ];
    expect(readCarriedIn(entries)).toEqual([
      { carryOverId: "c1", fromTournamentId: "t1", fromName: "Test Wednesday", amountCents: 5_000 },
      { carryOverId: "c2", fromTournamentId: null, fromName: "Old", amountCents: 100 },
    ]);
    expect(readCarriedIn(null)).toEqual([]);
    expect(readCarriedIn("[]")).toEqual([]);
    expect(carriedInCents(readCarriedIn(entries))).toBe(5_100);
  });
});

describe("the words (the club's staff only)", () => {
  const figures = { setCents: 95_000, availableCents: 100_000 };

  it("says a leftover goes to the club's fee, in its name for it", () => {
    expect(leftoverText(5_000, "AP")).toBe("Leftover $50 → AP");
    expect(leftoverText(337, "Rake")).toBe("Leftover $3.37 → Rake");
    expect(differenceSentence({ ...figures, cents: 5_000 }, "AP")).toBe("Leftover $50 → AP: the prizes add up to $950 of the $1,000 available for prizes.");
  });

  it("says what the club adds, and nothing when there is no difference", () => {
    expect(differenceSentence({ setCents: 120_000, availableCents: 100_000, cents: -20_000 }, "AP")).toBe(
      "The prizes add up to $1,200, $200 more than the $1,000 available for prizes: the club adds $200.",
    );
    expect(differenceSentence({ setCents: 50_000, availableCents: -100, cents: -50_100 }, "AP")).toContain("than the $0 available");
    expect(differenceSentence({ ...figures, cents: 0 }, "AP")).toBeNull();
  });

  it("words a change for the activity feed and the toasts", () => {
    expect(differenceNote({ cents: 15_000 }, "AP")).toBe("Leftover $150 → AP");
    expect(differenceNote({ cents: -20_000 }, "AP")).toBe("Added by the club: $200");
    expect(differenceNote({ cents: 0 }, "AP")).toBeNull();
  });

  it("lists the breakdown beside the pool: carried in, added for free entries, the leftover, added by the club", () => {
    const carriedIn = [{ carryOverId: "c1", fromTournamentId: "t0", fromName: "Test Wednesday", amountCents: 2_500 }];
    expect(differenceLines({ difference: settleDifference(105_000, 120_000), carriedIn, freeEntries: { addedCents: 10_000 } }, "AP")).toEqual([
      { kind: "carried_in", label: "Carried over from Test Wednesday", cents: 2_500, text: "Carried over from Test Wednesday $25" },
      { kind: "added_for_free_entries", label: FREE_ENTRIES_ADDED_LABEL, cents: 10_000, text: "Added by the club for free entries $100" },
      { kind: "kept_by_club", label: "Leftover → AP", cents: 15_000, text: "Leftover $150 → AP" },
    ]);
    expect(differenceLines({ difference: settleDifference(105_000, 100_000) }, "AP")).toEqual([
      { kind: "added_by_club", label: "Added by the club", cents: 5_000, text: "Added by the club $50" },
    ]);
    expect(differenceLines({ difference: settleDifference(105_000, 105_000), carriedIn: null, freeEntries: { addedCents: 0 } }, "AP")).toEqual([]);
    expect(differenceLines({}, "AP")).toEqual([]);
  });

  it("still shows a snapshot frozen before round 7 as it was paid: carried over, or added to the places", () => {
    const frozen = (choice: string, extra: object) => ({ difference: { keptByClubCents: 0, addedByClubCents: 0, choice, ...extra } });
    expect(differenceLines(frozen("carry", { carriedOverCents: 15_000, carryTarget: "Winter League" }), "AP")).toEqual([
      { kind: "carried_over", label: "Carried over to Winter League", cents: 15_000, text: "Carried over to Winter League $150" },
    ]);
    expect(differenceLines(frozen("first", { addedToPrizesCents: 15_000 }), "AP").map((line) => line.label)).toEqual(["Left over, added to 1st"]);
    expect(differenceLines(frozen("pro_rata", { addedToPrizesCents: 15_000 }), "AP").map((line) => line.label)).toEqual(["Left over, shared across the paid places"]);
  });
});
