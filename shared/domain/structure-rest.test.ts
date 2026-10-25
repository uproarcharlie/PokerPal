import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { generateStructure, presetStructure } from "./blind-structures";
import { INITIAL_CLOCK_STATE, rebaseOnStructureChange, structureProblems, type BlindLevel, type ClockStructure, type PlayLevel } from "./clock";
import { reshapeRest, restDefaults, restOfStructureProblems, type RestOfStructureInput } from "./structure-rest";

/** Central Stars · One Life Line: L1–L6 at 20 min, b1 "Last re-buys / add-ons", L7–L12, b2 "Colour up", L13–L18, b3, L19–L24; BB ante from L4. */
const centralStars = () => presetStructure("central_stars_one_life_line");
const indexOf = (structure: ClockStructure, id: string) => structure.levels.findIndex((level) => level.id === id);
const plays = (levels: readonly BlindLevel[]) => levels.filter((level): level is PlayLevel => level.kind === "level");
const shape = (levels: readonly BlindLevel[]) => levels.map((level) => (level.kind === "level" ? `${level.bigBlind}` : `break${level.durationMinutes}`));

const input = (fromIndex: number, overrides: Partial<RestOfStructureInput> = {}): RestOfStructureInput => ({
  fromIndex,
  levelMinutes: null,
  blinds: { kind: "keep" },
  anteFromLevel: null,
  breaks: { kind: "keep" },
  ...overrides,
});

describe("reshapeRest: played levels are never touched", () => {
  it("keeps every row up to and including the clock's, ids and all", () => {
    const structure = centralStars();
    const from = indexOf(structure, "l8");
    const changed = reshapeRest(structure, input(from, { levelMinutes: 12, blinds: { kind: "regenerate", growth: { kind: "multiplier", factor: 1.5 }, levelCount: 6, smallestChip: null } }));
    expect(changed.levels.slice(0, from + 1)).toEqual(structure.levels.slice(0, from + 1));
    expect({ ...changed, levels: [] }).toEqual({ ...structure, levels: [] });
    // The clock stays on its level: the edit can be saved over a running clock.
    expect(rebaseOnStructureChange(structure.levels, changed.levels, { ...INITIAL_CLOCK_STATE, status: "paused", currentLevelIndex: from, pausedRemainingMs: 60_000, startedAt: 1 }, 10)).toMatchObject({
      ok: true,
      state: { currentLevelIndex: from, pausedRemainingMs: 60_000 },
    });
  });
});

describe("reshapeRest: level length", () => {
  it("sets every later level's length, leaving the breaks and blinds as they are", () => {
    const structure = centralStars();
    const from = indexOf(structure, "l8");
    const changed = reshapeRest(structure, input(from, { levelMinutes: 12 }));
    expect(changed.levels).toHaveLength(structure.levels.length);
    changed.levels.forEach((level, i) => {
      const before = structure.levels[i];
      if (i <= from || level.kind === "break") expect(level).toEqual(before);
      else expect(level).toEqual({ ...before, durationMinutes: 12 });
    });
  });

  it("is the same structure with nothing to change", () => {
    const structure = centralStars();
    expect(reshapeRest(structure, input(3))).toEqual(structure);
  });
});

