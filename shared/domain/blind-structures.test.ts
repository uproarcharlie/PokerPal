import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  anteFor,
  BLIND_PRESET_KEYS,
  BLIND_PRESETS,
  CENTRAL_STARS_REBUY_BREAK_NOTE,
  defaultSmallestChip,
  everyoneAnte,
  generateStructure,
  generatorProblems,
  isBlindPresetKey,
  nextLevelId,
  nextSmallBlindAbove,
  presetStructure,
  roundSmallBlind,
  suggestNextLevel,
  type StructureGeneratorInput,
} from "./blind-structures";
import { structureProblems, type BlindLevel, type PlayLevel } from "./clock";

const plays = (levels: readonly BlindLevel[]) => levels.filter((level): level is PlayLevel => level.kind === "level");
const blinds = (levels: readonly BlindLevel[]) => plays(levels).map((level) => `${level.smallBlind}/${level.bigBlind}`);

const settings = (overrides: Partial<StructureGeneratorInput> = {}): StructureGeneratorInput => ({
  startingStack: 25_000,
  smallBlind: 100,
  bigBlind: 200,
  growth: { kind: "multiplier", factor: 1.3 },
  levelCount: 10,
  levelMinutes: 15,
  laterLevels: null,
  breaks: null,
  ante: { mode: "none", fromLevel: 1 },
  smallestChip: null,
  rebuyStack: null,
  addonStack: null,
  earlyBirdStack: null,
  ...overrides,
});

describe("chip rounding", () => {
  it("takes the largest usual chip that makes the first blinds", () => {
    expect(defaultSmallestChip(100, 200)).toBe(100);
    expect(defaultSmallestChip(25, 50)).toBe(25);
    expect(defaultSmallestChip(50, 100)).toBe(25);
    expect(defaultSmallestChip(1000, 2000)).toBe(1000);
    expect(defaultSmallestChip(3, 6)).toBe(1);
  });

  it("rounds small blinds to nice amounts the smallest chip makes", () => {
    expect(roundSmallBlind(130, 100)).toBe(100);
    expect(roundSmallBlind(260, 100)).toBe(300);
    expect(roundSmallBlind(150, 100)).toBe(100); // a tie between 100 and 200 takes the smaller
    expect(roundSmallBlind(790, 100)).toBe(800);
    expect(roundSmallBlind(70, 25)).toBe(75);
    expect(roundSmallBlind(1_100, 100)).toBe(1_000);
    expect(roundSmallBlind(7_400, 500)).toBe(7_500);
    expect(roundSmallBlind(3, 7)).toBe(7); // no nice amount: one chip
  });

  it("finds the next nice small blind up", () => {
    expect(nextSmallBlindAbove(100, 100)).toBe(200);
    expect(nextSmallBlindAbove(600, 100)).toBe(800);
    expect(nextSmallBlindAbove(50, 25)).toBe(75);
    expect(nextSmallBlindAbove(50_000_000, 100)).toBe(50_000_000);
  });

  it("sets an ante for everyone at about 10–12.5% of the big blind", () => {
    expect(everyoneAnte(1_000, 100)).toBe(100);
    expect(everyoneAnte(2_000, 100)).toBe(200);
    expect(everyoneAnte(400, 25)).toBe(50);
    expect(everyoneAnte(24_000, 100)).toBe(2_500);
    expect(everyoneAnte(1_200, 100)).toBe(100); // nothing in range: the nearest
    expect(everyoneAnte(50, 100)).toBe(100); // never under one chip
    expect(anteFor("bb_ante", 1_600, 100)).toBe(1_600);
    expect(anteFor("everyone", 1_600, 100)).toBe(200);
    expect(anteFor("none", 1_600, 100)).toBe(0);
  });
});

