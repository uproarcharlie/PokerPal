/**
 * Tournament registrations: sign-up (public and staff), the TD's updates, atomic count changes and
 * removing an entry. Every write locks the tournament row first, then the registration rows it
 * touches (SELECT ... FOR NO KEY UPDATE, which finalize's FOR UPDATE and every tournament update still
 * queue behind), so duplicate sign-ups, the max-players check and the prize-pool lock cannot race
 * (data-integrity-10).
 */
import { z } from "zod";
import { HIGH_HAND_LIMITS } from "../domain/high-hands";
import { idSchema, integerSchema, moneySchema, optionalText } from "./common";
import type { HighHandAtDoorDto } from "./high-hands";
import type { ClubPlayer } from "./players";
import type { PublicRegistration, PublicRegistrationRow, RegistrationHighHands, WaitingListPlace } from "./public";
import type { Cents } from "../domain/money";
import type { AutoSeatResultDto } from "./seating";

/**
 * POST /api/tournaments/:id/registrations, anyone (QR sign-up; public-write limit). Every other field
 * is ignored, so a sign-up can never set payment, results or counts (SEC-06). Anyone but the club's
 * staff may sign up only a player who has registered at this club before (whom the QR page's search
 * finds), or the player POST /api/players just created or matched, by sending the `signUpToken` it
 * returned; any other player is 404 PLAYER_NOT_FOUND, as if they did not exist (P2REV0-02). A sign-up
 * beyond Max players is taken onto the waiting list (round 5, item 15: `waitingListPosition`).
 * Refused with 400 PHOTO_REQUIRED (a club that requires a photo, and a player without one who is not
 * one of its regulars and was not added on its QR page: R5REV-SEC-01), 409 ALREADY_REGISTERED,
 * PRIZE_POOL_LOCKED, TOURNAMENT_CLOSED (completed or cancelled), 404 PLAYER_NOT_FOUND, 400
 * HIGH_HAND_NOT_AVAILABLE. A sign-up has not paid, so its high-hand entries are not in the pots (round 6:
 * paid players only) until the TD confirms the payment (which is never refused for a pot: see
 * PaymentConfirmedDto). Open while the game is in progress (enableLateRegistration is not enforced
 * until the Phase 4 clock).
 *
 * Round 10: `highHandIds` are the high hands the player enters (each a tournament's high hand id, or
 * "legacy" for its legacy one: shared/api/high-hands), in any order, duplicates ignored; an id the
 * tournament does not run is 400 HIGH_HAND_NOT_AVAILABLE (details { highHandId }). Sent, it wins over
 * `enteringHighHands`, which (from a page loaded before round 10) means every high hand the tournament
 * runs, or none (shared/domain/high-hands chosenHighHandIds). What the player owes for them is paid at
 * the door (paymentInstructions.highHandsAtDoor).
 */
export const highHandIdsSchema = z
  .array(idSchema)
  .max(HIGH_HAND_LIMITS.maxHighHands * 2, "Too many high hands")
  .transform((ids) => Array.from(new Set(ids)));

export const publicRegistrationSchema = z.object({
  playerId: idSchema,
  enteringHighHands: z.boolean().optional(),
  highHandIds: highHandIdsSchema.optional(),
  signUpToken: z.string().max(200).optional(),
});
export type PublicRegistrationInput = z.infer<typeof publicRegistrationSchema>;

/* ---------- free entries (round 7, item 6: staff only) ---------- */

/** Why a player was given a free entry: the reason chips staff pick from. */
export const FREE_ENTRY_REASONS = ["season_prize", "promo", "staff", "other"] as const;
export type FreeEntryReason = (typeof FREE_ENTRY_REASONS)[number];

export const FREE_ENTRY_REASON_LABELS: Readonly<Record<FreeEntryReason, string>> = Object.freeze({
  season_prize: "Season prize",
  promo: "Promo",
  staff: "Staff",
  other: "Other",
});

