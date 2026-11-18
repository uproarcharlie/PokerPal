/**
 * Round 10: several high hands per game, each its own pot, and players enter the ones they want
 * (shared/domain/high-hands has the rules and the maths). A tournament either LISTS its high hands
 * (tournament_high_hands) or keeps its one high hand, if any, in its legacy columns; every endpoint here
 * names a high hand by its id, and the legacy one by LEGACY_HIGH_HAND_ID ("legacy"), so a client treats
 * both alike (read a tournament's high hands with highHandsOf, an entry's with highHandIdsOf and
 * highHandWinsOf).
 *
 * Who sees what (round 6 and 8 rules): a high hand's name, fee, number of prizes, note, its pot and its
 * awards are public (what players play for); its AP rule (`rakeType`, `rakeAmount`) and the AP taken
 * from its pot are staff-only (shared/api/public FORBIDDEN_TAKINGS_KEYS has them), never on a public
 * page, the TV or a public answer. High-hand fees are paid at the door (round 8): a bank transfer is the
 * buy-in only.
 */
import { z } from "zod";
import {
  HIGH_HAND_LIMITS,
  HIGH_HAND_PRIZES_MAX,
  type HighHandAward,
  type HighHandAtDoor,
  type HighHandPot,
} from "../domain/high-hands";
import { toCents, type Cents } from "../domain/money";
import { idSchema, integerSchema, moneySchema, optionalMoneySchema, optionalText, rakeTypeSchema, requiredText, type RakeType } from "./common";
import type { ManagedRegistration } from "./registrations";

export { HIGH_HAND_LIMITS, HIGH_HAND_PRIZES_MAX, HIGH_HAND_WINNER_CHOICES, LEGACY_HIGH_HAND_ID } from "../domain/high-hands";

const reasonSchema = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((value) => (value ? value : undefined));

/* ---------- what a tournament's high hands look like ---------- */

/** One high hand as anyone may see it: no AP. `id` is a tournament_high_hands id, or LEGACY_HIGH_HAND_ID. */
export interface PublicHighHandDto {
  id: string;
  name: string;
  /** From 1, in the order the club set. */
  position: number;
  /** What entering it costs, as decimal(10,2) text ("5.00"). */
  entryFee: string;
  /** How many prizes its pot is split into (a tie adds one). */
  winners: number;
  note: string | null;
}

/** A high hand's AP rule: for the club's staff only (both keys are in FORBIDDEN_TAKINGS_KEYS). */
export interface HighHandTakingsDto {
  rakeType: RakeType;
  /** The percentage, or the flat amount taken from the pot, as decimal(10,2) text. */
  rakeAmount: string;
}

/** A listed high hand as the API sends it: the AP rule only to someone who runs the club. */
export type HighHandDto = PublicHighHandDto & Partial<HighHandTakingsDto>;

/** One prize an entry has won (high_hand_awards), as every registration answer lists them (`highHandWins`). */
export interface HighHandWinDto {
  highHandId: string;
  amountCents: Cents;
  /** A tie: the registration whose prize this one shares. */
  splitWithRegistrationId: string | null;
  /** ISO. */
  awardedAt: string;
}

/** One high hand an entry pays for at the door (the sign-up's payment instructions). */
export type HighHandAtDoorDto = HighHandAtDoor;

/* ---------- PUT /api/tournaments/:id/high-hands (staff) ---------- */

/**
 * One high hand as staff set it. `id`: one of the tournament's listed high hands, LEGACY_HIGH_HAND_ID
 * for its legacy one (which the change takes into the list, with its entrants and awards), or absent
 * for a new one. `winners`: the forms offer 1-4 (HIGH_HAND_WINNER_CHOICES); a stored count a tie raised
 * (up to HIGH_HAND_PRIZES_MAX) is accepted back. A rate of "none" stores 0.00. `legacyEntrants`
 * (R10REV1-MONEY-02), on a new high hand only: the players already in the legacy high hand, as the
 * change takes it into the list, are entered in this one too (their one entry covered both halves: a
 * $10 high hand sold as two at $5 keeps them in both, owing what they did). Awards stay with the legacy
 * high hand's own row.
 */
