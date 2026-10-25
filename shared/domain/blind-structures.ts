/**
 * Blind structures: a generator (stack, first blinds, growth, chip rounding, level lengths, breaks,
 * antes) and the built-in presets, including Central Stars' "One Life Line". PURE: no runtime imports
 * but ./clock, no I/O.
 *
 * Blinds are rounded the way real ladders are written: the small blind is a "nice" amount, m × 10^k
 * for m in 1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8, that the smallest chip in play makes exactly, and
 * the big blind is twice it (after level 1, which is as entered). So 100-chips give 300/600, 800/1,600
 * and 1,200/2,400 but never 150/300. An everyone-ante is about 10–12.5% of the big blind, rounded to a
 * nice amount of the smallest chip; a big-blind ante equals the big blind.
 */
import { CLOCK_LIMITS, type AnteMode, type BlindLevel, type ClockStructure, type PlayLevel, type StructureProblem } from "./clock";

/** Chip values a club's set usually has, smallest first. */
export const CHIP_DENOMINATIONS = [1, 5, 25, 100, 500, 1_000, 5_000, 25_000, 100_000] as const;

const NICE_MANTISSAS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8] as const;

/** Every nice whole amount up to the chip limit, ascending. */
const NICE_AMOUNTS: readonly number[] = (() => {
  const amounts = new Set<number>();
  for (let power = 1; power <= CLOCK_LIMITS.maxChips; power *= 10) {
    for (const mantissa of NICE_MANTISSAS) {
      const amount = Math.round(mantissa * power * 10) / 10;
      if (Number.isInteger(amount) && amount <= CLOCK_LIMITS.maxChips) amounts.add(amount);
    }
  }
  return Array.from(amounts).sort((a, b) => a - b);
})();

/** The largest chip in CHIP_DENOMINATIONS that makes both blinds exactly (1 when none bigger does). */
export function defaultSmallestChip(smallBlind: number, bigBlind: number): number {
  const fits = CHIP_DENOMINATIONS.filter((chip) => smallBlind % chip === 0 && bigBlind % chip === 0);
  return fits.length > 0 ? fits[fits.length - 1] : 1;
}

/** The nice small blinds `smallestChip` makes exactly (with a big blind of twice it within the limit), ascending. */
function smallBlindLadder(smallestChip: number): number[] {
  const ladder = NICE_AMOUNTS.filter((amount) => amount % smallestChip === 0 && amount * 2 <= CLOCK_LIMITS.maxChips);
  return ladder.length > 0 ? ladder : [smallestChip];
}

/** The nice small blind nearest `value` that `smallestChip` makes exactly (ties: the smaller). */
export function roundSmallBlind(value: number, smallestChip: number): number {
  const ladder = smallBlindLadder(smallestChip);
  let best = ladder[0];
  for (const amount of ladder) if (Math.abs(amount - value) < Math.abs(best - value)) best = amount;
  return best;
}

/** The smallest nice small blind above `smallBlind` that `smallestChip` makes; half the chip limit at most. */
export function nextSmallBlindAbove(smallBlind: number, smallestChip: number): number {
  return smallBlindLadder(smallestChip).find((amount) => amount > smallBlind) ?? Math.floor(CLOCK_LIMITS.maxChips / 2);
}

/**
 * An ante for every player at big blind `bigBlind`: the nice amount of the smallest chip nearest 11%
 * of it, preferring one between 10% and 12.5%; never less than one smallest chip.
 */
export function everyoneAnte(bigBlind: number, smallestChip: number): number {
  const target = bigBlind * 0.11;
  const candidates = NICE_AMOUNTS.filter((amount) => amount % smallestChip === 0 && amount <= bigBlind);
  if (candidates.length === 0) return smallestChip;
  const inRange = candidates.filter((amount) => amount >= bigBlind * 0.1 && amount <= bigBlind * 0.125);
  const pool = inRange.length > 0 ? inRange : candidates;
  let best = pool[0];
  for (const amount of pool) if (Math.abs(amount - target) < Math.abs(best - target)) best = amount;
  return best;
}

