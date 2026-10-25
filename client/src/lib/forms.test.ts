import { describe, expect, it, vi } from "vitest";
import { createPointsSystemSchema } from "@shared/api/points";
import { createSeasonSchema } from "@shared/api/seasons";
import { ApiError } from "@/lib/api/http";
import { formErrorMap, showServerFieldErrors } from "./forms";

function messages(result: { success: boolean; error?: { issues: Array<{ path: Array<string | number>; message: string }> } }) {
  return Object.fromEntries((result.error?.issues ?? []).map((issue) => [issue.path.join("."), issue.message]));
}

describe("formErrorMap", () => {
  it("words the shared schemas' built-in checks for people", () => {
    const result = createPointsSystemSchema.safeParse(
      { name: "", participationPoints: -1, knockoutPoints: 1.5, allocations: [{ points: 2_000_000 }] },
      { errorMap: formErrorMap },
    );

    expect(messages(result)).toEqual({
      name: "Required",
      participationPoints: "Must be 0 or more",
      knockoutPoints: "Must be a whole number",
      "allocations.0.position": "Required",
      "allocations.0.points": "Must be 1000000 or less",
    });
  });

  it("words a too-long name and a number box holding text the same on every form (P3REV2-CQ-03)", () => {
    const longName = createSeasonSchema.safeParse({ clubId: "c1", name: "x".repeat(101), startDate: "2026-03-01" }, { errorMap: formErrorMap });
    const notANumber = createPointsSystemSchema.safeParse({ name: "Points", participationPoints: Number("lots") }, { errorMap: formErrorMap });

    expect(messages(longName)).toEqual({ name: "Must be 100 characters or fewer" });
    expect(messages(notANumber)).toEqual({ participationPoints: "Must be a whole number" });
  });

  it("calls a blank start date required and a malformed one invalid, keeping the schema's own sentences", () => {
    const blank = createSeasonSchema.safeParse({ clubId: "c1", name: "Spring", startDate: "", endDate: "" }, { errorMap: formErrorMap });
    const reversed = createSeasonSchema.safeParse(
      { clubId: "c1", name: "Spring", startDate: "2026-05-01", endDate: "2026-04-01" },
      { errorMap: formErrorMap },
    );
    const malformed = createSeasonSchema.safeParse({ clubId: "c1", name: "Spring", startDate: "soon" }, { errorMap: formErrorMap });

    expect(messages(blank)).toEqual({ startDate: "Required" });
    expect(messages(reversed)).toEqual({ endDate: "The end date must be on or after the start date" });
    expect(messages(malformed)).toEqual({ startDate: "Enter a valid date" });
  });
});

describe("showServerFieldErrors", () => {
  const validation = new ApiError({
    status: 400,
    code: "VALIDATION",
    error: "Invalid points system data",
    details: [
      { code: "custom", path: ["allocations", 1, "position"], message: "Overlaps another allocation" },
      { code: "custom", path: ["allocations", 7, "position"], message: "Not a row on the form" },
    ],
  });

  it("puts each VALIDATION problem on the field its path names, skipping paths the form does not have", () => {
    const setError = vi.fn();

    expect(showServerFieldErrors(setError, validation, { fields: (name) => /^allocations\.[01]\.(position|points)$/.test(name) })).toBe(true);
    expect(setError).toHaveBeenCalledTimes(1);
    expect(setError).toHaveBeenCalledWith("allocations.1.position", { type: "server", message: "Overlaps another allocation" }, { shouldFocus: true });
  });

  it("puts a nested path on its top-level field when only that is on the form, focusing the first", () => {
    const setError = vi.fn();
    const error = new ApiError({
      status: 400,
      code: "VALIDATION",
      error: "Invalid",
      details: [
        { path: ["phone"], message: "Use a NZ number" },
        { path: ["email", "domain"], message: "Check the email" },
      ],
    });

    expect(showServerFieldErrors(setError, error, { fields: ["phone", "email"] })).toBe(true);
    expect(setError.mock.calls).toEqual([
      ["phone", { type: "server", message: "Use a NZ number" }, { shouldFocus: true }],
      ["email", { type: "server", message: "Check the email" }, { shouldFocus: false }],
    ]);
  });

  it("renames a field the server names otherwise before testing it against the form (R5REV3-CQ-08)", () => {
    const setError = vi.fn();
    const error = new ApiError({
      status: 400,
      code: "VALIDATION",
      error: "Invalid payouts",
      details: [
        { path: ["places", 2], message: "3rd cannot pay more than 2nd" },
        { path: ["reason"], message: "Keep the reason under 200 characters" },
      ],
    });

    const placeBox = (name: string) => (/^places\.\d+$/.test(name) ? `${name}.value` : name);
    expect(showServerFieldErrors(setError, error, { fields: (name) => /^places\.\d+\.value$/.test(name) || name === "reason", rename: placeBox })).toBe(true);
    expect(setError.mock.calls).toEqual([
      ["places.2.value", { type: "server", message: "3rd cannot pay more than 2nd" }, { shouldFocus: true }],
      ["reason", { type: "server", message: "Keep the reason under 200 characters" }, { shouldFocus: false }],
    ]);
  });

  it("puts a refusal on the field its code is about, listing the password rules a WEAK_PASSWORD broke", () => {
    const setError = vi.fn();
    const weak = new ApiError({ status: 400, code: "WEAK_PASSWORD", error: "Weak password", details: ["Use 8 or more characters", "Add a number"] });
    const taken = new ApiError({ status: 409, code: "PHONE_TAKEN", error: "Another player has that phone number" });

    expect(showServerFieldErrors(setError, weak, { fields: ["password"], codes: { WEAK_PASSWORD: "password" } })).toBe(true);
    expect(showServerFieldErrors(setError, taken, { fields: ["phone"], codes: { PHONE_TAKEN: "phone" } })).toBe(true);
    expect(setError.mock.calls).toEqual([
      ["password", { type: "server", message: "Use 8 or more characters. Add a number." }, { shouldFocus: true }],
      ["phone", { type: "server", message: "Another player has that phone number" }, { shouldFocus: true }],
    ]);
  });

  it("puts a refusal whose details name a field on that field", () => {
    const setError = vi.fn();
    const error = new ApiError({ status: 400, code: "PERCENT_OVER_100", error: "A percentage can be at most 100", details: { field: "rakeAmount" } });

    expect(showServerFieldErrors(setError, error, { fields: ["rakeAmount"] })).toBe(true);
    expect(setError).toHaveBeenCalledWith("rakeAmount", { type: "server", message: "A percentage can be at most 100" }, { shouldFocus: true });
  });

  it("leaves anything else to the caller", () => {
    const setError = vi.fn();
    const forbidden = new ApiError({ status: 403, code: "FORBIDDEN", error: "Only the club's staff can do that" });

    expect(showServerFieldErrors(setError, forbidden, { fields: () => true })).toBe(false);
    expect(showServerFieldErrors(setError, new Error("boom"), { fields: () => true })).toBe(false);
    expect(showServerFieldErrors(setError, validation, { fields: ["name"] })).toBe(false);
    expect(setError).not.toHaveBeenCalled();
  });
});
