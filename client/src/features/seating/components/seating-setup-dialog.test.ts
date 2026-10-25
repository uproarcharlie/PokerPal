import { describe, expect, it } from "vitest";
import { defaultTableCount, setupPreview } from "./seating-setup-dialog";

describe("the setup's tables", () => {
  it("starts with the tables the server would open when sent none, re-reading an unset 'start with' at the seats chosen (R5REV3-CQ-12)", () => {
    const unset = { startingTables: null, openTableAt: null };
    // At most 9 players: one 9-seat table takes them all, but at 6 seats the default is 2 tables, as setUpSeating has it.
    expect(defaultTableCount(unset, 9, 9, 4)).toBe(1);
    expect(defaultTableCount(unset, 9, 6, 4)).toBe(2);
    // The TD's own "start with 3" and "open the next table at 6" stay theirs.
    expect(defaultTableCount({ startingTables: 3, openTableAt: null }, 40, 9, 4)).toBe(3);
    expect(defaultTableCount({ startingTables: null, openTableAt: 6 }, 40, 9, 20)).toBe(4);
  });

  it("says how the draw would spread the players, and who would wait", () => {
    expect(setupPreview(13, "6", "2")).toBe("2 tables: 6 / 6 · 1 player waits for a seat");
    expect(setupPreview(0, "9", "2")).toBe("2 tables (nobody to seat yet)");
    expect(setupPreview(5, "1", "2")).toBeNull();
  });
});
