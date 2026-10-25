/**
 * "Change the rest of the structure" (round 5, item 3): the sheet's values (numbers as typed), the
 * input they make for shared/domain/structure-rest, the problems with it (filed under the sheet's own
 * fields), and the preview of the levels after the current one, old beside new. Pure.
 */
import { GENERATOR_LIMITS } from "@shared/domain/blind-structures";
import { anteText, formatBlinds, type BlindLevel, type ClockStructure, type PlayLevel, type StructureProblem } from "@shared/domain/clock";
import { restDefaults, restOfStructureProblems, reshapeRest, type RestOfStructureInput } from "@shared/domain/structure-rest";
import { plural } from "@/lib/format";
import { durationText } from "./structure-form";

/** The increases offered as one tap; anything else is typed (Custom). */
export const FACTOR_CHOICES = ["1.25", "1.33", "1.5", "2"] as const;

export interface RestFormValues {
  /** Every later level the same length (`minutes`), or each kept as it is. */
  length: { change: boolean; minutes: string };
  blinds: {
    mode: "keep" | "regenerate";
    growth: "multiplier" | "step";
    /** One of FACTOR_CHOICES, or what was typed under Custom. */
    factor: string;
    bigBlindStep: string;
    levelCount: string;
    smallestChip: string;
  };
  /** Antes as they are, or on every later level from `fromLevel` (only when the structure has antes). */
  antes: { mode: "keep" | "from"; fromLevel: string };
  /** Notes are typed one per line, in break order. */
  breaks: { mode: "keep" | "none" | "every"; everyLevels: string; minutes: string; notes: string };
}

export type RestField =
  | "length.minutes"
  | "blinds.factor"
  | "blinds.bigBlindStep"
  | "blinds.levelCount"
  | "blinds.smallestChip"
  | "antes.fromLevel"
  | "breaks"
  | "breaks.everyLevels"
  | "breaks.minutes"
  | "breaks.notes";

/** A problem with the sheet: under a field, or about the whole change (`field` null). */
export interface RestProblem {
  field: RestField | null;
  message: string;
}

/** The play level the clock is on, or the last one before it (on a break): what the blinds grow from. */
export function baseLevelOf(structure: Pick<ClockStructure, "levels">, fromIndex: number): { level: PlayLevel; number: number } | null {
  let number = 0;
  let base: PlayLevel | null = null;
  for (const level of structure.levels.slice(0, fromIndex + 1)) {
    if (level.kind === "level") {
      number++;
      base = level;
    }
  }
  return base ? { level: base, number } : null;
}

const text = (value: number) => String(value);

/** The sheet's starting values: the later levels as they are now (restDefaults), changing nothing until the TD does. */
export function restValues(structure: ClockStructure, fromIndex: number): RestFormValues {
  const defaults = restDefaults(structure, fromIndex);
  const base = baseLevelOf(structure, fromIndex);
  const factor = defaults.growth.kind === "multiplier" ? defaults.growth.factor : 1.5;
  const choice = FACTOR_CHOICES.find((value) => Number(value) === factor);
  const breaks = structure.levels.filter((level) => level.kind === "break");
  const laterBreaks = structure.levels.slice(fromIndex + 1).filter((level) => level.kind === "break");
  const firstBreak = laterBreaks[0] ?? breaks[0];
  return {
    length: { change: false, minutes: text(defaults.levelMinutes) },
    blinds: {
      mode: "keep",
      growth: "multiplier",
      factor: choice ?? text(factor),
      // A step of the current big blind: whole small chips, so every small blind is exact.
      bigBlindStep: text(base ? base.level.bigBlind : 2 * defaults.smallestChip),
      levelCount: text(defaults.levelCount),
      smallestChip: text(defaults.smallestChip),
    },
    antes: { mode: "keep", fromLevel: text((base?.number ?? 0) + 1) },
    breaks: {
      mode: "keep",
      everyLevels: text(breakSpacing(structure) ?? 6),
      minutes: text(firstBreak?.durationMinutes ?? 10),
      // Re-spaced breaks keep the notes of those still to come, in order ("Last re-buys / add-ons" matters).
      notes: laterBreaks.map((level) => level.note ?? "").join("\n"),
    },
  };
}

