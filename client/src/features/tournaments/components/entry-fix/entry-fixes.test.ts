import { describe, expect, it } from "vitest";
import { freeEntryStatus, registrationDto, tournamentDto } from "@test/helpers/f1-tournaments";
import { entryFixOptions, notPaidQuestion, type FixableEntry } from "./entry-fixes";

const drop = (poolCents: number, highHandCents = 0, manualPoolCents: number | null = null) => ({ poolCents, highHandCents, highHands: [], manualPoolCents });
const asked = (cents: ReturnType<typeof drop> | undefined, freeTournament = false) => notPaidQuestion("Tama", cents, { freeTournament });

describe("notPaidQuestion (round 9)", () => {
  it("says what the prize pool and the high-hand pot each lose", () => {
    expect(asked(drop(9_500))).toBe("Tama goes back to Not paid yet; the prize pool drops by $95. They keep their seat.");
    expect(asked(drop(9_500, 2_000))).toBe("Tama goes back to Not paid yet; the prize pool drops by $95 and the high-hand pot by $20. They keep their seat.");
    expect(asked(drop(0, 2_000))).toBe("Tama goes back to Not paid yet; the high-hand pot drops by $20. They keep their seat.");
    expect(asked(drop(0))).toBe("Tama goes back to Not paid yet; the prize pool does not change. They keep their seat.");
  });

  it("keeps a prize pool set by hand as it is, and says nothing of money it does not know yet", () => {
    expect(asked(drop(0, 0, 50_000))).toBe("Tama goes back to Not paid yet. The prize pool stays at $500: it is set by hand. They keep their seat.");
    expect(asked(undefined)).toBe("Tama goes back to Not paid yet. They keep their seat.");
    expect(asked(drop(0), true)).toBe("Tama goes back to Not accepted yet; the prize pool does not change. They keep their seat.");
  });
});

describe("entryFixOptions (round 9)", () => {
  const entry = (overrides: Partial<FixableEntry> = {}): FixableEntry => ({ ...registrationDto("r1", "Tama"), ...freeEntryStatus(), paymentConfirmed: true, paidBy: "transfer", ...overrides });

  it("offers a paid entry everything, its payment as recorded", () => {
    expect(entryFixOptions(entry(), tournamentDto({ enableHighHand: true, highHandAmount: "20.00" }))).toEqual({
      notPaid: { unavailable: null },
      paidBy: { current: "transfer" },
      editPlayer: { unavailable: null },
      highHands: [{ highHandId: "legacy", label: "High hand entered", entered: false, unavailable: null }],
    });
  });

  it("leaves the payment fixes to a free entry's own Undo, and to an entry that has not paid", () => {
    for (const fixable of [entry({ freeEntry: true, paidBy: "free" }), entry({ paymentConfirmed: false, paidBy: null })]) {
      expect(entryFixOptions(fixable, tournamentDto())).toMatchObject({ notPaid: null, paidBy: null, highHands: [] });
    }
  });

  it("still lets a player leave the high hand once the pool is locked, never join it", () => {
    const locked = tournamentDto({ enableHighHand: true, highHandAmount: "20.00", prizePoolLocked: true });
    expect(entryFixOptions(entry({ enteringHighHands: true }), locked).highHands).toEqual([{ highHandId: "legacy", label: "High hand entered", entered: true, unavailable: null }]);
    expect(entryFixOptions(entry(), locked).highHands[0]?.unavailable).toMatch(/locked/);
  });
});

describe("entryFixOptions with several high hands (round 10)", () => {
  const highHands = [
    { id: "hh1", name: "First half", position: 1, entryFee: "5.00", winners: 1, note: "Before the break" },
    { id: "hh2", name: "Second half", position: 2, entryFee: "5.00", winners: 1, note: null },
  ];
  const listed = (overrides = {}) => tournamentDto({ enableHighHand: true, highHandAmount: "10.00", highHands, ...overrides });
  const entry = (overrides: Partial<FixableEntry> = {}): FixableEntry => ({ ...registrationDto("r1", "Tama Rangi"), ...freeEntryStatus(), paymentConfirmed: true, ...overrides });

  it("offers one tick per high hand, named, in order", () => {
    const options = entryFixOptions(entry({ enteringHighHands: true, highHandIds: ["hh2"] }), listed());
    expect(options.highHands).toEqual([
      { highHandId: "hh1", label: "First half high hand", entered: false, unavailable: null },
      { highHandId: "hh2", label: "Second half high hand", entered: true, unavailable: null },
    ]);
  });

  it("greys out joining one while the pool is locked, and leaving one the player has won", () => {
    const won = { highHandId: "hh1", amountCents: 4_500, splitWithRegistrationId: null, awardedAt: "2026-11-18T08:00:00.000Z" };
    const options = entryFixOptions(entry({ enteringHighHands: true, highHandIds: ["hh1"], highHandWins: [won] }), listed({ prizePoolLocked: true }));
    expect(options.highHands.map((highHand) => highHand.unavailable)).toEqual([
      "Take Tama's First half high hand award back first",
      "The prize pool is locked: nobody joins a high hand now",
    ]);
  });
});

describe("notPaidQuestion with several high hands (round 10)", () => {
  it("names each pot that drops", () => {
    const pots = [
      { highHandId: "hh1", name: "First half", cents: 500 },
      { highHandId: "hh2", name: "Second half", cents: 500 },
    ];
    expect(notPaidQuestion("Tama", { poolCents: 5_000, highHandCents: 1_000, highHands: pots, manualPoolCents: null }, { freeTournament: false })).toBe(
      "Tama goes back to Not paid yet; the prize pool drops by $50 and the First half high hand pot by $5 and the Second half high hand pot by $5. They keep their seat.",
    );
    expect(notPaidQuestion("Tama", { poolCents: 0, highHandCents: 1_000, highHands: pots, manualPoolCents: 20_000 }, { freeTournament: false })).toBe(
      "Tama goes back to Not paid yet. The prize pool stays at $200: it is set by hand. The First half high hand pot drops by $5 and the Second half high hand pot by $5. They keep their seat.",
    );
  });
});
