/**
 * What the Fix menu offers for an entry (round 9, item 1; the owner: "I need to be able to edit players
 * who are confirmed as paid just in case of a mistake"), worked out from the entry as the club's staff
 * are sent it and the tournament's own rules, the same ones the server applies.
 */
import type { ClubPlayer } from "@shared/api/players";
import type { PublicRegistration } from "@shared/api/public";
import type { FreeEntryStatus, PaymentMethod, PaymentStatus, StaffRegistrationDto } from "@shared/api/registrations";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { offersHighHand } from "@shared/domain/player-actions";
import { isFreeTournament, type PaymentDrop } from "@shared/domain/prize-pool";
import { isClosedStatus } from "@shared/domain/tournaments";
import { formatMoney } from "@/lib/format";

/**
 * An entry a Fix menu corrects: a payment-desk row (its player with their contact details) or a
 * standings row as the club's staff are sent it (with its payment status, the player's public fields).
 */
export type FixableEntry = (PublicRegistration | StaffRegistrationDto) & Partial<PaymentStatus & FreeEntryStatus>;

/** The tournament fields the menu reads. */
export type FixTournament = Pick<TournamentDetailDto, "status" | "buyInAmount" | "enableHighHand" | "highHandAmount" | "prizePoolLocked">;

/** One way the menu can correct the entry: offered, or offered greyed out with why. */
interface Offer {
  /** Why it cannot be used now, said under it; null when it can. */
  unavailable: string | null;
}

export interface EntryFixOptions {
  /** Mark as not paid (as not accepted, in a game with no buy-in): only for an entry that has paid (a free entry has its own Undo). */
  notPaid: Offer | null;
  /** How they paid, cash or bank transfer: for a paid entry with a buy-in (null: not recorded yet). */
  paidBy: { current: PaymentMethod | null } | null;
  /** Their name, mobile and photo, with the staff's edit-player sheet. */
  editPlayer: Offer;
  /** Whether they are in the high hand: where the game has one. */
  highHand: (Offer & { entered: boolean }) | null;
}

/** The player with their contact details, when the row carries them (a payment-desk row). */
export const contactOf = (entry: FixableEntry): ClubPlayer | null => (entry.player && "canEdit" in entry.player ? entry.player : null);

/** A visiting player's details belong to their own club (ClubPlayer.canEdit). */
const VISITING = "Visiting from another club: their own club edits their details";

/** The game is over: a payment taken in stays (the server refuses to take one back). */
const CLOSED_PAYMENT = "The game is over: its payments stay as they are";

export function entryFixOptions(entry: FixableEntry, tournament: FixTournament): EntryFixOptions {
  const paid = entry.paymentConfirmed === true && entry.freeEntry !== true;
  const contact = contactOf(entry);
  const entered = entry.enteringHighHands === true;
  return {
    notPaid: paid ? { unavailable: isClosedStatus(tournament.status) ? CLOSED_PAYMENT : null } : null,
    paidBy: paid && !isFreeTournament(tournament) ? { current: entry.paidBy === "cash" || entry.paidBy === "transfer" ? entry.paidBy : null } : null,
    editPlayer: { unavailable: contact && !contact.canEdit ? VISITING : null },
    highHand: offersHighHand(tournament)
      ? { entered, unavailable: !entered && tournament.prizePoolLocked === true ? "The prize pool is locked: nobody joins the high hand now" : null }
      : null,
  };
}

/**
 * The question before a payment is taken back: who goes back to the desk's list, and what the prize
 * pool (and the high-hand pot) lose, worked out with the shared pool maths; a pool set by hand stays as
 * set. `drop` is undefined while the desk's lists are still on their way.
 */
export function notPaidQuestion(name: string, drop: PaymentDrop | undefined, { freeTournament }: { freeTournament: boolean }): string {
  const back = `${name} goes back to ${freeTournament ? "Not accepted yet" : "Not paid yet"}`;
  const seat = "They keep their seat.";
  if (!drop) return `${back}. ${seat}`;
  const pot = formatMoney(drop.highHandCents);
  if (drop.manualPoolCents !== null) {
    const highHand = drop.highHandCents > 0 ? ` The high-hand pot drops by ${pot}.` : "";
    return `${back}. The prize pool stays at ${formatMoney(drop.manualPoolCents)}: it is set by hand.${highHand} ${seat}`;
  }
  const pool = formatMoney(drop.poolCents);
  if (drop.poolCents > 0 && drop.highHandCents > 0) return `${back}; the prize pool drops by ${pool} and the high-hand pot by ${pot}. ${seat}`;
  if (drop.poolCents > 0) return `${back}; the prize pool drops by ${pool}. ${seat}`;
  if (drop.highHandCents > 0) return `${back}; the high-hand pot drops by ${pot}. ${seat}`;
  return `${back}; the prize pool does not change. ${seat}`;
}
