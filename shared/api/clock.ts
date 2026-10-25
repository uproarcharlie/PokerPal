/**
 * /api/tournaments/:id/clock/* and /api/clubs/:id/blind-structures: the tournament clock's request
 * schemas and DTOs (phase4-contracts §3). The clock logic itself is shared/domain/clock (zod-free, for
 * the TV display); these schemas validate requests against the same shapes (clock.test.ts proves the
 * zod output types equal the domain types).
 *
 * Writes need a manager of the tournament's club (admin, owner or manager) and an open tournament
 * (409 TOURNAMENT_CLOSED once it is completed or cancelled). Every write answers with the fresh
 * LiveDisplayDto (shared/api/live-display), and every 409 it sends carries it too, as
 * `details: { display }`, so a device that lost a race shows the clock as it now is.
 */
import { z } from "zod";
import {
  ANTE_MODES,
  CLOCK_LIMITS,
  LEVEL_ID_PATTERN,
  structureProblems,
  type ClockActionName,
  type ClockStatus,
  type ClockStructure,
} from "../domain/clock";
import { BLIND_PRESET_KEYS, GENERATOR_LIMITS, generatorProblems, type BlindPresetKey } from "../domain/blind-structures";
import type { UpcomingStatus } from "../domain/tournaments";
import { idSchema } from "./common";

const chips = z.number().int("Whole chips only").min(0).max(CLOCK_LIMITS.maxChips);
const levelId = z.string().regex(LEVEL_ID_PATTERN, "Invalid level id");
const minutes = z.number().int("Whole minutes only").min(CLOCK_LIMITS.minMinutes).max(CLOCK_LIMITS.maxMinutes);
const stack = z.number().int("Whole chips only").min(1).max(CLOCK_LIMITS.maxChips).nullable();

export const playLevelSchema = z.object({
  kind: z.literal("level"),
  id: levelId,
  durationMinutes: minutes,
  smallBlind: chips,
  bigBlind: chips.min(1, "The big blind must be at least 1"),
  ante: chips.default(0),
});

export const breakLevelSchema = z.object({
  kind: z.literal("break"),
  id: levelId,
  durationMinutes: minutes,
  note: z
    .string()
    .trim()
    .max(CLOCK_LIMITS.maxNoteLength)
    .nullable()
    .default(null)
    .transform((note) => (note ? note : null)),
});

export const blindLevelSchema = z.discriminatedUnion("kind", [playLevelSchema, breakLevelSchema]);

/** Levels and breaks in play order: at least one blind level, unique ids, big blind ≥ small blind. */
export const blindLevelsSchema = z
  .array(blindLevelSchema)
  .min(1, "Add at least one blind level")
  .max(CLOCK_LIMITS.maxLevels)
  .superRefine((levels, ctx) => {
    for (const problem of structureProblems(levels)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: problem.path, message: problem.message });
  });

export const anteModeSchema = z.enum(ANTE_MODES);

/** A structure: the levels, the ante mode, and the stacks the chip figures use (null: not set). */
export const clockStructureSchema = z.object({
  levels: blindLevelsSchema,
  anteMode: anteModeSchema,
  startingStack: stack,
  rebuyStack: stack,
  addonStack: stack,
  earlyBirdStack: stack,
});

/** What the TV shows, per clock. Stored as given; read back field by field (resolveDisplaySettings). */
export const clockDisplaySettingsSchema = z.object({
  /** The prize pool: always, only once the pool is locked (the default: no disputes over an estimate), or never. */
  showPrizePool: z.enum(["always", "when_locked", "never"]).default("when_locked"),
  showPayouts: z.boolean().default(true),
  /** The club's take, under its label ("AP"). */
  showAp: z.boolean().default(false),
  showAverageStack: z.boolean().default(true),
  /** Where the QR code leads: the season leaderboard (falls back to the tournament page), the tournament, seat finder, or no QR. */
  qrTarget: z.enum(["season", "tournament", "seats", "none"]).default("season"),
  /** A full-screen layer over the clock, e.g. the seat list after a draw. */
  overlay: z.enum(["none", "seating", "payouts"]).default("none"),
});
export type ClockDisplaySettings = z.infer<typeof clockDisplaySettingsSchema>;
export type QrTarget = ClockDisplaySettings["qrTarget"];

export const DEFAULT_DISPLAY_SETTINGS: Readonly<ClockDisplaySettings> = Object.freeze(clockDisplaySettingsSchema.parse({}));

