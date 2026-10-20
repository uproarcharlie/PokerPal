import { describe, expect, it } from "vitest";
import { cropFractions } from "./crop-dialog";

describe("cropFractions", () => {
  it("turns the cropper's percentages into the fractions the upload takes, kept inside the picture", () => {
    expect(cropFractions({ x: 25, y: 10, width: 50, height: 80 })).toEqual({ x: 0.25, y: 0.1, width: 0.5, height: 0.8 });
    expect(cropFractions({ x: -2, y: 60, width: 104, height: 50 })).toEqual({ x: 0, y: 0.6, width: 1, height: 0.4 });
  });
});
