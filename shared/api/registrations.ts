/**
 * Tournament registrations: sign-up (public and staff), the TD's updates, atomic count changes and
 * removing an entry. Every write locks the tournament row first, then the registration rows it
 * touches (SELECT ... FOR NO KEY UPDATE, which finalize's FOR UPDATE and every tournament update still
 * queue behind), so duplicate sign-ups, the max-players check and the prize-pool lock cannot race
 * (data-integrity-10).
 */
import { z } from "zod";
import { idSchema, integerSchema, moneySchema } from "./common";
import type { ClubPlayer } from "./players";
import type { PublicRegistration, PublicRegistrationRow, WaitingListPlace } from "./public";
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
 * HIGH_HAND_NOT_AVAILABLE. A sign-up has not paid, so its high-hand entry is not in the pot (round 6:
 * paid players only) until the TD confirms the payment (which is never refused for the pot: see
 * PaymentConfirmedDto). Open while the game is in progress (enableLateRegistration is not enforced
 * until the Phase 4 clock).
 */
export const publicRegistrationSchema = z.object({
  playerId: idSchema,
  enteringHighHands: z.boolean().optional(),
  signUpToken: z.string().max(200).optional(),
});
export type PublicRegistrationInput = z.infer<typeof publicRegistrationSchema>;

/**
 * The same endpoint for someone who manages the tournament's club: may also set the opening counts
 * and payment. Registering a player as paid, or with re-buys or add-ons, accepts them: past Max
 * players that is 409 TOURNAMENT_FULL ("18 of 18 players accepted: raise Max players to accept more"),
 * with no override (round 5, item 15). The lock and closed-tournament rules still apply.
 */
export const staffRegistrationSchema = publicRegistrationSchema.extend({
  buyIns: integerSchema(1, 20).optional(),
  rebuys: integerSchema(0, 1000).optional(),
  addons: integerSchema(0, 1000).optional(),
  paymentConfirmed: z.boolean().optional(),
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
 *   completed one the message points to Correct Results).
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
 *   the paid entries took in (400 AP_EXCEEDS_GROSS).
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
    paymentConfirmed: z.boolean().optional(),
    highHandWinner: z.boolean().optional(),
    highHandAmount: z.preprocess((value) => (value === "" ? null : value), moneySchema.nullable()).optional(),
    highHandSplitWith: idSchema.optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), "Nothing to update");
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

/** Whether the entry has paid at the desk: for the club's staff only (P2REV0-SEC-04). */
export interface PaymentStatus {
  paymentConfirmed: boolean | null;
}

/**
 * A registration as the club's staff get it: every staff write's response, and each row of GET
 * /api/tournaments/:id/registrations for someone who runs the club (everyone else gets PublicRegistration).
 */
export type ManagedRegistration = PublicRegistration & PaymentStatus;

/**
 * POST /api/tournaments/:id/registrations (201), round 5: the registration (ManagedRegistration for
 * the club's staff, PublicRegistration for anyone else) and what auto-seat did with it, inside the
 * same transaction (shared/domain/table-advisor planAutoSeat; tournament row locked first, so two
 * sign-ups never take one seat): "seated" at Table 2, Seat 7, or "waiting" and why (tables_full also
 * logs "seat_waiting" for the TD; no_tables before setup; awaiting_payment under "once they've paid";
 * off).
 */
export type RegistrationCreatedDto = (PublicRegistration | ManagedRegistration) & { seating: AutoSeatResultDto };

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
};

/** A registration for staff screens: the player's contact details only when `player.canEdit` (ClubPlayer). */
export type StaffRegistrationDto = PublicRegistrationRow & PaymentStatus & WaitingListPlace & { player: ClubPlayer | null };

/**
 * GET /api/tournaments/:id/pending-registrations (staff). amountOwed is dollars, as today, but now
 * buyIns × buy-in + re-buys × re-buy + add-ons × add-on + the high-hand entry (money-18).
 */
export type PendingRegistrationDto = StaffRegistrationDto & { amountOwed: number };

/** GET /api/tournaments/:id/confirmed-registrations (staff). amountPaid uses the same formula. */
export type ConfirmedRegistrationDto = StaffRegistrationDto & { amountPaid: number };