describe("reshapeRest: regenerating the blinds", () => {
  it("grows from the current level's blinds by the multiplier, on the generator's nice ladder, antes following the mode", () => {
    const structure = centralStars();
    const from = indexOf(structure, "l8");
    const changed = reshapeRest(structure, input(from, { blinds: { kind: "regenerate", growth: { kind: "multiplier", factor: 1.5 }, levelCount: 6, smallestChip: null } }));
    const later = plays(changed.levels.slice(from + 1));
    expect(later.map((level) => level.bigBlind)).toEqual([4000, 6000, 8000, 12_000, 16_000, 24_000]);
    for (const level of later) {
      expect(level.smallBlind).toBe(level.bigBlind / 2);
      expect(level.ante).toBe(level.bigBlind);
      expect(level.durationMinutes).toBe(15);
    }
    // Kept breaks stay after the same level numbers (b2 after level 12); b3 (after level 18) is past the new last level.
    expect(shape(changed.levels.slice(from + 1))).toEqual(["4000", "6000", "8000", "12000", "break10", "16000", "24000"]);
    expect(changed.levels.find((level) => level.kind === "break" && level.id === "b2")).toEqual(structure.levels.find((level) => level.id === "b2"));
    expect(structureProblems(changed.levels)).toEqual([]);
  });

  it("grows by a fixed step, with new ids no row has", () => {
    const structure = centralStars();
    const from = indexOf(structure, "l8");
    const changed = reshapeRest(structure, input(from, { blinds: { kind: "regenerate", growth: { kind: "step", bigBlindStep: 1000 }, levelCount: 3, smallestChip: null }, breaks: { kind: "none" }, levelMinutes: 10 }));
    expect(plays(changed.levels.slice(from + 1)).map((level) => [level.smallBlind, level.bigBlind, level.durationMinutes])).toEqual([
      [2000, 4000, 10],
      [2500, 5000, 10],
      [3000, 6000, 10],
    ]);
    const ids = changed.levels.map((level) => level.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never gives a new row the id of a row it replaces, so a save made stale by the clock moving on is refused (R5REV1-CLK-01)", () => {
    const structure = centralStars();
    const from = indexOf(structure, "l8");
    const changed = reshapeRest(structure, input(from, { blinds: { kind: "regenerate", growth: { kind: "multiplier", factor: 2 }, levelCount: 4, smallestChip: null }, breaks: { kind: "none" } }));
    const before = new Set(structure.levels.map((level) => level.id));
    expect(changed.levels.slice(from + 1).filter((level) => before.has(level.id))).toEqual([]);
    // The sheet was drawn on level 8; the clock reached level 9 before the save landed.
    const onNext = { ...INITIAL_CLOCK_STATE, status: "paused" as const, currentLevelIndex: indexOf(structure, "l9"), pausedRemainingMs: 60_000, startedAt: 1 };
    expect(rebaseOnStructureChange(structure.levels, changed.levels, onNext, 10)).toEqual({ ok: false, problem: "CURRENT_LEVEL_REMOVED" });
  });

  it("grows from the last level played when the clock is on a break", () => {
    const structure = centralStars();
    const from = indexOf(structure, "b1");
    const changed = reshapeRest(structure, input(from, { blinds: { kind: "regenerate", growth: { kind: "multiplier", factor: 2 }, levelCount: 2, smallestChip: null }, breaks: { kind: "every", everyLevels: 6, minutes: 10, notes: [] } }));
    expect(shape(changed.levels.slice(from + 1))).toEqual(["3000", "6000"]);
  });

  it("puts antes on the levels from the number chosen, and none before it", () => {
    const structure = centralStars();
    const from = indexOf(structure, "l8");
    const changed = reshapeRest(structure, input(from, { anteFromLevel: 11 }));
    const later = plays(changed.levels.slice(from + 1));
    expect(later.map((level) => level.ante > 0)).toEqual([false, false, ...Array<boolean>(later.length - 2).fill(true)]);
    expect(later[2].ante).toBe(later[2].bigBlind);
  });

  it("keeps a structure without antes without them", () => {
    const structure = { ...centralStars(), anteMode: "none" as const };
    const changed = reshapeRest(structure, input(8, { anteFromLevel: 1, blinds: { kind: "regenerate", growth: { kind: "multiplier", factor: 1.5 }, levelCount: 2, smallestChip: null } }));
    expect(plays(changed.levels.slice(9)).map((level) => level.ante)).toEqual([0, 0]);
  });

  it("antes everyone about a tenth of the big blind in that mode", () => {
    const structure = { ...centralStars(), anteMode: "everyone" as const };
    const changed = reshapeRest(structure, input(8, { blinds: { kind: "regenerate", growth: { kind: "multiplier", factor: 1.5 }, levelCount: 2, smallestChip: null } }));
    expect(plays(changed.levels.slice(9)).map((level) => level.ante)).toEqual([400, 600]);
  });
});

describe("reshapeRest: the breaks still to come", () => {
  it("removes them", () => {
    const structure = centralStars();
    const from = indexOf(structure, "l8");
    const changed = reshapeRest(structure, input(from, { breaks: { kind: "none" } }));
    expect(changed.levels.slice(from + 1).every((level) => level.kind === "level")).toBe(true);
    expect(plays(changed.levels)).toEqual(plays(structure.levels));
    expect(changed.levels.slice(0, from + 1).some((level) => level.kind === "break")).toBe(true);
  });

  it("re-spaces them every N levels, counted from level 1, notes in order, never after the last level", () => {
    const structure = centralStars();
    const from = indexOf(structure, "l8");
    const changed = reshapeRest(structure, input(from, { breaks: { kind: "every", everyLevels: 4, minutes: 12, notes: [" Colour up ", ""] } }));
    const later = changed.levels.slice(from + 1);
    // A break straight after the current level 8, then after 12, 16 and 20; none after 24.
    expect(later.map((level) => (level.kind === "break" ? `B${level.durationMinutes}:${level.note}` : "L")).join(" ")).toBe(
      "B12:Colour up L L L L B12:null L L L L B12:null L L L L B12:null L L L L",
    );
    const ids = changed.levels.map((level) => level.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("restOfStructureProblems", () => {
  const structure = centralStars();
  const regenerate = (growth: { kind: "multiplier"; factor: number } | { kind: "step"; bigBlindStep: number }, levelCount = 6) => ({
    blinds: { kind: "regenerate" as const, growth, levelCount, smallestChip: null },
  });

  it.each([
    [input(-1), "fromIndex", "The clock's level is not in this structure"],
    [input(27), "fromIndex", "The clock's level is not in this structure"],
    [input(8, { levelMinutes: 0 }), "levelMinutes", "Levels last 1 to 240 minutes"],
    [input(8, { breaks: { kind: "every", everyLevels: 0, minutes: 10, notes: [] } }), "breaks", "Breaks can come every 1 to 20 levels"],
    [input(8, { breaks: { kind: "every", everyLevels: 4, minutes: 121, notes: [] } }), "breaks", "Breaks last 1 to 120 minutes"],
    [input(8, { breaks: { kind: "every", everyLevels: 4, minutes: 10, notes: ["x".repeat(81)] } }), "breaks", "Break notes are at most 80 characters"],
    [input(8, { anteFromLevel: 0 }), "anteFromLevel", "The antes must start at a level number"],
    [input(8, regenerate({ kind: "multiplier", factor: 1.01 })), "growth", "Choose an increase between ×1.05 and ×3"],
    [input(8, regenerate({ kind: "step", bigBlindStep: 150 })), "growth", "The step must be a whole number of two smallest chips (so each small blind is exact)"],
    [input(8, regenerate({ kind: "multiplier", factor: 3 }, 30)), "growth", "The blinds would pass 100,000,000: use fewer levels or a smaller increase"],
    [input(8, regenerate({ kind: "multiplier", factor: 1.5 }, 0)), "levelCount", "Choose between 1 and 60 levels"],
    [input(8, { blinds: { kind: "regenerate", growth: { kind: "multiplier", factor: 1.5 }, levelCount: 6, smallestChip: 0 } }), "smallestChip", "Enter the smallest chip in play"],
  ])("refuses %j", (bad, path, message) => {
    expect(restOfStructureProblems(structure, bad)).toEqual([{ path: [path], message }]);
    expect(() => reshapeRest(structure, bad)).toThrow(RangeError);
  });

  it("needs a level played to grow from", () => {
    const opening: ClockStructure = { ...structure, levels: [{ kind: "break", id: "b0", durationMinutes: 10, note: "Seat draw" }, ...structure.levels] };
    expect(restOfStructureProblems(opening, input(0, regenerate({ kind: "multiplier", factor: 1.5 })))).toEqual([
      { path: ["blinds"], message: "No blind level has been reached yet: edit the structure instead" },
    ]);
    expect(restOfStructureProblems(opening, input(0, { breaks: { kind: "every", everyLevels: 4, minutes: 10, notes: [] } }))).toEqual([]);
  });

  it("refuses a structure over 100 rows", () => {
    expect(restOfStructureProblems(structure, input(8, { ...regenerate({ kind: "step", bigBlindStep: 200 }, 60), breaks: { kind: "every", everyLevels: 1, minutes: 5, notes: [] } }))).toEqual([
      { path: [], message: "A structure can have at most 100 levels and breaks" },
    ]);
  });

  it("accepts every regenerated rest of a generated structure, which then passes the editor's own checks", () => {
    const generated = generateStructure({
      startingStack: 20_000,
      smallBlind: 100,
      bigBlind: 200,
      growth: { kind: "multiplier", factor: 1.4 },
      levelCount: 20,
      levelMinutes: 15,
      laterLevels: null,
      breaks: { everyLevels: 5, minutes: 10, notes: [] },
      ante: { mode: "bb_ante", fromLevel: 5 },
      smallestChip: null,
      rebuyStack: null,
      addonStack: null,
      earlyBirdStack: null,
    });
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: generated.levels.length - 1 }),
        fc.double({ min: 1.05, max: 2, noNaN: true }),
        fc.integer({ min: 1, max: 20 }),
        fc.option(fc.integer({ min: 1, max: 6 }), { nil: null }),
        (from, factor, levelCount, every) => {
          const shaped = input(from, {
            blinds: { kind: "regenerate", growth: { kind: "multiplier", factor }, levelCount, smallestChip: null },
            breaks: every === null ? { kind: "keep" } : { kind: "every", everyLevels: every, minutes: 10, notes: [] },
          });
          fc.pre(restOfStructureProblems(generated, shaped).length === 0);
          const changed = reshapeRest(generated, shaped);
          expect(structureProblems(changed.levels)).toEqual([]);
          expect(changed.levels.slice(0, from + 1)).toEqual(generated.levels.slice(0, from + 1));
          const blinds = plays(changed.levels).map((level) => level.bigBlind);
          for (let i = 1; i < blinds.length; i++) if (i >= plays(generated.levels.slice(0, from + 1)).length) expect(blinds[i]).toBeGreaterThan(blinds[i - 1]);
          expect(changed.levels[changed.levels.length - 1].kind === "break" && changed.levels.length - 1 > from).toBe(false);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("restDefaults", () => {
  it("starts the editor from the later levels as they are", () => {
    const structure = centralStars();
    const defaults = restDefaults(structure, indexOf(structure, "l8"));
    expect(defaults).toMatchObject({ levelMinutes: 15, levelCount: 16, smallestChip: 100, breaks: { kind: "keep" } });
    expect(defaults.growth).toEqual({ kind: "multiplier", factor: 1.25 });
    expect(restDefaults(structure, structure.levels.length - 1)).toMatchObject({ levelCount: 1, breaks: { kind: "none" }, levelMinutes: 15 });
  });
});
