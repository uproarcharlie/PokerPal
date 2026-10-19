import { describe, expect, it } from "vitest";
import { nextPath, withNext } from "./next-path";

describe("nextPath", () => {
  it("returns a path on this site", () => {
    expect(nextPath("?next=/staff-invite")).toBe("/staff-invite");
    expect(nextPath("?next=%2Fclubs%2Fc1%2Fsettings")).toBe("/clubs/c1/settings");
  });

  it("ignores anything that could leave the site, and an absent parameter", () => {
    for (const search of ["?next=//evil.example", "?next=/\\evil.example", "?next=https://evil.example", "?next=javascript:alert(1)", "", "?other=1"]) {
      expect(nextPath(search)).toBe("/clubs");
    }
  });

  it("carries a valid next over to the other auth page, and only a valid one", () => {
    expect(withNext("/register", "?next=/staff-invite")).toBe("/register?next=%2Fstaff-invite");
    expect(withNext("/register", "?next=//evil.example")).toBe("/register");
  });
});