describe("generateStructure", () => {
  it("builds the usual ladder for 100-chips at ×1.3", () => {
    const structure = generateStructure(settings({ levelCount: 20 }));
    expect(blinds(structure.levels)).toEqual([
      "100/200", "200/400", "300/600", "400/800", "500/1000", "600/1200", "800/1600", "1000/2000", "1200/2400", "1500/3000",
      "2000/4000", "2500/5000", "3000/6000", "4000/8000", "5000/10000", "6000/12000", "8000/16000", "10000/20000", "12000/24000", "15000/30000",
    ]);
    expect(structure).toMatchObject({ anteMode: "none", startingStack: 25_000, rebuyStack: null, addonStack: null, earlyBirdStack: null });
    expect(structureProblems(structure.levels)).toEqual([]);
  });

  it("uses 25-chips for a 25/50 start", () => {
    expect(blinds(generateStructure(settings({ smallBlind: 25, bigBlind: 50, growth: { kind: "multiplier", factor: 1.5 }, levelCount: 8 })).levels)).toEqual([
      "25/50", "50/100", "75/150", "100/200", "150/300", "200/400", "300/600", "400/800",
    ]);
  });

  it("adds a fixed big-blind step, keeping every small blind exact", () => {
    expect(blinds(generateStructure(settings({ growth: { kind: "step", bigBlindStep: 200 }, levelCount: 5 })).levels)).toEqual([
      "100/200", "200/400", "300/600", "400/800", "500/1000",
    ]);
    expect(blinds(generateStructure(settings({ smallBlind: 50, bigBlind: 75, smallestChip: 25, growth: { kind: "step", bigBlindStep: 50 }, levelCount: 3 })).levels)).toEqual([
      "50/75", "75/150", "100/200",
    ]);
  });

  it("puts breaks after every N levels, never after the last, with their notes in order", () => {
    const { levels } = generateStructure(settings({ levelCount: 9, breaks: { everyLevels: 3, minutes: 10, notes: ["Colour up", "  "] } }));
    expect(levels.map((level) => level.id)).toEqual(["l1", "l2", "l3", "b1", "l4", "l5", "l6", "b2", "l7", "l8", "l9"]);
    expect(levels[3]).toEqual({ kind: "break", id: "b1", durationMinutes: 10, note: "Colour up" });
    expect(levels[7]).toEqual({ kind: "break", id: "b2", durationMinutes: 10, note: null });
  });

  it("switches to the later level length after level N or after the first break", () => {
    const afterLevel = generateStructure(settings({ levelCount: 5, levelMinutes: 20, laterLevels: { minutes: 15, startsAfter: 2 } }));
    expect(plays(afterLevel.levels).map((level) => level.durationMinutes)).toEqual([20, 20, 15, 15, 15]);
    const afterBreak = generateStructure(
      settings({ levelCount: 6, levelMinutes: 20, laterLevels: { minutes: 15, startsAfter: "first_break" }, breaks: { everyLevels: 4, minutes: 15, notes: [] } }),
    );
    expect(afterBreak.levels.map((level) => level.durationMinutes)).toEqual([20, 20, 20, 20, 15, 15, 15]);
  });

  it("adds antes from the chosen level, by mode", () => {
    const bb = generateStructure(settings({ levelCount: 4, ante: { mode: "bb_ante", fromLevel: 3 } }));
    expect(plays(bb.levels).map((level) => level.ante)).toEqual([0, 0, 600, 800]);
    const everyone = generateStructure(settings({ levelCount: 8, ante: { mode: "everyone", fromLevel: 6 } }));
    expect(plays(everyone.levels).map((level) => level.ante)).toEqual([0, 0, 0, 0, 0, 100, 200, 200]);
    expect(everyone.anteMode).toBe("everyone");
  });

  it("carries the other stacks through", () => {
    expect(generateStructure(settings({ rebuyStack: 30_000, addonStack: 40_000, earlyBirdStack: 5_000 }))).toMatchObject({
      rebuyStack: 30_000,
      addonStack: 40_000,
      earlyBirdStack: 5_000,
    });
  });

  it("always makes a playable, strictly rising structure from valid settings", () => {
    const valid = fc
      .record({
        chip: fc.constantFrom(1, 5, 25, 100, 500),
        units: fc.integer({ min: 1, max: 4 }),
        factor: fc.double({ min: 1.05, max: 2, noNaN: true }),
        levelCount: fc.integer({ min: 1, max: 30 }),
        levelMinutes: fc.integer({ min: 1, max: 60 }),
        every: fc.option(fc.integer({ min: 1, max: 8 }), { nil: null }),
        anteMode: fc.constantFrom("none" as const, "bb_ante" as const, "everyone" as const),
      })
      .map(({ chip, units, factor, levelCount, levelMinutes, every, anteMode }) =>
        settings({
          smallBlind: chip * units,
          bigBlind: chip * units * 2,
          smallestChip: chip,
          growth: { kind: "multiplier", factor },
          levelCount,
          levelMinutes,
          breaks: every ? { everyLevels: every, minutes: 10, notes: [] } : null,
          ante: { mode: anteMode, fromLevel: 1 },
        }),
      )
      .filter((input) => generatorProblems(input).length === 0);
    fc.assert(
      fc.property(valid, (input) => {
        const { levels } = generateStructure(input);
        expect(structureProblems(levels)).toEqual([]);
        const played = plays(levels);
        expect(played).toHaveLength(input.levelCount);
        const chip = input.smallestChip as number;
        played.forEach((level, i) => {
          expect(level.smallBlind % chip).toBe(0);
          if (i > 0) {
            expect(level.bigBlind).toBe(level.smallBlind * 2);
            expect(level.bigBlind).toBeGreaterThan(played[i - 1].bigBlind);
          }
          if (input.ante.mode === "bb_ante") expect(level.ante).toBe(level.bigBlind);
          if (input.ante.mode === "everyone") expect(level.ante % chip).toBe(0);
        });
        expect(levels[levels.length - 1].kind).toBe("level");
      }),
    );
  });

  it("refuses settings generatorProblems finds", () => {
    expect(() => generateStructure(settings({ levelCount: 0 }))).toThrow(RangeError);
  });
});

