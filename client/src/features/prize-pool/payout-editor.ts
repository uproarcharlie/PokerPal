/**
 * The payout editor's values and wording (round 5, items 1 and 16): the boxes the TD types into, read as
 * the places shared/domain/payouts pays (each place a percentage of the pool or a fixed amount, paid
 * exactly as set), where any money they leave over goes (shared/domain/prize-difference: the club keeps
 * it unless the TD chooses otherwise), checked by the request schema the server checks with
 * (payoutsUpdateSchema), and the live sum line. What a place pays is always the domain's figure, never
 * worked out here.
 */
import { z } from "zod";
import { moneySchema } from "@shared/api/common";
import { payoutsUpdateSchema, toPayoutPlaces, type PayoutPlaceInput } from "@shared/api/prize-pool";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { formatMoney, type Cents } from "@shared/domain/money";
import { amountBoxText } from "@/lib/format";
import {
  addPayoutPlace,
  changePlaceKind,
  parseCustomPayouts,
  PAYOUT_STRUCTURE_KEYS,
  PAYOUT_STRUCTURE_LABELS,
  PAYOUT_STRUCTURES,
  placeName,
  placesFromShares,
  type PayoutPlace,
  type PayoutStructureKey,
  type StandardPayoutKey,
} from "@shared/domain/payouts";
import {
  PRIZE_DIFFERENCE_CHOICES,
  readPrizeDifference,
  type PrizeDifference,
  type PrizeDifferenceChoice,
} from "@shared/domain/prize-difference";
import type { PrizePoolBreakdown } from "@shared/domain/prize-pool";

/** One place as its boxes hold it: how it is set, and the number typed ("50" for 50%, "300" for $300). */
export interface PayoutRowValues {
  kind: PayoutPlace["kind"];
  value: string;
}

export interface PayoutEditorValues {
  payoutStructure: PayoutStructureKey;
  /** The custom places (shown and sent only for "custom"; kept while a standard structure is looked at). */
  places: PayoutRowValues[];
  /** Where money the prizes leave over goes (round 5, item 16). */
  prizeDifference: PrizeDifferenceChoice;
  reason: string;
}

/** The money the editor works from: the pool a percentage is of (a manual pool, else what is available) and the money available for prizes. */
export interface EditorMoney {
  poolCents: Cents;
  availableCents: Cents;
}

export const editorMoney = (breakdown: Pick<PrizePoolBreakdown, "manualPrizePool" | "netAfterAp">): EditorMoney => ({
  poolCents: breakdown.manualPrizePool ?? breakdown.netAfterAp,
  availableCents: breakdown.netAfterAp,
});

/** Why the TD changed the payouts: one tap each, or typed. Shown in the public activity feed. */
export const PAYOUT_REASONS = ["Short field", "Bigger field", "Correction"] as const;

const NUMBER_TEXT = /^\d+(\.\d+)?$/;

const isStructureKey = (key: string | null | undefined): key is PayoutStructureKey =>
  typeof key === "string" && (PAYOUT_STRUCTURE_KEYS as readonly string[]).includes(key);

/** "Top 5" for "Top 5 (40/25/20/10/5)": the structure's name without its split. */
export const structureName = (key: PayoutStructureKey) => PAYOUT_STRUCTURE_LABELS[key].split(" (")[0];

/** "40 / 25 / 20 / 10 / 5": a standard structure's percentages. */
export const structureSplit = (key: StandardPayoutKey) => PAYOUT_STRUCTURES[key].map((bp) => bp / 100).join(" / ");

/** A place as the editor's boxes show it: "50" (%), "300" ($300) or "12.50" ($12.50). */
export function rowOf(place: PayoutPlace): PayoutRowValues {
  if (place.kind === "percent") return { kind: "percent", value: String(place.basisPoints / 100) };
  return { kind: "amount", value: amountBoxText(place.amountCents) };
}

/** Whether a row's box holds a number of its kind (a percentage, or an amount to the cent). */
function typed(row: PayoutRowValues): boolean {
  const text = row.value.trim();
  return row.kind === "percent" ? NUMBER_TEXT.test(text) : moneySchema.safeParse(text).success;
}

/** A row as the request sends it (only for a row whose box holds a number). */
function inputOf(row: PayoutRowValues): PayoutPlaceInput {
  const text = row.value.trim();
  return row.kind === "percent" ? { kind: "percent", percent: Number(text) } : { kind: "amount", amount: text };
}

/**
 * The place a row holds so far, for the live sum: a box that is not a number yet pays nothing (the
 * domain's preview counts it as nothing and names the place).
 */
