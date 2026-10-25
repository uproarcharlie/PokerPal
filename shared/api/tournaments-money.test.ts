import { describe, expect, it } from "vitest";
import { finalizePreviewSchema, finalizeSchema } from "./finalize";
import { prizePoolAdjustmentSchema, rakeRatesSchema } from "./prize-pool";
import { createTournamentSchema, updateTournamentSchema } from "./tournaments";
import { HIGH_HAND_PRIZES_MAX } from "../domain/prize-pool";

/** What today's create-tournament modal sends (create-tournament-modal.tsx), form-only fields included. */
const modalPayload = {
  name: "Friday Freezeout",
  clubId: "club-1",
  startDateTime: "2026-10-23T07:00:00.000Z",
  buyInAmount: 50,
  enableRebuys: false,
  rebuyAmount: null,
  addonAmount: null,
  maxRebuys: null,
  rebuyPeriodMinutes: null,
  rakeType: "percentage",
  rakeAmount: 10,
  rebuyRakeType: "none",
  rebuyRakeAmount: 0,
  addonRakeType: "none",
  addonRakeAmount: 0,
  payoutStructure: "top3",
  enableHighHand: false,
  highHandAmount: null,
  highHandRakeType: "none",
  highHandRakeAmount: 0,
  highHandPayouts: 1,
  minPlayers: 8,
  maxPlayers: 40,
  status: "registration",
  seasonId: null,
  pointsSystemId: null,
  trackPoints: true,
};

describe("createTournamentSchema", () => {
  it("accepts today's modal payload, as column text, without the form-only fields", () => {
    const parsed = createTournamentSchema.parse(modalPayload);

    expect(parsed).toMatchObject({ buyInAmount: "50.00", rakeAmount: "10.00", status: "registration", maxPlayers: 40 });
    expect(parsed).not.toHaveProperty("enableRebuys");
    expect(parsed.startDateTime).toBeInstanceOf(Date);
  });

  it("never accepts money or audit fields that only the AP endpoints and finalize write", () => {
    const parsed = createTournamentSchema.parse({
      ...modalPayload,
      rakeOverride: "1.00",
      manualPrizePool: "9999",
      prizePoolSnapshot: {},
      finalizedAt: "2026-01-01",
      prizePoolLocked: true,
    });

    for (const key of ["rakeOverride", "manualPrizePool", "prizePoolSnapshot", "finalizedAt", "prizePoolLocked"]) {
      expect(parsed).not.toHaveProperty(key);
    }
  });

  it("starts as a draft unless opened, and never in progress or completed", () => {
    const { status: _status, ...withoutStatus } = modalPayload;

    expect(createTournamentSchema.parse(withoutStatus).status).toBe("scheduled");
    expect(createTournamentSchema.safeParse({ ...modalPayload, status: "completed" }).success).toBe(false);
  });

  it("defaults to no rake and Standard payouts, as the columns do", () => {
    const { rakeType: _rake, rakeAmount: _amount, payoutStructure: _payouts, ...bare } = modalPayload;

    expect(createTournamentSchema.parse(bare)).toMatchObject({ rakeType: "none", payoutStructure: "standard" });
  });

  it("leaves the AP rates to mergeRakeRates, the one rule every later change uses (P2REV4-CQ-01)", () => {
    // The create service merges them over "none" and refuses these (test/api/tournaments.api.test.ts).
    expect(createTournamentSchema.parse({ ...modalPayload, rakeAmount: 150 }).rakeAmount).toBe("150.00");
    expect(createTournamentSchema.parse({ ...modalPayload, rebuyRakeType: "none", rebuyRakeAmount: 5 }).rebuyRakeAmount).toBe("5.00");
  });

  it("refuses an invalid custom payout list", () => {
    const custom = createTournamentSchema.safeParse({ ...modalPayload, payoutStructure: "custom", customPayouts: "[60,30]" });

    expect(custom.success).toBe(false);
    expect(createTournamentSchema.parse({ ...modalPayload, payoutStructure: "custom", customPayouts: "[60,40]" }).customPayouts).toBe(
      "[60,40]",
    );
  });
});

