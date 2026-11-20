/**
 * The "High hands" part of the tournament form and of the Money tab's high-hand editor (round 10): each
 * high hand as its boxes hold it, the schema that checks them (the shared list schema, fed what was
 * typed), and what the editor says around them. Pure, so every rule is unit-tested.
 */
import { z } from "zod";
import { rakeTypeSchema, type RakeType } from "@shared/api/common";
import { highHandsListSchema, type HighHandInput } from "@shared/api/high-hands";
import type { PublicRegistration } from "@shared/api/public";
import {
  HIGH_HAND_LIMITS,
  HIGH_HAND_WINNER_CHOICES,
  highHandEntrantCounts,
  highHandLabel,
  highHandsOf,
  highHandWinners,
  twoHighHandsPreset,
  type HighHandsInput,
} from "@shared/domain/high-hands";
import { centsToDecimalString, formatMoney, toCents } from "@shared/domain/money";
import { errorDetails, isApiError } from "@/lib/api/http";
import { plural } from "@/lib/format";
import { rakeTypeOf, rateAmountText } from "./rate-text";

/** One high hand as the form's boxes hold it. */
export interface HighHandFormValue {
  /** The high hand's id ("legacy" for a tournament's one high hand of before round 10), or "" for one not saved yet. */
  highHandId: string;
  name: string;
  entryFee: string;
  /** The number of prizes, as the segmented choice holds it ("1" to "4"; a count a tie raised may be more). */
  winners: string;
  rakeType: RakeType;
  rakeAmount: string;
  note: string;
}

/** The values of a form that holds a list of high hands (the tournament form, the Money tab's editor). */
export interface HighHandsFormValues {
  highHands: HighHandFormValue[];
}

/** One high hand's boxes as the request's high hand: a new one without an id, a rate of "none" without its amount. */
const highHandFormItem = z
  .object({
    highHandId: z.string(),
    name: z.string(),
    entryFee: z.string(),
    winners: z.string(),
    rakeType: rakeTypeSchema,
    rakeAmount: z.string(),
    note: z.string(),
  })
  .transform(({ highHandId, winners, rakeType, rakeAmount, ...rest }) => ({
    ...(highHandId ? { id: highHandId } : {}),
    ...rest,
    winners: Number(winners),
    rakeType,
    rakeAmount: rakeType === "none" ? undefined : rakeAmount,
  }));

/**
 * The list as typed, checked by the shared list schema (shared/api/high-hands): a name each (once,
 * ignoring case), a fee above $0, a rate within 100%. Its problems name the box: `highHands.1.entryFee`.
 */
export const highHandsFormSchema = z.array(highHandFormItem).pipe(highHandsListSchema);

/** The list to send, from boxes that have passed the schema. */
export const highHandsInput = (values: readonly HighHandFormValue[]): HighHandInput[] => highHandsFormSchema.parse(values);

/** The tournament's high hands as the form starts from them: its listed ones, or its legacy one (id "legacy"), or none. */
export function highHandFormValues(tournament: HighHandsInput): HighHandFormValue[] {
  return highHandsOf(tournament).map((highHand) => {
    const rakeType = rakeTypeOf(highHand.rakeType);
    return {
      highHandId: highHand.id,
      name: highHand.name,
      entryFee: centsToDecimalString(toCents(highHand.entryFee)),
      winners: String(highHandWinners(highHand)),
      rakeType,
      rakeAmount: rateAmountText(rakeType, highHand.rakeAmount),
      note: highHand.note ?? "",
    };
  });
}

/** A new high hand's boxes: the next free "High hand 2" name, one prize, no AP. */
export function newHighHand(current: readonly Pick<HighHandFormValue, "name">[]): HighHandFormValue {
  const taken = new Set(current.map(({ name }) => name.trim().toLowerCase()));
  let number = current.length + 1;
  while (taken.has(`high hand ${number}`)) number += 1;
  return { highHandId: "", name: `High hand ${number}`, entryFee: "", winners: "1", rakeType: "none", rakeAmount: "", note: "" };
}

/** What "Two high hands at $5 each" puts in the boxes. */
export const TWO_HIGH_HANDS_FEE = "5.00";

/**
 * "Two high hands at $5 each" (twoHighHandsPreset): a first-half and a second-half high hand. They take
 * the places of the high hands already listed, in order, so a saved one (the legacy one with its
 * players and winners, too) becomes the first half rather than being removed.
 */
export function twoHighHandsValues(current: readonly Pick<HighHandFormValue, "highHandId">[]): HighHandFormValue[] {
  return twoHighHandsPreset(TWO_HIGH_HANDS_FEE).map((highHand, index) => ({
    highHandId: current[index]?.highHandId ?? "",
    name: highHand.name,
    entryFee: centsToDecimalString(toCents(highHand.entryFee)),
    winners: String(highHand.winners ?? 1),
    rakeType: "none",
    rakeAmount: "",
    note: highHand.note ?? "",
  }));
}

