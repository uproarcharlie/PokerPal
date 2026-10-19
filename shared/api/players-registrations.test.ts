import { describe, expect, it } from "vitest";
import { createPendingActionSchema } from "./pending-actions";
import { createPlayerSchema, normaliseName, normalisePhone, updatePlayerSchema } from "./players";
import { adjustCountsSchema, publicRegistrationSchema, staffRegistrationSchema, updateRegistrationSchema } from "./registrations";

describe("players", () => {
  it("normalisePhone compares digits, keeping a leading +", () => {
    expect(normalisePhone(" 021 123-4567 ")).toBe("0211234567");
    expect(normalisePhone("(021) 1234567")).toBe("0211234567");
    expect(normalisePhone("+64 21 123 4567")).toBe("+64211234567");
    expect(normalisePhone("n/a")).toBeNull();
    expect(normalisePhone(null)).toBeNull();
  });

  it("normaliseName folds case and spacing", () => {
    expect(normaliseName("  Alice   O'Neil ")).toBe(normaliseName("alice o'neil"));
  });

  it("a public sign-up can never link an account (SEC-04)", () => {
    const parsed = createPlayerSchema.parse({ name: "Al", phone: "021", userId: "u1" });

    expect(parsed).toEqual({ name: "Al", phone: "021" });
  });

  it("an update can remove the photo, which today is silently ignored (img-04)", () => {
    expect(updatePlayerSchema.parse({ imageUrl: null })).toEqual({ imageUrl: null });
    expect(updatePlayerSchema.parse({ email: " " })).toEqual({ email: null });
    expect(updatePlayerSchema.safeParse({}).success).toBe(false);
  });
});

describe("registrations", () => {
  it("a public sign-up keeps only the player and the high-hand choice (SEC-06)", () => {
    const parsed = publicRegistrationSchema.parse({
      playerId: "p1",
      enteringHighHands: true,
      paymentConfirmed: true,
      buyIns: 0,
      prizeAmount: "5000",
      pointsAwarded: 999,
      finalPosition: 1,
      highHandWinner: true,
      tournamentId: "other",
    });

    expect(parsed).toEqual({ playerId: "p1", enteringHighHands: true });
  });

  it("staff may also set the opening counts and payment", () => {
    expect(staffRegistrationSchema.parse({ playerId: "p1", buyIns: 2, rebuys: 1, paymentConfirmed: true })).toEqual({
      playerId: "p1",
      buyIns: 2,
      rebuys: 1,
      paymentConfirmed: true,
    });
    expect(staffRegistrationSchema.safeParse({ playerId: "p1", buyIns: 0 }).success).toBe(false);
  });

  it("reads every count as a JSON whole number: null, blank, a boolean, a list or a string is refused, never 0 or 1 (CQ-P2-01)", () => {
    const loose = [null, "", "  ", true, false, [], [3], "2", 1.5];
    for (const value of loose) {
      for (const field of ["buyIns", "rebuys", "addons"] as const) {
        expect(staffRegistrationSchema.safeParse({ playerId: "p1", [field]: value }).success, `${field} ${JSON.stringify(value)}`).toBe(false);
      }
      for (const field of ["buyIns", "rebuys", "addons", "knockouts"] as const) {
        expect(updateRegistrationSchema.safeParse({ [field]: value }).success, `${field} ${JSON.stringify(value)}`).toBe(false);
      }
      expect(adjustCountsSchema.safeParse({ rebuys: value }).success).toBe(false);
    }
    expect(updateRegistrationSchema.parse({ rebuys: 0 })).toEqual({ rebuys: 0 });
  });

  it("an update never touches finalize's results or moves a registration", () => {
    const parsed = updateRegistrationSchema.parse({
      isEliminated: true,
      eliminationTime: "2020-01-01T00:00:00Z",
      eliminatedBy: "p2",
      finalPosition: 1,
      prizeAmount: "100",
      pointsAwarded: 50,
      tournamentId: "t2",
      playerId: "p9",
    });

    expect(parsed).toEqual({ isEliminated: true, eliminatedBy: "p2" });
  });

  it("refuses negative counts and an empty update", () => {
    expect(updateRegistrationSchema.safeParse({ rebuys: -3 }).success).toBe(false);
    expect(updateRegistrationSchema.safeParse({}).success).toBe(false);
  });

  it("count changes are small whole-number deltas, at least one of them non-zero", () => {
    expect(adjustCountsSchema.parse({ rebuys: 1 })).toEqual({ rebuys: 1 });
    expect(adjustCountsSchema.parse({ knockouts: -1, addons: 0 })).toEqual({ knockouts: -1, addons: 0 });
    for (const bad of [{}, { rebuys: 0 }, { rebuys: 1.5 }, { rebuys: 21 }, { rebuys: "1" }]) {
      expect(adjustCountsSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("pending actions", () => {
  it("re-buys and add-ons have no target; a knockout needs one that is someone else (SEC-05)", () => {
    expect(createPendingActionSchema.parse({ playerId: "p1", actionType: "rebuy" })).toEqual({ playerId: "p1", actionType: "rebuy" });
    expect(createPendingActionSchema.parse({ playerId: "p1", actionType: "knockout", targetPlayerId: "p2" })).toEqual({
      playerId: "p1",
      actionType: "knockout",
      targetPlayerId: "p2",
    });
    const bad = [
      { playerId: "p1", actionType: "knockout" },
      { playerId: "p1", actionType: "knockout", targetPlayerId: "p1" },
      { playerId: "p1", actionType: "addon", targetPlayerId: "p2" },
      { playerId: "p1", actionType: "cashout" },
    ];
    for (const input of bad) expect(createPendingActionSchema.safeParse(input).success).toBe(false);
  });
});
