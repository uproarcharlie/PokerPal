import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildFinalizePlan, type FinalizeRegistrationInput } from "./finalize";
import {
  adoptLegacyHighHand,
  allHighHandsFeeCents,
  awardedCentsOf,
  chosenHighHandIds,
  combinedHighHand,
  DEFAULT_HIGH_HAND_NAME,
  findHighHand,
  highHandAwardsOf,
  highHandChoiceChange,
  highHandEntrantCounts,
  highHandFeesCents,
  highHandIdsOf,
  highHandLabel,
  highHandPot,
  highHandPots,
  highHandRakeCents,
  highHandsAtDoor,
  highHandsOf,
  highHandsPhrase,
  highHandStandings,
  highHandWinsOf,
  LEGACY_HIGH_HAND_ID,
  legacyHighHand,
  listsHighHands,
  nextHighHandAward,
  offersHighHands,
  planHighHandsChange,
  potsAwardsProblem,
  readHighHandChoice,
  registrationHighHandSummary,
  repricedHighHands,
  snapshotHighHands,
  splitHighHandAward,
  tournamentHighHandSummary,
  twoHighHandsPreset,
  type HighHandSettings,
  type HighHandWinInput,
} from "./high-hands";
import { toBasisPoints, toCents, type Cents } from "./money";
import { offersHighHand } from "./player-actions";
import { amountDueCents, computePrizePool, paymentDropCents, type EntryInput, type PrizePoolInput } from "./prize-pool";

/** Tonight's game (the owner, 2026-11-18): two high hands at $5, sold together until now as one $10 entry. */
const FIRST: HighHandSettings = { id: "hh1", name: "First half", position: 1, entryFee: "5.00", rakeType: "percentage", rakeAmount: "10.00", winners: 1, note: "Before the break" };
const SECOND: HighHandSettings = { id: "hh2", name: "Second half", position: 2, entryFee: "5.00", rakeType: "none", rakeAmount: "0.00", winners: 2, note: null };

const game = (overrides: Partial<PrizePoolInput> = {}): PrizePoolInput => ({
  buyInAmount: "50.00",
  rakeType: "none",
  payoutStructure: "standard",
  maxPlayers: 40,
  highHands: [FIRST, SECOND],
  ...overrides,
});

/** A legacy game: the one high hand in the tournament's columns. */
const legacyGame = (overrides: Partial<PrizePoolInput> = {}): PrizePoolInput => ({
  buyInAmount: "50.00",
  rakeType: "none",
  payoutStructure: "standard",
  maxPlayers: 40,
  enableHighHand: true,
  highHandAmount: "10.00",
  highHandRakeType: "fixed",
  highHandRakeAmount: "4.00",
  highHandPayouts: 2,
  ...overrides,
});

type Entry = EntryInput & { id: string };
const paid = (id: string, extra: Partial<Entry> = {}): Entry => ({ id, buyIns: 1, paymentConfirmed: true, ...extra });
const unpaid = (id: string, extra: Partial<Entry> = {}): Entry => ({ id, buyIns: 1, paymentConfirmed: false, ...extra });
const win = (highHandId: string, amountCents: Cents, awardedAt = "2026-11-18T09:00:00.000Z", splitWithRegistrationId: string | null = null): HighHandWinInput => ({
  highHandId,
  amountCents,
  awardedAt,
  splitWithRegistrationId,
});

describe("a tournament's high hands", () => {
  it("are its listed ones in order, whatever order they arrive in, and none once every one is removed", () => {
    const listed = game({ highHands: [{ ...SECOND, position: 2 }, { ...FIRST, position: 1 }] });
    expect(listsHighHands(listed)).toBe(true);
    expect(highHandsOf(listed).map((highHand) => highHand.id)).toEqual(["hh1", "hh2"]);
    // A position missing (a form's draft) sorts last, ties keep their order.
    expect(highHandsOf(game({ highHands: [{ ...FIRST, position: null }, { ...SECOND, position: 1 }, { ...FIRST, id: "hh3", position: 1 }] })).map((h) => h.id)).toEqual(["hh2", "hh3", "hh1"]);
    expect(highHandsOf(game({ highHands: [] }))).toEqual([]);
    expect(offersHighHands(game({ highHands: [] }))).toBe(false);
  });

  it("are the legacy columns as ONE high hand with today's settings when it lists none", () => {
    const legacy = legacyGame();
    expect(listsHighHands(legacy)).toBe(false);
    expect(highHandsOf(legacy)).toEqual([
      { id: LEGACY_HIGH_HAND_ID, name: DEFAULT_HIGH_HAND_NAME, position: 1, entryFee: "10.00", rakeType: "fixed", rakeAmount: "4.00", winners: 2, note: null },
    ]);
    expect(legacyHighHand({ enableHighHand: true, highHandAmount: "5.00" })).toMatchObject({ rakeType: "none", winners: undefined });
    expect(findHighHand(legacy, LEGACY_HIGH_HAND_ID)?.entryFee).toBe("10.00");
    expect(findHighHand(legacy, "hh1")).toBeUndefined();
  });

  it("include no legacy high hand that is switched off or has no price (P3REV5-CQ-02)", () => {
    for (const columns of [{ enableHighHand: false }, { highHandAmount: "0.00" }, { highHandAmount: null }, { enableHighHand: null }]) {
      expect(highHandsOf(legacyGame(columns))).toEqual([]);
      expect(offersHighHand(legacyGame(columns))).toBe(false);
    }
    expect(offersHighHand(legacyGame())).toBe(true);
  });

  it("are offered by any list, a form's included (its new high hands have no id yet)", () => {
    expect(offersHighHand({ enableHighHand: false, highHands: [{ name: "First half" }] })).toBe(true);
    expect(offersHighHand({ enableHighHand: true, highHandAmount: "10.00", highHands: [] })).toBe(false);
  });

  it("are named as the activity feed and the award button say them", () => {
    expect(highHandLabel("First half")).toBe("First half high hand");
    expect(highHandLabel(" High hand 2 ")).toBe("High hand 2");
    expect(highHandLabel("Mega high-hand")).toBe("Mega high-hand");
    expect(highHandLabel(DEFAULT_HIGH_HAND_NAME)).toBe("High hand");
  });
});