describe("generatorProblems", () => {
  const messages = (overrides: Partial<StructureGeneratorInput>) => generatorProblems(settings(overrides)).map((problem) => problem.path[0]);

  it("finds nothing wrong with sensible settings", () => {
    expect(generatorProblems(settings())).toEqual([]);
  });

  it("checks the stack, the blinds and the smallest chip", () => {
    expect(messages({ startingStack: 0 })).toEqual(["startingStack"]);
    expect(messages({ smallBlind: 0 })).toContain("smallBlind");
    expect(messages({ bigBlind: 1.5 })).toContain("bigBlind");
    expect(messages({ bigBlind: 50 })).toEqual(["bigBlind"]);
    expect(messages({ smallestChip: 75 })).toEqual(["smallestChip"]);
    expect(messages({ smallestChip: 0 })).toEqual(["smallestChip"]);
  });

  it("refuses a ladder whose rounding would reach the chip limit and stop rising (the curve alone stays under it)", () => {
    // The curve (4 × 1.53^38, 100 × 1.8^22) stays under the limit; the rounded ladder does not.
    for (const overrides of [
      { smallBlind: 2, bigBlind: 4, smallestChip: 1, growth: { kind: "multiplier", factor: 1.53 }, levelCount: 39 },
      // fast-check's counterexample to the "strictly rising" property below.
      { smallBlind: 50, bigBlind: 100, smallestChip: 25, growth: { kind: "multiplier", factor: 1.8000000000000003 }, levelCount: 23 },
    ] satisfies Partial<StructureGeneratorInput>[]) {
      expect(generatorProblems(settings(overrides))).toEqual([
        { path: ["growth"], message: "The blinds would pass 100,000,000: use fewer levels or a smaller increase" },
      ]);
      expect(() => generateStructure(settings(overrides))).toThrow(RangeError);
    }
    // One level fewer still rises all the way.
    const { levels } = generateStructure(settings({ smallBlind: 2, bigBlind: 4, smallestChip: 1, growth: { kind: "multiplier", factor: 1.53 }, levelCount: 38 }));
    const bigs = plays(levels).map((level) => level.bigBlind);
    expect(bigs.every((bigBlind, i) => i === 0 || bigBlind > bigs[i - 1])).toBe(true);
  });

  it("checks level counts and lengths", () => {
    expect(messages({ levelCount: 61, growth: { kind: "multiplier", factor: 1.05 } })).toEqual(["levelCount"]);
    expect(messages({ levelMinutes: 0 })).toEqual(["levelMinutes"]);
    expect(messages({ laterLevels: { minutes: 300, startsAfter: 2 } })).toEqual(["laterLevels"]);
    expect(messages({ laterLevels: { minutes: 15, startsAfter: 10 } })).toEqual(["laterLevels"]);
    expect(messages({ laterLevels: { minutes: 15, startsAfter: "first_break" } })).toEqual(["laterLevels"]);
    // Breaks switched on, but none comes before the last level: there is still no first break (P4REV1-06).
    for (const everyLevels of [10, 12]) {
      expect(generatorProblems(settings({ laterLevels: { minutes: 15, startsAfter: "first_break" }, breaks: { everyLevels, minutes: 15, notes: [] } }))).toEqual([
        { path: ["laterLevels"], message: "There is no break to start the later length after" },
      ]);
    }
    expect(messages({ laterLevels: { minutes: 15, startsAfter: "first_break" }, breaks: { everyLevels: 9, minutes: 15, notes: [] } })).toEqual([]);
    expect(messages({ breaks: { everyLevels: 0, minutes: 10, notes: [] } })).toEqual(["breaks"]);
    expect(messages({ breaks: { everyLevels: 4, minutes: 500, notes: [] } })).toEqual(["breaks"]);
  });

  it("checks the growth, including blinds that would pass the chip limit", () => {
    expect(messages({ growth: { kind: "multiplier", factor: 1 } })).toEqual(["growth"]);
    expect(messages({ growth: { kind: "multiplier", factor: Number.NaN } })).toEqual(["growth"]);
    expect(messages({ growth: { kind: "multiplier", factor: 3 }, levelCount: 60 })).toEqual(["growth"]);
    expect(messages({ growth: { kind: "step", bigBlindStep: 100 } })).toEqual(["growth"]);
    expect(messages({ growth: { kind: "step", bigBlindStep: 300 } })).toEqual(["growth"]);
    expect(messages({ growth: { kind: "step", bigBlindStep: 50_000_000 }, levelCount: 3 })).toEqual(["growth"]);
  });

  it("checks the ante start only when there are antes", () => {
    expect(messages({ ante: { mode: "bb_ante", fromLevel: 11 } })).toEqual(["ante"]);
    expect(messages({ ante: { mode: "none", fromLevel: 11 } })).toEqual([]);
  });
});

