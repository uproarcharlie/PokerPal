import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  carriedInCents,
  carryTargetName,
  choiceOutcome,
  DEFAULT_PRIZE_DIFFERENCE,
  differenceLines,
  differenceNote,
  differenceSentence,
  isPrizeDifferenceChoice,
  PRIZE_DIFFERENCE_CHOICES,
  PRIZE_DIFFERENCE_LABELS,
  readCarriedIn,
  readPrizeDifference,
  settleDifference,
  shareProRata,
} from "./prize-difference";

const total = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0);

describe("the choices", () => {
  it("offers the four the owner asked for, the club keeping it by default", () => {
    expect(PRIZE_DIFFERENCE_CHOICES).toEqual(["club", "first", "pro_rata", "carry"]);
    expect(DEFAULT_PRIZE_DIFFERENCE).toBe("club");
    expect(Object.values(PRIZE_DIFFERENCE_LABELS)).toEqual(["Club keeps it", "Add it to 1st", "Share it across the paid places", "Carry it over"]);
  });

  it("reads anything that is not a choice as the default", () => {
    expect(readPrizeDifference("carry")).toBe("carry");
    for (const stored of [null, undefined, "", "keep", 1, {}]) expect(readPrizeDifference(stored)).toBe("club");
    expect(isPrizeDifferenceChoice("pro_rata")).toBe(true);
    expect(isPrizeDifferenceChoice("rest")).toBe(false);
  });
});

describe("shareProRata", () => {
  it("shares in whole dollars by what each place pays, the dollars and cents left to 1st", () => {
    expect(shareProRata(8_500, [30_000, 18_000, 12_000])).toEqual([4_300, 2_500, 1_700]);
    expect(shareProRata(10_050, [50_000, 50_000])).toEqual([5_050, 5_000]);
  });

  it("gives it all to 1st when no place pays anything yet, and nothing to no places", () => {
    expect(shareProRata(5_000, [0, 0])).toEqual([5_000, 0]);
    expect(shareProRata(5_000, [])).toEqual([]);
  });

  it("always shares exactly, never favouring a place beyond its share, even for huge amounts", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 50 }), fc.array(fc.integer({ min: 0, max: 100_000_000 }), { minLength: 1, maxLength: 10 }), (cents, amounts) => {
        const shares = shareProRata(cents, amounts);
        expect(total(shares)).toBe(cents);
        const weight = total(amounts);
        shares.forEach((share, i) => {
          if (i === 0) return;
          expect(share % 100).toBe(0);
          if (weight > 0) expect(BigInt(share) * BigInt(weight)).toBeLessThanOrEqual(BigInt(cents) * BigInt(amounts[i]));
        });
      }),
      { numRuns: 1000 },
    );
  });
});

describe("settleDifference", () => {
  const set = [60_000, 30_000, 15_000];

  it("keeps the leftover for the club by default", () => {
    expect(settleDifference(set, 105_000, 120_000, "club")).toEqual({
      amounts: set,
      difference: {
        choice: "club",
        availableCents: 120_000,
        setCents: 105_000,
        cents: 15_000,
        keptByClubCents: 15_000,
        addedToPrizesCents: 0,
        carriedOverCents: 0,
        addedByClubCents: 0,
      },
    });
  });

  it("adds it to 1st, shares it, or carries it over", () => {
    expect(settleDifference(set, 105_000, 120_000, "first").amounts).toEqual([75_000, 30_000, 15_000]);
    expect(settleDifference(set, 105_000, 120_000, "pro_rata").amounts).toEqual([68_700, 34_200, 17_100]);
    const carried = settleDifference(set, 105_000, 120_000, "carry");
    expect(carried.amounts).toEqual(set);
    expect(carried.difference).toMatchObject({ carriedOverCents: 15_000, keptByClubCents: 0, addedToPrizesCents: 0 });
  });

  it("lets the club keep a leftover there is no place to add to", () => {
    expect(settleDifference([], 0, 5_000, "first").difference).toMatchObject({ keptByClubCents: 5_000, addedToPrizesCents: 0 });
  });

  it("has the club add a shortfall, whatever the choice", () => {
    for (const choice of PRIZE_DIFFERENCE_CHOICES) {
      const settled = settleDifference(set, 105_000, 90_000, choice);
      expect(settled.amounts).toEqual(set);
      expect(settled.difference).toMatchObject({ cents: -15_000, addedByClubCents: 15_000, keptByClubCents: 0, carriedOverCents: 0, addedToPrizesCents: 0 });
    }
  });

  it("does nothing when the prizes are exactly what is available", () => {
    expect(settleDifference(set, 105_000, 105_000, "pro_rata")).toMatchObject({ amounts: set, difference: { cents: 0, addedToPrizesCents: 0 } });
  });

  it("refuses amounts that are not whole cents", () => {
    expect(() => settleDifference([0.5], 1, 1, "club")).toThrow(RangeError);
    expect(() => settleDifference([100], 100, Number.NaN, "club")).toThrow(RangeError);
  });

  it("always accounts for every cent: paid + kept + carried − added by the club = available", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 1_000_000 }), { minLength: 1, maxLength: 9 }),
        fc.integer({ min: -100_000, max: 10_000_000 }),
        fc.constantFrom(...PRIZE_DIFFERENCE_CHOICES),
        (amounts, available, choice) => {
          const setCents = total(amounts);
          const { amounts: paid, difference } = settleDifference(amounts, setCents, available, choice);
          expect(total(paid) + difference.keptByClubCents + difference.carriedOverCents - difference.addedByClubCents).toBe(available);
          paid.forEach((amount, i) => expect(amount).toBeGreaterThanOrEqual(amounts[i]));
        },
      ),
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