describe("which high hands an entry is in and has won", () => {
  it("reads the legacy flags for a legacy game, only while it offers its high hand", () => {
    expect(highHandIdsOf(legacyGame(), { enteringHighHands: true })).toEqual([LEGACY_HIGH_HAND_ID]);
    expect(highHandIdsOf(legacyGame(), { enteringHighHands: false, highHandIds: ["hh1"] })).toEqual([]);
    expect(highHandIdsOf(legacyGame({ enableHighHand: false }), { enteringHighHands: true })).toEqual([]);
    expect(highHandWinsOf(legacyGame(), { highHandWinner: true, highHandAmount: "36.00" })).toEqual([
      { highHandId: LEGACY_HIGH_HAND_ID, amountCents: 3_600, splitWithRegistrationId: null, awardedAt: null },
    ]);
    expect(highHandWinsOf(legacyGame(), { highHandWinner: false, highHandAmount: "36.00" })).toEqual([]);
    expect(highHandWinsOf(legacyGame({ highHandAmount: null }), { highHandWinner: true, highHandAmount: "36.00" })).toEqual([]);
  });

  it("reads the listed choices for a listed game, in its order, ignoring the legacy flags and high hands it does not run", () => {
    expect(highHandIdsOf(game(), { enteringHighHands: true, highHandIds: ["hh2", "gone", "hh1"] })).toEqual(["hh1", "hh2"]);
    expect(highHandIdsOf(game(), { enteringHighHands: true })).toEqual([]);
    const wins = [win("hh2", 500, "2026-11-18T10:00:00.000Z"), win("gone", 100), win("hh1", 450, "2026-11-18T08:00:00.000Z")];
    expect(highHandWinsOf(game(), { highHandWinner: true, highHandAmount: "99.00", highHandWins: wins }).map((w) => w.highHandId)).toEqual(["hh1", "hh2"]);
    expect(highHandWinsOf(game(), { highHandWinner: true, highHandAmount: "99.00" })).toEqual([]);
  });
});

describe("what an entry owes for its high hands (paid at the door)", () => {
  it("is the fees of the ones it chose: one $5 high hand, not the $10 for both", () => {
    expect(highHandFeesCents(game(), ["hh2"])).toBe(500);
    expect(highHandFeesCents(game(), ["hh1", "hh2", "hh1", "gone"])).toBe(1_000);
    expect(allHighHandsFeeCents(game())).toBe(1_000);
    expect(allHighHandsFeeCents(legacyGame())).toBe(1_000);
    expect(allHighHandsFeeCents(game({ highHands: [] }))).toBe(0);
    expect(highHandsAtDoor(game(), { highHandIds: ["hh2"] })).toEqual([{ highHandId: "hh2", name: "Second half", feeCents: 500 }]);
    expect(highHandsAtDoor(legacyGame(), { enteringHighHands: true })).toEqual([{ highHandId: LEGACY_HIGH_HAND_ID, name: "High hand", feeCents: 1_000 }]);
  });

  it("is added to the buy-in, re-buys and add-ons in amountDueCents, as the legacy fee always was", () => {
    const t = game({ rebuyAmount: "40.00" });
    expect(amountDueCents(t, { buyIns: 1, rebuys: 1, highHandIds: ["hh2"] })).toBe(5_000 + 4_000 + 500);
    expect(amountDueCents(t, { buyIns: 1, highHandIds: ["hh1", "hh2"] })).toBe(6_000);
    // A free entry owes nothing for its buy-in, but pays for its high hands (round 7).
    expect(amountDueCents(t, { buyIns: 1, freeEntry: true, highHandIds: ["hh1"] })).toBe(500);
    // The legacy flag means nothing in a listed game.
    expect(amountDueCents(t, { buyIns: 1, enteringHighHands: true })).toBe(5_000);
    expect(amountDueCents(legacyGame(), { buyIns: 1, enteringHighHands: true })).toBe(6_000);
  });
});