export const isFreeEntryReason = (value: unknown): value is FreeEntryReason =>
  typeof value === "string" && (FREE_ENTRY_REASONS as readonly string[]).includes(value);

/**
 * A free entry as staff give it: why (a reason chip, and an optional note), and whether the club pays
 * the player's buy-in into the prize pool (`funded`: the full buy-in, no AP taken). Without `funded`
 * the buy-in adds nothing to the pool. The entry's re-buys, add-ons and high-hand entry are paid as
 * normal.
 */
export const freeEntrySchema = z.object({
  reason: z.enum(FREE_ENTRY_REASONS, { message: "Choose why they get a free entry" }),
  note: optionalText(200),
  funded: z.boolean().optional(),
});
export type FreeEntryInput = z.infer<typeof freeEntrySchema>;

/* ---------- how an entry paid (round 8) ---------- */

/**
 * How an accepted entry paid, for the club's records (tournament_registrations.paid_by): in cash or by
 * bank transfer, as the TD said when confirming the payment, or a free entry (written when one is
 * given). Null: not recorded (a payment confirmed before round 8, or without saying how).
 */
export const PAID_BY = ["cash", "transfer", "free"] as const;
export type PaidBy = (typeof PAID_BY)[number];

export const PAID_BY_LABELS: Readonly<Record<PaidBy, string>> = Object.freeze({
  cash: "Cash",
  transfer: "Bank transfer",
  free: "Free entry",
});

export const isPaidBy = (value: unknown): value is PaidBy => typeof value === "string" && (PAID_BY as readonly string[]).includes(value);

/** What the TD may record a payment as; a free entry is recorded by giving one (POST /api/registrations/:id/free-entry). */
export const PAYMENT_METHODS = ["cash", "transfer"] as const satisfies readonly PaidBy[];
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * The same endpoint for someone who manages the tournament's club: may also set the opening counts
 * and payment. Registering a player as paid, or with re-buys or add-ons, accepts them: past Max
 * players that is 409 TOURNAMENT_FULL ("18 of 18 players accepted: raise Max players to accept more"),
 * with no override (round 5, item 15). The lock and closed-tournament rules still apply.
 * `freeEntry` (round 7) registers them with a free entry: accepted like a paid entry (the same
 * TOURNAMENT_FULL refusal), so it cannot be sent with `paymentConfirmed: false` (400). The public
 * sign-up's schema has no such field: a QR sign-up can never claim one.
 */
export const staffRegistrationSchema = publicRegistrationSchema.extend({
  buyIns: integerSchema(1, 20).optional(),
  rebuys: integerSchema(0, 1000).optional(),
  addons: integerSchema(0, 1000).optional(),
  paymentConfirmed: z.boolean().optional(),
  freeEntry: freeEntrySchema.optional(),
  /** Round 8: how a player registered as paid paid (only with `paymentConfirmed: true`, else 400). */
  paidBy: z.enum(PAYMENT_METHODS).optional(),
});
export type StaffRegistrationInput = z.infer<typeof staffRegistrationSchema>;