/** The numbers of prizes the form offers: 1 to 4, and a stored count a tie raised beyond them. */
export function winnerChoices(stored: string): string[] {
  const choices = HIGH_HAND_WINNER_CHOICES.map(String);
  return choices.includes(stored) || !/^\d+$/.test(stored) ? choices : [...choices, stored];
}

/** "All high hands: $10.00": what entering every one costs, from the fees typed so far (a box not yet a fee counts nothing). */
export function allHighHandsText(values: readonly Pick<HighHandFormValue, "entryFee">[]): string {
  const cents = values.reduce((sum, { entryFee }) => sum + (/^\d{1,8}(\.\d{1,2})?$/.test(entryFee.trim()) ? toCents(entryFee.trim()) : 0), 0);
  return formatMoney(cents, { forceCents: true });
}

export const canAddHighHand = (values: readonly unknown[]): boolean => values.length < HIGH_HAND_LIMITS.maxHighHands;

/**
 * Why a high hand cannot be taken off the list: players are in it (the server refuses that,
 * HIGH_HAND_ENTRIES, paid or not), or null when it can.
 */
export function removeBlockedBecause(value: Pick<HighHandFormValue, "highHandId" | "name">, entrants: Readonly<Record<string, number>>): string | null {
  const count = value.highHandId ? (entrants[value.highHandId] ?? 0) : 0;
  if (count === 0) return null;
  return `${plural(count, "player is", "players are")} in the ${highHandLabel(value.name)}: take them out of it first (Fix on their entry).`;
}

/** How many registrations are in each of the tournament's high hands (the field's and the waiting list's, paid or not). */
export function highHandEntrantsOf(
  tournament: HighHandsInput,
  registrations: readonly Pick<PublicRegistration, "enteringHighHands" | "highHandIds">[],
): Record<string, number> {
  return Object.fromEntries(highHandEntrantCounts(tournament, registrations));
}

/** Whether two lists, as they will be sent, say the same: an edit that leaves them alone does not send them. */
export const sameHighHands = (a: readonly HighHandInput[], b: readonly HighHandInput[]): boolean => JSON.stringify(a) === JSON.stringify(b);

/** A box of one high hand, by the form's name ("highHands.1.entryFee"). */
export const isHighHandField = (name: string): boolean => /^highHands\.\d+\.(name|entryFee|winners|rakeType|rakeAmount|note)$/.test(name);

/**
 * The high hand a refusal is about (`details.highHandId`: HIGH_HAND_AWARDED, HIGH_HAND_OVER_POOL,
 * HIGH_HAND_ENTRIES), as its place in the form's list, with the server's sentence; null for any other
 * refusal, or one about a high hand no longer on the form.
 */
export function highHandProblem(error: unknown, values: readonly Pick<HighHandFormValue, "highHandId">[]): { index: number; message: string } | null {
  const details = errorDetails(error, "HIGH_HAND_AWARDED", "HIGH_HAND_OVER_POOL", "HIGH_HAND_ENTRIES");
  const highHandId = details?.highHandId;
  if (typeof highHandId !== "string" || !isApiError(error)) return null;
  const index = values.findIndex((value) => value.highHandId === highHandId);
  return index === -1 ? null : { index, message: error.error };
}

/** One change a 409 ENTRIES_REPRICED names: a price of the tournament's, or (round 10) a high hand's fee. */
const ENTRY_WORDS: Readonly<Record<string, [string, string]>> = {
  buyInAmount: ["buy-in", "buy-ins"],
  // Round 11: each buy-in's bounty ("3 bounties from $0.00 to $100.00").
  bountyAmount: ["bounty", "bounties"],
  rebuyAmount: ["re-buy", "re-buys"],
  addonAmount: ["add-on", "add-ons"],
  highHandAmount: ["high-hand entry", "high-hand entries"],
};

/**
 * What a re-pricing re-prices, one line per price ("3 buy-ins from $50.00 to $60.00", "2 entries in the
 * First half high hand from $5.00 to $6.00"), both kinds a 409 ENTRIES_REPRICED may carry (round 10);
 * empty when its details are not as expected (the server's sentence is shown then).
 */
export function repricingLines(error: unknown): string[] {
  const changes = errorDetails(error, "ENTRIES_REPRICED")?.changes;
  if (!Array.isArray(changes)) return [];
  const lines = changes.map((change: unknown) => {
    if (typeof change !== "object" || change === null) return null;
    const { field, name, count, fromCents, toCents: to } = change as Record<string, unknown>;
    if (typeof count !== "number" || typeof fromCents !== "number" || typeof to !== "number") return null;
    const prices = `from ${formatMoney(fromCents, { forceCents: true })} to ${formatMoney(to, { forceCents: true })}`;
    if (typeof name === "string") return `${plural(count, "entry", "entries")} in the ${highHandLabel(name)} ${prices}`;
    const words = typeof field === "string" ? ENTRY_WORDS[field] : undefined;
    return words ? `${count} ${count === 1 ? words[0] : words[1]} ${prices}` : null;
  });
  return lines.every((line): line is string => line !== null) ? lines : [];
}