describe("each pot", () => {
  it("takes its own AP: a percentage of the pot, one flat amount, or none", () => {
    expect(highHandRakeCents({ rakeType: "percentage", rakeAmount: "12.5" }, 4_000)).toBe(500);
    expect(highHandRakeCents({ rakeType: "fixed", rakeAmount: "4.00" }, 4_000)).toBe(400);
    expect(highHandRakeCents({ rakeType: "fixed", rakeAmount: "4.00" }, 0)).toBe(400);
    expect(highHandRakeCents({ rakeType: "none", rakeAmount: "4.00" }, 4_000)).toBe(0);
    expect(highHandRakeCents({ rakeType: "other", rakeAmount: "4.00" }, 4_000)).toBe(0);
    expect(highHandPot({ ...FIRST, winners: 0 }, 3)).toEqual({ highHandId: "hh1", name: "First half", position: 1, feeCents: 500, entrants: 3, gross: 1_500, rake: 150, net: 1_350, winners: 1 });
  });

  it("holds the paid entrants of that high hand only, the waiting list and the unpaid left out", () => {
    const entries = [
      paid("ann", { highHandIds: ["hh1", "hh2"] }),
      paid("bea", { highHandIds: ["hh2"] }),
      paid("cy", { highHandIds: ["hh2"], freeEntry: true }),
      unpaid("dee", { highHandIds: ["hh1", "hh2"] }),
      paid("eve"),
    ];
    const pool = computePrizePool(game(), entries);
    expect(pool.highHands).toEqual([
      { highHandId: "hh1", name: "First half", position: 1, feeCents: 500, entrants: 1, gross: 500, rake: 50, net: 450, winners: 1 },
      { highHandId: "hh2", name: "Second half", position: 2, feeCents: 500, entrants: 3, gross: 1_500, rake: 0, net: 1_500, winners: 2 },
    ]);
    // The screens' one figure: everyone in any pot, the pots added together.
    expect(pool.highHand).toEqual({ entrants: 3, gross: 2_000, rake: 50, net: 1_950, winners: 3 });
    expect(pool.counts.highHandEntrants).toBe(3);
    // No high-hand money is ever in the prize pool: three paid buy-ins (the free entry's brings nothing in).
    expect(pool.gross.total).toBe(3 * 5_000);
    // Behind a full field nobody counts until accepted.
    const full = computePrizePool(game({ maxPlayers: 2 }), [paid("ann", { highHandIds: ["hh1"] }), paid("bea"), unpaid("zed", { highHandIds: ["hh1"] })]);
    expect(full.highHands[0].entrants).toBe(1);
    expect(combinedHighHand([], 0)).toEqual({ entrants: 0, gross: 0, rake: 0, net: 0, winners: 1 });
  });

  it("counts a row of totals as the registrations it stands for", () => {
    expect(highHandPots(game(), [{ highHandIds: ["hh1"], registrationCount: 4 }])[0].entrants).toBe(4);
  });

  it("is named, with what each pot drops, when a payment is taken back (the Fix menu)", () => {
    const entries = [paid("ann", { highHandIds: ["hh1", "hh2"] }), paid("bea", { highHandIds: ["hh2"] })];
    expect(paymentDropCents(game(), entries, "ann")).toMatchObject({
      highHandCents: 450 + 500,
      highHands: [
        { highHandId: "hh1", name: "First half", cents: 450 },
        { highHandId: "hh2", name: "Second half", cents: 500 },
      ],
    });
    expect(paymentDropCents(game(), entries, "bea").highHands).toEqual([{ highHandId: "hh2", name: "Second half", cents: 500 }]);
  });
});

describe("awards, one pot at a time", () => {
  const registrations: Entry[] = [
    paid("ann", { highHandIds: ["hh1", "hh2"], highHandWins: [win("hh2", 750, "2026-11-18T10:00:00.000Z")] }),
    paid("bea", { highHandIds: ["hh1", "hh2"], highHandWins: [win("hh1", 900, "2026-11-18T08:00:00.000Z")] }),
    paid("cy", { highHandIds: ["hh2"], highHandWins: [win("hh2", 250, "2026-11-18T09:00:00.000Z")] }),
  ];

  it("are listed pot by pot, in award order", () => {
    const awards = highHandAwardsOf(game(), registrations);
    expect(awards.map((award) => [award.highHandId, award.registrationId])).toEqual([
      ["hh1", "bea"],
      ["hh2", "cy"],
      ["hh2", "ann"],
    ]);
    expect(awardedCentsOf(awards, "hh2")).toEqual([250, 750]);
    expect(highHandAwardsOf(legacyGame(), [paid("ann", { highHandWinner: true, highHandAmount: "18.00" }), paid("bea")])).toEqual([
      { highHandId: LEGACY_HIGH_HAND_ID, registrationId: "ann", amountCents: 1_800, splitWithRegistrationId: null, awardedAt: null },
    ]);
  });

  it("each pot's standing: the next award, what no award pays and whether the awards fit", () => {
    const pool = computePrizePool(game(), registrations);
    const [first, second] = highHandStandings(pool.highHands, highHandAwardsOf(game(), registrations));
    // First half: 2 paid entrants × $5 less 10% = $9, one prize, awarded $9.
    expect(first).toMatchObject({ awardedCents: 900, nextAwardCents: null, unawardedCents: 0, problem: null });
    // Second half: 3 × $5 = $15, two prizes awarded $2.50 and $7.50.
    expect(second).toMatchObject({ awardedCents: 1_000, nextAwardCents: null, unawardedCents: 500, problem: { code: "HIGH_HAND_AWARDED", awardedCents: 1_000, potCents: 1_500 } });
    expect(second.awards).toHaveLength(2);
  });

  it("checks only the pots a change moved: a pot left as it was is never refused for its awards", () => {
    const awards = highHandAwardsOf(game(), registrations);
    const before = computePrizePool(game(), registrations).highHands;
    const lessInFirst = computePrizePool(game(), registrations.map((r) => (r.id === "ann" ? { ...r, highHandIds: ["hh2"] } : r))).highHands;
    expect(potsAwardsProblem(before, lessInFirst, awards)).toEqual({ code: "HIGH_HAND_OVER_POOL", awardedCents: 900, potCents: 450, highHandId: "hh1", name: "First half" });
    // The second pot does not fit either, but nothing about it changed.
    expect(potsAwardsProblem(before, before, awards)).toBeNull();
    // A new pot is always checked.
    expect(potsAwardsProblem([], [highHandPot(SECOND, 0)], awards)).toMatchObject({ code: "HIGH_HAND_OVER_POOL", highHandId: "hh2" });
  });

  it("follow the legacy rules for each pot: the next award, a tie, the remainder to the last winner", () => {
    const pot = highHandPot({ ...SECOND, winners: 3 }, 7);
    const first = nextHighHandAward(pot, []) as number;
    const secondAward = nextHighHandAward(pot, [first]) as number;
    const third = nextHighHandAward(pot, [first, secondAward]) as number;
    expect(first + secondAward + third).toBe(pot.net);
    expect(splitHighHandAward(1_001)).toEqual({ shareCents: 500, keepCents: 501 });
  });
});

