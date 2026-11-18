import { describe, expect, it } from "vitest";
import { freeEntryStatus, registrationDto, tournamentDto } from "@test/helpers/f1-tournaments";
import { entryFixOptions, notPaidQuestion, type FixableEntry } from "./entry-fixes";

const drop = (poolCents: number, highHandCents = 0, manualPoolCents: number | null = null) => ({ poolCents, highHandCents, manualPoolCents });
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
      highHand: { entered: false, unavailable: null },
    });
  });

  it("leaves the payment fixes to a free entry's own Undo, and to an entry that has not paid", () => {
    for (const fixable of [entry({ freeEntry: true, paidBy: "free" }), entry({ paymentConfirmed: false, paidBy: null })]) {
      expect(entryFixOptions(fixable, tournamentDto())).toMatchObject({ notPaid: null, paidBy: null, highHand: null });
    }
  });

  it("still lets a player leave the high hand once the pool is locked, never join it", () => {
    const locked = tournamentDto({ enableHighHand: true, highHandAmount: "20.00", prizePoolLocked: true });
    expect(entryFixOptions(entry({ enteringHighHands: true }), locked).highHand).toEqual({ entered: true, unavailable: null });
    expect(entryFixOptions(entry(), locked).highHand?.unavailable).toMatch(/locked/);
  });
});