/** The ante at a level of big blind `bigBlind` under `mode`. */
export function anteFor(mode: AnteMode, bigBlind: number, smallestChip: number): number {
  if (mode === "bb_ante") return bigBlind;
  if (mode === "everyone") return everyoneAnte(bigBlind, smallestChip);
  return 0;
}

// ---------------------------------------------------------------------------------------------------
// The generator

export type BlindGrowth =
  /** Each level's blinds about `factor` times the last (1.25–1.6 is usual), rounded to nice amounts. */
  | { kind: "multiplier"; factor: number }
  /** Each big blind `bigBlindStep` more than the last. */
  | { kind: "step"; bigBlindStep: number };

export interface StructureGeneratorInput {
  startingStack: number;
  /** Level 1's blinds; later small blinds are half the big blind. */
  smallBlind: number;
  bigBlind: number;
  growth: BlindGrowth;
  /** How many play levels (breaks come on top). */
  levelCount: number;
  levelMinutes: number;
  /** A different length for later levels: after play level N, or after the first break. */
  laterLevels: { minutes: number; startsAfter: number | "first_break" } | null;
  /** A break after every N play levels (never after the last), each with an optional note by order. */
  breaks: { everyLevels: number; minutes: number; notes: readonly string[] } | null;
  ante: { mode: AnteMode; fromLevel: number };
  /** The smallest chip in play; defaults to the largest denomination that makes level 1's blinds. */
  smallestChip: number | null;
  /** Carried into the structure as they are. */
  rebuyStack: number | null;
  addonStack: number | null;
  earlyBirdStack: number | null;
}

export const GENERATOR_LIMITS = {
  minLevels: 1,
  maxLevels: 60,
  minFactor: 1.05,
  maxFactor: 3,
  maxBreakEvery: 20,
  maxBreakMinutes: 120,
} as const;

