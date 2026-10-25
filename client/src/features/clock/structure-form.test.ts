import { describe, expect, it } from "vitest";
import { presetStructure } from "@shared/domain/blind-structures";
import { structureHash, type ClockStructure } from "@shared/domain/clock";
import { formErrorMap } from "@/lib/forms";
import { breakRow, durationText, levelOption, rebuyBreakEndMinutes, rowsSummary, rowTitle, structureFormSchema, structureSummary, structureValues, suggestedRow } from "./structure-form";

const structure: ClockStructure = {
  levels: [
    { kind: "level", id: "l1", durationMinutes: 20, smallBlind: 200, bigBlind: 400, ante: 0 },
    { kind: "break", id: "b1", durationMinutes: 10, note: "Colour up" },
    { kind: "level", id: "l2", durationMinutes: 15, smallBlind: 300, bigBlind: 600, ante: 600 },
  ],
  anteMode: "bb_ante",
  startingStack: 80_000,
  rebuyStack: null,
  addonStack: 120_000,
  earlyBirdStack: 25_000,
};

const issues = (values: unknown) => {
  const result = structureFormSchema.safeParse(values, { errorMap: formErrorMap });
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
};

describe("the structure form", () => {
  it("round-trips a saved structure unchanged (the editor sends back what it loaded)", () => {
    const parsed = structureFormSchema.parse(structureValues(structure));
    expect(parsed).toEqual(structure);
    expect(structureHash(parsed)).toBe(structureHash(structure));
  });

  it("round-trips Central Stars' preset", () => {
    const preset = presetStructure("central_stars_one_life_line");
    expect(structureFormSchema.parse(structureValues(preset))).toEqual(preset);
  });

  it("reads blank stacks as not set and a blank ante as none", () => {
    const values = structureValues(structure);
    values.rebuyStack = "";
    values.addonStack = " ";
    values.levels[2].ante = "";
    const parsed = structureFormSchema.parse(values);
    expect(parsed.addonStack).toBeNull();
    expect(parsed.levels[2]).toMatchObject({ ante: 0 });
  });

  it("drops every ante (even one typed earlier) when the structure has none", () => {
    const values = { ...structureValues(structure), anteMode: "none" as const };
    values.levels[2].ante = "not a number";
    expect(structureFormSchema.parse(values).levels[2]).toMatchObject({ ante: 0 });
  });

  it("names the box a problem is in, in the form's words", () => {
    const values = structureValues(structure);
    values.levels[2].durationMinutes = "abc";
    values.startingStack = "0";
    values.levels[1].durationMinutes = "";
    expect(issues(values)).toEqual(
      expect.arrayContaining(["levels.2.durationMinutes: Must be a whole number", "levels.1.durationMinutes: Required", "startingStack: Must be 1 or more"]),
    );
  });

  it("puts the cross-row rules on the row they are about", () => {
    const values = structureValues(structure);
    values.levels[0].bigBlind = "100";
    expect(issues(values)).toEqual(["levels.0.bigBlind: The big blind must be at least the small blind"]);
  });

  it("refuses a structure with only breaks", () => {
    const values = structureValues({ ...structure, levels: [{ kind: "break", id: "b1", durationMinutes: 10, note: null }] });
    expect(issues(values)).toContain("levels: Add at least one blind level");
  });

  it("names rows by kind and number, and sums them up", () => {
    const rows = structureValues(structure).levels;
    expect([0, 1, 2].map((index) => rowTitle(rows, index))).toEqual(["Level 1", "Break 1", "Level 2"]);
    expect(rowsSummary(rows)).toBe("2 levels · 45 min in all");
    expect(durationText(45)).toBe("45 min");
    expect(durationText(120)).toBe("2 h");
    expect(durationText(495)).toBe("8 h 15 min");
  });

  it("sums a structure up in one line, one level as one level (P4REV4-R3-CQ-04)", () => {
    expect(structureSummary(structure.levels)).toBe("2 levels · 45 min in all");
    expect(structureSummary(structure.levels, { from: true })).toBe("2 levels · from 200/400 · 45 min");
    const single = [structure.levels[0]];
    expect(structureSummary(single)).toBe("1 level · 20 min in all");
    expect(rowsSummary(structureValues({ ...structure, levels: single }).levels)).toBe("1 level · 20 min in all");
    expect(structureSummary(presetStructure("central_stars_one_life_line").levels, { from: true })).toBe("24 levels · from 200/400 · 7 h 5 min");
  });

  it("finds where the re-buy break ends, breaks included, from the structure as it is", () => {
    expect(rebuyBreakEndMinutes(presetStructure("central_stars_one_life_line").levels)).toBe(135);
    expect(rebuyBreakEndMinutes(structure.levels)).toBeNull();
    const longerFirstLevel = presetStructure("central_stars_one_life_line").levels.map((level, index) => (index === 0 ? { ...level, durationMinutes: 30 } : level));
    expect(rebuyBreakEndMinutes(longerFirstLevel)).toBe(145);
  });

  it("suggests a level about a third up, after the row asked for, with a new id", () => {
    const rows = structureValues(structure).levels;
    const atEnd = suggestedRow(rows, "bb_ante");
    expect(atEnd).toMatchObject({ kind: "level", levelId: "l3", smallBlind: "400", bigBlind: "800", ante: "800", durationMinutes: "15" });
    const afterFirst = suggestedRow(rows, "bb_ante", 0);
    expect(afterFirst).toMatchObject({ levelId: "l3", smallBlind: "300", bigBlind: "600", ante: "" });
  });

  it("suggests from the readable rows only while one is half-typed", () => {
    const rows = structureValues(structure).levels;
    rows[2].bigBlind = "";
    expect(suggestedRow(rows, "bb_ante")).toMatchObject({ smallBlind: "300", bigBlind: "600" });
  });

  it("adds a 10-minute break with an id no row has", () => {
    expect(breakRow(structureValues(structure).levels)).toEqual({ kind: "break", levelId: "b2", durationMinutes: "10", smallBlind: "", bigBlind: "", ante: "", note: "" });
  });

  it("words each level for the jump list", () => {
    expect(structure.levels.map((_, index) => levelOption(structure.levels, index))).toEqual(["Level 1 · 200/400", "Break · Colour up", "Level 2 · 300/600"]);
    expect(levelOption([{ kind: "break", id: "b9", durationMinutes: 5, note: null }], 0)).toBe("Break (5 min)");
  });
});
