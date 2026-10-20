import { describe, expect, it } from "vitest";
import { positionRange } from "./format";

describe("positions", () => {
  it("names one position, or a range", () => {
    expect(positionRange(1, null)).toBe("1st");
    expect(positionRange(4, 10)).toBe("4th–10th");
    expect(positionRange(3, 3)).toBe("3rd");
  });
});