/** What is wrong with generator settings (the request schema checks types and plain ranges first). */
export function generatorProblems(input: StructureGeneratorInput): StructureProblem[] {
  const problems: StructureProblem[] = [];
  const add = (path: string, message: string) => problems.push({ path: [path], message });
  const wholeIn = (value: number, min: number, max: number) => Number.isInteger(value) && value >= min && value <= max;
  const chip = input.smallestChip ?? defaultSmallestChip(input.smallBlind, input.bigBlind);
  if (!wholeIn(input.startingStack, 1, CLOCK_LIMITS.maxChips)) add("startingStack", "Enter a starting stack of at least 1 chip");
  if (!wholeIn(input.smallBlind, 1, CLOCK_LIMITS.maxChips)) add("smallBlind", "Enter a small blind of at least 1 chip");
  if (!wholeIn(input.bigBlind, 1, CLOCK_LIMITS.maxChips)) add("bigBlind", "Enter a big blind of at least 1 chip");
  else if (input.bigBlind < input.smallBlind) add("bigBlind", "The big blind must be at least the small blind");
  if (!wholeIn(chip, 1, CLOCK_LIMITS.maxChips) || input.smallBlind % chip !== 0 || input.bigBlind % chip !== 0) {
    add("smallestChip", "The smallest chip must make the first blinds exactly");
  }
  if (!wholeIn(input.levelCount, GENERATOR_LIMITS.minLevels, GENERATOR_LIMITS.maxLevels)) {
    add("levelCount", `Choose between ${GENERATOR_LIMITS.minLevels} and ${GENERATOR_LIMITS.maxLevels} levels`);
  }
  const minutesProblem = (value: number, max: number) => !wholeIn(value, CLOCK_LIMITS.minMinutes, max);
  if (minutesProblem(input.levelMinutes, CLOCK_LIMITS.maxMinutes)) add("levelMinutes", `Levels last 1 to ${CLOCK_LIMITS.maxMinutes} minutes`);
  if (input.laterLevels && minutesProblem(input.laterLevels.minutes, CLOCK_LIMITS.maxMinutes)) {
    add("laterLevels", `Levels last 1 to ${CLOCK_LIMITS.maxMinutes} minutes`);
  }
  if (input.breaks && minutesProblem(input.breaks.minutes, GENERATOR_LIMITS.maxBreakMinutes)) {
    add("breaks", `Breaks last 1 to ${GENERATOR_LIMITS.maxBreakMinutes} minutes`);
  }
  const last = input.levelCount - 1;
  if (input.growth.kind === "multiplier") {
    const { factor } = input.growth;
    if (!(factor >= GENERATOR_LIMITS.minFactor && factor <= GENERATOR_LIMITS.maxFactor)) {
      add("growth", `Choose an increase between ×${GENERATOR_LIMITS.minFactor} and ×${GENERATOR_LIMITS.maxFactor}`);
    } else if (input.bigBlind * factor ** last > CLOCK_LIMITS.maxChips) {
      add("growth", "The blinds would pass 100,000,000: use fewer levels or a smaller increase");
    }
  } else if (!(input.growth.bigBlindStep >= 2 * chip) || input.growth.bigBlindStep % (2 * chip) !== 0) {
    add("growth", "The step must be a whole number of two smallest chips (so each small blind is exact)");
  } else if (input.bigBlind + input.growth.bigBlindStep * last > CLOCK_LIMITS.maxChips) {
    add("growth", "The blinds would pass 100,000,000: use fewer levels or a smaller step");
  }
  // The ladder rounds each step up to a nice amount, so it can rise faster than the curve checked
  // above: settings whose rounded blinds would stop rising at the chip limit are refused too.
  if (problems.length === 0 && !strictlyRisingWithinLimit(bigBlinds(input, chip))) {
    add("growth", `The blinds would pass 100,000,000: use fewer levels or a smaller ${input.growth.kind === "multiplier" ? "increase" : "step"}`);
  }
  if (input.laterLevels && typeof input.laterLevels.startsAfter === "number" && input.laterLevels.startsAfter >= input.levelCount) {
    add("laterLevels", "The later length must start before the last level");
  }
  // A break comes after every `everyLevels` levels but never after the last one (generateStructure).
  const makesABreak = input.breaks !== null && input.breaks.everyLevels < input.levelCount;
  if (input.laterLevels?.startsAfter === "first_break" && !makesABreak) add("laterLevels", "There is no break to start the later length after");
  if (input.breaks && (input.breaks.everyLevels < 1 || input.breaks.everyLevels > GENERATOR_LIMITS.maxBreakEvery)) {
    add("breaks", `Breaks can come every 1 to ${GENERATOR_LIMITS.maxBreakEvery} levels`);
  }
  if (input.ante.mode !== "none" && (input.ante.fromLevel < 1 || input.ante.fromLevel > input.levelCount)) {
    add("ante", "The antes must start at one of the levels");
  }
  return problems;
}

/**
 * The big blind of every play level, from level 1's. With a multiplier, each small blind is the nice
 * amount nearest the last one × factor, or the next nice amount up where that is no more (at the
 * bottom of the ladder one chip is a big step). Starting each step from the last level, not from a
 * curve, keeps the ladder free of near-repeats such as 7,500 then 8,000.
 */
function bigBlinds(input: StructureGeneratorInput, chip: number): number[] {
  const blinds = [input.bigBlind];
  for (let n = 1; n < input.levelCount; n++) {
    const previous = blinds[n - 1];
    let next: number;
    if (input.growth.kind === "multiplier") {
      next = 2 * roundSmallBlind((previous / 2) * input.growth.factor, chip);
      if (next <= previous) next = 2 * nextSmallBlindAbove(previous / 2, chip);
    } else {
      // A whole number of two smallest chips, so the small blind (half) is exact.
      next = Math.round((input.bigBlind + input.growth.bigBlindStep * n) / (2 * chip)) * 2 * chip;
      if (next <= previous) next = previous + 2 * chip;
    }
    blinds.push(next);
  }
  return blinds;
}