/**
 * PUT /api/registrations/:id (staff). Finalize alone writes finalPosition, prizeAmount and
 * pointsAwarded; tournamentId and playerId never change. Rules, all in one transaction:
 * - isEliminated true: the server stamps eliminationTime (a sent one is ignored); eliminatedBy must be
 *   another active player of this tournament (400 INVALID_TARGET), whose knockouts go up by one.
 *   Already out: 409 ALREADY_ELIMINATED.
 * - isEliminated false: clears eliminationTime and eliminatedBy and takes the knockout back off the
 *   eliminator (money-25). Not out: 409 NOT_ELIMINATED.
 * - isEliminated sent with its stored value is not a change, like every field: beside other fields
 *   (a resent row with a payment fix) it is ignored. Only a request about the elimination alone
 *   (isEliminated, perhaps with eliminatedBy), or naming a different eliminator for a player already
 *   out, gets the 409 above (P2REV4-CQ2-08).
 * - buyIns, rebuys or addons above the stored count, or enteringHighHands false → true, while the pool
 *   is locked: 409 PRIZE_POOL_LOCKED. Re-buys beyond maxRebuys: 409 MAX_REBUYS_REACHED.
 * - completed or cancelled tournament: only paymentConfirmed and the high-hand fields may change
 *   (payments are often reconciled after the game); anything else is 409 TOURNAMENT_CLOSED (for a
 *   completed one the message points to Correct Results). A payment is taken in then, never taken
 *   back: paymentConfirmed true → false is 409 TOURNAMENT_CLOSED too (round 9).
 * - highHandWinner true: the server works out the award (the high-hand pot left over the winners still
 *   to come, the last taking the remainder) and ignores any highHandAmount sent; past the number of
 *   winners, 409 HIGH_HAND_AWARDED; no high hand, 400 HIGH_HAND_NOT_AVAILABLE. false clears the amount.
 *   With `highHandSplitWith` (the registration id of an earlier winner) the award is a tie instead:
 *   that winner's prize is shared, half each (the odd cent stays with them), and the tournament gets
 *   one more high-hand prize; any other id is 400 INVALID_TARGET.
 *   A winner's amount changed by hand follows the same rule as any change to the pot: never more than
 *   the pot (409 HIGH_HAND_OVER_POOL), and once every prize is awarded exactly the pot (409
 *   HIGH_HAND_AWARDED), so no money is left that nobody can win.
 * - enteringHighHands changed, or paymentConfirmed true → false while the tournament is open (only paid
 *   entries are in the pot): the awards already made must still fit the pot (409 HIGH_HAND_OVER_POOL
 *   when they would add up to more, HIGH_HAND_AWARDED when every prize is awarded and the pot would no
 *   longer be what they add up to). A payment taken (false → true) is never refused for the pot, as on
 *   confirm-payment, and after the game no payment change is checked against it: the high hand there
 *   is paid out (R6REV0-MONEY-01).
 * - knockouts is an absolute count, kept for today's client; new code uses /counts.
 * - paymentConfirmed false → true accepts the player, as does a first re-buy, add-on, knockout or bust
 *   of a waiting-list entry: past Max players, 409 TOURNAMENT_FULL (round 5, item 15; no override).
 *   true → false takes the entry's money out of the pool: a manual AP total must still be within what
 *   the paid entries took in (400 AP_EXCEEDS_GROSS); how it paid (paidBy, round 8) is cleared with it.
 *   The entry keeps its seat and its place in the field, and nobody on the waiting list is accepted.
 * - Round 9 (the desk's Fix menu): a payment taken back and a high-hand entry changed are each a
 *   staff-only activity entry ("entry_corrected") and an audit row ("registration.correct").
 * - Round 10, `highHandIds`: the whole set of high hands the entry is in (the Fix menu's "High hands
 *   entered" ticks), as POST takes it, and `enteringHighHands` alone means all or none
 *   (chosenHighHandIds). The rules of enteringHighHands above apply to each high hand joined or left:
 *   joining one while the pool is locked, 409 PRIZE_POOL_LOCKED; an id it does not run, 400
 *   HIGH_HAND_NOT_AVAILABLE; each pot's awards must still fit it, 409 HIGH_HAND_OVER_POOL /
 *   HIGH_HAND_AWARDED (details { highHandId, name, awardedCents, potCents }); and leaving one the entry
 *   has won, 409 HIGH_HAND_WINNER (details { highHandId }: take the award back first). Allowed after
 *   the game, as today. One "entry_corrected" entry ("Tama Rangi is now in the First half and Second
 *   half high hands") and one "registration.correct" row (change "high_hand", with highHandIds before
 *   and after) per change.
 * - Round 10, `joinHighHandIds` / `leaveHighHandIds` (R10REV1-PHONE-01): one Fix tick as a change, not
 *   a set: the high hands the entry is in as the server holds it (under the lock), with those joined
 *   and those left, so a second quick tick from a list not yet reloaded never undoes the first. Joining
 *   one it is in, or leaving one it is not, changes nothing. Otherwise exactly as `highHandIds` (the
 *   same refusals, feed line and audit row; "legacy" for the legacy high hand). Sent with highHandIds or
 *   enteringHighHands, or one id in both lists: 400 VALIDATION.
 * - Round 10, for a tournament that lists its high hands: highHandWinner, highHandAmount and
 *   highHandSplitWith are 409 HIGH_HAND_LISTED (a page loaded before round 10: awards are made one high
 *   hand at a time, POST /api/tournaments/:id/high-hands/:highHandId/awards); a value resent unchanged
 *   is ignored, like every field.
 */
