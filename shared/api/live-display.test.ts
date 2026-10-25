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

    expect(prizes).toEqual({
      tournamentId: "t1",
      locked: true,
      estimated: false,
      source: "live",
      poolCents: 28_500,
      payouts: [
        { position: 1, amountCents: 14_300 },
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

  it("names the money carried in by where it came from only, and the high-hand pot of the paid entries", () => {
    const prizes = toPublicPrizes(
      tournament({ carriedIn: [{ carryOverId: "co1", fromTournamentId: "t0", fromName: "Week 3", amountCents: 10_000 }], enableHighHand: true, highHandAmount: "10.00" }),
      [entry("r1", { enteringHighHands: true }), entry("r2", { enteringHighHands: true }), entry("r3", { paymentConfirmed: false, enteringHighHands: true })],
    );

    expect(prizes).toMatchObject({ poolCents: 29_000, carriedIn: [{ fromName: "Week 3", amountCents: 10_000 }], highHandPotCents: 2_000 });
    expect(findTakingsKeys(prizes)).toEqual([]);
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