/** Every big blind above the one before it and none past the chip limit. */
function strictlyRisingWithinLimit(blinds: readonly number[]): boolean {
  return blinds.every((bigBlind, i) => bigBlind <= CLOCK_LIMITS.maxChips && (i === 0 || bigBlind > blinds[i - 1]));
}

/**
 * A structure from generator settings. Level ids are "l1".."lN" and break ids "b1".."bM", so the
 * same settings always give the same structure. Throws a RangeError for settings
 * `generatorProblems` refuses.
 */
export function generateStructure(input: StructureGeneratorInput): ClockStructure {
  const problems = generatorProblems(input);
  if (problems.length > 0) throw new RangeError(problems.map((problem) => problem.message).join("; "));
  const chip = input.smallestChip ?? defaultSmallestChip(input.smallBlind, input.bigBlind);
  const blinds = bigBlinds(input, chip);
  const levels: BlindLevel[] = [];
  let breaksSoFar = 0;
  blinds.forEach((bigBlind, i) => {
    const number = i + 1;
    const later =
      input.laterLevels !== null &&
      (input.laterLevels.startsAfter === "first_break" ? breaksSoFar > 0 : number > input.laterLevels.startsAfter);
    const ante = input.ante.mode !== "none" && number >= input.ante.fromLevel ? anteFor(input.ante.mode, bigBlind, chip) : 0;
    levels.push({
      kind: "level",
      id: `l${number}`,
      durationMinutes: later && input.laterLevels ? input.laterLevels.minutes : input.levelMinutes,
      smallBlind: i === 0 ? input.smallBlind : bigBlind / 2,
      bigBlind,
      ante,
    });
    if (input.breaks && number % input.breaks.everyLevels === 0 && number < input.levelCount) {
      const note = input.breaks.notes[breaksSoFar]?.trim();
      breaksSoFar += 1;
      levels.push({ kind: "break", id: `b${breaksSoFar}`, durationMinutes: input.breaks.minutes, note: note ? note : null });
    }
  });
  return {
    levels,
    anteMode: input.ante.mode,
    startingStack: input.startingStack,
    rebuyStack: input.rebuyStack,
    addonStack: input.addonStack,
    earlyBirdStack: input.earlyBirdStack,
  };
}

// ---------------------------------------------------------------------------------------------------
// Editing helpers

/** An id no level in `levels` has: "l<n>" for a play level, "b<n>" for a break, n one past the highest used. */
export function nextLevelId(levels: readonly BlindLevel[], kind: BlindLevel["kind"]): string {
  const prefix = kind === "level" ? "l" : "b";
  const pattern = new RegExp(`^${prefix}(\\d+)$`);
  const used = levels.map((level) => Number(pattern.exec(level.id)?.[1] ?? 0));
  let next = Math.max(0, ...used) + 1;
  while (levels.some((level) => level.id === `${prefix}${next}`)) next++;
  return `${prefix}${next}`;
}

/**
 * The level "Add level" appends: blinds about a third above the last play level's (always more, on
 * the nice ladder of level 1's smallest chip), the same length, and an ante if the last level had one.
 * With no play level yet: 100/200 for 15 minutes.
 */
export function suggestNextLevel(levels: readonly BlindLevel[], anteMode: AnteMode): PlayLevel {
  const plays = levels.filter((level): level is PlayLevel => level.kind === "level");
  const last = plays[plays.length - 1];
  const id = nextLevelId(levels, "level");
  if (!last) return { kind: "level", id, durationMinutes: 15, smallBlind: 100, bigBlind: 200, ante: 0 };
  const chip = defaultSmallestChip(plays[0].smallBlind, plays[0].bigBlind);
  const smallBlind = Math.max(nextSmallBlindAbove(last.bigBlind / 2, chip), roundSmallBlind((last.bigBlind / 2) * 1.33, chip));
  const bigBlind = 2 * smallBlind;
  const ante = anteMode !== "none" && last.ante > 0 ? anteFor(anteMode, bigBlind, chip) : 0;
  return { kind: "level", id, durationMinutes: last.durationMinutes, smallBlind, bigBlind, ante };
}

// ---------------------------------------------------------------------------------------------------
// Presets

