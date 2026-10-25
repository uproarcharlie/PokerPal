import { describe, expect, it } from "vitest";
import { presetStructure } from "@shared/domain/blind-structures";
import type { ClockStructure, PlayLevel } from "@shared/domain/clock";
import { shortStructure } from "@test/helpers/clock-dto";
import { baseLevelOf, readRest, restChanged, restPreview, restValues, type RestFormValues } from "./rest-form";

/** Central Stars · One Life Line: L1–L6, b1 "Last re-buys / add-ons", L7–L12, b2, L13–L18, b3, L19–L24; BB ante from L4. */
const centralStars = () => presetStructure("central_stars_one_life_line");
const indexOf = (structure: ClockStructure, id: string) => structure.levels.findIndex((level) => level.id === id);
const plays = (structure: ClockStructure, from: number) => structure.levels.slice(from + 1).filter((level): level is PlayLevel => level.kind === "level");

const read = (structure: ClockStructure, from: number, change: (values: RestFormValues) => void) => {
  const values = restValues(structure, from);
  change(values);
  return readRest(structure, from, values);
};

describe("the rest-of-structure sheet's values", () => {
  it("start from the structure as it is, changing nothing", () => {
    const structure = centralStars();
    const from = indexOf(structure, "l8");
    const values = restValues(structure, from);
    expect(values.length.change).toBe(false);
    expect(values.blinds.mode).toBe("keep");
    expect(values.breaks.mode).toBe("keep");
    // The step defaults to the current big blind; the antes from the next level.
    expect(baseLevelOf(structure, from)).toMatchObject({ number: 8 });
    expect(values.antes.fromLevel).toBe("9");
    // Re-spacing the breaks keeps the notes of those still to come.
    expect(values.breaks.notes).toBe("Colour up\n");
    const result = readRest(structure, from, values);
    expect(result.ok && restChanged(structure, result.structure)).toBe(false);
  });

  it("offer the usual increases as one tap and anything else as Custom", () => {
    const structure = shortStructure();
    // 1,000 over 800 is ×1.25, one of the chips.
    expect(restValues(structure, 0).blinds.factor).toBe("1.25");
    const custom = { ...structure, levels: [...structure.levels.slice(0, 4), { kind: "level" as const, id: "l9", durationMinutes: 15, smallBlind: 700, bigBlind: 1400, ante: 0 }] };
    expect(restValues(custom, 0).blinds.factor).toBe("1.75");
  });

  it("set every later level's length, played levels and this one untouched", () => {
    const structure = centralStars();
    const from = indexOf(structure, "l8");
    const result = read(structure, from, (values) => {
      values.length = { change: true, minutes: "12" };
    });
    if (!result.ok) throw new Error("refused");
    expect(result.structure.levels.slice(0, from + 1)).toEqual(structure.levels.slice(0, from + 1));
    expect(plays(result.structure, from).every((level) => level.durationMinutes === 12)).toBe(true);
    expect(restChanged(structure, result.structure)).toBe(true);
  });

  it("regenerate the later blinds by a multiplier or a step, breaks every N levels with their notes", () => {
    const structure = centralStars();
    const from = indexOf(structure, "l8");
    const multiplied = read(structure, from, (values) => {
      values.blinds = { ...values.blinds, mode: "regenerate", growth: "multiplier", factor: "1.5", levelCount: "6" };
      values.breaks = { mode: "every", everyLevels: "4", minutes: "15", notes: "Colour up\nDinner" };
    });
    if (!multiplied.ok) throw new Error("refused");
    expect(plays(multiplied.structure, from).map((level) => level.bigBlind)).toEqual([4000, 6000, 8000, 12_000, 16_000, 24_000]);
    const breaks = multiplied.structure.levels.slice(from + 1).filter((level) => level.kind === "break");
    expect(breaks.map((level) => level.kind === "break" && level.note)).toEqual(["Colour up", "Dinner"]);

    const stepped = read(structure, from, (values) => {
      values.blinds = { ...values.blinds, mode: "regenerate", growth: "step", bigBlindStep: "1000", levelCount: "3" };
      values.breaks.mode = "none";
    });
    if (!stepped.ok) throw new Error("refused");
    expect(plays(stepped.structure, from).map((level) => level.bigBlind)).toEqual([4000, 5000, 6000]);
    expect(stepped.structure.levels.slice(from + 1).some((level) => level.kind === "break")).toBe(false);
  });

  it("put the antes on from a level on, in the structure's ante mode", () => {
    const structure = centralStars();
    const from = indexOf(structure, "l2");
    const result = read(structure, from, (values) => {
      values.antes = { mode: "from", fromLevel: "6" };
    });
    if (!result.ok) throw new Error("refused");
    const later = plays(result.structure, from);
    // Levels 3–5 lose theirs; from level 6 a big-blind ante as large as the big blind.
    expect(later.slice(0, 3).every((level) => level.ante === 0)).toBe(true);
    expect(later.slice(3).every((level) => level.ante === level.bigBlind)).toBe(true);
  });

  it("file each problem under its box, and the shared rules' own under theirs", () => {
    const structure = centralStars();
    const from = indexOf(structure, "l8");
    const blank = read(structure, from, (values) => {
      values.length = { change: true, minutes: "" };
      values.blinds = { ...values.blinds, mode: "regenerate", growth: "multiplier", factor: "x" };
    });
    expect(blank.ok ? [] : blank.problems).toEqual([
      { field: "length.minutes", message: "Enter the minutes per level" },
      { field: "blinds.factor", message: "Enter how much the blinds multiply, e.g. 1.5" },
    ]);
    const tooFast = read(structure, from, (values) => {
      values.blinds = { ...values.blinds, mode: "regenerate", growth: "multiplier", factor: "9" };
      values.breaks = { mode: "every", everyLevels: "50", minutes: "15", notes: "" };
    });
    // The breaks' problems are told under the breaks, never matched by their words (R5REV3-CQ-05).
    expect(tooFast.ok ? [] : tooFast.problems).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "blinds.factor" }), { field: "breaks", message: "Breaks can come every 1 to 20 levels" }]),
    );
    const longNote = read(structure, from, (values) => {
      values.breaks = { mode: "every", everyLevels: "4", minutes: "15", notes: "x".repeat(81) };
    });
    expect(longNote.ok ? [] : longNote.problems).toEqual([{ field: "breaks", message: "Break notes are at most 80 characters" }]);
    const oddStep = read(structure, from, (values) => {
      values.blinds = { ...values.blinds, mode: "regenerate", growth: "step", bigBlindStep: "1001" };
    });
    expect(oddStep.ok ? null : oddStep.problems[0]).toEqual({ field: "blinds.bigBlindStep", message: "The step must be a whole number of two smallest chips (so each small blind is exact)" });
  });
});