export const highHandInputSchema = z
  .object({
    id: idSchema.optional(),
    name: requiredText(HIGH_HAND_LIMITS.maxNameLength),
    entryFee: moneySchema.refine((fee) => toCents(fee) > 0, "Enter a fee above $0"),
    rakeType: rakeTypeSchema.default("none"),
    rakeAmount: optionalMoneySchema,
    winners: integerSchema(1, HIGH_HAND_PRIZES_MAX).default(1),
    note: optionalText(HIGH_HAND_LIMITS.maxNoteLength),
    legacyEntrants: z.boolean().optional(),
  })
  .superRefine((input, ctx) => {
    if (input.legacyEntrants === true && input.id !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["legacyEntrants"], message: "Only a new high hand takes in the players of the one being listed" });
    }
    if (input.rakeType === "none") return;
    if (input.rakeAmount === undefined || input.rakeAmount === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rakeAmount"], message: "Enter an amount for that rate" });
    } else if (input.rakeType === "percentage" && Number(input.rakeAmount) > 100) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rakeAmount"], message: "A percentage cannot be over 100" });
    }
  });
export type HighHandInput = z.infer<typeof highHandInputSchema>;

/**
 * The whole list, in order (none: no high hand). Each name once (ignoring case), each id once, at most
 * HIGH_HAND_LIMITS.maxHighHands. Issues name the high hand: `highHands[1].name`.
 */
export const highHandsListSchema = z
  .array(highHandInputSchema)
  .max(HIGH_HAND_LIMITS.maxHighHands, `At most ${HIGH_HAND_LIMITS.maxHighHands} high hands`)
  .superRefine((list, ctx) => {
    const names = new Map<string, number>();
    const ids = new Set<string>();
    list.forEach((highHand, index) => {
      const name = highHand.name.trim().toLowerCase();
      if (names.has(name)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "name"], message: "Two high hands cannot have the same name" });
      else names.set(name, index);
      if (highHand.id === undefined) return;
      if (ids.has(highHand.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "id"], message: "That high hand is in the list twice" });
      ids.add(highHand.id);
    });
  });

/**
 * PUT /api/tournaments/:id/high-hands (the club's staff): set the tournament's high hands, in order
 * (shared/domain/high-hands planHighHandsChange, in one transaction under the tournament lock):
 * - a tournament that lists none and sends its legacy high hand back unchanged (or sends none while it
 *   has none) changes nothing; sending [] while it offers one turns it off, by the legacy rule (409
 *   HIGH_HAND_ENTRIES, details { highHandId: "legacy", entrants }, while anyone is in it). Any other list
 *   starts listing: the legacy high hand (sent as LEGACY_HIGH_HAND_ID) is taken into the list with its
 *   entrants and awards (adoptLegacyHighHand); left out, it is refused while anyone is in it, as above.
 * - an id that is not one of the tournament's high hands (LEGACY_HIGH_HAND_ID once it lists them):
 *   400 HIGH_HAND_NOT_AVAILABLE, details { highHandId }.
 * - removing a high hand anyone is in (paid or not): 409 HIGH_HAND_ENTRIES, details { highHandId, entrants }
 *   (take them out of it first: PUT /api/registrations/:id highHandIds). Its row is kept, marked removed.
 * - a new fee for a high hand with entries recorded in it (the field's, paid or not): 409
 *   ENTRIES_REPRICED, details { changes: HighHandRepricing[] }, unless `repriceEntries` (asked last, once
 *   nothing else refuses the change, as the tournament form's prices). For the legacy high hand taken
 *   in, the new fee is that of every high hand its entries will be in (its own and those marked
 *   `legacyEntrants`: none to ask when they add up to the old fee), and the change names them, and the
 *   new ones they will not be in (`nowIn`, `notIn`).
 * - `legacyEntrants` on a change that does not take a legacy high hand into the list: 400
 *   HIGH_HAND_NOT_AVAILABLE, details { highHandId: "legacy" } (reload the page).
 * - every pot's awards must still fit it (fee, AP or number of prizes changed): 409 HIGH_HAND_OVER_POOL /
 *   HIGH_HAND_AWARDED, details { highHandId, name, awardedCents, potCents } (potsAwardsProblem).
 * - completed or cancelled: 409 TOURNAMENT_CLOSED, unless nothing changes. Allowed while the prize pool
 *   is locked (entries can then not join a high hand: PRIZE_POOL_LOCKED on the entry).
 * Writes the legacy columns as the list's summary (tournamentHighHandSummary), logs "high_hands_changed"
 * (staff-only: it names each AP rule, with `reason`) and audits "tournament.high_hands". Answers
 * HighHandsUpdatedDto. The tournament form sends the same list as `highHands` on POST/PUT
 * /api/tournaments (shared/api/tournaments), applied by the same rules in that request's transaction.
 */
export const highHandsUpdateSchema = z.object({
  highHands: highHandsListSchema,
  repriceEntries: z.boolean().default(false),
  reason: reasonSchema,
});
export type HighHandsUpdateInput = z.infer<typeof highHandsUpdateSchema>;

/* ---------- awards: one pot at a time (the club's staff) ---------- */