export const BLIND_PRESET_KEYS = ["central_stars_one_life_line", "turbo_10", "standard_15", "deep_20"] as const;
export type BlindPresetKey = (typeof BLIND_PRESET_KEYS)[number];

/** A club format the tournament form can copy: amounts as decimal(10,2) text, like the API's. */
export interface PresetFormat {
  buyInAmount: string;
  rebuyAmount: string | null;
  addonAmount: string | null;
  maxRebuys: number | null;
  /** Add-ons per player (null: no limit); enforced like maxRebuys (shared/domain/player-actions topUpRefusal). */
  maxAddons: number | null;
  /** A player takes re-buys or add-ons, not both; enforced too. */
  rebuyOrAddon: boolean;
  /** Minutes from the start to the end of the break where re-buys and add-ons close. */
  rebuyPeriodMinutes: number | null;
  /** The format in words, for the clock and the form (the limits above are also enforced). */
  notes: readonly string[];
}

export interface BlindPreset {
  key: BlindPresetKey;
  name: string;
  description: string;
  structure: ClockStructure;
  /** The generator settings it came from, for "start from this preset"; null for a hand-made ladder. */
  generator: StructureGeneratorInput | null;
  format: PresetFormat | null;
}

const play = (number: number, smallBlind: number, bigBlind: number, durationMinutes: number, ante: number): PlayLevel => ({
  kind: "level",
  id: `l${number}`,
  durationMinutes,
  smallBlind,
  bigBlind,
  ante,
});
const pause = (number: number, durationMinutes: number, note: string | null): BlindLevel => ({ kind: "break", id: `b${number}`, durationMinutes, note });

/** The break note where Central Stars' single re-buy / add-on window closes. */
export const CENTRAL_STARS_REBUY_BREAK_NOTE = "Last re-buys / add-ons";

/**
 * Central Stars' "One Life Line" (their flyer): $100 buy-in for 80,000; one $25 re-buy OR one $25
 * add-on, each 120,000, until the end of the first break; a 25,000 early-bird bonus; 20-minute levels
 * before the first break and 15-minute levels after; cash entry.
 *
 * The ladder (chosen for an 80,000 stack, 200 big blinds deep at the start): 200/400 to 800/1,600 in
 * six 20-minute levels (two hours), with a big-blind ante from level 4 (500/1,000); a 15-minute break
 * "Last re-buys / add-ons"; then 15-minute levels from 1,000/2,000, where every blind is a multiple of
 * 500 so the 100s can come off; a 10-minute colour-up break after level 12 (5,000/10,000) and a
 * 10-minute break after level 18; up to 100,000/200,000 at level 24.
 */
const CENTRAL_STARS_LEVELS: BlindLevel[] = [
  play(1, 200, 400, 20, 0),
  play(2, 300, 600, 20, 0),
  play(3, 400, 800, 20, 0),
  play(4, 500, 1_000, 20, 1_000),
  play(5, 600, 1_200, 20, 1_200),
  play(6, 800, 1_600, 20, 1_600),
  pause(1, 15, CENTRAL_STARS_REBUY_BREAK_NOTE),
  play(7, 1_000, 2_000, 15, 2_000),
  play(8, 1_500, 3_000, 15, 3_000),
  play(9, 2_000, 4_000, 15, 4_000),
  play(10, 3_000, 6_000, 15, 6_000),
  play(11, 4_000, 8_000, 15, 8_000),
  play(12, 5_000, 10_000, 15, 10_000),
  pause(2, 10, "Colour up"),
  play(13, 6_000, 12_000, 15, 12_000),
  play(14, 8_000, 16_000, 15, 16_000),
  play(15, 10_000, 20_000, 15, 20_000),
  play(16, 15_000, 30_000, 15, 30_000),
  play(17, 20_000, 40_000, 15, 40_000),
  play(18, 25_000, 50_000, 15, 50_000),
  pause(3, 10, null),
  play(19, 30_000, 60_000, 15, 60_000),
  play(20, 40_000, 80_000, 15, 80_000),
  play(21, 50_000, 100_000, 15, 100_000),
  play(22, 60_000, 120_000, 15, 120_000),
  play(23, 80_000, 160_000, 15, 160_000),
  play(24, 100_000, 200_000, 15, 200_000),
];

