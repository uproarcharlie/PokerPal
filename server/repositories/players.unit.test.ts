import { describe, expect, it } from "vitest";
import { containsPattern } from "./players";

describe("containsPattern", () => {
  it("wraps the text in % and matches LIKE's special characters literally", () => {
    expect(containsPattern("al")).toBe("%al%");
    expect(containsPattern("50%_off\\")).toBe("%50\\%\\_off\\\\%");
  });
});