describe("the words", () => {
  const figures = { setCents: 95_000, availableCents: 100_000 };

  it("names where carried money goes: the season, or the next tournament", () => {
    expect(carryTargetName("Winter League")).toBe("Winter League");
    expect(carryTargetName("  ")).toBe("the next tournament");
    expect(carryTargetName(null)).toBe("the next tournament");
  });

  it("says in one sentence where a leftover goes, for each choice", () => {
    const sentence = (choice: (typeof PRIZE_DIFFERENCE_CHOICES)[number]) => differenceSentence({ ...figures, cents: 5_000, choice }, "Winter League");
    expect(sentence("club")).toBe("The prizes add up to $950, $50 less than the $1,000 available for prizes: the club keeps it.");
    expect(sentence("first")).toBe("The prizes add up to $950, $50 less than the $1,000 available for prizes: it goes to 1st.");
    expect(sentence("pro_rata")).toBe("The prizes add up to $950, $50 less than the $1,000 available for prizes: it is shared across the paid places.");
    expect(sentence("carry")).toBe("The prizes add up to $950, $50 less than the $1,000 available for prizes: it is carried over to Winter League.");
    expect(choiceOutcome("carry", "the next tournament")).toBe("it is carried over to the next tournament");
  });

  it("says what the club adds, and nothing when there is no difference", () => {
    expect(differenceSentence({ setCents: 120_000, availableCents: 100_000, cents: -20_000, choice: "club" }, "x")).toBe(
      "The prizes add up to $1,200, $200 more than the $1,000 available for prizes: the club adds $200.",
    );
    expect(differenceSentence({ setCents: 50_000, availableCents: -100, cents: -50_100, choice: "club" }, "x")).toContain("than the $0 available");
    expect(differenceSentence({ ...figures, cents: 0, choice: "club" }, "x")).toBeNull();
  });

  it("words a change for the activity feed", () => {
    expect(differenceNote({ ...figures, cents: 15_000, choice: "club" }, "Winter League")).toBe("$150 left over: the club keeps it");
    expect(differenceNote({ ...figures, cents: 15_000, choice: "carry" }, "Winter League")).toBe("$150 left over: it is carried over to Winter League");
    expect(differenceNote({ ...figures, cents: -20_000, choice: "carry" }, "Winter League")).toBe("$200 added by the club");
    expect(differenceNote({ ...figures, cents: 0, choice: "club" }, "Winter League")).toBeNull();
  });

  it("lists the honest breakdown beside the pool: carried in, kept, carried over, added", () => {
    const carriedIn = [{ carryOverId: "c1", fromTournamentId: "t0", fromName: "Test Wednesday", amountCents: 2_500 }];
    const settled = (choice: (typeof PRIZE_DIFFERENCE_CHOICES)[number], available = 120_000) =>
      settleDifference([60_000, 30_000, 15_000], 105_000, available, choice).difference;
    expect(differenceLines({ difference: settled("club"), carriedIn }, "Winter League")).toEqual([
      { kind: "carried_in", label: "Carried over from Test Wednesday", cents: 2_500 },
      { kind: "kept_by_club", label: "Kept by the club", cents: 15_000 },
    ]);
    expect(differenceLines({ difference: settled("carry") }, "Winter League")).toEqual([
      { kind: "carried_over", label: "Carried over to Winter League", cents: 15_000 },
    ]);
    expect(differenceLines({ difference: settled("first") }, "x")).toEqual([{ kind: "added_to_prizes", label: "Left over, added to 1st", cents: 15_000 }]);
    expect(differenceLines({ difference: settled("pro_rata") }, "x")).toEqual([
      { kind: "added_to_prizes", label: "Left over, shared across the paid places", cents: 15_000 },
    ]);
    expect(differenceLines({ difference: settled("club", 100_000) }, "x")).toEqual([{ kind: "added_by_club", label: "Added by the club", cents: 5_000 }]);
    expect(differenceLines({ difference: settled("club", 105_000), carriedIn: null }, "x")).toEqual([]);
    expect(differenceLines({}, "x")).toEqual([]);
  });
});