/** How many levels apart the structure's breaks come, when they come evenly; null otherwise. */
function breakSpacing(structure: Pick<ClockStructure, "levels">): number | null {
  const after: number[] = [];
  let number = 0;
  for (const level of structure.levels) {
    if (level.kind === "level") number++;
    else after.push(number);
  }
  if (after.length === 0 || after[0] < 1) return null;
  return after.every((levelNumber, i) => levelNumber === after[0] * (i + 1)) ? after[0] : null;
}

/** A whole number typed into a box, or null. */
function whole(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

/** "1.33", "1,5" → 1.33, 1.5; null for anything else. */
function decimal(value: string): number | null {
  const trimmed = value.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  return Number(trimmed);
}

/** Break notes from the box: one per line, blank lines kept as "no note" for that break, trailing ones dropped. */
function notesOf(notes: string): string[] {
  const lines = notes.split("\n").map((line) => line.trim());
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Which of the sheet's fields a structure-rest problem belongs to (null: the whole change). */
function fieldOf(problem: StructureProblem, values: RestFormValues): RestField | null {
  switch (problem.path[0]) {
    case "levelMinutes":
      return "length.minutes";
    case "growth":
      return values.blinds.growth === "multiplier" ? "blinds.factor" : "blinds.bigBlindStep";
    case "levelCount":
      return "blinds.levelCount";
    case "smallestChip":
      return "blinds.smallestChip";
    case "anteFromLevel":
      return "antes.fromLevel";
    case "breaks":
      // By the path, never the message's words (conventions §3.4, R5REV3-CQ-05): a box the path names,
      // else the breaks as a whole (shown under their boxes).
      return BREAK_FIELDS.get(problem.path[1]) ?? "breaks";
    default:
      return null;
  }
}

const BREAK_FIELDS: ReadonlyMap<unknown, RestField> = new Map<string, RestField>([
  ["everyLevels", "breaks.everyLevels"],
  ["minutes", "breaks.minutes"],
  ["notes", "breaks.notes"],
]);

export type RestRead = { ok: true; input: RestOfStructureInput; structure: ClockStructure } | { ok: false; problems: RestProblem[] };

/**
 * What the sheet's values do to `structure` from `fromIndex`: the reshaped structure, or the problems
 * (a box that holds no number, or the shared rules' own: restOfStructureProblems).
 */
export function readRest(structure: ClockStructure, fromIndex: number, values: RestFormValues): RestRead {
  const problems: RestProblem[] = [];
  const need = (field: RestField, value: number | null, message: string): number => {
    if (value === null) problems.push({ field, message });
    return value ?? 0;
  };
  const levelMinutes = values.length.change ? need("length.minutes", whole(values.length.minutes), "Enter the minutes per level") : null;

  let blinds: RestOfStructureInput["blinds"] = { kind: "keep" };
  if (values.blinds.mode === "regenerate") {
    const growth =
      values.blinds.growth === "multiplier"
        ? ({ kind: "multiplier", factor: need("blinds.factor", decimal(values.blinds.factor), "Enter how much the blinds multiply, e.g. 1.5") } as const)
        : ({ kind: "step", bigBlindStep: need("blinds.bigBlindStep", whole(values.blinds.bigBlindStep), "Enter how much each big blind goes up") } as const);
    blinds = {
      kind: "regenerate",
      growth,
      levelCount: need("blinds.levelCount", whole(values.blinds.levelCount), "Enter how many levels to play after this one"),
      smallestChip: values.blinds.smallestChip.trim() === "" ? null : need("blinds.smallestChip", whole(values.blinds.smallestChip), "Enter the smallest chip in play"),
    };
  }

  const anteFromLevel =
    structure.anteMode !== "none" && values.antes.mode === "from" ? need("antes.fromLevel", whole(values.antes.fromLevel), "Enter the level the antes start at") : null;

  let breaks: RestOfStructureInput["breaks"] = { kind: values.breaks.mode === "none" ? "none" : "keep" };
  if (values.breaks.mode === "every") {
    breaks = {
      kind: "every",
      everyLevels: need("breaks.everyLevels", whole(values.breaks.everyLevels), "Enter how many levels between breaks"),
      minutes: need("breaks.minutes", whole(values.breaks.minutes), "Enter the minutes per break"),
      notes: notesOf(values.breaks.notes),
    };
  }

  if (problems.length > 0) return { ok: false, problems };
  const input: RestOfStructureInput = { fromIndex, levelMinutes, blinds, anteFromLevel, breaks };
  const shared = restOfStructureProblems(structure, input);
  if (shared.length > 0) return { ok: false, problems: shared.map((problem) => ({ field: fieldOf(problem, values), message: problem.message })) };
  return { ok: true, input, structure: reshapeRest(structure, input) };
}

/** Whether reshaping changed anything after the current row (Save is pointless otherwise). */
export function restChanged(before: Pick<ClockStructure, "levels">, after: Pick<ClockStructure, "levels">): boolean {
  return JSON.stringify(before.levels) !== JSON.stringify(after.levels);
}

/** One row of the preview: a later level or break as it will be, and what it was when that differs. */
export interface RestPreviewRow {
  key: string;
  /** "Level 7", "Break". */
  name: string;
  /** "800/1,600 · BB ante 1,600 · 15 min", "10 min · Colour up". */
  now: string;
  /** What the same level number (or the break after the same level) was, when different; "new" for a row that was not there. */
  was: string | null;
}

export interface RestPreview {
  rows: RestPreviewRow[];
  /** Later rows that go: "Level 25", "Break after Level 12". */
  removed: string[];
  /** "18 levels and 3 breaks after this one · 9 h 15 min of play left". */
  summary: string;
}

const levelWords = (level: PlayLevel, structure: Pick<ClockStructure, "anteMode">) => {
  const ante = anteText(level, structure.anteMode);
  return [formatBlinds(level), ante, `${String(level.durationMinutes)} min`].filter(Boolean).join(" · ");
};

const breakWords = (level: Extract<BlindLevel, { kind: "break" }>) => [`${String(level.durationMinutes)} min`, level.note].filter(Boolean).join(" · ");

/** The later rows by what identifies them across a reshape: level numbers, and the level each break follows. */
function laterRows(structure: ClockStructure, fromIndex: number) {
  let number = baseLevelOf(structure, fromIndex)?.number ?? 0;
  return structure.levels.slice(fromIndex + 1).map((level) => {
    if (level.kind === "level") {
      number++;
      return { key: `level:${String(number)}`, name: `Level ${String(number)}`, words: levelWords(level, structure), level };
    }
    return { key: `break:${String(number)}`, name: number > 0 ? `Break after Level ${String(number)}` : "Break", words: breakWords(level), level };
  });
}

/** The levels after the current one as `after` has them, each beside what it was in `before`. */
export function restPreview(before: ClockStructure, after: ClockStructure, fromIndex: number): RestPreview {
  const old = laterRows(before, fromIndex);
  const next = laterRows(after, fromIndex);
  const oldByKey = new Map<string, (typeof old)[number]>();
  for (const row of old) if (!oldByKey.has(row.key)) oldByKey.set(row.key, row);
  const nextKeys = new Set(next.map((row) => row.key));
  const rows = next.map((row, i): RestPreviewRow => {
    const was = oldByKey.get(row.key);
    return {
      key: `${row.key}:${String(i)}`,
      name: row.level.kind === "break" ? "Break" : row.name,
      now: row.words,
      was: was === undefined ? "new" : was.words === row.words ? null : was.words,
    };
  });
  const removed = old.filter((row) => !nextKeys.has(row.key)).map((row) => row.name);
  const plays = after.levels.slice(fromIndex + 1).filter((level) => level.kind === "level").length;
  const breaks = after.levels.slice(fromIndex + 1).length - plays;
  const minutes = after.levels.slice(fromIndex + 1).reduce((sum, level) => sum + level.durationMinutes, 0);
  const counted = breaks > 0 ? `${plural(plays, "level")} and ${plural(breaks, "break")}` : plural(plays, "level");
  return {
    rows,
    removed,
    summary: plays + breaks === 0 ? "Nothing after this level: it is the last" : `${counted} after this one · ${durationText(minutes)} to the end`,
  };
}

/** The most later levels the regenerator makes. */
export const MAX_REST_LEVELS = GENERATOR_LIMITS.maxLevels;