export const updateRegistrationSchema = z
  .object({
    isEliminated: z.boolean().optional(),
    eliminatedBy: idSchema.nullable().optional(),
    buyIns: integerSchema(1, 20).optional(),
    rebuys: integerSchema(0, 1000).optional(),
    addons: integerSchema(0, 1000).optional(),
    knockouts: integerSchema(0, 1000).optional(),
    enteringHighHands: z.boolean().optional(),
    highHandIds: highHandIdsSchema.optional(),
    joinHighHandIds: highHandIdsSchema.optional(),
    leaveHighHandIds: highHandIdsSchema.optional(),
    paymentConfirmed: z.boolean().optional(),
    highHandWinner: z.boolean().optional(),
    highHandAmount: z.preprocess((value) => (value === "" ? null : value), moneySchema.nullable()).optional(),
    highHandSplitWith: idSchema.optional(),
  })
  .superRefine((input, ctx) => {
    if (!Object.values(input).some((value) => value !== undefined)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Nothing to update" });
    if (input.joinHighHandIds === undefined && input.leaveHighHandIds === undefined) return;
    for (const field of ["highHandIds", "enteringHighHands"] as const) {
      if (input[field] === undefined) continue;
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: "Send the high hands to join or leave, or the whole choice, not both" });
    }
    const leaving = new Set(input.leaveHighHandIds ?? []);
    if ((input.joinHighHandIds ?? []).some((id) => leaving.has(id))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["leaveHighHandIds"], message: "A high hand cannot be joined and left at once" });
    }
  });
export type UpdateRegistrationInput = z.infer<typeof updateRegistrationSchema>;

const delta = integerSchema(-20, 20);

/**
 * POST /api/registrations/:id/counts (staff): atomic `SET n = n + delta` (replaces PATCH
 * /api/registrations/:id and its read-then-write +1: data-integrity-11, money-12). Same lock and
 * maxRebuys rules as PUT for increases; a count can never go below zero (409 COUNT_BELOW_ZERO).
 * Each increase is logged ("made 1 re-buy"). A re-buy by a player who is out puts them back in, and
 * whoever knocked them out keeps the knockout (a restore, which undoes a mistake, takes it back). A
 * waiting-list entry's first re-buy, add-on or knockout past Max players: 409 TOURNAMENT_FULL.
 */
export const adjustCountsSchema = z
  .object({ rebuys: delta.optional(), addons: delta.optional(), knockouts: delta.optional() })
  .refine((input) => Object.values(input).some((value) => value !== undefined && value !== 0), "Nothing to change");
export type AdjustCountsInput = z.infer<typeof adjustCountsSchema>;

/**
 * PATCH /api/registrations/:id/confirm-payment (staff), round 8: how the player paid, for the club's
 * records (`paidBy`; left out, not recorded). Confirming a payment already confirmed changes only how
 * it was paid, when sent: a correction (round 9, the desk's Fix menu), logged as a staff-only
 * "entry_corrected" activity entry and a "registration.correct" audit row; sent unchanged, or left
 * out, it changes and logs nothing. A free entry keeps "free": mark it paid instead.
 */