describe("updateTournamentSchema", () => {
  it("accepts today's status, lock and manual-pool updates", () => {
    expect(updateTournamentSchema.parse({ status: "in_progress" })).toEqual({ status: "in_progress" });
    expect(updateTournamentSchema.parse({ prizePoolLocked: true })).toEqual({ prizePoolLocked: true });
    expect(updateTournamentSchema.parse({ rakeAmount: "5", keepRakeOverride: true })).toEqual({ rakeAmount: "5.00", keepRakeOverride: true });
    expect(updateTournamentSchema.safeParse({ keepRakeOverride: "yes" }).success).toBe(false);
    expect(updateTournamentSchema.parse({ manualPrizePool: "" })).toEqual({ manualPrizePool: null });
    expect(updateTournamentSchema.parse({ manualPrizePool: "300" })).toEqual({ manualPrizePool: "300.00" });
  });

  it("reads every count as a JSON whole number: a boolean, a list or a string is refused; blank clears a limit (CQ-P2-01)", () => {
    for (const value of [true, false, [], [3], "2", 1.5]) {
      for (const field of ["maxRebuys", "rebuyPeriodMinutes", "minPlayers", "highHandPayouts", "maxPlayers"] as const) {
        expect(updateTournamentSchema.safeParse({ [field]: value }).success, `${field} ${JSON.stringify(value)}`).toBe(false);
      }
    }
    for (const field of ["highHandPayouts", "maxPlayers"] as const) {
      expect(updateTournamentSchema.safeParse({ [field]: null }).success).toBe(false);
      expect(updateTournamentSchema.safeParse({ [field]: "" }).success).toBe(false);
    }
    expect(updateTournamentSchema.parse({ maxRebuys: "", minPlayers: null })).toEqual({ maxRebuys: null, minPlayers: null });
    expect(updateTournamentSchema.parse({ maxRebuys: 0, maxPlayers: 40 })).toEqual({ maxRebuys: 0, maxPlayers: 40 });
  });

  it("accepts as many high-hand prizes as a tie can make, and no more (CQ-P2-04)", () => {
    expect(updateTournamentSchema.parse({ highHandPayouts: HIGH_HAND_PRIZES_MAX })).toEqual({ highHandPayouts: HIGH_HAND_PRIZES_MAX });
    expect(updateTournamentSchema.safeParse({ highHandPayouts: HIGH_HAND_PRIZES_MAX + 1 }).success).toBe(false);
    expect(updateTournamentSchema.safeParse({ highHandPayouts: 0 }).success).toBe(false);
  });

  it("refuses an empty update, and never fills in a default", () => {
    expect(updateTournamentSchema.safeParse({ unknown: 1 }).success).toBe(false);
    expect(updateTournamentSchema.parse({ name: "Renamed" })).toEqual({ name: "Renamed" });
  });
});

describe("prize pool adjustments", () => {
  it("takes one of three modes, amounts as column text, a blank reason as none", () => {
    expect(prizePoolAdjustmentSchema.parse({ mode: "ap_override", amount: 20, reason: " Low turnout " })).toEqual({
      mode: "ap_override",
      amount: "20.00",
      reason: "Low turnout",
    });
    expect(prizePoolAdjustmentSchema.parse({ mode: "calculated", reason: "" })).toEqual({ mode: "calculated" });
    expect(prizePoolAdjustmentSchema.safeParse({ mode: "manual_pool" }).success).toBe(false);
    expect(prizePoolAdjustmentSchema.safeParse({ mode: "ap_override", amount: "-5" }).success).toBe(false);
  });

  it("rate changes need at least one rate, and keep the override only on request", () => {
    expect(rakeRatesSchema.parse({ rakeType: "fixed", rakeAmount: "5" })).toEqual({
      rakeType: "fixed",
      rakeAmount: "5.00",
      keepOverride: false,
    });
    expect(rakeRatesSchema.safeParse({ keepOverride: true }).success).toBe(false);
  });
});

describe("finalize", () => {
  it("takes an optional finish order, plan hash and force", () => {
    expect(finalizeSchema.parse({})).toEqual({});
    expect(finalizeSchema.parse({ finishOrder: ["r2", "r1"], expectedPlanHash: "0".repeat(32), force: true })).toEqual({
      finishOrder: ["r2", "r1"],
      expectedPlanHash: "0".repeat(32),
      force: true,
    });
    expect(finalizeSchema.safeParse({ expectedPlanHash: "abc" }).success).toBe(false);
  });

  it("the preview ignores a plan hash", () => {
    expect(finalizePreviewSchema.parse({ finishOrder: ["r1"], expectedPlanHash: "0".repeat(32) })).toEqual({
      finishOrder: ["r1"],
    });
  });
});
