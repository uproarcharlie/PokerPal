/**
 * The structure editor's form: its values (every number box as text), the schema that checks them
 * (the shared clockStructureSchema, fed the numbers typed into the boxes), and the rows "Add level",
 * "Insert level" and "Insert break" make. Pure, so every rule is unit-tested.
 */
import { z } from "zod";
import { clockStructureSchema } from "@shared/api/clock";
import { CENTRAL_STARS_REBUY_BREAK_NOTE, nextLevelId, suggestNextLevel } from "@shared/domain/blind-structures";
import { formatBlinds, levelNumberAt, type AnteMode, type BlindLevel, type ClockStructure, type PlayLevel } from "@shared/domain/clock";
import { plural } from "@/lib/format";
import { readNumber } from "@/lib/forms";

/** One row of the editor: a level or a break. `levelId` keeps the clock on its level across edits. */
export interface LevelRowValues {
  kind: BlindLevel["kind"];
  levelId: string;
  durationMinutes: string;
  smallBlind: string;
  bigBlind: string;
  ante: string;
  note: string;
}

export interface StructureFormValues {
  levels: LevelRowValues[];
  anteMode: AnteMode;
  startingStack: string;
  rebuyStack: string;
  addonStack: string;
  earlyBirdStack: string;
}

const text = (value: number | null) => (value === null ? "" : String(value));

function rowOf(level: BlindLevel): LevelRowValues {
  return level.kind === "level"
    ? {
        kind: "level",
        levelId: level.id,
        durationMinutes: text(level.durationMinutes),
        smallBlind: text(level.smallBlind),
        bigBlind: text(level.bigBlind),
        ante: level.ante > 0 ? text(level.ante) : "",
        note: "",
      }
    : { kind: "break", levelId: level.id, durationMinutes: text(level.durationMinutes), smallBlind: "", bigBlind: "", ante: "", note: level.note ?? "" };
}

/** The form's values for a structure (the editor starts from the saved one). */
export function structureValues(structure: ClockStructure): StructureFormValues {
  return {
    levels: structure.levels.map(rowOf),
    anteMode: structure.anteMode,
    startingStack: text(structure.startingStack),
    rebuyStack: text(structure.rebuyStack),
    addonStack: text(structure.addonStack),
    earlyBirdStack: text(structure.earlyBirdStack),
  };
}

/**
 * A row as the request reads it: the boxes' numbers, and only what its kind has. A blank ante is no
 * ante, and so is any ante while the structure has none (the boxes are hidden then).
 */
function levelInput(row: LevelRowValues, anteMode: AnteMode): unknown {
  if (row.kind === "break") return { kind: "break", id: row.levelId, durationMinutes: readNumber(row.durationMinutes), note: row.note };
  return {
    kind: "level",
    id: row.levelId,
    durationMinutes: readNumber(row.durationMinutes),
    smallBlind: readNumber(row.smallBlind),
    bigBlind: readNumber(row.bigBlind),
    ante: anteMode === "none" || row.ante.trim() === "" ? 0 : readNumber(row.ante),
  };
}

/** The values in the request's shape, for the shared schema to check (its issue paths name the form's fields). */
function structureInput(values: unknown): unknown {
  if (typeof values !== "object" || values === null) return values;
  const form = values as StructureFormValues;
  return {
    levels: Array.isArray(form.levels) ? form.levels.map((row) => levelInput(row, form.anteMode)) : form.levels,
    anteMode: form.anteMode,
    startingStack: readNumber(form.startingStack),
    rebuyStack: readNumber(form.rebuyStack),
    addonStack: readNumber(form.addonStack),
    earlyBirdStack: readNumber(form.earlyBirdStack),
  };
}

/** The editor's schema: the request's own (clockStructureSchema), over the numbers typed. Its output is the structure to send. */
export const structureFormSchema = z.preprocess(structureInput, clockStructureSchema);