describe("choosing high hands", () => {
  it("reads a choice against the tournament's high hands: duplicates dropped, its order, unknown ids apart", () => {
    expect(readHighHandChoice(game(), ["hh2", "hh1", "hh2", "nope"])).toEqual({ ids: ["hh1", "hh2"], unknown: ["nope"] });
    expect(readHighHandChoice(legacyGame(), [LEGACY_HIGH_HAND_ID])).toEqual({ ids: [LEGACY_HIGH_HAND_ID], unknown: [] });
    expect(readHighHandChoice(legacyGame({ enableHighHand: false }), [LEGACY_HIGH_HAND_ID])).toEqual({ ids: [], unknown: [LEGACY_HIGH_HAND_ID] });
  });

  it("takes highHandIds when sent, else the legacy flag as all of them or none, else leaves the choice as it is", () => {
    expect(chosenHighHandIds(game(), { highHandIds: ["hh2"], enteringHighHands: true })).toEqual(["hh2"]);
    expect(chosenHighHandIds(game(), { enteringHighHands: true })).toEqual(["hh1", "hh2"]);
    expect(chosenHighHandIds(game(), { enteringHighHands: false })).toEqual([]);
    expect(chosenHighHandIds(legacyGame(), { enteringHighHands: true })).toEqual([LEGACY_HIGH_HAND_ID]);
    expect(chosenHighHandIds(game(), {})).toBeUndefined();
    expect(chosenHighHandIds(game(), { highHandIds: null, enteringHighHands: null })).toBeUndefined();
  });

  it("says what a change joins and leaves, and which of those left the entry has won", () => {
    const entry = { highHandIds: ["hh1"], highHandWins: [win("hh1", 450)] };
    expect(highHandChoiceChange(game(), entry, ["hh2"])).toEqual({ joined: ["hh2"], left: ["hh1"], leftWon: ["hh1"] });
    expect(highHandChoiceChange(game(), entry, ["hh1", "hh2"])).toEqual({ joined: ["hh2"], left: [], leftWon: [] });
    expect(highHandChoiceChange(legacyGame(), { enteringHighHands: true }, [])).toEqual({ joined: [], left: [LEGACY_HIGH_HAND_ID], leftWon: [] });
  });

  it("counts each high hand's entries", () => {
    expect(highHandEntrantCounts(game(), [{ highHandIds: ["hh1", "hh2"] }, { highHandIds: ["hh2"] }, {}])).toEqual(new Map([["hh1", 1], ["hh2", 2]]));
  });
});

describe("the legacy columns kept as the list's summary", () => {
  it("say whether the tournament runs any high hand, at what entering every one costs", () => {
    expect(tournamentHighHandSummary([FIRST, SECOND])).toEqual({ enableHighHand: true, highHandAmount: "10.00" });
    expect(tournamentHighHandSummary([])).toEqual({ enableHighHand: false, highHandAmount: null });
    // So a reader of the legacy columns alone still offers the high hand.
    expect(offersHighHand({ ...tournamentHighHandSummary([FIRST]), highHands: undefined })).toBe(true);
  });

  it("say whether an entry is in any, has won any, and for how much in all", () => {
    expect(registrationHighHandSummary(["hh1", "hh2"], [{ amountCents: 450 }, { amountCents: 750 }])).toEqual({ enteringHighHands: true, highHandWinner: true, highHandAmount: "12.00" });
    expect(registrationHighHandSummary([], [])).toEqual({ enteringHighHands: false, highHandWinner: false, highHandAmount: null });
  });
});

