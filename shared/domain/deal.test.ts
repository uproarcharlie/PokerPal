import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { dealProblems, describeDeal, evenChop, type Dealable } from "./deal";

const dealable = (cents: number[]): Dealable => ({
  totalCents: cents.reduce((sum, amount) => sum + amount, 0),
  players: cents.map((plannedCents, i) => ({
    registrationId: `r${i + 1}`,
    playerId: `p${i + 1}`,
    playerName: ["Alice", "Bob", "Carl", "Dee"][i] ?? `Player ${i + 1}`,
    position: i + 1,
    plannedCents,
  })),
});

const deal = (amounts: number[], reason = "Chip chop") => ({
  reason,
  amounts: amounts.map((amountCents, i) => ({ registrationId: `r${i + 1}`, amountCents })),
});

describe("dealProblems", () => {
  const three = dealable([50_000, 30_000, 20_000]);

  it("accepts any split of exactly what the players still in would be paid, to the cent", () => {
    expect(dealProblems(three, deal([40_000, 35_000, 25_000]))).toEqual([]);
    expect(dealProblems(three, deal([33_334, 33_333, 33_333]))).toEqual([]);
    expect(dealProblems(three, deal([0, 0, 100_000]))).toEqual([]);
  });

  it("needs two or more players still in", () => {
    expect(dealProblems(null, deal([100_000]))).toEqual([{ code: "DEAL_TOO_FEW_PLAYERS", message: "A deal needs two or more players still in" }]);
    expect(dealProblems(dealable([100_000]), deal([100_000]))).toEqual([
      { code: "DEAL_TOO_FEW_PLAYERS", message: "A deal needs two or more players still in" },
    ]);
  });

  it("refuses an amount short of the total, or over it", () => {
    expect(dealProblems(three, deal([40_000, 35_000, 20_000]))).toEqual([{ code: "DEAL_TOTAL", message: "The deal must share $1,000 (it is $50 short)" }]);
    expect(dealProblems(three, deal([40_000, 35_000, 25_001]))).toEqual([{ code: "DEAL_TOTAL", message: "The deal must share $1,000 (it is $0.01 too much)" }]);
  });

  it("names exactly the players still in, each once", () => {
    const missing = { reason: "Chop", amounts: [{ registrationId: "r1", amountCents: 50_000 }, { registrationId: "r2", amountCents: 50_000 }] };
    expect(dealProblems(three, missing)).toEqual([{ code: "DEAL_PLAYERS", message: "Give Carl an amount too", registrationId: "r3" }]);
    const stranger = { reason: "Chop", amounts: [...deal([40_000, 30_000, 30_000]).amounts.slice(0, 2), { registrationId: "r9", amountCents: 30_000 }] };
    expect(dealProblems(three, stranger)[0]).toEqual({
      code: "DEAL_PLAYERS",
      message: "A deal shares the prizes of the players still in: give each of them one amount",
      registrationId: "r9",
    });
    const twice = { reason: "Chop", amounts: [...deal([40_000, 30_000]).amounts, { registrationId: "r1", amountCents: 30_000 }] };
    expect(dealProblems(three, twice)[0]).toMatchObject({ code: "DEAL_PLAYERS", registrationId: "r1" });
  });

  it.each([[-1], [0.5], [Number.NaN], [Number.MAX_SAFE_INTEGER + 2]])("refuses an amount of %d cents", (cents) => {
    expect(dealProblems(three, deal([50_000, 30_000, cents]))).toEqual([
      { code: "DEAL_AMOUNT", message: "Each amount must be $0 or more, to the cent", registrationId: "r3" },
    ]);
  });

  it("asks what was agreed", () => {
    expect(dealProblems(three, deal([50_000, 30_000, 20_000], "   "))).toEqual([
      { code: "DEAL_REASON", message: 'Say what was agreed, e.g. "Chip chop at 3 handed"' },
    ]);
  });
});

describe("evenChop", () => {
  it("splits the total equally in whole dollars, the odd dollars and cents to the first player", () => {
    expect(evenChop(100_000, ["r1", "r2", "r3"])).toEqual([
      { registrationId: "r1", amountCents: 33_400 },
      { registrationId: "r2", amountCents: 33_300 },
      { registrationId: "r3", amountCents: 33_300 },
    ]);
    expect(evenChop(1_050, ["a", "b"])).toEqual([
      { registrationId: "a", amountCents: 550 },
      { registrationId: "b", amountCents: 500 },
    ]);
    expect(evenChop(100, ["a"])).toEqual([{ registrationId: "a", amountCents: 100 }]);
    expect(evenChop(100, [])).toEqual([]);
    expect(evenChop(-5, ["a", "b"]).map((share) => share.amountCents)).toEqual([0, 0]);
    expect(evenChop(Number.NaN, ["a"]).map((share) => share.amountCents)).toEqual([0]);
  });

  it("always passes dealProblems", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 1_000_000 }), { minLength: 2, maxLength: 9 }), (planned) => {
        const players = dealable(planned);
        const chop = evenChop(players.totalCents, players.players.map((player) => player.registrationId));
        expect(dealProblems(players, { reason: "Even chop", amounts: chop })).toEqual([]);
      }),
      { numRuns: 500 },
    );
  });
});

describe("describeDeal", () => {
  it("lists who gets what, as the activity feed says it", () => {
    expect(
      describeDeal({
        players: [
          { registrationId: "r1", playerId: "p1", playerName: "Alice", position: 1, plannedCents: 50_000, amountCents: 45_000 },
          { registrationId: "r2", playerId: "p2", playerName: "Bob", position: 2, plannedCents: 30_000, amountCents: 35_000 },
        ],
      }),
    ).toBe("Alice $450, Bob $350");
  });
});