export const confirmPaymentSchema = z.object({ paidBy: z.enum(PAYMENT_METHODS).optional() });
export type ConfirmPaymentInput = z.infer<typeof confirmPaymentSchema>;

/**
 * POST /api/registrations/:id/free-entry (staff of the tournament's club), round 7:
 * - "give": gives the entry a free entry, or changes its reason, note or funding. Giving one to an
 *   unpaid sign-up accepts them like a payment does: past Max players, 409 TOURNAMENT_FULL (no
 *   override), and under "once they've paid" auto-seat seats them. Giving one to an entry that has paid
 *   takes its buy-in back out of the pool (unless funded), so a manual AP total must still be within
 *   what came in (400 AP_EXCEEDS_GROSS).
 * - "take_back": a normal unpaid entry again (accepted no more, as when a payment is taken back: the
 *   high-hand awards must still fit the pot, 409 HIGH_HAND_OVER_POOL / HIGH_HAND_AWARDED, and a manual
 *   AP total the gross, 400 AP_EXCEEDS_GROSS).
 * - "mark_paid": a normal paid entry: the player has paid their buy-in after all (`paidBy`, round 8:
 *   how, else not recorded).
 * "take_back" and "mark_paid" on an entry with no free entry are 409 NOT_FREE_ENTRY. Allowed after the
 * game too, like payments (reconciled at the end of the night). Each change is a staff-only activity
 * entry ("payment_confirmed", eventData.freeEntry) and an audit row ("registration.free_entry").
 */
export const freeEntryChangeSchema = z.discriminatedUnion("action", [
  freeEntrySchema.extend({ action: z.literal("give") }),
  z.object({ action: z.literal("take_back") }),
  z.object({ action: z.literal("mark_paid"), paidBy: z.enum(PAYMENT_METHODS).optional() }),
]);
export type FreeEntryChangeInput = z.infer<typeof freeEntryChangeSchema>;

/** Whether the entry has paid at the desk: for the club's staff only (P2REV0-SEC-04). */
export interface PaymentStatus {
  paymentConfirmed: boolean | null;
  /**
   * How it paid (round 8; null: not recorded). Every staff registration answer has it; optional only
   * because a row made before round 8 (a cached answer, a test's fixture) has none.
   */
  paidBy?: PaidBy | null;
}

/**
 * Whether the entry is a free entry (round 7), and why: for the club's staff only, never on a public
 * page, the TV or a public response. A free entry is always accepted (paymentConfirmed true). Who gave
 * it stays on the server (the audit log names them). Every staff registration list, sign-up, payment
 * confirmation, update and free-entry change answers with all four; optional only because a row made
 * before round 7 (a cached answer, a test's fixture) has none, which reads as no free entry.
 */
export interface FreeEntryStatus {
  freeEntry?: boolean;
  /** The club pays the buy-in into the prize pool. */
  freeEntryFunded?: boolean;
  freeEntryReason?: FreeEntryReason | null;
  freeEntryNote?: string | null;
}

/**
 * A registration as the club's staff get it: every staff write's response, and each row of GET
 * /api/tournaments/:id/registrations for someone who runs the club (everyone else gets PublicRegistration).
 */
export type ManagedRegistration = PublicRegistration & PaymentStatus & FreeEntryStatus;

/**
 * POST /api/tournaments/:id/registrations (201), round 5: the registration (ManagedRegistration for
 * the club's staff, PublicRegistration for anyone else) and what auto-seat did with it, inside the
 * same transaction (shared/domain/table-advisor planAutoSeat; tournament row locked first, so two
 * sign-ups never take one seat): "seated" at Table 2, Seat 7, or "waiting" and why (tables_full also
 * logs "seat_waiting" for the TD; no_tables before setup; awaiting_payment under "once they've paid";
 * off).
 */
