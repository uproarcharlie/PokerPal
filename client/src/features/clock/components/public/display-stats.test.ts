import { describe, expect, it } from "vitest";
import { liveDisplayDto } from "@test/helpers/clock-dto";
import { clockDto } from "@test/helpers/clock-dto";
import { displayTiles } from "./display-stats";

const settings = clockDto().displaySettings;

describe("displayTiles: the high hand pots (round 10)", () => {
  it("adds each high hand's pot by name after the other figures, what its winners share and nothing else", () => {
    const display = liveDisplayDto({
      money: {
        highHands: [
          { id: "hh1", name: "First half", potCents: 4_500 },
          { id: "hh2", name: "High hand 2", potCents: 3_000 },
        ],
      },
    });

    const tiles = displayTiles(display, null, settings);

    expect(tiles.slice(-2)).toEqual([
      { label: "First half high hand", value: "$45" },
      { label: "High hand 2", value: "$30" },
    ]);
  });

  it("adds none while the TD shows no high hand pots (the server sends none)", () => {
    const labels = displayTiles(liveDisplayDto({ money: { highHands: null } }), null, settings).map((tile) => tile.label);
    expect(labels.some((label) => /high hand/i.test(label))).toBe(false);
  });
});
