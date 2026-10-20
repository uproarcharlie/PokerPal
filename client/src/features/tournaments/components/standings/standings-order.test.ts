import { describe, expect, it } from "vitest";
import { registrationDto } from "@test/helpers/f1-tournaments";
import { playerName, UNKNOWN_PLAYER } from "../../player-name";
import { finishersOf } from "./standings-order";

describe("a sign-up whose player is missing (P3REV6-CQ-04)", () => {
  it("is named the same way in Correct Results as in the standings and the desks", () => {
    const missing = registrationDto("r2", "", 1, { player: null, finalPosition: 1 });
    const ann = registrationDto("r1", "Ann", 1, { finalPosition: 2 });

    expect(finishersOf([ann, missing])).toEqual([
      { registrationId: "r2", playerName: UNKNOWN_PLAYER },
      { registrationId: "r1", playerName: "Ann" },
    ]);
    expect(playerName(missing)).toBe("Unknown player");
    expect(playerName(ann)).toBe("Ann");
  });
});