describe("the rest-of-structure preview", () => {
  it("lists each later level as it will be, beside what it was, and what is no longer played", () => {
    const structure = shortStructure();
    const result = read(structure, 0, (values) => {
      values.length = { change: true, minutes: "15" };
      values.breaks.mode = "none";
    });
    if (!result.ok) throw new Error("refused");
    const preview = restPreview(structure, result.structure, 0);
    expect(preview.rows.map(({ name, now, was }) => [name, now, was])).toEqual([
      ["Level 2", "300/600 · 15 min", "300/600 · 20 min"],
      ["Level 3", "400/800 · BB ante 800 · 15 min", "400/800 · BB ante 800 · 20 min"],
      ["Level 4", "500/1,000 · BB ante 1,000 · 15 min", null],
    ]);
    expect(preview.removed).toEqual(["Break after Level 3"]);
    expect(preview.summary).toBe("3 levels after this one · 45 min to the end");
  });

  it("marks a level that was not there as new, and says when nothing follows", () => {
    const structure = shortStructure();
    const last = structure.levels.length - 1;
    const result = read(structure, last, (values) => {
      values.blinds = { ...values.blinds, mode: "regenerate", growth: "multiplier", factor: "2", levelCount: "2" };
    });
    if (!result.ok) throw new Error("refused");
    const preview = restPreview(structure, result.structure, last);
    expect(preview.rows.map((row) => [row.name, row.was])).toEqual([
      ["Level 5", "new"],
      ["Level 6", "new"],
    ]);
    expect(restPreview(structure, structure, last).summary).toBe("Nothing after this level: it is the last");
  });
});
