/**
 * The structure generator's form: its values (numbers as text, the optional parts as switches), the
 * schema that checks them (the shared structureGeneratorSchema, fed what the boxes hold, so its issue
 * paths name the form's fields), and the values a preset's settings fill it with. Pure.
 */
import { z } from "zod";
import { structureGeneratorSchema } from "@shared/api/clock";
import { BLIND_PRESETS, type StructureGeneratorInput } from "@shared/domain/blind-structures";
import type { AnteMode } from "@shared/domain/clock";
import { readNumber } from "@/lib/forms";

export interface GeneratorFormValues {
  startingStack: string;
  smallBlind: string;
  bigBlind: string;
  growth: { kind: "multiplier" | "step"; factor: string; bigBlindStep: string };
  levelCount: string;
  levelMinutes: string;
  laterLevels: { enabled: boolean; minutes: string; startsAfter: string };
  /** Notes are typed one per line, in break order. */
  breaks: { enabled: boolean; everyLevels: string; minutes: string; notes: string };
  ante: { mode: AnteMode; fromLevel: string };
  /** Blank: the largest common chip that makes level 1's blinds. */
  smallestChip: string;
  rebuyStack: string;
  addonStack: string;
  earlyBirdStack: string;
}

/** `laterLevels.startsAfter` for "after the first break". */
export const AFTER_FIRST_BREAK = "first_break";

const text = (value: number | null) => (value === null ? "" : String(value));

/** The form's values for generator settings (a preset's, or the defaults). */
export function generatorValues(input: StructureGeneratorInput): GeneratorFormValues {
  return {
    startingStack: text(input.startingStack),
    smallBlind: text(input.smallBlind),
    bigBlind: text(input.bigBlind),
    growth:
      input.growth.kind === "multiplier"
        ? { kind: "multiplier", factor: text(input.growth.factor), bigBlindStep: "" }
        : { kind: "step", factor: "1.5", bigBlindStep: text(input.growth.bigBlindStep) },
    levelCount: text(input.levelCount),
    levelMinutes: text(input.levelMinutes),
    laterLevels: input.laterLevels
      ? { enabled: true, minutes: text(input.laterLevels.minutes), startsAfter: String(input.laterLevels.startsAfter) }
      : { enabled: false, minutes: "15", startsAfter: AFTER_FIRST_BREAK },
    breaks: input.breaks
      ? { enabled: true, everyLevels: text(input.breaks.everyLevels), minutes: text(input.breaks.minutes), notes: input.breaks.notes.join("\n") }
      : { enabled: false, everyLevels: "6", minutes: "10", notes: "" },
    ante: { mode: input.ante.mode, fromLevel: text(input.ante.fromLevel) },
    smallestChip: text(input.smallestChip),
    rebuyStack: text(input.rebuyStack),
    addonStack: text(input.addonStack),
    earlyBirdStack: text(input.earlyBirdStack),
  };
}

/** The presets made by the generator, whose settings the form can start from. */
export const GENERATOR_STARTS = BLIND_PRESETS.flatMap((preset) => (preset.generator ? [{ key: preset.key, name: preset.name, input: preset.generator }] : []));

/** What the form starts with: the standard 15-minute preset's settings. */
export const DEFAULT_GENERATOR_VALUES = generatorValues(GENERATOR_STARTS.find((start) => start.key === "standard_15")?.input ?? GENERATOR_STARTS[0].input);

/** Break notes from the box: one per line, blank lines kept as "no note" for that break, trailing ones dropped. */
function notesOf(notes: string): string[] {
  const lines = notes.split("\n").map((line) => line.trim());
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** The values in the generator's shape, for the shared schema to check. */
function generatorInput(values: unknown): unknown {
  if (typeof values !== "object" || values === null) return values;
  const form = values as GeneratorFormValues;
  return {
    startingStack: readNumber(form.startingStack),
    smallBlind: readNumber(form.smallBlind),
    bigBlind: readNumber(form.bigBlind),
    growth:
      form.growth.kind === "multiplier"
        ? { kind: "multiplier", factor: readNumber(form.growth.factor) }
        : { kind: "step", bigBlindStep: readNumber(form.growth.bigBlindStep) },
    levelCount: readNumber(form.levelCount),
    levelMinutes: readNumber(form.levelMinutes),
    laterLevels: form.laterLevels.enabled
      ? {
          minutes: readNumber(form.laterLevels.minutes),
          startsAfter: form.laterLevels.startsAfter === AFTER_FIRST_BREAK ? AFTER_FIRST_BREAK : readNumber(form.laterLevels.startsAfter),
        }
      : null,
    breaks: form.breaks.enabled
      ? { everyLevels: readNumber(form.breaks.everyLevels), minutes: readNumber(form.breaks.minutes), notes: notesOf(form.breaks.notes) }
      : null,
    ante: { mode: form.ante.mode, fromLevel: form.ante.mode === "none" ? 1 : readNumber(form.ante.fromLevel) },
    smallestChip: readNumber(form.smallestChip),
    rebuyStack: readNumber(form.rebuyStack),
    addonStack: readNumber(form.addonStack),
    earlyBirdStack: readNumber(form.earlyBirdStack),
  };
}

/** The generator's schema over the form's values; its output is the generator's input. */
export const generatorFormSchema = z.preprocess(generatorInput, structureGeneratorSchema);