describe("planHighHandsChange: staff setting the list", () => {
  const legacyResent = { id: LEGACY_HIGH_HAND_ID, name: "High hand", entryFee: "10.00", rakeType: "fixed", rakeAmount: "4.00", winners: 2, note: null };

  it("leaves a legacy game as it is when its high hand comes back unchanged, or none comes back while it has none", () => {
    expect(planHighHandsChange(legacyGame(), [legacyResent])).toEqual({ kind: "unchanged" });
    expect(planHighHandsChange(legacyGame(), [{ ...legacyResent, rakeAmount: "4", note: "  " }])).toEqual({ kind: "unchanged" });
    expect(planHighHandsChange(legacyGame({ enableHighHand: false }), [])).toEqual({ kind: "unchanged" });
  });

  it("turns a legacy game's high hand off by the legacy rule when the list comes back empty", () => {
    expect(planHighHandsChange(legacyGame(), [])).toEqual({ kind: "legacy_off" });
  });

  it("starts listing when a legacy game's list really changes, taking its high hand in (or leaving it out)", () => {
    expect(planHighHandsChange(legacyGame(), [{ ...legacyResent, name: "First half", entryFee: "5" }, { name: "Second half", entryFee: "5.00" }])).toEqual({
      kind: "list",
      create: [
        { name: "First half", position: 1, entryFee: "5.00", rakeType: "fixed", rakeAmount: "4.00", winners: 2, note: null, adoptsLegacy: true, takesLegacyEntrants: false },
        { name: "Second half", position: 2, entryFee: "5.00", rakeType: "none", rakeAmount: "0.00", winners: 1, note: null, adoptsLegacy: false, takesLegacyEntrants: false },
      ],
      update: [],
      remove: [],
      removesLegacy: false,
    });
    expect(planHighHandsChange(legacyGame(), twoHighHandsPreset("5"))).toMatchObject({ kind: "list", removesLegacy: true, create: [{ adoptsLegacy: false }, { adoptsLegacy: false }] });
    // A game with no high hand yet simply starts its list.
    expect(planHighHandsChange(legacyGame({ enableHighHand: false }), [{ name: "High hand", entryFee: "10" }])).toMatchObject({ kind: "list", removesLegacy: false });
  });

  it("refuses an id that is not one of the tournament's high hands, or one named twice", () => {
    expect(planHighHandsChange(legacyGame(), [{ id: "hh1", name: "x", entryFee: "5" }])).toEqual({ kind: "unknown", id: "hh1" });
    expect(planHighHandsChange(legacyGame({ enableHighHand: false }), [legacyResent])).toEqual({ kind: "unknown", id: LEGACY_HIGH_HAND_ID });
    expect(planHighHandsChange(game(), [legacyResent])).toEqual({ kind: "unknown", id: LEGACY_HIGH_HAND_ID });
    expect(planHighHandsChange(game(), [FIRST, { ...FIRST, name: "Again" }])).toEqual({ kind: "unknown", id: "hh1" });
  });

  it("creates, updates (a reorder included) and removes listed high hands, and writes nothing for the list resent", () => {
    expect(planHighHandsChange(game(), [FIRST, SECOND])).toEqual({ kind: "unchanged" });
    expect(planHighHandsChange(game(), [SECOND, { ...FIRST, rakeType: "none" }, { name: "Late", entryFee: "2", winners: 1 }])).toEqual({
      kind: "list",
      create: [{ name: "Late", position: 3, entryFee: "2.00", rakeType: "none", rakeAmount: "0.00", winners: 1, note: null, adoptsLegacy: false, takesLegacyEntrants: false }],
      update: [
        { id: "hh2", name: "Second half", position: 1, entryFee: "5.00", rakeType: "none", rakeAmount: "0.00", winners: 2, note: null },
        { id: "hh1", name: "First half", position: 2, entryFee: "5.00", rakeType: "none", rakeAmount: "0.00", winners: 1, note: "Before the break" },
      ],
      remove: [],
      removesLegacy: false,
    });
    expect(planHighHandsChange(game(), [FIRST])).toEqual({ kind: "list", create: [], update: [], remove: ["hh2"], removesLegacy: false });
    expect(planHighHandsChange(game(), [])).toEqual({ kind: "list", create: [], update: [], remove: ["hh1", "hh2"], removesLegacy: false });
  });

  it("gives the form's helper two half-game high hands", () => {
    expect(twoHighHandsPreset(5)).toEqual([
      { name: "First half", entryFee: "5.00", rakeType: "none", rakeAmount: "0.00", winners: 1, note: "Before the break" },
      { name: "Second half", entryFee: "5.00", rakeType: "none", rakeAmount: "0.00", winners: 1, note: "After the break" },
    ]);
  });

  it("asks before re-pricing a high hand with entries recorded in it, paid or not", () => {
    const recorded = [unpaid("ann", { highHandIds: ["hh1"] }), paid("bea", { highHandIds: ["hh1", "hh2"] })];
    expect(repricedHighHands(game(), [{ id: "hh1", entryFee: "6.00" }, { id: "hh2", entryFee: "5.00" }], recorded)).toEqual([
      { highHandId: "hh1", name: "First half", count: 2, fromCents: 500, toCents: 600 },
    ]);
    // Removed, or with nobody in it: nothing to re-price.
    expect(repricedHighHands(game(), [{ id: "hh2", entryFee: "9.00" }], [paid("ann", { highHandIds: ["hh1"] })])).toEqual([]);
    expect(repricedHighHands(legacyGame(), [{ id: LEGACY_HIGH_HAND_ID, entryFee: "5.00" }], [paid("ann", { enteringHighHands: true })])).toEqual([
      { highHandId: LEGACY_HIGH_HAND_ID, name: "High hand", count: 1, fromCents: 1_000, toCents: 500 },
    ]);
  });

  it("prices the legacy high hand's entries by every high hand they will be in once it is listed, naming them (R10REV1-MONEY-02)", () => {
    const recorded = [paid("ann", { enteringHighHands: true }), unpaid("bea", { enteringHighHands: true })];
    const halves = (legacyEntrants: boolean) => [
      { id: LEGACY_HIGH_HAND_ID, name: "First half", entryFee: "5.00" },
      { name: "Second half", entryFee: "5.00", legacyEntrants },
    ];

    // Their $10 entry covered both halves: in both, they owe what they did.
    expect(repricedHighHands(legacyGame(), halves(true), recorded)).toEqual([]);
    expect(repricedHighHands(legacyGame(), halves(false), recorded)).toEqual([
      { highHandId: LEGACY_HIGH_HAND_ID, name: "High hand", count: 2, fromCents: 1_000, toCents: 500, nowIn: ["First half"], notIn: ["Second half"] },
    ]);
    expect(repricedHighHands(legacyGame(), [halves(true)[0], { name: "Second half", entryFee: "6.00", legacyEntrants: true }], recorded)).toEqual([
      { highHandId: LEGACY_HIGH_HAND_ID, name: "High hand", count: 2, fromCents: 1_000, toCents: 1_100, nowIn: ["First half", "Second half"], notIn: [] },
    ]);
    // A tournament already listing its high hands has no legacy entries to carry.
    expect(repricedHighHands(game(), [{ id: "hh1", entryFee: "5.00" }, { name: "Late", entryFee: "5.00", legacyEntrants: true }], recorded)).toEqual([]);
  });
});

