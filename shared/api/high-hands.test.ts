import { describe, expect, it } from "vitest";
import { LEGACY_HIGH_HAND_ID, type HighHandSettings } from "../domain/high-hands";
import type { EntryInput } from "../domain/prize-pool";
import { clockDisplaySettingsPatchSchema, DEFAULT_DISPLAY_SETTINGS } from "./clock";
import { highHandAwardCorrectionSchema, highHandAwardSchema, highHandInputSchema, highHandsListSchema, highHandsUpdateSchema } from "./high-hands";
import { toPublicPrizes, type PrizesTournament } from "./live-display";
import { findForbiddenKeys, findTakingsKeys } from "./public";
import { publicRegistrationSchema, staffRegistrationSchema, updateRegistrationSchema } from "./registrations";
import { createTournamentSchema, updateTournamentSchema } from "./tournaments";

const issues = (result: { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } }) =>
  (result.error?.issues ?? []).map((issue) => `${issue.path.join(".")}: ${issue.message}`);

describe("a high hand as staff set it", () => {
  it("takes a name, a fee above $0, an AP rule and its prizes, with the defaults filled in", () => {
    expect(highHandInputSchema.parse({ name: " First half ", entryFee: 5 })).toEqual({ name: "First half", entryFee: "5.00", rakeType: "none", winners: 1 });
    expect(highHandInputSchema.parse({ id: LEGACY_HIGH_HAND_ID, name: "High hand", entryFee: "10", rakeType: "fixed", rakeAmount: "2", winners: 2, note: " Before the break " })).toEqual({
      id: LEGACY_HIGH_HAND_ID,
      name: "High hand",
      entryFee: "10.00",
      rakeType: "fixed",
      rakeAmount: "2.00",
      winners: 2,
      note: "Before the break",
    });
    // A tie may have raised the prizes beyond the forms' 4: the stored count is accepted back.
    expect(highHandInputSchema.parse({ name: "x", entryFee: 1, winners: 20 }).winners).toBe(20);
  });

  it("refuses a blank name, a $0 fee, an AP rate without an amount or over 100%, and prizes out of range", () => {
    expect(issues(highHandInputSchema.safeParse({ name: " ", entryFee: "5" }))).toEqual(["name: Required"]);
    expect(issues(highHandInputSchema.safeParse({ name: "x", entryFee: "0.00" }))).toEqual(["entryFee: Enter a fee above $0"]);
    expect(issues(highHandInputSchema.safeParse({ name: "x", entryFee: "5", rakeType: "percentage" }))).toEqual(["rakeAmount: Enter an amount for that rate"]);
    expect(issues(highHandInputSchema.safeParse({ name: "x", entryFee: "5", rakeType: "fixed", rakeAmount: "" }))).toEqual(["rakeAmount: Enter an amount for that rate"]);
    expect(issues(highHandInputSchema.safeParse({ name: "x", entryFee: "5", rakeType: "percentage", rakeAmount: "100.01" }))).toEqual(["rakeAmount: A percentage cannot be over 100"]);
    expect(highHandInputSchema.safeParse({ name: "x", entryFee: "5", rakeType: "percentage", rakeAmount: "100" }).success).toBe(true);
    for (const winners of [0, 21, 1.5, "2"]) expect(highHandInputSchema.safeParse({ name: "x", entryFee: "5", winners }).success).toBe(false);
    expect(highHandInputSchema.safeParse({ name: "x".repeat(41), entryFee: "5" }).success).toBe(false);
    expect(highHandInputSchema.safeParse({ name: "x", entryFee: "5", note: "n".repeat(121) }).success).toBe(false);
  });
});