/** The rows as levels, as far as they can be read (for numbering, totals and suggestions while typing). */
function draftLevels(rows: readonly LevelRowValues[]): BlindLevel[] {
  const whole = (value: string) => {
    const number = Number(value.trim());
    return value.trim() !== "" && Number.isInteger(number) && number >= 0 ? number : 0;
  };
  return rows.map((row) =>
    row.kind === "break"
      ? { kind: "break", id: row.levelId, durationMinutes: whole(row.durationMinutes), note: row.note.trim() || null }
      : { kind: "level", id: row.levelId, durationMinutes: whole(row.durationMinutes), smallBlind: whole(row.smallBlind), bigBlind: whole(row.bigBlind), ante: whole(row.ante) },
  );
}

/** "Level 3" or "Break 1", as the editor names a row (each name its own, for the boxes' labels). */
export function rowTitle(rows: readonly Pick<LevelRowValues, "kind">[], index: number): string {
  const kind = rows[index]?.kind ?? "level";
  const count = rows.slice(0, index + 1).filter((row) => row.kind === kind).length;
  return `${kind === "level" ? "Level" : "Break"} ${String(count)}`;
}


/** "6 h 45 min", "45 min". */
export function durationText(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${String(rest)} min`;
  return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest)} min`;
}

/**
 * A structure in a line: "24 levels · 8 h 15 min in all"; with `from`, the blinds play starts at in
 * place of "in all", to tell presets and earlier games apart: "24 levels · from 200/400 · 8 h 15 min".
 */
export function structureSummary(levels: readonly BlindLevel[], { from = false }: { from?: boolean } = {}): string {
  const plays = levels.filter((level): level is PlayLevel => level.kind === "level");
  const duration = durationText(levels.reduce((sum, level) => sum + level.durationMinutes, 0));
  const count = plural(plays.length, "level");
  return from ? `${count} · from ${plays[0] ? formatBlinds(plays[0]) : "–"} · ${duration}` : `${count} · ${duration} in all`;
}

/** The summary of the editor's rows, as far as they can be read while typing. */
export const rowsSummary = (rows: readonly LevelRowValues[]) => structureSummary(draftLevels(rows));

/**
 * The level to put after row `afterIndex` (the end when omitted): about a third above the last
 * playable level before it (suggestNextLevel), with an id no row has.
 */
export function suggestedRow(rows: readonly LevelRowValues[], anteMode: AnteMode, afterIndex = rows.length - 1): LevelRowValues {
  const all = draftLevels(rows);
  const before = all.slice(0, afterIndex + 1).filter((level): level is PlayLevel => level.kind === "level" && level.smallBlind > 0 && level.bigBlind >= level.smallBlind);
  const suggestion = suggestNextLevel(before, anteMode);
  return rowOf({ ...suggestion, id: nextLevelId(all, "level") });
}

/** A 10-minute break with no note, with an id no row has. */
export function breakRow(rows: readonly LevelRowValues[]): LevelRowValues {
  return rowOf({ kind: "break", id: nextLevelId(draftLevels(rows), "break"), durationMinutes: 10, note: null });
}

/**
 * Minutes of clock time, breaks included, to the end of the break where re-buys and add-ons close (a
 * break noted "Last re-buys / add-ons", as Central Stars' format has); null without one. What the
 * tournament's re-buy period should be for the TV's countdown to close them with that break.
 */
export function rebuyBreakEndMinutes(levels: readonly BlindLevel[]): number | null {
  let minutes = 0;
  for (const level of levels) {
    minutes += level.durationMinutes;
    if (level.kind === "break" && level.note === CENTRAL_STARS_REBUY_BREAK_NOTE) return minutes;
  }
  return null;
}

/** "Level 3 · 400/800" or "Break · Colour up", for the jump-to-level list. */
export function levelOption(levels: readonly BlindLevel[], index: number): string {
  const level = levels[index];
  if (level.kind === "break") return level.note ? `Break · ${level.note}` : `Break (${String(level.durationMinutes)} min)`;
  return `Level ${String(levelNumberAt(levels, index))} · ${formatBlinds(level)}`;
}