describe("planHighHandsChange: the legacy high hand's players entered in a new one too (R10REV1-MONEY-02)", () => {
  it("marks a new high hand to take them in only as the legacy one is taken into the list", () => {
    const halves = [
      { id: LEGACY_HIGH_HAND_ID, name: "First half", entryFee: "5.00", legacyEntrants: true },
      { name: "Second half", entryFee: "5.00", legacyEntrants: true },
      { name: "Late", entryFee: "2.00" },
    ];
    expect(planHighHandsChange(legacyGame(), halves)).toMatchObject({
      kind: "list",
      create: [
        { name: "First half", adoptsLegacy: true, takesLegacyEntrants: false },
        { name: "Second half", adoptsLegacy: false, takesLegacyEntrants: true },
        { name: "Late", adoptsLegacy: false, takesLegacyEntrants: false },
      ],
    });
    // Left out, the legacy high hand has no players to give.
    expect(planHighHandsChange(legacyGame(), halves.slice(1))).toMatchObject({ kind: "list", create: [{ takesLegacyEntrants: false }, { takesLegacyEntrants: false }] });
    expect(planHighHandsChange(game(), [FIRST, SECOND, { name: "Late", entryFee: "2.00", legacyEntrants: true }])).toMatchObject({ create: [{ takesLegacyEntrants: false }] });
  });
});

describe("highHandsPhrase", () => {
  it("names one or several high hands in a sentence", () => {
    expect(highHandsPhrase(["First half"])).toBe("the First half high hand");
    expect(highHandsPhrase(["First half", "Second half "])).toBe("the First half and Second half high hands");
    expect(highHandsPhrase(["High hand 1", "Late", "High hand 3"])).toBe("the High hand 1, Late high hand and High hand 3");
  });
});

describe("adoptLegacyHighHand", () => {
  it("copies the legacy high hand's entrants and awards as the columns hold them, a winner who never ticked it included", () => {
    const registrations = [
      paid("ann", { enteringHighHands: true, highHandWinner: true, highHandAmount: "16.00" }),
      unpaid("bea", { enteringHighHands: true }),
      paid("cy", { highHandWinner: true, highHandAmount: "0.50" }),
      paid("dee"),
    ];
    expect(adoptLegacyHighHand(legacyGame(), registrations)).toEqual({
      entrantIds: ["ann", "bea"],
      awards: [
        { registrationId: "ann", amountCents: 1_600 },
        { registrationId: "cy", amountCents: 50 },
      ],
    });
    expect(adoptLegacyHighHand(legacyGame({ enableHighHand: false }), registrations)).toBeNull();
    expect(adoptLegacyHighHand(game(), registrations)).toBeNull();
  });
});

describe("the finalize snapshot", () => {
  it("records each pot with what it awarded, players named", () => {
    const standings = highHandStandings([highHandPot(FIRST, 2)], [{ highHandId: "hh1", registrationId: "ann", amountCents: 900, splitWithRegistrationId: null, awardedAt: null }]);
    expect(snapshotHighHands(standings, (id) => id.toUpperCase())).toEqual([
      {
        highHandId: "hh1",
        name: "First half",
        feeCents: 500,
        entrants: 2,
        grossCents: 1_000,
        rakeCents: 100,
        netCents: 900,
        winners: 1,
        awards: [{ registrationId: "ann", playerName: "ANN", amountCents: 900, splitWithRegistrationId: null }],
      },
    ]);
  });

  it("is written by finalize when the tournament runs a high hand, and left out when it runs none", () => {
    const registrations: FinalizeRegistrationInput[] = [
      { id: "r1", playerId: "p1", buyIns: 1, paymentConfirmed: true, highHandIds: ["hh2"], highHandWins: [win("hh2", 500)] },
      { id: "r2", playerId: "p2", buyIns: 1, paymentConfirmed: true, isEliminated: true, eliminationTime: "2026-11-18T09:00:00.000Z" },
    ];
    const plan = (highHands: HighHandSettings[]) =>
      buildFinalizePlan({
        tournament: { buyInAmount: "50.00", rakeType: "none", payoutStructure: "standard", maxPlayers: 40, highHands },
        registrations,
        pointsSystem: null,
        allocations: [],
        playerNames: new Map([["p1", "Tama Rangi"], ["p2", "Ana"]]),
        finalizedAt: "2026-11-18T11:00:00.000Z",
        rakeLabel: "AP",
      });
    const listed = plan([FIRST, SECOND]);
    expect(listed.ok && listed.snapshot.highHands?.map((pot) => [pot.highHandId, pot.netCents, pot.awards.map((a) => a.playerName)])).toEqual([
      ["hh1", 0, []],
      ["hh2", 500, ["Tama Rangi"]],
    ]);
    const none = plan([]);
    expect(none.ok && "highHands" in none.snapshot).toBe(false);
  });
});

/* ------------------------------------------------------------------------------------------------
 * Properties
 * ---------------------------------------------------------------------------------------------- */

const money = (maxCents: number) => fc.integer({ min: 0, max: maxCents }).map((cents) => (cents / 100).toFixed(2));
const rakeRule = fc.oneof(
  fc.record({ rakeType: fc.constant("none"), rakeAmount: fc.constant("0.00") }),
  fc.record({ rakeType: fc.constant("percentage"), rakeAmount: fc.integer({ min: 0, max: 10_000 }).map((bp) => (bp / 100).toFixed(2)) }),
  fc.record({ rakeType: fc.constant("fixed"), rakeAmount: money(5_000) }),
);

/** An entry's payment status, in every form the pool reads (paid, unpaid, a free entry funded or not, no status at all). */
const payment = fc.oneof(
  fc.constant({ paymentConfirmed: true }),
  fc.constant({ paymentConfirmed: false }),
  fc.constant({ paymentConfirmed: null }),
  fc.constant({ paymentConfirmed: true, freeEntry: true }),
  fc.constant({ paymentConfirmed: true, freeEntry: true, freeEntryFunded: true }),
);

