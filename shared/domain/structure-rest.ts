/**
 * "Change the rest of the structure" (round 5, item 3): bulk edits to every level after the one the
 * clock is on. PURE: no runtime imports outside shared/domain, no I/O, zod-free.
 *
 * Played levels, and the current one, are never touched (same rows, same ids), so the clock keeps its
 * place: the Clock tab previews `reshapeRest(...)` and saves it through the structure editor's own
 * PUT /api/tournaments/:id/clock with `baseHash` (the same STRUCTURE_CHANGED and CURRENT_LEVEL_REMOVED
 * rules). What it can do, together or alone: set every later level's length; regenerate the later
 * blinds from the current level with a multiplier or a fixed step (rounded like the generator, antes
 * following the structure's ante mode); and keep, remove or re-space the breaks still to come.
 */
import { anteFor, defaultSmallestChip, GENERATOR_LIMITS, nextLevelId, nextSmallBlindAbove, roundSmallBlind, type BlindGrowth } from "./blind-structures";
import { CLOCK_LIMITS, type BlindLevel, type BreakLevel, type ClockStructure, type PlayLevel, type StructureProblem } from "./clock";

export type RestBlinds =
  /** Keep every later level's blinds (and antes). */
  | { kind: "keep" }
  /** `levelCount` new levels after the current one, each `growth` above the one before, starting from the current level's blinds. */
  | { kind: "regenerate"; growth: BlindGrowth; levelCount: number; smallestChip: number | null };

export type RestBreaks =
  /** Keep the breaks still to come where they are (after the same level numbers). */
  | { kind: "keep" }
  /** No more breaks. */
  | { kind: "none" }
  /** A break after every level whose number is a multiple of `everyLevels` (never after the last), each with an optional note by order. */
  | { kind: "every"; everyLevels: number; minutes: number; notes: readonly string[] };

export interface RestOfStructureInput {
  /** The row the clock is on (DerivedClock.levelIndex): it and every row before it stay as they are. */
  fromIndex: number;
  /** Every later play level's length in minutes, or null to keep each one's (regenerated levels then take the current level's). */
  levelMinutes: number | null;
  blinds: RestBlinds;
  /**
   * With the structure's ante mode not "none": antes on every later level numbered this or above
   * (and none below it). Null keeps them: kept levels keep theirs, regenerated levels have one when the
   * current level has one.
   */
  anteFromLevel: number | null;
  breaks: RestBreaks;
}

/** The play level the rest grows from: the one the clock is on, else the last one before it (the clock is on a break). */
function baseLevel(levels: readonly BlindLevel[], fromIndex: number): { level: PlayLevel; number: number } | null {
  let number = 0;
  let base: PlayLevel | null = null;
  for (let i = 0; i <= fromIndex && i < levels.length; i++) {
    const level = levels[i];
    if (level.kind === "level") {
      number++;
      base = level;
    }
  }
  return base ? { level: base, number } : null;
}

const wholeIn = (value: number, min: number, max: number) => Number.isInteger(value) && value >= min && value <= max;