export function placeOfRow(row: PayoutRowValues): PayoutPlace {
  if (typed(row)) return toPayoutPlaces([inputOf(row)])[0];
  return row.kind === "percent" ? { kind: "percent", basisPoints: Number.NaN } : { kind: "amount", amountCents: Number.NaN };
}

export const placesOfRows = (rows: readonly PayoutRowValues[]): PayoutPlace[] => rows.map(placeOfRow);

/** The custom places the tournament has stored, or null when none are set up (or they cannot be read). */
export function storedPlaces(tournament: Pick<TournamentDetailDto, "customPayouts">): PayoutPlace[] | null {
  const parsed = parseCustomPayouts(tournament.customPayouts);
  return parsed.ok ? parsed.places : null;
}

/**
 * What the editor opens on: the stored structure, and as the custom places those stored, or else
 * Standard's, so Custom always starts from something that pays.
 */
export function startingValues(tournament: Pick<TournamentDetailDto, "payoutStructure" | "customPayouts" | "prizeDifference">): PayoutEditorValues {
  const payoutStructure = isStructureKey(tournament.payoutStructure) ? tournament.payoutStructure : "standard";
  const places = storedPlaces(tournament) ?? placesFromShares(PAYOUT_STRUCTURES.standard);
  return { payoutStructure, places: places.map(rowOf), prizeDifference: readPrizeDifference(tournament.prizeDifference), reason: "" };
}

/** A standard structure's places, to start the custom ones from ("Change these places"). */
export const rowsOfStructure = (key: StandardPayoutKey): PayoutRowValues[] => placesFromShares(PAYOUT_STRUCTURES[key]).map(rowOf);

/** "Add a place": one more below the last, of its kind, at half of it (an empty box when the last is not a number yet). */
export function addedRow(rows: readonly PayoutRowValues[]): PayoutRowValues {
  const last = rows[rows.length - 1];
  if (last && !typed(last)) return { kind: last.kind, value: "" };
  const places = placesOfRows(rows);
  return rowOf(addPayoutPlace(places)[places.length]);
}

/** The row switched to `kind`, keeping what it pays from `poolCents` (an empty box when it is not a number yet). */
export function switchedRow(rows: readonly PayoutRowValues[], index: number, kind: PayoutPlace["kind"], poolCents: Cents): PayoutRowValues {
  const row = rows[index];
  if (row.kind === kind) return row;
  if (!typed(row)) return { kind, value: "" };
  return rowOf(changePlaceKind(placesOfRows(rows), index, kind, poolCents)[index]);
}

const TYPE_MESSAGES: Readonly<Record<PayoutPlace["kind"], string>> = {
  percent: "Enter a percentage, e.g. 25 or 12.5",
  amount: "Enter an amount, e.g. 300 or 12.50",
};

/** The request the boxes make (each custom place's box holding a number of its kind). */
function requestOf({ payoutStructure, places, prizeDifference, reason }: PayoutEditorValues) {
  return { payoutStructure, ...(payoutStructure === "custom" ? { places: places.map(inputOf) } : {}), prizeDifference, reason };
}

/** Where an issue of the request goes on the form: a place's issue on its box, the rest where the request has it. */
const formPath = (path: ReadonlyArray<string | number>) => (path[0] === "places" && typeof path[1] === "number" ? ["places", path[1], "value"] : [...path]);

/**
 * The boxes checked as the server checks them: each custom place a number of its kind, then the
 * request schema (payoutsUpdateSchema, the shared rules), every issue about a place put on that place's
 * box and one about the places together on `places`. Parsing gives the request body.
 */
export const payoutsFormSchema = z
  .object({
    payoutStructure: z.enum(PAYOUT_STRUCTURE_KEYS),
    places: z.array(z.object({ kind: z.enum(["percent", "amount"]), value: z.string() })),
    prizeDifference: z.enum(PRIZE_DIFFERENCE_CHOICES),
    reason: z.string(),
  })
  .superRefine((values, ctx) => {
    if (values.payoutStructure === "custom") {
      const untyped = values.places.flatMap((row, index) => (typed(row) ? [] : [{ index, kind: row.kind }]));
      for (const { index, kind } of untyped) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["places", index, "value"], message: TYPE_MESSAGES[kind] });
      if (untyped.length > 0) return;
    }
    const checked = payoutsUpdateSchema.safeParse(requestOf(values));
    if (checked.success) return;
    for (const issue of checked.error.issues) ctx.addIssue({ code: z.ZodIssueCode.custom, path: formPath(issue.path), message: issue.message });
  })
  .transform(requestOf)
  .pipe(payoutsUpdateSchema);