export const highHandParamsSchema = z.object({ id: idSchema, highHandId: idSchema });
export const highHandAwardParamsSchema = highHandParamsSchema.extend({ registrationId: idSchema });

/**
 * POST /api/tournaments/:id/high-hands/:highHandId/awards: award that high hand ("Award First half high
 * hand") to `registrationId`, which must be in it (paid or not): 400 HIGH_HAND_NOT_ENTERED otherwise, and
 * 409 HIGH_HAND_ALREADY_WON when it already won it. The server works out the prize under the tournament
 * lock (nextHighHandAward: what is left of that pot over the winners still to come, the last taking the
 * rest), so the pot's awards add up to it exactly; past its number of prizes, 409 HIGH_HAND_AWARDED (for
 * a tie, split instead). With `splitWith` (an earlier winner of the same high hand) the award is a tie:
 * that winner's prize is shared, half each, the odd cent staying with them (splitHighHandAward), and the
 * high hand gets one more prize (up to HIGH_HAND_PRIZES_MAX; 409 HIGH_HAND_AWARDED beyond); any other id
 * is 400 INVALID_TARGET. An unknown high hand: 404 NOT_FOUND. Allowed after the game too (high hands are
 * settled at the end of the night, as before). For the legacy high hand this is exactly PUT
 * /api/registrations/:id { highHandWinner: true, highHandSplitWith }. Logs "high_hand" ("Tama Rangi won the
 * First half high hand ($45)", eventData { highHandId, highHandName, amountCents, splitWith? }) and audits
 * "high_hand.award" (a split: "high_hand.split" too). Answers HighHandAwardResultDto (201).
 */
export const highHandAwardSchema = z.object({
  registrationId: idSchema,
  splitWith: idSchema.optional(),
});
export type HighHandAwardInput = z.infer<typeof highHandAwardSchema>;

/**
 * PATCH /api/tournaments/:id/high-hands/:highHandId/awards/:registrationId: correct a winner's prize,
 * e.g. to add money paid in after the last award (HighHandStanding.unawardedCents: "add it to a winner's
 * prize"). The pot's awards must still fit it: never more than the pot (409 HIGH_HAND_OVER_POOL), and once
 * every prize is awarded exactly the pot (409 HIGH_HAND_AWARDED). 404 for a registration that has not won
 * it. Logged and audited as an award ("high_hand.award", change "corrected"). Answers HighHandAwardResultDto.
 */
export const highHandAwardCorrectionSchema = z.object({ amount: moneySchema, reason: reasonSchema });
export type HighHandAwardCorrectionInput = z.infer<typeof highHandAwardCorrectionSchema>;

/** One award as the staff's award screens show it. */
export type HighHandAwardDto = HighHandAward & { playerName: string };

/**
 * A high hand's pot and awards after a change to them. `pot.rake` is the club's: staff only.
 *
 * DELETE /api/tournaments/:id/high-hands/:highHandId/awards/:registrationId answers it (200): the award
 * taken back (a mistake). A tie's other winner keeps what they now have. Logged ("high_hand": "Tama
 * Rangi's First half high hand win was taken back") and audited ("high_hand.award", change
 * "taken_back"). 404 for a registration that has not won it.
 */
export interface HighHandAwardsDto {
  highHandId: string;
  pot: HighHandPot;
  /** Every award of the high hand, in award order. */
  awards: HighHandAwardDto[];
  /** What the next winner would be paid (nextHighHandAward); null once every prize is awarded. */
  nextAwardCents: Cents | null;
  /** Money paid in after the last award that no award pays (unawardedHighHandCents). */
  unawardedCents: Cents;
}

/** POST (201) and PATCH (200) …/awards: the award made or corrected, and the pot after it. */
export interface HighHandAwardResultDto extends HighHandAwardsDto {
  award: HighHandAwardDto;
  /** A tie: the earlier winner's award as it now stands (they keep the rest). Null otherwise. */
  splitFrom: HighHandAwardDto | null;
  /** The winner's registration as it now stands (its highHandWins, and the legacy summary columns). */
  registration: ManagedRegistration;
}

/** PUT /api/tournaments/:id/high-hands (200), as the AP endpoints answer. */
export type { ApUpdateResponse as HighHandsUpdatedDto } from "./prize-pool";

/** `details` of 409 HIGH_HAND_OVER_POOL / HIGH_HAND_AWARDED for a listed high hand (and of HIGH_HAND_ENTRIES, without the amounts). */
export interface HighHandConflictDetails {
  highHandId: string;
  name?: string;
  awardedCents?: Cents;
  potCents?: Cents;
  entrants?: number;
}