/** What is wrong with `input` for `structure`; empty when reshapeRest can apply it. */
export function restOfStructureProblems(structure: ClockStructure, input: RestOfStructureInput): StructureProblem[] {
  const problems: StructureProblem[] = [];
  const add = (path: string, message: string) => problems.push({ path: [path], message });
  const { levels } = structure;
  if (!wholeIn(input.fromIndex, 0, levels.length - 1)) {
    add("fromIndex", "The clock's level is not in this structure");
    return problems;
  }
  if (input.levelMinutes !== null && !wholeIn(input.levelMinutes, CLOCK_LIMITS.minMinutes, CLOCK_LIMITS.maxMinutes)) {
    add("levelMinutes", `Levels last ${CLOCK_LIMITS.minMinutes} to ${CLOCK_LIMITS.maxMinutes} minutes`);
  }
  if (input.breaks.kind === "every") {
    if (!wholeIn(input.breaks.everyLevels, 1, GENERATOR_LIMITS.maxBreakEvery)) add("breaks", `Breaks can come every 1 to ${GENERATOR_LIMITS.maxBreakEvery} levels`);
    if (!wholeIn(input.breaks.minutes, CLOCK_LIMITS.minMinutes, GENERATOR_LIMITS.maxBreakMinutes)) add("breaks", `Breaks last 1 to ${GENERATOR_LIMITS.maxBreakMinutes} minutes`);
    if (input.breaks.notes.some((note) => note.trim().length > CLOCK_LIMITS.maxNoteLength)) add("breaks", `Break notes are at most ${CLOCK_LIMITS.maxNoteLength} characters`);
  }
  if (input.anteFromLevel !== null && !wholeIn(input.anteFromLevel, 1, CLOCK_LIMITS.maxLevels)) add("anteFromLevel", "The antes must start at a level number");
  const base = baseLevel(levels, input.fromIndex);
  if (input.blinds.kind === "regenerate") {
    const { growth, levelCount, smallestChip } = input.blinds;
    if (!base) {
      add("blinds", "No blind level has been reached yet: edit the structure instead");
      return problems;
    }
    if (!wholeIn(levelCount, 1, GENERATOR_LIMITS.maxLevels)) add("levelCount", `Choose between 1 and ${GENERATOR_LIMITS.maxLevels} levels`);
    const chip = smallestChip ?? chipOf(structure);
    if (!wholeIn(chip, 1, CLOCK_LIMITS.maxChips)) add("smallestChip", "Enter the smallest chip in play");
    if (growth.kind === "multiplier" && !(growth.factor >= GENERATOR_LIMITS.minFactor && growth.factor <= GENERATOR_LIMITS.maxFactor)) {
      add("growth", `Choose an increase between ×${GENERATOR_LIMITS.minFactor} and ×${GENERATOR_LIMITS.maxFactor}`);
    }
    if (growth.kind === "step" && (!(growth.bigBlindStep >= 2 * chip) || growth.bigBlindStep % (2 * chip) !== 0)) {
      add("growth", "The step must be a whole number of two smallest chips (so each small blind is exact)");
    }
    if (problems.length === 0) {
      const blinds = laterBigBlinds(base.level.bigBlind, growth, levelCount, chip);
      if (blinds.some((bigBlind, i) => bigBlind > CLOCK_LIMITS.maxChips || bigBlind <= (i === 0 ? base.level.bigBlind : blinds[i - 1]))) {
        add("growth", "The blinds would pass 100,000,000: use fewer levels or a smaller increase");
      }
    }
  }
  if (problems.length === 0 && reshape(structure, input).levels.length > CLOCK_LIMITS.maxLevels) {
    problems.push({ path: [], message: `A structure can have at most ${CLOCK_LIMITS.maxLevels} levels and breaks` });
  }
  return problems;
}

/** The smallest chip the structure's first blinds are made of (as "Add level" assumes). */
function chipOf(structure: ClockStructure): number {
  const first = structure.levels.find((level): level is PlayLevel => level.kind === "level");
  return first ? defaultSmallestChip(first.smallBlind, first.bigBlind) : 1;
}

/** `count` big blinds after `from`, each rounded like the generator's ladder and always above the one before. */
function laterBigBlinds(from: number, growth: BlindGrowth, count: number, chip: number): number[] {
  const blinds: number[] = [];
  let previous = from;
  for (let n = 0; n < count; n++) {
    let next: number;
    if (growth.kind === "multiplier") {
      next = 2 * roundSmallBlind((previous / 2) * growth.factor, chip);
      if (next <= previous) next = 2 * nextSmallBlindAbove(previous / 2, chip);
    } else {
      next = Math.round((previous + growth.bigBlindStep) / (2 * chip)) * 2 * chip;
      if (next <= previous) next = previous + 2 * chip;
    }
    blinds.push(next);
    previous = next;
  }
  return blinds;
}

/**
 * The structure with `input` applied to every row after `input.fromIndex`. Rows up to and including
 * it are the same objects' copies, ids unchanged; new rows get ids no other row has. Throws a
 * RangeError for input restOfStructureProblems refuses.
 */
export function reshapeRest(structure: ClockStructure, input: RestOfStructureInput): ClockStructure {
  const problems = restOfStructureProblems(structure, input);
  if (problems.length > 0) throw new RangeError(problems.map((problem) => problem.message).join("; "));
  return reshape(structure, input);
}

