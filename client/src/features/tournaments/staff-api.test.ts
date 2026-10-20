import { describe, expect, it } from "vitest";
import { previewOf } from "@test/helpers/f1-tournaments";
import { ApiError } from "@/lib/api/http";
import { planChangedPreview, rebuyBeforeEliminationDetails } from "./staff-api";

const refusal = (code: "PLAN_CHANGED" | "REBUY_BEFORE_ELIMINATION" | "CONFLICT", details: unknown) =>
  new ApiError({ status: 409, code, error: "Refused", details });

describe("reading a 409's details (P3REV2-CQ-10)", () => {
  it("takes the new plan from PLAN_CHANGED, and nothing from details that are not one", () => {
    const preview = previewOf({ planHash: "a".repeat(32) });

    expect(planChangedPreview(refusal("PLAN_CHANGED", { preview }))).toEqual(preview);
    expect(planChangedPreview(refusal("PLAN_CHANGED", { preview: { ok: "yes" } }))).toBeUndefined();
    expect(planChangedPreview(refusal("PLAN_CHANGED", null))).toBeUndefined();
    expect(planChangedPreview(refusal("CONFLICT", { preview }))).toBeUndefined();
  });

  it("takes who and when from REBUY_BEFORE_ELIMINATION, missing times as unknown", () => {
    expect(rebuyBeforeEliminationDetails(refusal("REBUY_BEFORE_ELIMINATION", { playerName: "Ann", requestedAt: "2026-10-23T08:00:00.000Z" }))).toEqual({
      playerName: "Ann",
      requestedAt: "2026-10-23T08:00:00.000Z",
      eliminatedAt: null,
    });
    expect(rebuyBeforeEliminationDetails(refusal("REBUY_BEFORE_ELIMINATION", { requestedAt: 5 }))).toBeUndefined();
    expect(rebuyBeforeEliminationDetails(new Error("boom"))).toBeUndefined();
  });
});