/** PATCH /api/tournaments/:id/clock/display: any of the settings; unknown keys refused. */
export const clockDisplaySettingsPatchSchema = z
  .object({
    showPrizePool: clockDisplaySettingsSchema.shape.showPrizePool.removeDefault(),
    showPayouts: z.boolean(),
    showAp: z.boolean(),
    showAverageStack: z.boolean(),
    qrTarget: clockDisplaySettingsSchema.shape.qrTarget.removeDefault(),
    overlay: clockDisplaySettingsSchema.shape.overlay.removeDefault(),
  })
  .partial()
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, "Nothing to update");
export type ClockDisplaySettingsPatch = z.infer<typeof clockDisplaySettingsPatchSchema>;

/** Stored settings as the display uses them: each valid field kept, anything else its default. Never throws. */
export function resolveDisplaySettings(raw: unknown): ClockDisplaySettings {
  const stored = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const settings = { ...DEFAULT_DISPLAY_SETTINGS };
  for (const key of Object.keys(settings) as Array<keyof ClockDisplaySettings>) {
    const parsed = clockDisplaySettingsSchema.shape[key].safeParse(stored[key]);
    if (parsed.success && stored[key] !== undefined) Object.assign(settings, { [key]: parsed.data });
  }
  return settings;
}

/**
 * PUT /api/tournaments/:id/clock: create the clock (baseHash null; 409 CLOCK_EXISTS if it exists) or
 * replace its structure (baseHash = the structureHash the editor started from; 409 STRUCTURE_CHANGED
 * when someone saved since). The clock keeps its place (rebaseOnStructureChange: 409
 * CURRENT_LEVEL_REMOVED for deleting the level a running or paused clock is on); a finished clock is
 * 409 CLOCK_FINISHED. Antes are cleared when anteMode is "none". Saving clears the undo snapshot.
 */
export const clockConfigSchema = z.object({
  structure: clockStructureSchema,
  presetKey: z.enum(BLIND_PRESET_KEYS).nullable().optional(),
  /** Only on create: the initial display settings (later changes go through PATCH .../clock/display). */
  displaySettings: clockDisplaySettingsPatchSchema.optional(),
  baseHash: z.string().regex(/^[0-9a-f]{8}$/, "Invalid structure hash").nullable(),
});
export type ClockConfigInput = z.infer<typeof clockConfigSchema>;

const expectedLevelIndex = z.number().int().min(0).max(CLOCK_LIMITS.maxLevels - 1).optional();
const levelIndex = z.number().int().min(0).max(CLOCK_LIMITS.maxLevels - 1);

/** POST /api/tournaments/:id/clock/actions (domain semantics: applyClockAction). */
export const clockActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), alsoStartTournament: z.boolean().optional() }),
  z.object({ action: z.literal("pause") }),
  z.object({ action: z.literal("resume"), alsoStartTournament: z.boolean().optional() }),
  z.object({ action: z.literal("toggle"), expectedStatus: z.enum(["idle", "running", "paused"]).optional(), alsoStartTournament: z.boolean().optional() }),
  z.object({ action: z.literal("next"), expectedLevelIndex }),
  z.object({ action: z.literal("prev"), expectedLevelIndex }),
  z.object({ action: z.literal("jump"), levelIndex, expectedLevelIndex }),
  z.object({
    action: z.literal("adjust"),
    deltaSeconds: z.number().int().min(-3600).max(3600).refine((seconds) => seconds !== 0, "Must not be 0"),
    expectedLevelIndex,
  }),
  z.object({ action: z.literal("set_remaining"), remainingSeconds: z.number().int().min(0).max(CLOCK_LIMITS.maxRemainingMs / 1000), expectedLevelIndex }),
  z.object({ action: z.literal("reset") }),
  /** `expectedUndo`: the ClockUndoDto `at` and `redo` the device showed; when another undo is stored by then, nothing changes (200). */
  z.object({ action: z.literal("undo"), expectedUndo: z.object({ at: z.number().int().min(0), redo: z.boolean() }).optional() }),
]);
export type ClockActionInput = z.infer<typeof clockActionSchema>;

const generatorMinutes = z.number().int().min(CLOCK_LIMITS.minMinutes).max(CLOCK_LIMITS.maxMinutes);

/**
 * The structure generator's form (client only: the generator runs in the browser, and the result is
 * saved with PUT .../clock like any edit). Same rules as shared/domain/blind-structures
 * generatorProblems.
 */
