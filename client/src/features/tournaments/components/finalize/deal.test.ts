import { describe, expect, it } from "vitest";
import type { Dealable, SnapshotDeal } from "@shared/domain/deal";
import { dealReasons, dealRequest, dealTotalText, draftProblems, evenDraft, previousDeal, startDeal, typedCents } from "./deal";

// Alice, Bob and Carl still in, sharing $475 (their places pay $238 / $142 / $95).
const dealable: Dealable = {
  totalCents: 47_500,
  players: [
    { registrationId: "r1", playerId: "p1", playerName: "Alice", position: 1, plannedCents: 23_800 },
    { registrationId: "r2", playerId: "p2", playerName: "Bob", position: 2, plannedCents: 14_200 },
    { registrationId: "r3", playerId: "p3", playerName: "Carl", position: 3, plannedCents: 9_500 },
  ],
};

const paid = (amounts: Record<string, number>, reason = "Chip chop at 3 handed"): SnapshotDeal => ({
  reason,
  totalCents: 47_500,
  players: dealable.players.map((player) => ({ ...player, position: player.position ?? 0, plannedCents: player.plannedCents ?? 0, amountCents: amounts[player.registrationId] })),
});

describe("a deal as the TD types it", () => {
  it("starts from what each player's place pays, or empty boxes before the finishing order is known", () => {
    expect(startDeal(dealable)).toEqual({ amounts: { r1: "238", r2: "142", r3: "95" }, reason: "" });
    const unordered = { ...dealable, players: dealable.players.map((player) => ({ ...player, position: null, plannedCents: null })) };
    expect(startDeal(unordered)).toEqual({ amounts: { r1: "", r2: "", r3: "" }, reason: "" });
  });

  it("starts a correction from the deal finalize paid, while the same players are still in", () => {
    expect(previousDeal(dealable, paid({ r1: 20_000, r2: 15_050, r3: 12_450 }))).toEqual({
      amounts: { r1: "200", r2: "150.50", r3: "124.50" },
      reason: "Chip chop at 3 handed",
    });
    expect(previousDeal(dealable, null)).toBeNull();
    expect(previousDeal(null, paid({ r1: 20_000, r2: 15_000, r3: 12_500 }))).toBeNull();
    const twoLeft = { ...dealable, players: dealable.players.slice(0, 2) };
    expect(previousDeal(twoLeft, paid({ r1: 20_000, r2: 15_000, r3: 12_500 }))).toBeNull();
  });

  it("splits evenly in whole dollars, the odd dollars and cents to the player shown first", () => {
    expect(evenDraft({ amounts: {}, reason: "Even chop" }, dealable, ["r2", "r1", "r3"])).toEqual({
      amounts: { r2: "159", r1: "158", r3: "158" },
      reason: "Even chop",
    });
  });

  it("says what is wrong with it by finalize's own rules, a box not typed yet as a wrong amount", () => {
    expect(draftProblems(dealable, { amounts: { r1: "200", r2: "180", r3: "90" }, reason: "" })).toEqual([
      { code: "DEAL_TOTAL", message: "The deal must share $475 (it is $5 short)" },
      { code: "DEAL_REASON", message: 'Say what was agreed, e.g. "Chip chop at 3 handed"' },
    ]);
    expect(draftProblems(dealable, { amounts: { r1: "200", r2: "", r3: "95" }, reason: "Chop" })).toEqual([
      { code: "DEAL_AMOUNT", message: "Each amount must be $0 or more, to the cent", registrationId: "r2" },
    ]);
    expect(draftProblems(dealable, { amounts: { r1: "200", r2: "180", r3: "95" }, reason: "Chop" })).toEqual([]);
  });

  it("sends the deal only once it can be paid, every amount to the cent", () => {
    expect(dealRequest(dealable, { amounts: { r1: "200", r2: "180", r3: "90" }, reason: "Chop" })).toBeNull();
    expect(dealRequest(dealable, { amounts: { r1: "200", r2: "179.5", r3: "95.50" }, reason: " Chip chop " })).toEqual({
      amounts: [
        { registrationId: "r1", amount: "200.00" },
        { registrationId: "r2", amount: "179.50" },
        { registrationId: "r3", amount: "95.50" },
      ],
      reason: "Chip chop",
    });
  });

  it("keeps the running total beside what the players share", () => {
    expect(dealTotalText(dealable, { amounts: { r1: "200", r2: "180", r3: "95" }, reason: "" })).toEqual({ text: "$475 of $475: it adds up", adds: true });
    expect(dealTotalText(dealable, { amounts: { r1: "200", r2: "180", r3: "" }, reason: "" })).toEqual({ text: "$380 of $475: $95 short", adds: false });
    expect(dealTotalText(dealable, { amounts: { r1: "300", r2: "180", r3: "95" }, reason: "" })).toEqual({ text: "$575 of $475: $100 too much", adds: false });
  });

  it("words amounts and the usual deals", () => {
    expect(typedCents(" 12.5 ")).toBe(1_250);
    expect(typedCents("-5")).toBeNull();
    expect(dealReasons(2)).toEqual(["Chip chop at 2 handed", "Even chop at 2 handed", "ICM chop at 2 handed"]);
  });
});