export type RegistrationCreatedDto = (PublicRegistration | ManagedRegistration) & {
  seating: AutoSeatResultDto;
  /**
   * Round 8: how to pay by bank transfer, when the tournament shows its club's bank details after
   * sign-up (showBankTransfer) and the club has them; absent otherwise, and for a player the desk
   * registered as paid. The club's account only with a buy-in to transfer now (PaymentInstructionsDto,
   * the one with `accountNumber`), else NothingToTransferDto. Only in this answer, to whoever made the
   * sign-up (and staff): never in a list, a public read or the TV.
   */
  paymentInstructions?: SignUpPaymentDto;
};

/** The most characters a New Zealand bank transfer takes in its Particulars, Code and Reference fields. */
export const BANK_TRANSFER_FIELD_MAX = 12;

/** `text` with its spacing tidied, cut to `max` characters (whole characters, never half an emoji). */
function fitField(text: string, max = BANK_TRANSFER_FIELD_MAX): string {
  return Array.from(text.trim().replace(/\s+/g, " ")).slice(0, max).join("").trimEnd();
}

/**
 * The Reference a player puts on their transfer (the owner, 2026-11-16): their name, cut to the 12
 * characters the field takes ("Tama Rangi"; "Alexandra Fitzgerald" → "Alexandra Fi"). The desk finds
 * the transfer by searching for the name.
 */
export const paymentReference = (playerName: string): string => fitField(playerName);

/** "Wed 18 Nov": the tournament's day, in the club's time zone. */
function tournamentDay(start: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-NZ", { timeZone, weekday: "short", day: "numeric", month: "short" }).formatToParts(start);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("weekday")} ${part("day")} ${part("month")}`;
}

/**
 * The Particulars suggested for the transfer: the tournament's short name, which is its name when that
 * fits the 12 characters, else its day ("Wed 18 Nov") in the club's time zone (an IANA zone).
 */
export function paymentParticulars(tournament: { name: string; startDateTime: Date }, timeZone: string): string {
  const name = tournament.name.trim().replace(/\s+/g, " ");
  return name !== "" && Array.from(name).length <= BANK_TRANSFER_FIELD_MAX ? name : fitField(tournamentDay(tournament.startDateTime, timeZone));
}

/**
 * Round 8 (bank transfer payments): what the player who has just signed up needs to pay the buy-in
 * ahead by transfer. Sent only in the sign-up's own answer (RegistrationCreatedDto) for a tournament
 * that shows it, with a buy-in to transfer now; the screen also says they may pay at the door, and
 * that the TD confirms payments.
 */
export interface PaymentInstructionsDto {
  /** The club's account (shared/api/clubs BankDetails). */
  accountName: string;
  accountNumber: string;
  bankName: string | null;
  /** The club's own note for players paying by transfer. */
  instructions: string | null;
  /** What to transfer: the buy-in only (the high hand is paid at the door); never 0. */
  amountDueCents: Cents;
  /** For the transfer's Particulars (paymentParticulars). */
  particulars: string;
  /** For its Reference: the player's name, cut to 12 characters (paymentReference). */
  reference: string;
  /** The high-hand entry the player ticked, paid at the door ("High hand ($5) — pay at the door"); 0 when none. */
  highHandAtDoorCents: Cents;
  /**
   * Round 10: each high hand the player chose, with its fee, in order ("First half high hand ($5) — pay at
   * the door"); they add up to highHandAtDoorCents. Every answer since round 10 has it; optional only
   * because one made before (a saved sign-up, a test's fixture) has none: show highHandAtDoorCents then.
   */
  highHandsAtDoor?: HighHandAtDoorDto[];
  /** Never on the waiting list: a waiting-list sign-up is told NothingToTransferDto. */
  waitingList: false;
}

