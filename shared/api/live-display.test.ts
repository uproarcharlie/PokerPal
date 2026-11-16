import { describe, expect, it } from "vitest";
import type { EntryInput } from "../domain/prize-pool";
import { carriedInNote, toPublicPrizes, type PrizesTournament } from "./live-display";
import { findTakingsKeys } from "./public";

describe("carriedInNote", () => {
  it("says what was carried in and from where, in one short line, or nothing", () => {
    expect(carriedInNote([])).toBeNull();
    expect(carriedInNote([{ fromName: "Week 3", amountCents: 20_000 }])).toBe("Includes $200 carried over from Week 3");
    expect(carriedInNote([{ fromName: "Week 3", amountCents: 20_000 }, { fromName: "Week 4", amountCents: 5_050 }])).toBe("Includes $250.50 carried over from Week 3 and Week 4");
    expect(carriedInNote(["A", "B", "C"].map((fromName) => ({ fromName, amountCents: 100 })))).toBe("Includes $3 carried over from A, B and C");
  });
});

describe("toPublicPrizes", () => {
  /** $100 buy-ins, $5 AP each, 50/30/20, locked. */
  const tournament = (overrides: Partial<PrizesTournament> = {}): PrizesTournament => ({
    id: "t1",
    status: "in_progress",
    buyInAmount: "100.00",
    rakeType: "fixed",
    rakeAmount: "5.00",
    payoutStructure: "standard",
    prizePoolLocked: true,
    ...overrides,
  });
  const entry = (id: string, extra: Partial<EntryInput> = {}): EntryInput & { id: string } => ({ id, buyIns: 1, paymentConfirmed: true, ...extra });

  it("pays the paid players' pool, and counts nothing for an entry with no payment status (a public registration)", () => {
    const prizes = toPublicPrizes(tournament(), [entry("r1"), entry("r2"), entry("r3"), entry("r4", { paymentConfirmed: false }), { id: "r5", buyIns: 1 }]);

    // $285 available, each place rounded down to whole dollars (round 7): the headline is what they pay, $284, and the $1 left is the club's.
    expect(prizes).toEqual({
      tournamentId: "t1",
      locked: true,
      estimated: false,
      source: "live",
      poolCents: 28_400,
      payouts: [
        { position: 1, amountCents: 14_200 },
        { position: 2, amountCents: 8_500 },
        { position: 3, amountCents: 5_700 },
      ],
      undistributedCents: 0,
      carriedIn: [],
      highHandPotCents: null,
      deal: null,
    });
    expect(toPublicPrizes(tournament(), [{ id: "r1", buyIns: 1 }]).poolCents).toBe(0);
  });

  it("counts what the club pays in for a free entry, in full and with no AP, and nothing of one it does not, naming neither (round 7)", () => {
    // 2 paid: $200 less $10 AP; the funded free entry adds its $100: $290, paid out as $145 + $87 + $58. The other adds nothing.
    const prizes = toPublicPrizes(tournament(), [
      entry("r1"),
      entry("r2"),
      entry("r3", { freeEntry: true, freeEntryFunded: true }),
      entry("r4", { freeEntry: true }),
    ]);

    expect(prizes).toMatchObject({
      poolCents: 29_000,
      payouts: [
        { position: 1, amountCents: 14_500 },
        { position: 2, amountCents: 8_700 },
        { position: 3, amountCents: 5_800 },
      ],
      undistributedCents: 0,
    });
    expect(findTakingsKeys(prizes)).toEqual([]);
    expect(JSON.stringify(prizes)).not.toMatch(/free|funded/i);
  });

  it("names the money carried in by where it came from only, and the high-hand pot of the paid entries", () => {
    const prizes = toPublicPrizes(
      tournament({ carriedIn: [{ carryOverId: "co1", fromTournamentId: "t0", fromName: "Week 3", amountCents: 10_000 }], enableHighHand: true, highHandAmount: "10.00" }),
      [entry("r1", { enteringHighHands: true }), entry("r2", { enteringHighHands: true }), entry("r3", { paymentConfirmed: false, enteringHighHands: true })],
    );

    // $290 for prizes, but only 2 paid players: 1st $145 and 2nd $87 are the pool; what 3rd would pay is the club's.
    expect(prizes).toMatchObject({ poolCents: 23_200, carriedIn: [{ fromName: "Week 3", amountCents: 10_000 }], highHandPotCents: 2_000 });
    expect(findTakingsKeys(prizes)).toEqual([]);
  });

  it("headlines what the places with a paid player pay, and never what the places with none would (R7FREV0-MONEY-01)", () => {
    // $190 for prizes on Standard: $95/$57/$38, but with 2 paid players only $95 + $57 is paid.
    const prizes = toPublicPrizes(tournament(), [entry("r1"), entry("r2"), entry("r3", { paymentConfirmed: false })]);

    expect(prizes).toMatchObject({
      poolCents: 15_200,
      payouts: [
        { position: 1, amountCents: 9_500 },
        { position: 2, amountCents: 5_700 },
      ],
      undistributedCents: 0,
    });
    expect(prizes.poolCents).toBe(prizes.payouts.reduce((sum, payout) => sum + payout.amountCents, 0));
    expect(JSON.stringify(prizes)).not.toContain("3800");
  });

  it("shows what finalize paid, carried in and dealt once completed, and nothing once cancelled", () => {
    const deal = { reason: "Chop", totalCents: 19_000, players: [] };
    const snapshot = {
      pool: { netCents: 19_000, carriedIn: [{ carryOverId: "co1", fromTournamentId: null, fromName: "Week 3", amountCents: 1_000 }] },
      paid: [
        { position: 1, registrationId: "r1", basisPoints: 6_000, amountCents: 11_400 },
        { position: 2, registrationId: "r2", basisPoints: 4_000, amountCents: 7_600 },
      ],
      deal,
    };

    expect(toPublicPrizes(tournament({ status: "completed", prizePoolSnapshot: snapshot }), [entry("r1"), entry("r2")])).toMatchObject({
      source: "snapshot",
      estimated: false,
      poolCents: 19_000,
      payouts: [
        { position: 1, amountCents: 11_400, registrationId: "r1" },
        { position: 2, amountCents: 7_600, registrationId: "r2" },
      ],
      carriedIn: [{ fromName: "Week 3", amountCents: 1_000 }],
      deal,
    });
    expect(toPublicPrizes(tournament({ status: "cancelled" }), [entry("r1"), entry("r2")])).toMatchObject({ source: "cancelled", poolCents: 0, payouts: [] });
  });
});