function reshape(structure: ClockStructure, input: RestOfStructureInput): ClockStructure {
  const kept = structure.levels.slice(0, input.fromIndex + 1).map((level) => ({ ...level }));
  const later = structure.levels.slice(input.fromIndex + 1);
  const base = baseLevel(structure.levels, input.fromIndex);
  const baseNumber = base?.number ?? 0;
  const chip = input.blinds.kind === "regenerate" ? (input.blinds.smallestChip ?? chipOf(structure)) : chipOf(structure);
  const anteAt = (number: number, bigBlind: number, had: boolean): number => {
    if (structure.anteMode === "none") return 0;
    if (input.anteFromLevel === null) return had ? anteFor(structure.anteMode, bigBlind, chip) : 0;
    return number >= input.anteFromLevel ? anteFor(structure.anteMode, bigBlind, chip) : 0;
  };
  const keptPlay = (level: PlayLevel, number: number): PlayLevel => ({
    ...level,
    durationMinutes: input.levelMinutes ?? level.durationMinutes,
    ante: input.anteFromLevel === null ? level.ante : anteAt(number, level.bigBlind, level.ante > 0),
  });

  // Keeping the blinds and the breaks: the same rows, each later level with its new length and antes.
  if (input.blinds.kind === "keep" && input.breaks.kind === "keep") {
    let number = baseNumber;
    const rest = later.map((level) => (level.kind === "level" ? keptPlay(level, ++number) : { ...level }));
    return { ...structure, levels: [...kept, ...rest] };
  }

  // The later play levels, numbered on from the base level.
  let plays: Array<{ level: PlayLevel; number: number }>;
  if (input.blinds.kind === "regenerate" && base) {
    const minutes = input.levelMinutes ?? base.level.durationMinutes;
    const hadAnte = base.level.ante > 0;
    plays = laterBigBlinds(base.level.bigBlind, input.blinds.growth, input.blinds.levelCount, chip).map((bigBlind, i) => ({
      number: baseNumber + i + 1,
      level: { kind: "level", id: "", durationMinutes: minutes, smallBlind: bigBlind / 2, bigBlind, ante: anteAt(baseNumber + i + 1, bigBlind, hadAnte) },
    }));
  } else {
    let number = baseNumber;
    plays = later.filter((level): level is PlayLevel => level.kind === "level").map((level) => ({ number: ++number, level: keptPlay(level, number) }));
  }
  const lastNumber = plays.length > 0 ? plays[plays.length - 1].number : baseNumber;

  // The breaks still to come, by the level number they follow (baseNumber: straight after the current row); never after the last level.
  const breaksAfter = new Map<number, BreakLevel[]>();
  const addBreak = (after: number, row: BreakLevel) => breaksAfter.set(after, [...(breaksAfter.get(after) ?? []), row]);
  if (input.breaks.kind === "keep") {
    let number = baseNumber;
    for (const level of later) {
      if (level.kind === "level") number++;
      else if (number < lastNumber) addBreak(number, { ...level });
    }
  } else if (input.breaks.kind === "every") {
    const { everyLevels, minutes, notes } = input.breaks;
    const onBreak = structure.levels[input.fromIndex]?.kind === "break";
    let made = 0;
    for (let number = onBreak || baseNumber === 0 ? baseNumber + 1 : baseNumber; number < lastNumber; number++) {
      if (number % everyLevels !== 0) continue;
      const note = notes[made]?.trim();
      made++;
      addBreak(number, { kind: "break", id: "", durationMinutes: minutes, note: note ? note : null });
    }
  }

  const rest: BlindLevel[] = [...(breaksAfter.get(baseNumber) ?? [])];
  for (const play of plays) rest.push(play.level, ...(breaksAfter.get(play.number) ?? []));
  return { ...structure, levels: [...kept, ...withFreshIds(structure.levels, rest)] };
}

/**
 * `rows` with every empty id replaced by "l<n>" / "b<n>" that no row of the structure as it was
 * (`original`) or of `rows` has. A new row never takes the id of a row it replaces: were the clock to
 * move into that row before the save lands, the server would find the id and keep the clock there,
 * on a level it never played (a level ended at once, or skipped), instead of refusing the stale save
 * with CURRENT_LEVEL_REMOVED (R5REV1-CLK-01).
 */
function withFreshIds(original: readonly BlindLevel[], rows: readonly BlindLevel[]): BlindLevel[] {
  const used = [...original, ...rows.filter((row) => row.id !== "")];
  return rows.map((row) => {
    if (row.id !== "") return row;
    const withId = { ...row, id: nextLevelId(used, row.kind) };
    used.push(withId);
    return withId;
  });
}

/** The editor's starting values for the rest of `structure` from `fromIndex`: what the later levels look like now. */
export interface RestDefaults {
  levelMinutes: number;
  levelCount: number;
  /** The increase between the last two play levels (rounded to 0.05, within the generator's range), or a step when they rise evenly. */
  growth: BlindGrowth;
  smallestChip: number;
  breaks: RestBreaks;
}

export function restDefaults(structure: ClockStructure, fromIndex: number): RestDefaults {
  const plays = structure.levels.filter((level): level is PlayLevel => level.kind === "level");
  const later = structure.levels.slice(fromIndex + 1);
  const laterPlays = later.filter((level): level is PlayLevel => level.kind === "level");
  const current = baseLevel(structure.levels, fromIndex)?.level ?? plays[0];
  const last = plays[plays.length - 1];
  const beforeLast = plays[plays.length - 2];
  const ratio = last && beforeLast && beforeLast.bigBlind > 0 ? last.bigBlind / beforeLast.bigBlind : 1.5;
  const factor = Math.min(GENERATOR_LIMITS.maxFactor, Math.max(GENERATOR_LIMITS.minFactor, Math.round(ratio * 20) / 20));
  const laterBreaks = later.filter((level) => level.kind === "break");
  return {
    levelMinutes: laterPlays[0]?.durationMinutes ?? current?.durationMinutes ?? 15,
    levelCount: Math.max(1, laterPlays.length),
    growth: { kind: "multiplier", factor },
    smallestChip: chipOf(structure),
    breaks: laterBreaks.length > 0 ? { kind: "keep" } : { kind: "none" },
  };
}