const legacyTournament = fc.record({
  buyInAmount: money(20_000),
  rebuyAmount: fc.option(money(10_000)),
  addonAmount: fc.option(money(10_000)),
  rakeType: fc.constant("none"),
  payoutStructure: fc.constant("standard"),
  maxPlayers: fc.integer({ min: 2, max: 30 }),
  enableHighHand: fc.constant(true),
  highHandAmount: fc.integer({ min: 1, max: 10_000 }).map((cents) => (cents / 100).toFixed(2)),
  highHandRakeType: fc.constantFrom("none", "percentage", "fixed", null),
  highHandRakeAmount: fc.oneof(money(10_000), fc.constant(null)),
  highHandPayouts: fc.option(fc.integer({ min: 0, max: 4 })),
});

const legacyEntries = fc.array(
  fc.record({
    buyIns: fc.integer({ min: 0, max: 3 }),
    rebuys: fc.integer({ min: 0, max: 3 }),
    addons: fc.integer({ min: 0, max: 2 }),
    enteringHighHands: fc.option(fc.boolean()),
    highHandWinner: fc.boolean(),
    highHandAmount: fc.option(money(20_000)),
    payment,
  }),
  { maxLength: 24 },
).map((rows) => rows.map(({ payment: status, ...row }, i) => ({ id: `r${i}`, registrationTime: `2026-11-18T08:${String(i).padStart(2, "0")}:00.000Z`, ...row, ...status })));

/** Today's high-hand pot (before round 10), worked out independently in integer cents from the columns. */
function todaysPot(t: PrizePoolInput, entrants: number) {
  const gross = entrants * toCents(t.highHandAmount);
  const rake =
    t.highHandRakeType === "percentage"
      ? Math.round((gross * toBasisPoints(t.highHandRakeAmount)) / 10_000)
      : t.highHandRakeType === "fixed"
        ? toCents(t.highHandRakeAmount)
        : 0;
  return { entrants, gross, rake, net: gross - rake, winners: t.highHandPayouts && t.highHandPayouts > 0 ? t.highHandPayouts : 1 };
}

/** Today's amount owed (before round 10), worked out independently. */
const todaysDue = (t: PrizePoolInput, e: EntryInput) =>
  (e.freeEntry === true ? 0 : toCents(t.buyInAmount) * (e.buyIns ?? 0)) +
  toCents(t.rebuyAmount) * (e.rebuys ?? 0) +
  toCents(t.addonAmount) * (e.addons ?? 0) +
  (e.enteringHighHands ? toCents(t.highHandAmount) : 0);

describe("legacy parity (fast-check): a legacy game's single pot is today's figures to the cent", () => {
  it("one pot, the legacy high hand, with today's entrants, gross, AP, net and prizes; today's amount owed; today's awards", () => {
    fc.assert(
      fc.property(legacyTournament, legacyEntries, (t, entries) => {
        const pool = computePrizePool(t, entries);
        expect(pool.highHands).toHaveLength(1);
        const [pot] = pool.highHands;
        const { highHandId, name, position, feeCents, ...figures } = pot;
        expect({ highHandId, name, position, feeCents }).toEqual({ highHandId: LEGACY_HIGH_HAND_ID, name: "High hand", position: 1, feeCents: toCents(t.highHandAmount) });
        // The new pot, the legacy figure every screen showed, and an independent sum all agree.
        expect(figures).toEqual(pool.highHand);
        const accepted = entries.filter((e) => e.paymentConfirmed === true && e.enteringHighHands);
        // With nobody on the waiting list accepted, every accepted entrant is in the field.
        expect(figures).toEqual(todaysPot(t, accepted.length));
        for (const entry of entries) expect(amountDueCents(t, entry)).toBe(todaysDue(t, entry));
        const awards = highHandAwardsOf(t, entries);
        expect(awards.map((a) => [a.registrationId, a.amountCents])).toEqual(entries.filter((e) => e.highHandWinner).map((e) => [e.id, toCents(e.highHandAmount)]));
        const [standing] = highHandStandings(pool.highHands, awards);
        expect(standing.nextAwardCents).toBe(nextHighHandAward(pool.highHand, awardedCentsOf(awards, LEGACY_HIGH_HAND_ID)));
      }),
    );
  });

  it("a legacy game whose high hand is off has no pot, and its legacy figure and amounts owed are as they were", () => {
    fc.assert(
      fc.property(legacyTournament, legacyEntries, fc.constantFrom({ enableHighHand: false }, { highHandAmount: "0.00" }), (t, entries, off) => {
        const switchedOff = { ...t, ...off };
        const pool = computePrizePool(switchedOff, entries);
        expect(pool.highHands).toEqual([]);
        expect(pool.highHand).toEqual(todaysPot(switchedOff, pool.counts.highHandEntrants));
        for (const entry of entries) expect(amountDueCents(switchedOff, entry)).toBe(todaysDue(switchedOff, entry));
      }),
    );
  });

  it("taking the legacy high hand into a list moves no money: the same pot, awards and amounts owed", () => {
    fc.assert(
      fc.property(legacyTournament, legacyEntries, (t, entries) => {
        const adopted = adoptLegacyHighHand(t, entries);
        expect(adopted).not.toBeNull();
        const plan = planHighHandsChange(t, [{ ...legacyHighHand(t), name: "First half" }]);
        expect(plan.kind).toBe("list");
        const row = plan.kind === "list" ? { ...plan.create[0], id: "row1" } : null;
        const listed: PrizePoolInput = { ...t, highHands: row ? [row] : [] };
        const entrants = new Set(adopted?.entrantIds);
        const awardsOf = new Map(adopted?.awards.map((award) => [award.registrationId, award.amountCents]));
        const moved = entries.map((entry) => ({
          ...entry,
          highHandIds: entrants.has(entry.id) ? ["row1"] : [],
          highHandWins: awardsOf.has(entry.id) ? [win("row1", awardsOf.get(entry.id) as Cents, entry.registrationTime)] : [],
        }));
        const before = computePrizePool(t, entries).highHands[0];
        const after = computePrizePool(listed, moved).highHands[0];
        expect({ ...after, highHandId: before.highHandId, name: before.name }).toEqual(before);
        for (let i = 0; i < entries.length; i++) expect(amountDueCents(listed, moved[i])).toBe(amountDueCents(t, entries[i]));
        expect(awardedCentsOf(highHandAwardsOf(listed, moved), "row1")).toEqual(awardedCentsOf(highHandAwardsOf(t, entries), LEGACY_HIGH_HAND_ID));
      }),
    );
  });
});