/** The issue about the custom places together ("The percentages add up to 110%, over 100%") for the values as they are now. */
export function placesProblem(values: PayoutEditorValues): string | undefined {
  const result = payoutsFormSchema.safeParse(values);
  return result.success ? undefined : result.error.issues.find((issue) => issue.path.length === 1 && issue.path[0] === "places")?.message;
}

/** What the sum line says, and how it looks. */
export interface PayoutSumLine {
  tone: "exact" | "leftover" | "over" | "empty";
  text: string;
}

/** Where money left over goes, as the end of "$44 left over …". */
const LEFTOVER_GOES: Readonly<Record<PrizeDifferenceChoice, (carryTarget: string) => string>> = {
  club: () => "is kept by the club",
  first: () => "goes to 1st",
  pro_rata: () => "is shared across the paid places",
  carry: (carryTarget) => `is carried over to ${carryTarget}`,
};

/**
 * The live sum check of the prizes as set against the money available: what is left over and where it
 * goes, what the club adds when they are more, or that they add up exactly.
 */
export function sumLine(difference: Pick<PrizeDifference, "cents" | "choice" | "availableCents" | "setCents">, carryTarget: string): PayoutSumLine {
  if (difference.availableCents <= 0 && difference.setCents <= 0) {
    return { tone: "empty", text: "No prize pool yet: each place is worked out as players enter." };
  }
  if (difference.cents < 0) return { tone: "over", text: `Added by the club: ${formatMoney(-difference.cents)}` };
  if (difference.cents > 0) return { tone: "leftover", text: `${formatMoney(difference.cents)} left over ${LEFTOVER_GOES[difference.choice](carryTarget)}` };
  return { tone: "exact", text: `Adds up to the ${formatMoney(difference.availableCents)} available for prizes exactly` };
}

/**
 * The sum line while the places still have a problem (a box half typed, percentages over 100%): what
 * the places typed so far add up to beside the money available, with no word yet on where a
 * difference goes.
 */
export function roughSumLine(placedCents: Cents, availableCents: Cents): PayoutSumLine {
  const so = `The places add up to ${formatMoney(placedCents)}`;
  const available = `the ${formatMoney(Math.max(0, availableCents))} available for prizes`;
  if (placedCents > availableCents) return { tone: "over", text: `${so}, ${formatMoney(placedCents - availableCents)} more than ${available}` };
  if (placedCents < availableCents) return { tone: "leftover", text: `${so}, ${formatMoney(availableCents - placedCents)} less than ${available}` };
  return { tone: "exact", text: `${so}: ${available}` };
}

/** What Save asks first: that the club adds money to pay the prizes as set. */
export interface PayoutsSaveCheck {
  title: string;
  description: string;
  confirmLabel: string;
}

/**
 * Whether saving needs the TD's word first (R5REV-HOST-06): when the prizes as set add up to more than
 * the money available, the club adds the difference (a guarantee). A leftover needs no second question:
 * the editor asks where it goes as the TD types. Null otherwise.
 */
export function payoutsSaveCheck(difference: Pick<PrizeDifference, "cents" | "availableCents" | "setCents"> | null): PayoutsSaveCheck | null {
  if (!difference || difference.cents >= 0) return null;
  const added = formatMoney(-difference.cents);
  return {
    title: `The club adds ${added}`,
    description:
      `The prizes add up to ${formatMoney(difference.setCents)}, ${added} more than the ${formatMoney(Math.max(0, difference.availableCents))} available for prizes. ` +
      `They are paid as set and the club adds ${added} ("Added by the club"), less if more players enter.`,
    confirmLabel: `Save: the club adds ${added}`,
  };
}

/** Why the places beyond the players entered are not paid yet, or null when everyone placed can be paid. */
export function unpaidPlacesNote(places: number, entrants: number): string | null {
  if (entrants <= 0 || entrants >= places) return null;
  const players = `${entrants} ${entrants === 1 ? "player has" : "players have"}`;
  return `Only ${players} entered: places below ${placeName(entrants)} are paid only if more players enter.`;
}

/** Whether the payouts sent would pay what is paid now: the same structure and choice, and for Custom the same places. */
export function sameAsStored(
  values: PayoutEditorValues,
  tournament: Pick<TournamentDetailDto, "payoutStructure" | "customPayouts" | "prizeDifference">,
): boolean {
  const stored = startingValues(tournament);
  if (values.payoutStructure !== stored.payoutStructure || values.prizeDifference !== stored.prizeDifference) return false;
  if (values.payoutStructure !== "custom") return true;
  const saved = storedPlaces(tournament);
  if (!saved) return false;
  const now = placesOfRows(values.places);
  return now.length === saved.length && now.every((place, i) => JSON.stringify(place) === JSON.stringify(saved[i]));
}