export const structureGeneratorSchema = z
  .object({
    startingStack: z.number().int().min(1).max(CLOCK_LIMITS.maxChips),
    smallBlind: z.number().int().min(1).max(CLOCK_LIMITS.maxChips),
    bigBlind: z.number().int().min(1).max(CLOCK_LIMITS.maxChips),
    growth: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("multiplier"), factor: z.number().min(GENERATOR_LIMITS.minFactor).max(GENERATOR_LIMITS.maxFactor) }),
      z.object({ kind: z.literal("step"), bigBlindStep: z.number().int().min(1).max(CLOCK_LIMITS.maxChips) }),
    ]),
    levelCount: z.number().int().min(GENERATOR_LIMITS.minLevels).max(GENERATOR_LIMITS.maxLevels),
    levelMinutes: generatorMinutes,
    laterLevels: z
      .object({ minutes: generatorMinutes, startsAfter: z.union([z.number().int().min(1).max(GENERATOR_LIMITS.maxLevels), z.literal("first_break")]) })
      .nullable(),
    breaks: z
      .object({
        everyLevels: z.number().int().min(1).max(GENERATOR_LIMITS.maxBreakEvery),
        minutes: z.number().int().min(1).max(GENERATOR_LIMITS.maxBreakMinutes),
        notes: z.array(z.string().trim().max(CLOCK_LIMITS.maxNoteLength)).max(GENERATOR_LIMITS.maxLevels).default([]),
      })
      .nullable(),
    ante: z.object({ mode: anteModeSchema, fromLevel: z.number().int().min(1).max(GENERATOR_LIMITS.maxLevels) }),
    smallestChip: z.number().int().min(1).max(CLOCK_LIMITS.maxChips).nullable(),
    rebuyStack: stack,
    addonStack: stack,
    earlyBirdStack: stack,
  })
  .superRefine((input, ctx) => {
    for (const problem of generatorProblems(input)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: problem.path, message: problem.message });
  });

/** POST /api/tournaments/:id/early-birds: give (or take back) the early-bird bonus for these entries. */
export const earlyBirdsSchema = z.object({
  registrationIds: z.array(idSchema).min(1).max(500),
  earlyBird: z.boolean(),
});
export type EarlyBirdsInput = z.infer<typeof earlyBirdsSchema>;

/**
 * What Undo would do now (shared/domain/clock ClockUndo): take back `action` (described as the activity
 * feed has it) or, when `redo`, put it back. It lapses at `expiresAt` or once the clock is no longer on
 * `levelIndex` (undoAvailable(undo, derived.levelIndex, now) says whether it still works between polls).
 * Send `{ at, redo }` back as the undo action's expectedUndo. Times are epoch ms.
 */
export interface ClockUndoDto {
  action: Exclude<ClockActionName, "undo">;
  description: string;
  redo: boolean;
  at: number;
  expiresAt: number;
  levelIndex: number;
  /** The change also started the tournament from this status: Undo puts the tournament back to it (Redo starts it again). */
  startedTournamentFrom: UpcomingStatus | null;
}

/** The clock as every screen reads it (part of LiveDisplayDto). Times are epoch ms. */
export interface ClockDto {
  version: number;
  status: ClockStatus;
  currentLevelIndex: number;
  periodEndsAt: number | null;
  pausedRemainingMs: number | null;
  startedAt: number | null;
  structure: ClockStructure;
  /** structureHash(structure): send it back as baseHash when saving an edit. */
  structureHash: string;
  presetKey: BlindPresetKey | null;
  displaySettings: ClockDisplaySettings;
  /**
   * What Undo would do, as the response was built (null: nothing to undo). Only for a viewer who may
   * run the clock (viewer.canControl), and only while it has not lapsed.
   */
  undo: ClockUndoDto | null;
  updatedAt: string;
}

/**
 * 201 POST /api/tournaments/:id/clock/key: the TV's clock key, shown once. A screen that sends it as the
 * CLOCK_KEY_HEADER (shared/domain/clock) may run this tournament's clock (POST .../clock/actions) and
 * nothing else, without anyone signing in on it. `path` is the TV clock's link with the key in its
 * fragment (shared/domain/urls clockKeyLink). It works until `expiresAt` (CLOCK_LIMITS.keyLifetimeMs)
 * and only while whoever issued it may still manage the club. Issuing a new key revokes the old one; so
 * do DELETE .../clock/key, removing the clock, cancelling and finalizing the tournament.
 */
export interface ClockKeyDto {
  key: string;
  issuedAt: string;
  expiresAt: string;
  path: string;
}

/** 200 POST /api/tournaments/:id/early-birds. */
export interface EarlyBirdsResultDto {
  /** The entries whose flag changed (others already had it). */
  changed: string[];
  /** How many entries now have the bonus. */
  earlyBirds: number;
}

/** GET /api/clubs/:id/blind-structures (club staff): structures of the club's recent tournaments, for "copy from a previous game". */
export interface BlindStructureSourceDto {
  tournamentId: string;
  tournamentName: string;
  startDateTime: string;
  presetKey: BlindPresetKey | null;
  structure: ClockStructure;
  structureHash: string;
}