describe("the list of high hands", () => {
  it("is in order, each name and id once, at most six", () => {
    expect(highHandsListSchema.parse([])).toEqual([]);
    const two = highHandsListSchema.parse([
      { name: "First half", entryFee: "5" },
      { name: "Second half", entryFee: "5" },
    ]);
    expect(two.map((highHand) => highHand.name)).toEqual(["First half", "Second half"]);
    expect(issues(highHandsListSchema.safeParse([{ name: "First half", entryFee: "5" }, { name: "first HALF ", entryFee: "5" }]))).toEqual([
      "1.name: Two high hands cannot have the same name",
    ]);
    expect(issues(highHandsListSchema.safeParse([{ id: "a", name: "A", entryFee: "5" }, { id: "a", name: "B", entryFee: "5" }]))).toEqual(["1.id: That high hand is in the list twice"]);
    expect(highHandsListSchema.safeParse(Array.from({ length: 7 }, (_, i) => ({ name: `H${i}`, entryFee: "1" }))).success).toBe(false);
  });

  it("is what PUT …/high-hands takes, asking before re-pricing unless told", () => {
    expect(highHandsUpdateSchema.parse({ highHands: [] })).toEqual({ highHands: [], repriceEntries: false });
    expect(highHandsUpdateSchema.parse({ highHands: [], repriceEntries: true, reason: " Two halves tonight " })).toEqual({ highHands: [], repriceEntries: true, reason: "Two halves tonight" });
    expect(highHandsUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("rides along on the tournament form (create and edit), and the form's shape stays a plain object", () => {
    const created = createTournamentSchema.parse({
      name: "Wed night",
      clubId: "c1",
      startDateTime: "2026-11-18T07:00:00.000Z",
      buyInAmount: "50",
      maxPlayers: 40,
      highHands: [{ name: "First half", entryFee: "5" }],
    });
    expect(created.highHands).toEqual([{ name: "First half", entryFee: "5.00", rakeType: "none", winners: 1 }]);
    expect(createTournamentSchema.shape.highHands).toBeDefined();
    expect(updateTournamentSchema.parse({ highHands: [] })).toEqual({ highHands: [] });
  });
});

describe("choosing high hands at sign-up, at the desk and in the Fix menu", () => {
  it("takes the ids chosen, duplicates dropped", () => {
    expect(publicRegistrationSchema.parse({ playerId: "p1", highHandIds: ["hh2", "hh2"] })).toEqual({ playerId: "p1", highHandIds: ["hh2"] });
    expect(staffRegistrationSchema.parse({ playerId: "p1", highHandIds: [LEGACY_HIGH_HAND_ID], paymentConfirmed: true })).toMatchObject({ highHandIds: [LEGACY_HIGH_HAND_ID] });
    expect(updateRegistrationSchema.parse({ highHandIds: [] })).toEqual({ highHandIds: [] });
    expect(publicRegistrationSchema.safeParse({ playerId: "p1", highHandIds: ["bad id"] }).success).toBe(false);
    expect(publicRegistrationSchema.safeParse({ playerId: "p1", highHandIds: Array.from({ length: 13 }, (_, i) => `h${i}`) }).success).toBe(false);
  });

  it("still takes the legacy flag from a page loaded before round 10", () => {
    expect(publicRegistrationSchema.parse({ playerId: "p1", enteringHighHands: true })).toEqual({ playerId: "p1", enteringHighHands: true });
  });
});

describe("awards", () => {
  it("name the winner, and for a tie the earlier winner to split with", () => {
    expect(highHandAwardSchema.parse({ registrationId: "r1" })).toEqual({ registrationId: "r1" });
    expect(highHandAwardSchema.parse({ registrationId: "r1", splitWith: "r2" })).toEqual({ registrationId: "r1", splitWith: "r2" });
    expect(highHandAwardSchema.safeParse({}).success).toBe(false);
  });

  it("are corrected to an amount", () => {
    expect(highHandAwardCorrectionSchema.parse({ amount: 45 })).toEqual({ amount: "45.00" });
    expect(highHandAwardCorrectionSchema.safeParse({ amount: "-1" }).success).toBe(false);
  });
});

describe("the TV's high hands", () => {
  it("are off until the TD switches them on", () => {
    expect(DEFAULT_DISPLAY_SETTINGS.showHighHands).toBe(false);
    expect(clockDisplaySettingsPatchSchema.parse({ showHighHands: true })).toEqual({ showHighHands: true });
  });
});

describe("toPublicPrizes: each high hand's pot as the players see it", () => {
  const FIRST: HighHandSettings = { id: "hh1", name: "First half", position: 1, entryFee: "5.00", rakeType: "percentage", rakeAmount: "20.00", winners: 1, note: "Before the break" };
  const SECOND: HighHandSettings = { id: "hh2", name: "Second half", position: 2, entryFee: "5.00", rakeType: "fixed", rakeAmount: "1.00", winners: 2, note: null };
  const tournament = (overrides: Partial<PrizesTournament> = {}): PrizesTournament => ({
    id: "t1",
    status: "in_progress",
    buyInAmount: "50.00",
    rakeType: "none",
    payoutStructure: "standard",
    prizePoolLocked: false,
    highHands: [FIRST, SECOND],
    ...overrides,
  });
  const entry = (id: string, extra: Partial<EntryInput> = {}): EntryInput & { id: string } => ({ id, buyIns: 1, paymentConfirmed: true, ...extra });

  it("lists every pot by name with what its winners share and its awards: never the AP, the gross or who has paid", () => {
    const entries = [
      entry("r1", { highHandIds: ["hh1", "hh2"], highHandWins: [{ highHandId: "hh1", amountCents: 800, awardedAt: "2026-11-18T09:00:00.000Z" }] }),
      entry("r2", { highHandIds: ["hh2"] }),
      entry("r3", { highHandIds: ["hh1"], paymentConfirmed: false }),
    ];
    const prizes = toPublicPrizes(tournament(), entries);

    expect(prizes.highHands).toEqual([
      { id: "hh1", name: "First half", entryFeeCents: 500, note: "Before the break", potCents: 400, winners: 1, awards: [{ registrationId: "r1", amountCents: 800 }] },
      { id: "hh2", name: "Second half", entryFeeCents: 500, note: null, potCents: 900, winners: 2, awards: [] },
    ]);
    // The one figure older pages show: every pot together.
    expect(prizes.highHandPotCents).toBe(1_300);
    expect(findTakingsKeys(prizes)).toEqual([]);
    expect(findForbiddenKeys(prizes)).toEqual([]);
  });

  it("shows the legacy high hand as one pot, as before, and no pot without a high hand", () => {
    const legacy = tournament({ highHands: null, enableHighHand: true, highHandAmount: "10.00", highHandRakeType: "fixed", highHandRakeAmount: "2.00" });
    const prizes = toPublicPrizes(legacy, [entry("r1", { enteringHighHands: true, highHandWinner: true, highHandAmount: "18.00" }), entry("r2", { enteringHighHands: true })]);
    expect(prizes.highHands).toEqual([{ id: LEGACY_HIGH_HAND_ID, name: "High hand", entryFeeCents: 1_000, note: null, potCents: 1_800, winners: 1, awards: [{ registrationId: "r1", amountCents: 1_800 }] }]);
    expect(prizes.highHandPotCents).toBe(1_800);
    expect(toPublicPrizes(tournament({ highHands: [] }), [entry("r1")]).highHands).toEqual([]);
  });

  it("never shows a pot below zero (a flat AP bigger than what came in)", () => {
    expect(toPublicPrizes(tournament(), []).highHands.map((pot) => pot.potCents)).toEqual([0, 0]);
  });

  it("adds up the one figure from the pots as shown, so an empty pot's flat AP neither lowers it nor shows (R10REV0-PRIV-01)", () => {
    const empty = { ...SECOND, rakeAmount: "4.00" };
    const prizes = toPublicPrizes(tournament({ highHands: [{ ...FIRST, rakeType: "none" }, empty] }), [entry("r1", { highHandIds: ["hh1"] }), entry("r2", { highHandIds: ["hh1"] })]);

    expect(prizes.highHands.map((pot) => pot.potCents)).toEqual([1_000, 0]);
    expect(prizes.highHandPotCents).toBe(1_000);
    expect(toPublicPrizes(tournament({ highHands: [] }), [entry("r1")]).highHandPotCents).toBeNull();
  });
});

describe("the leak scans know the high hands' private keys", () => {
  it("flag a high hand's AP rule and who awarded a prize wherever they appear", () => {
    expect(findTakingsKeys({ highHands: [{ id: "hh1", rakeType: "percentage", rakeAmount: "10.00" }] })).toEqual(["highHands[0].rakeType", "highHands[0].rakeAmount"]);
    expect(findTakingsKeys({ highHands: [{ id: "hh1", rake: 50, gross: 500 }] })).toEqual(["highHands[0].rake", "highHands[0].gross"]);
    expect(findForbiddenKeys({ awards: [{ awardedBy: "u1" }] })).toEqual(["awards[0].awardedBy"]);
  });
});