const generic = (
  settings: Omit<StructureGeneratorInput, "smallestChip" | "rebuyStack" | "addonStack" | "earlyBirdStack" | "laterLevels">,
): StructureGeneratorInput => ({ ...settings, smallestChip: null, laterLevels: null, rebuyStack: null, addonStack: null, earlyBirdStack: null });

const TURBO_10 = generic({
  startingStack: 10_000,
  smallBlind: 25,
  bigBlind: 50,
  growth: { kind: "multiplier", factor: 1.4 },
  levelCount: 18,
  levelMinutes: 10,
  breaks: { everyLevels: 6, minutes: 10, notes: ["Colour up the 25s"] },
  ante: { mode: "bb_ante", fromLevel: 7 },
});

const STANDARD_15 = generic({
  startingStack: 25_000,
  smallBlind: 100,
  bigBlind: 200,
  growth: { kind: "multiplier", factor: 1.3 },
  levelCount: 20,
  levelMinutes: 15,
  breaks: { everyLevels: 5, minutes: 10, notes: [] },
  ante: { mode: "bb_ante", fromLevel: 6 },
});

const DEEP_20 = generic({
  startingStack: 50_000,
  smallBlind: 100,
  bigBlind: 200,
  growth: { kind: "multiplier", factor: 1.25 },
  levelCount: 24,
  levelMinutes: 20,
  breaks: { everyLevels: 4, minutes: 15, notes: [] },
  ante: { mode: "everyone", fromLevel: 5 },
});

/** The built-in presets, Central Stars' first. */
export const BLIND_PRESETS: readonly BlindPreset[] = Object.freeze([
  {
    key: "central_stars_one_life_line",
    name: "Central Stars · One Life Line",
    description: "80,000 stack · 20-minute levels, 15 after the break · one re-buy or add-on for 120,000 · 25,000 early bird",
    structure: {
      levels: CENTRAL_STARS_LEVELS,
      anteMode: "bb_ante",
      startingStack: 80_000,
      rebuyStack: 120_000,
      addonStack: 120_000,
      earlyBirdStack: 25_000,
    },
    generator: null,
    format: {
      buyInAmount: "100.00",
      rebuyAmount: "25.00",
      addonAmount: "25.00",
      maxRebuys: 1,
      maxAddons: 1,
      rebuyOrAddon: true,
      rebuyPeriodMinutes: 135,
      notes: ["One life line: one $25 re-buy or one $25 add-on (120,000), not both", "Early-bird bonus 25,000", "Cash entry"],
    },
  },
  {
    key: "turbo_10",
    name: "Turbo · 10-minute levels",
    description: "10,000 stack · 25/50 start · big-blind ante from level 7",
    structure: generateStructure(TURBO_10),
    generator: TURBO_10,
    format: null,
  },
  {
    key: "standard_15",
    name: "Standard · 15-minute levels",
    description: "25,000 stack · 100/200 start · big-blind ante from level 6",
    structure: generateStructure(STANDARD_15),
    generator: STANDARD_15,
    format: null,
  },
  {
    key: "deep_20",
    name: "Deep stack · 20-minute levels",
    description: "50,000 stack · 100/200 start · antes for everyone from level 5",
    structure: generateStructure(DEEP_20),
    generator: DEEP_20,
    format: null,
  },
]);

export function isBlindPresetKey(value: unknown): value is BlindPresetKey {
  return typeof value === "string" && (BLIND_PRESET_KEYS as readonly string[]).includes(value);
}

/** A copy of a preset's structure, safe to edit. */
export function presetStructure(key: BlindPresetKey): ClockStructure {
  const preset = BLIND_PRESETS.find((candidate) => candidate.key === key) as BlindPreset;
  return { ...preset.structure, levels: preset.structure.levels.map((level) => ({ ...level })) };
}