describe("editing helpers", () => {
  it("make ids nobody has", () => {
    expect(nextLevelId([], "level")).toBe("l1");
    expect(nextLevelId([{ kind: "level", id: "l7", durationMinutes: 1, smallBlind: 1, bigBlind: 2, ante: 0 }, { kind: "break", id: "x", durationMinutes: 1, note: null }], "level")).toBe("l8");
    expect(nextLevelId([{ kind: "break", id: "b2", durationMinutes: 1, note: null }], "break")).toBe("b3");
  });

  it("suggest the next level about a third up, with an ante if the last had one", () => {
    const { levels } = presetStructure("central_stars_one_life_line");
    expect(suggestNextLevel(levels, "bb_ante")).toEqual({ kind: "level", id: "l25", durationMinutes: 15, smallBlind: 120_000, bigBlind: 240_000, ante: 240_000 });
    expect(suggestNextLevel([{ kind: "level", id: "l1", durationMinutes: 20, smallBlind: 100, bigBlind: 200, ante: 0 }], "bb_ante")).toEqual({
      kind: "level",
      id: "l2",
      durationMinutes: 20,
      smallBlind: 200,
      bigBlind: 400,
      ante: 0,
    });
    expect(suggestNextLevel([], "none")).toEqual({ kind: "level", id: "l1", durationMinutes: 15, smallBlind: 100, bigBlind: 200, ante: 0 });
  });
});

