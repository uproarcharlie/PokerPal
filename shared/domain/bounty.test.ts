/**
 * Round 11: bounty games ("a $50 buy-in with a $100 bounty", the owner, 2026-11-21). Each buy-in pays
 * the bounty on top of its buy-in, so what an entry owes includes it (a free entry's too), and the
 * prize pool and the AP never hold it: a bounty game's pool is exactly the same game's without one.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { bountiesWonCents, bountyCents, entryPriceCents, hasBounty } from "./bounty";
import { centsToDecimalString } from "./money";
import { amountDueCents, computePrizePool, type EntryInput, type PrizePoolInput } from "./prize-pool";

/** The CS BOUNTY - FREEZEOUT as the owner sets it: $50 buy-in, $100 bounty, no AP. */
const BOUNTY_GAME = { buyInAmount: "50.00", bountyAmount: "100.00", rakeType: "none", rakeAmount: "0.00", payoutStructure: "standard" };

describe("bountyCents and hasBounty", () => {
  it.each([
    [null, 0, false],
    [undefined, 0, false],
    ["", 0, false],
    ["0.00", 0, false],
    ["100.00", 10_000, true],
    ["12.5", 1_250, true],
    [100, 10_000, true],
  ])("reads a bounty of %j as %d cents (a bounty game: %s)", (bountyAmount, cents, bounty) => {
    expect(bountyCents({ bountyAmount })).toBe(cents);
    expect(hasBounty({ bountyAmount })).toBe(bounty);
  });

  it("never reads a negative bounty as money owed", () => {
    expect(bountyCents({ bountyAmount: "-5.00" })).toBe(0);
  });
});

describe("entryPriceCents and bountiesWonCents", () => {
  it("prices one entry as the buy-in plus the bounty: $50 + $100 = $150", () => {
    expect(entryPriceCents(BOUNTY_GAME)).toBe(15_000);
    expect(entryPriceCents({ buyInAmount: "50.00", bountyAmount: null })).toBe(5_000);
  });

  it("pays one bounty a knockout", () => {
    expect(bountiesWonCents(BOUNTY_GAME, 3)).toBe(30_000);
    expect(bountiesWonCents(BOUNTY_GAME, 0)).toBe(0);
    expect(bountiesWonCents(BOUNTY_GAME, null)).toBe(0);
    expect(bountiesWonCents({ bountyAmount: null }, 4)).toBe(0);
  });
});

describe("amountDueCents with a bounty", () => {
  it("asks each buy-in for the buy-in and its bounty", () => {
    expect(amountDueCents(BOUNTY_GAME, { buyIns: 1 })).toBe(15_000);
  });

  it("asks a free entry for its bounty: the free entry covers the buy-in only", () => {
    expect(amountDueCents(BOUNTY_GAME, { buyIns: 1, freeEntry: true })).toBe(10_000);
  });

  it("asks two buy-ins for two bounties", () => {
    expect(amountDueCents(BOUNTY_GAME, { buyIns: 2 })).toBe(30_000);
  });

  it("adds no bounty to re-buys, add-ons or the high hand", () => {
    const game = { ...BOUNTY_GAME, rebuyAmount: "25.00", addonAmount: "20.00", enableHighHand: true, highHandAmount: "5.00" };
    expect(amountDueCents(game, { buyIns: 1, rebuys: 2, addons: 1, enteringHighHands: true })).toBe(15_000 + 5_000 + 2_000 + 500);
  });

  it("owes nothing for a bounty when the entry has no buy-in", () => {
    expect(amountDueCents(BOUNTY_GAME, { buyIns: 0 })).toBe(0);
  });

  it("is what it was before round 11 for a game with no bounty", () => {
    expect(amountDueCents({ ...BOUNTY_GAME, bountyAmount: null }, { buyIns: 2 })).toBe(10_000);
    expect(amountDueCents({ ...BOUNTY_GAME, bountyAmount: "0.00" }, { buyIns: 1, freeEntry: true })).toBe(0);
  });
});

describe("the prize pool never holds the bounty", () => {
  const paid = (n: number): EntryInput[] => Array.from({ length: n }, () => ({ buyIns: 1, paymentConfirmed: true }));

  it("pays $50 a paid player for a $50 + $100 bounty game, as the same game with no bounty", () => {
    const entries = [...paid(40), { buyIns: 1, paymentConfirmed: false }];
    const withBounty = computePrizePool(BOUNTY_GAME, entries);

    expect(withBounty.gross).toEqual({ buyIn: 200_000, rebuy: 0, addon: 0, total: 200_000 });
    expect(withBounty.net).toBe(200_000);
    expect(withBounty).toEqual(computePrizePool({ ...BOUNTY_GAME, bountyAmount: null }, entries));
  });

  it("is byte-identical with any bounty, whatever the prices, AP and entries", () => {
    const money = (maxCents: number) => fc.integer({ min: 0, max: maxCents }).map(centsToDecimalString);
    const tournaments: fc.Arbitrary<PrizePoolInput> = fc.record({
      buyInAmount: money(50_000),
      rebuyAmount: fc.option(money(50_000), { nil: null }),
      addonAmount: fc.option(money(50_000), { nil: null }),
      rakeType: fc.constantFrom("none", "percentage", "fixed"),
      rakeAmount: money(1_000),
      payoutStructure: fc.constantFrom("standard", "top3", "top5", "top8", "top9"),
      enableHighHand: fc.boolean(),
      highHandAmount: fc.option(money(5_000), { nil: null }),
    });
    const entries = fc.array(
      fc.record({
        buyIns: fc.integer({ min: 0, max: 3 }),
        rebuys: fc.integer({ min: 0, max: 3 }),
        addons: fc.integer({ min: 0, max: 2 }),
        enteringHighHands: fc.boolean(),
        paymentConfirmed: fc.boolean(),
        freeEntry: fc.boolean(),
      }),
      { maxLength: 60 },
    );

    fc.assert(
      fc.property(tournaments, entries, money(100_000), (tournament, list, bountyAmount) => {
        const without = JSON.stringify(computePrizePool({ ...tournament, bountyAmount: null }, list));
        expect(JSON.stringify(computePrizePool({ ...tournament, bountyAmount }, list))).toBe(without);
      }),
      { numRuns: 300 },
    );
  });
});