const listedHighHands = fc
  .array(
    fc.record({
      entryFee: fc.integer({ min: 1, max: 5_000 }).map((cents) => (cents / 100).toFixed(2)),
      rule: rakeRule,
      winners: fc.integer({ min: 1, max: 4 }),
    }),
    { minLength: 1, maxLength: 6 },
  )
  .map((list) => list.map(({ entryFee, rule, winners }, i): HighHandSettings => ({ id: `hh${i}`, name: `High hand ${i + 1}`, position: i + 1, entryFee, ...rule, winners, note: null })));

const listedGame = listedHighHands.chain((highHands) =>
  fc.record({
    tournament: fc.record({ buyInAmount: money(20_000), rebuyAmount: fc.option(money(5_000)), maxPlayers: fc.constant(100) }).map(
      (t): PrizePoolInput => ({ ...t, rakeType: "none", payoutStructure: "standard", highHands }),
    ),
    entries: fc
      .array(fc.record({ buyIns: fc.integer({ min: 0, max: 2 }), rebuys: fc.integer({ min: 0, max: 2 }), chosen: fc.subarray(highHands.map((h) => h.id)), payment }), { maxLength: 30 })
      .map((rows) => rows.map(({ chosen, payment: status, ...row }, i): Entry => ({ id: `r${i}`, ...row, highHandIds: chosen, enteringHighHands: chosen.length > 0, ...status }))),
  }),
);

describe("several pots (fast-check)", () => {
  it("each pot is its paid entrants' fees less its own AP; the pots hold every paid entrant's fees, and nothing else", () => {
    fc.assert(
      fc.property(listedGame, ({ tournament, entries }) => {
        const pool = computePrizePool(tournament, entries);
        const accepted = entries.filter((e) => e.paymentConfirmed === true);
        const highHands = highHandsOf(tournament);
        expect(pool.highHands.map((pot) => pot.highHandId)).toEqual(highHands.map((h) => h.id));
        pool.highHands.forEach((pot, i) => {
          const entrants = accepted.filter((e) => e.highHandIds?.includes(pot.highHandId)).length;
          expect(pot.entrants).toBe(entrants);
          expect(pot.gross).toBe(entrants * toCents(highHands[i].entryFee));
          expect(pot.rake).toBe(highHandRakeCents(highHands[i], pot.gross));
          expect(pot.net).toBe(pot.gross - pot.rake);
        });
        const fees = accepted.reduce((sum, e) => sum + highHandFeesCents(tournament, e.highHandIds ?? []), 0);
        expect(pool.highHands.reduce((sum, pot) => sum + pot.gross, 0)).toBe(fees);
        expect(pool.highHand.gross).toBe(fees);
        // High-hand money is never in the prize pool.
        expect(pool.gross.total).toBe(computePrizePool({ ...tournament, highHands: [] }, entries).gross.total);
      }),
    );
  });

  it("an entry owes its buy-ins and re-buys plus the fees of the high hands it chose; choosing every one costs the 'All high hands' price", () => {
    fc.assert(
      fc.property(listedGame, ({ tournament, entries }) => {
        for (const entry of entries) {
          const main = amountDueCents({ ...tournament, highHands: [] }, entry);
          expect(amountDueCents(tournament, entry)).toBe(main + highHandsAtDoor(tournament, entry).reduce((sum, h) => sum + h.feeCents, 0));
          expect(amountDueCents(tournament, { ...entry, highHandIds: highHandsOf(tournament).map((h) => h.id) })).toBe(main + allHighHandsFeeCents(tournament));
        }
      }),
    );
  });

  it("an unpaid entry never moves a pot, whatever it chose", () => {
    fc.assert(
      fc.property(listedGame, ({ tournament, entries }) => {
        const withUnpaid = [...entries, unpaid("late", { highHandIds: highHandsOf(tournament).map((h) => h.id) })];
        expect(computePrizePool(tournament, withUnpaid).highHands).toEqual(computePrizePool(tournament, entries).highHands);
      }),
    );
  });

  it("awarding each pot's prizes in turn pays out exactly that pot, whatever the other pots hold", () => {
    fc.assert(
      fc.property(listedGame, ({ tournament, entries }) => {
        for (const pot of computePrizePool(tournament, entries).highHands) {
          const awarded: Cents[] = [];
          for (let next = nextHighHandAward(pot, awarded); next !== null; next = nextHighHandAward(pot, awarded)) awarded.push(next);
          expect(awarded).toHaveLength(pot.winners);
          expect(awarded.reduce((sum, amount) => sum + amount, 0)).toBe(Math.max(pot.net, 0));
          expect(highHandStandings([pot], awarded.map((amountCents, i) => ({ highHandId: pot.highHandId, registrationId: `w${i}`, amountCents, splitWithRegistrationId: null, awardedAt: null })))[0]).toMatchObject({
            nextAwardCents: null,
            unawardedCents: 0,
            problem: null,
          });
        }
      }),
    );
  });
});
