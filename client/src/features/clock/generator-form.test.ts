import { describe, expect, it } from "vitest";
import { BLIND_PRESETS, generateStructure } from "@shared/domain/blind-structures";
import { formErrorMap } from "@/lib/forms";
import { AFTER_FIRST_BREAK, DEFAULT_GENERATOR_VALUES, GENERATOR_STARTS, generatorFormSchema, generatorValues, type GeneratorFormValues } from "./generator-form";

const issues = (values: GeneratorFormValues) => {
  const result = generatorFormSchema.safeParse(values, { errorMap: formErrorMap });
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
};

describe("the generator form", () => {
  it("offers every preset made by the generator to start from, and starts from the standard one", () => {
    expect(GENERATOR_STARTS.map((start) => start.key)).toEqual(["turbo_10", "standard_15", "deep_20"]);
    expect(DEFAULT_GENERATOR_VALUES).toMatchObject({ startingStack: "25000", levelMinutes: "15", growth: { kind: "multiplier", factor: "1.3" } });
  });

  it("gives back each preset's own settings, so its ladder is generated exactly", () => {
    for (const preset of BLIND_PRESETS) {
      if (!preset.generator) continue;
      const input = generatorFormSchema.parse(generatorValues(preset.generator));
      expect(generateStructure(input)).toEqual(preset.structure);
    }
  });

  it("reads the switched-off parts as none, and break notes one per line", () => {
    const values: GeneratorFormValues = {
      ...DEFAULT_GENERATOR_VALUES,
      laterLevels: { enabled: true, minutes: "15", startsAfter: AFTER_FIRST_BREAK },
      breaks: { enabled: true, everyLevels: "6", minutes: "15", notes: "Last re-buys / add-ons\n\nColour up\n\n" },
      ante: { mode: "none", fromLevel: "" },
      smallestChip: "",
      levelMinutes: "20",
    };
    const input = generatorFormSchema.parse(values);
    expect(input.laterLevels).toEqual({ minutes: 15, startsAfter: "first_break" });
    expect(input.breaks?.notes).toEqual(["Last re-buys / add-ons", "", "Colour up"]);
    expect(input.ante).toEqual({ mode: "none", fromLevel: 1 });
    expect(input.smallestChip).toBeNull();
    const parsed = generatorFormSchema.parse({ ...values, laterLevels: { ...values.laterLevels, enabled: false }, breaks: { ...values.breaks, enabled: false } });
    expect(parsed.laterLevels).toBeNull();
    expect(parsed.breaks).toBeNull();
  });

  it("reads a fixed step and a later length starting after a level", () => {
    const input = generatorFormSchema.parse({
      ...DEFAULT_GENERATOR_VALUES,
      growth: { kind: "step", factor: "", bigBlindStep: "200" },
      laterLevels: { enabled: true, minutes: "10", startsAfter: "6" },
    });
    expect(input.growth).toEqual({ kind: "step", bigBlindStep: 200 });
    expect(input.laterLevels).toEqual({ minutes: 10, startsAfter: 6 });
  });

  it("puts the shared rules' problems on the boxes and parts they are about", () => {
    expect(issues({ ...DEFAULT_GENERATOR_VALUES, bigBlind: "50" })).toContain("bigBlind: The big blind must be at least the small blind");
    expect(issues({ ...DEFAULT_GENERATOR_VALUES, growth: { kind: "multiplier", factor: "9", bigBlindStep: "" } })).toContain("growth.factor: Must be 3 or less");
    expect(issues({ ...DEFAULT_GENERATOR_VALUES, growth: { kind: "step", factor: "", bigBlindStep: "150" } })).toContain(
      "growth: The step must be a whole number of two smallest chips (so each small blind is exact)",
    );
    expect(issues({ ...DEFAULT_GENERATOR_VALUES, levelCount: "" })).toContain("levelCount: Required");
    expect(issues({ ...DEFAULT_GENERATOR_VALUES, ante: { mode: "bb_ante", fromLevel: "99" } })).toContain("ante.fromLevel: Must be 60 or less");
  });
});
