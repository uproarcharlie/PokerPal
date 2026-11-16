import { describe, expect, it } from "vitest";
import { createPlayerSchema, sameNameSearch } from "./players";
import { publicPlayerSearchQuerySchema } from "./public";

describe("a sign-up without a phone number (round 7, item 9)", () => {
  it("needs only a name: a blank or missing number is no number", () => {
    expect(createPlayerSchema.parse({ name: " Sam Taylor " })).toEqual({ name: "Sam Taylor" });
    expect(createPlayerSchema.parse({ name: "Sam", phone: "  " })).toEqual({ name: "Sam", phone: null });
    expect(createPlayerSchema.safeParse({ phone: "021 555 0100" }).success).toBe(false);
  });

  it("asks the name search for the players called exactly the name, its spacing tidied (R7FREV1-01)", () => {
    expect(sameNameSearch("  Sam \t  Taylor ")).toEqual({ q: "Sam Taylor", match: "exact", limit: 25 });
    expect(sameNameSearch("   ")).toBeNull();
    // A whole name, however long a name may be.
    const long = `${"a".repeat(59)} ${"b".repeat(40)}`;
    expect(sameNameSearch(long)?.q).toBe(long);
    expect(publicPlayerSearchQuerySchema.safeParse(sameNameSearch(long)).success).toBe(true);
  });

  it("takes a whole name only for an exact search: a search for part of one stays within 60 characters", () => {
    expect(publicPlayerSearchQuerySchema.parse({ q: "sam" })).toEqual({ q: "sam", match: "contains", limit: 10 });
    expect(publicPlayerSearchQuerySchema.safeParse({ q: "x".repeat(61) }).success).toBe(false);
    expect(publicPlayerSearchQuerySchema.safeParse({ q: "x".repeat(61), match: "exact" }).success).toBe(true);
    expect(publicPlayerSearchQuerySchema.safeParse({ q: "x".repeat(101), match: "exact" }).success).toBe(false);
    expect(publicPlayerSearchQuerySchema.safeParse({ q: "sam", match: "starts" }).success).toBe(false);
  });
});