/**
 * A sign-up for a tournament that shows bank details, with nothing to transfer now (R8REV0-PRIV-01):
 * on the waiting list behind a full field ("don't pay yet; the club will tell you if a spot opens"),
 * or with no buy-in to pay (a free entry, a $0 game). The club's account is left out: only someone
 * about to send it money is given it.
 */
export interface NothingToTransferDto {
  /** The entry's buy-in once it is accepted (0 for a free entry or a $0 game): from the waiting list, not to pay yet. */
  amountDueCents: Cents;
  /** The high-hand entry the player ticked, paid at the door; 0 when none. */
  highHandAtDoorCents: Cents;
  /** Round 10: as PaymentInstructionsDto.highHandsAtDoor. */
  highHandsAtDoor?: HighHandAtDoorDto[];
  waitingList: boolean;
}

/** What a sign-up's answer says about paying by transfer: the account to pay into (`accountNumber` in it), or nothing to transfer now. */
export type SignUpPaymentDto = PaymentInstructionsDto | NothingToTransferDto;

/**
 * PATCH /api/registrations/:id/confirm-payment (staff), round 5: accepts the player, which past Max
 * players is 409 TOURNAMENT_FULL "18 of 18 players accepted: raise Max players to accept more" for
 * everyone, owners included (item 15; a player who has already played is in the field, so their
 * payment is always taken). The payment puts the entry's money in the prize pool (round 6), and a
 * high-hand entrant's in the high-hand pot. It is never refused for that pot: money taken at the desk
 * is in it (R6REV0-MONEY-01). Under "once they've paid" a player who has no seat is seated by auto-seat
 * as their payment is confirmed (`seating`); null when auto-seat did nothing (another mode, already
 * seated, out, or nothing changed).
 */
export type PaymentConfirmedDto = ManagedRegistration & {
  seating: AutoSeatResultDto | null;
  /**
   * What of the high-hand pot no award pays after this payment (unawardedHighHandCents): every prize
   * was already awarded, so the TD adds it to a winner's prize (Award High Hand). 0 when nothing is
   * left over, and always after the game, when the high hand is paid out.
   */
  highHandUnawardedCents: Cents;
  /**
   * Round 10: that money pot by pot, for each pot of the entry's that has some ("First half: $5 not
   * awarded yet"); highHandUnawardedCents is their sum. Every answer since round 10 has it; optional only
   * because one made before has none.
   */
  highHandsUnawarded?: Array<{ highHandId: string; name: string; cents: Cents }>;
};

/**
 * POST /api/registrations/:id/free-entry: the registration as it now stands, where auto-seat put a
 * player the free entry accepted (as on confirm-payment), and what of the high-hand pot no award pays.
 */
export type FreeEntryChangedDto = PaymentConfirmedDto;

/** A registration for staff screens: the player's contact details only when `player.canEdit` (ClubPlayer). */
export type StaffRegistrationDto = PublicRegistrationRow &
  PaymentStatus &
  FreeEntryStatus &
  WaitingListPlace &
  RegistrationHighHands & { player: ClubPlayer | null };

/**
 * GET /api/tournaments/:id/pending-registrations (staff). amountOwed is dollars, as today, but now
 * buyIns × buy-in + re-buys × re-buy + add-ons × add-on + the high-hand entry (money-18): round 10, the
 * fees of the high hands the entry chose (shared/domain/prize-pool amountDueCents; the high hands are
 * paid at the door, highHandsAtDoor names them). A free entry is never pending: it is accepted.
 */
export type PendingRegistrationDto = StaffRegistrationDto & { amountOwed: number };

/**
 * GET /api/tournaments/:id/confirmed-registrations (staff): the accepted entries, free entries among
 * them (`freeEntry`). amountPaid uses the same formula, by which nobody pays a free entry's buy-ins.
 */
export type ConfirmedRegistrationDto = StaffRegistrationDto & { amountPaid: number };
