import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";
import { BLIND_PRESETS, generateStructure, type StructureGeneratorInput } from "../domain/blind-structures";
import type { BlindLevel, ClockAction, ClockStructure } from "../domain/clock";
import {
  blindLevelSchema,
  clockActionSchema,
  clockConfigSchema,
  clockDisplaySettingsPatchSchema,
  clockStructureSchema,
  DEFAULT_DISPLAY_SETTINGS,
  earlyBirdsSchema,
  resolveDisplaySettings,
  structureGeneratorSchema,
} from "./clock";

const issues = (result: { success: boolean; error?: { issues: Array<{ path: Array<string | number>; message: string }> } }) =>
  result.success ? [] : (result.error?.issues ?? []).map((issue) => `${issue.path.join(".")}: ${issue.message}`);

describe("the clock request schemas", () => {
  it("produce exactly the domain's types", () => {
    expectTypeOf<z.output<typeof blindLevelSchema>>().toEqualTypeOf<BlindLevel>();
    expectTypeOf<z.output<typeof clockActionSchema>>().toEqualTypeOf<ClockAction>();
    expectTypeOf<z.output<typeof clockStructureSchema>>().toEqualTypeOf<ClockStructure>();
    // What the generator form parses can go straight to generateStructure.
    expectTypeOf<z.output<typeof structureGeneratorSchema>>().toExtend<StructureGeneratorInput>();
  });

  it("accept every preset as a structure", () => {
    for (const preset of BLIND_PRESETS) expect(issues(clockStructureSchema.safeParse(preset.structure))).toEqual([]);
  });

  it("default an ante to 0 and a break note to null, and make a blank note null", () => {
    expect(blindLevelSchema.parse({ kind: "level", id: "l1", durationMinutes: 20, smallBlind: 100, bigBlind: 200 })).toEqual({
      kind: "level",
      id: "l1",
      durationMinutes: 20,
      smallBlind: 100,
      bigBlind: 200,
      ante: 0,
    });
    expect(blindLevelSchema.parse({ kind: "break", id: "b1", durationMinutes: 10 })).toEqual({ kind: "break", id: "b1", durationMinutes: 10, note: null });
    expect(blindLevelSchema.parse({ kind: "break", id: "b1", durationMinutes: 10, note: "   " })).toMatchObject({ note: null });
  });

  it("refuse broken levels and structures", () => {
    const level = { kind: "level", id: "l1", durationMinutes: 20, smallBlind: 100, bigBlind: 200, ante: 0 };
    const structure = (levels: unknown[]) => ({ levels, anteMode: "none", startingStack: 10_000, rebuyStack: null, addonStack: null, earlyBirdStack: null });
    expect(issues(clockStructureSchema.safeParse(structure([level, level])))).toEqual(["levels.1.id: Duplicate level id"]);
    expect(issues(clockStructureSchema.safeParse(structure([{ ...level, bigBlind: 50 }])))).toEqual(["levels.0.bigBlind: The big blind must be at least the small blind"]);
    expect(issues(clockStructureSchema.safeParse(structure([{ kind: "break", id: "b", durationMinutes: 5 }])))).toEqual(["levels: Add at least one blind level"]);
    expect(issues(clockStructureSchema.safeParse(structure([])))).toContain("levels: Add at least one blind level");
    expect(clockStructureSchema.safeParse(structure([{ ...level, durationMinutes: 0 }])).success).toBe(false);
    expect(clockStructureSchema.safeParse(structure([{ ...level, smallBlind: 1.5 }])).success).toBe(false);
    expect(clockStructureSchema.safeParse(structure([{ ...level, id: "has space" }])).success).toBe(false);
    expect(clockStructureSchema.safeParse({ ...structure([level]), anteMode: "sometimes" }).success).toBe(false);
    expect(clockStructureSchema.safeParse({ ...structure([level]), startingStack: 0 }).success).toBe(false);
  });

  it("take a config with a preset key and a hash, or null to create", () => {
    const structure = BLIND_PRESETS[0].structure;
    expect(clockConfigSchema.safeParse({ structure, presetKey: "central_stars_one_life_line", baseHash: null }).success).toBe(true);
    expect(clockConfigSchema.safeParse({ structure, baseHash: "0a1b2c3d", displaySettings: { qrTarget: "seats" } }).success).toBe(true);
    expect(clockConfigSchema.safeParse({ structure, baseHash: "nothex!!" }).success).toBe(false);
    expect(clockConfigSchema.safeParse({ structure, baseHash: null, presetKey: "made_up" }).success).toBe(false);
    expect(clockConfigSchema.safeParse({ structure }).success).toBe(false);
  });

  it("take every clock action, refusing a zero adjustment and out-of-range values", () => {
    for (const action of [
      { action: "start", alsoStartTournament: true },
      { action: "pause" },
      { action: "resume" },
      { action: "toggle", expectedStatus: "paused" },
      { action: "next", expectedLevelIndex: 3 },
      { action: "prev" },
      { action: "jump", levelIndex: 4 },
      { action: "adjust", deltaSeconds: -60 },
      { action: "set_remaining", remainingSeconds: 720 },
      { action: "reset" },
      { action: "undo" },
      { action: "undo", expectedUndo: { at: 1_792_740_000_000, redo: true } },
    ]) {
      expect(clockActionSchema.safeParse(action).success).toBe(true);
    }
    expect(clockActionSchema.safeParse({ action: "undo", expectedUndo: { at: 1_792_740_000_000 } }).success).toBe(false);
    expect(clockActionSchema.safeParse({ action: "undo", expectedUndo: { at: -1, redo: false } }).success).toBe(false);
    expect(clockActionSchema.safeParse({ action: "adjust", deltaSeconds: 0 }).success).toBe(false);
    expect(clockActionSchema.safeParse({ action: "adjust", deltaSeconds: 3601 }).success).toBe(false);
    expect(clockActionSchema.safeParse({ action: "set_remaining", remainingSeconds: 14_401 }).success).toBe(false);
    expect(clockActionSchema.safeParse({ action: "jump", levelIndex: 100 }).success).toBe(false);
    expect(clockActionSchema.safeParse({ action: "toggle", expectedStatus: "finished" }).success).toBe(false);
    expect(clockActionSchema.safeParse({ action: "explode" }).success).toBe(false);
  });
});