describe("presets", () => {
  it("are all playable, keyed as listed", () => {
    expect(BLIND_PRESETS.map((preset) => preset.key)).toEqual([...BLIND_PRESET_KEYS]);
    for (const preset of BLIND_PRESETS) {
      expect(structureProblems(preset.structure.levels)).toEqual([]);
      expect(new Set(preset.structure.levels.map((level) => level.id)).size).toBe(preset.structure.levels.length);
      if (preset.generator) expect(generateStructure(preset.generator)).toEqual(preset.structure);
    }
    expect(isBlindPresetKey("turbo_10")).toBe(true);
    expect(isBlindPresetKey("nope")).toBe(false);
  });

  it("copy their structure for editing", () => {
    const copy = presetStructure("standard_15");
    (copy.levels[0] as PlayLevel).bigBlind = 1;
    expect((BLIND_PRESETS[2].structure.levels[0] as PlayLevel).bigBlind).toBe(200);
  });

  describe("Central Stars · One Life Line", () => {
    const preset = BLIND_PRESETS[0];
    const { structure } = preset;

    it("has the flyer's stacks and format", () => {
      expect(structure).toMatchObject({ anteMode: "bb_ante", startingStack: 80_000, rebuyStack: 120_000, addonStack: 120_000, earlyBirdStack: 25_000 });
      expect(preset.format).toMatchObject({ buyInAmount: "100.00", rebuyAmount: "25.00", addonAmount: "25.00", maxRebuys: 1, maxAddons: 1, rebuyOrAddon: true });
    });

    it("plays 20-minute levels before the first break and 15-minute levels after", () => {
      const firstBreak = structure.levels.findIndex((level) => level.kind === "break");
      expect(structure.levels.slice(0, firstBreak).every((level) => level.durationMinutes === 20)).toBe(true);
      expect(plays(structure.levels.slice(firstBreak)).every((level) => level.durationMinutes === 15)).toBe(true);
      expect(firstBreak).toBe(6);
    });

    it("closes the single re-buy / add-on window at the first break, 135 minutes in", () => {
      const firstBreak = structure.levels.findIndex((level) => level.kind === "break");
      expect(structure.levels[firstBreak]).toEqual({ kind: "break", id: "b1", durationMinutes: 15, note: CENTRAL_STARS_REBUY_BREAK_NOTE });
      const minutesToBreakEnd = structure.levels.slice(0, firstBreak + 1).reduce((sum, level) => sum + level.durationMinutes, 0);
      expect(minutesToBreakEnd).toBe(preset.format?.rebuyPeriodMinutes);
    });

    it("climbs from 200/400 (200 big blinds deep) to 100,000/200,000 with a big-blind ante from level 4", () => {
      expect(blinds(structure.levels)).toEqual([
        "200/400", "300/600", "400/800", "500/1000", "600/1200", "800/1600",
        "1000/2000", "1500/3000", "2000/4000", "3000/6000", "4000/8000", "5000/10000",
        "6000/12000", "8000/16000", "10000/20000", "15000/30000", "20000/40000", "25000/50000",
        "30000/60000", "40000/80000", "50000/100000", "60000/120000", "80000/160000", "100000/200000",
      ]);
      expect(plays(structure.levels).map((level) => level.ante > 0)).toEqual([false, false, false, ...Array(21).fill(true)]);
      for (const level of plays(structure.levels)) if (level.ante > 0) expect(level.ante).toBe(level.bigBlind);
      // After the first break every blind is a multiple of 500: the 100s can come off.
      for (const level of plays(structure.levels.slice(7))) expect(level.smallBlind % 500).toBe(0);
    });
  });

  it("generic presets keep the ladders they were made with", () => {
    const ladders = Object.fromEntries(BLIND_PRESETS.slice(1).map((preset) => [preset.key, blinds(preset.structure.levels).join(" ")]));
    expect(ladders).toEqual({
      turbo_10: "25/50 50/100 75/150 100/200 150/300 200/400 300/600 400/800 600/1200 800/1600 1200/2400 1500/3000 2000/4000 3000/6000 4000/8000 6000/12000 8000/16000 12000/24000",
      standard_15: "100/200 200/400 300/600 400/800 500/1000 600/1200 800/1600 1000/2000 1200/2400 1500/3000 2000/4000 2500/5000 3000/6000 4000/8000 5000/10000 6000/12000 8000/16000 10000/20000 12000/24000 15000/30000",
      deep_20: "100/200 200/400 300/600 400/800 500/1000 600/1200 800/1600 1000/2000 1200/2400 1500/3000 2000/4000 2500/5000 3000/6000 4000/8000 5000/10000 6000/12000 7500/15000 10000/20000 12000/24000 15000/30000 20000/40000 25000/50000 30000/60000 40000/80000",
    });
  });
});