describe("display settings", () => {
  it("default to showing the pool only once it is locked, and the QR to the season", () => {
    expect(DEFAULT_DISPLAY_SETTINGS).toEqual({
      showPrizePool: "when_locked",
      showPayouts: true,
      showAp: false,
      showAverageStack: true,
      qrTarget: "season",
      overlay: "none",
    });
  });

  it("are read back field by field, never throwing", () => {
    expect(resolveDisplaySettings(null)).toEqual(DEFAULT_DISPLAY_SETTINGS);
    expect(resolveDisplaySettings("junk")).toEqual(DEFAULT_DISPLAY_SETTINGS);
    expect(resolveDisplaySettings({ showAp: true, qrTarget: "nowhere", overlay: "seating", extra: 1 })).toEqual({
      ...DEFAULT_DISPLAY_SETTINGS,
      showAp: true,
      overlay: "seating",
    });
  });

  it("are patched one or more at a time, refusing unknown or empty patches", () => {
    expect(clockDisplaySettingsPatchSchema.parse({ overlay: "payouts" })).toEqual({ overlay: "payouts" });
    expect(clockDisplaySettingsPatchSchema.safeParse({}).success).toBe(false);
    expect(clockDisplaySettingsPatchSchema.safeParse({ colour: "red" }).success).toBe(false);
    expect(clockDisplaySettingsPatchSchema.safeParse({ showPrizePool: "sometimes" }).success).toBe(false);
  });
});

describe("structureGeneratorSchema", () => {
  const valid = {
    startingStack: 80_000,
    smallBlind: 200,
    bigBlind: 400,
    growth: { kind: "multiplier", factor: 1.35 },
    levelCount: 20,
    levelMinutes: 20,
    laterLevels: { minutes: 15, startsAfter: "first_break" },
    breaks: { everyLevels: 6, minutes: 15, notes: ["Last re-buys / add-ons"] },
    ante: { mode: "bb_ante", fromLevel: 4 },
    smallestChip: null,
    rebuyStack: 120_000,
    addonStack: 120_000,
    earlyBirdStack: 25_000,
  };

  it("accepts settings the generator can use", () => {
    const parsed = structureGeneratorSchema.parse(valid);
    expect(generateStructure(parsed).levels.filter((level) => level.kind === "level")).toHaveLength(20);
    expect(structureGeneratorSchema.parse({ ...valid, breaks: { everyLevels: 6, minutes: 15 } }).breaks?.notes).toEqual([]);
  });

  it("reports the generator's own problems on their fields", () => {
    expect(issues(structureGeneratorSchema.safeParse({ ...valid, bigBlind: 100 }))).toEqual(["bigBlind: The big blind must be at least the small blind"]);
    expect(issues(structureGeneratorSchema.safeParse({ ...valid, ante: { mode: "bb_ante", fromLevel: 30 } }))).toEqual(["ante: The antes must start at one of the levels"]);
    // "15 minutes after the first break" with breaks every 20 of 20 levels: no break ever comes.
    expect(issues(structureGeneratorSchema.safeParse({ ...valid, breaks: { everyLevels: 20, minutes: 15, notes: [] } }))).toEqual([
      "laterLevels: There is no break to start the later length after",
    ]);
    expect(structureGeneratorSchema.safeParse({ ...valid, growth: { kind: "multiplier", factor: 5 } }).success).toBe(false);
  });
});

describe("earlyBirdsSchema", () => {
  it("takes one or more registrations and whether they get the bonus", () => {
    expect(earlyBirdsSchema.parse({ registrationIds: ["r1", "r2"], earlyBird: true })).toEqual({ registrationIds: ["r1", "r2"], earlyBird: true });
    expect(earlyBirdsSchema.safeParse({ registrationIds: [], earlyBird: true }).success).toBe(false);
    expect(earlyBirdsSchema.safeParse({ registrationIds: ["bad id"], earlyBird: true }).success).toBe(false);
    expect(earlyBirdsSchema.safeParse({ registrationIds: ["r1"] }).success).toBe(false);
  });
});
