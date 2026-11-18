import type { TournamentDetailDto } from "@shared/api/tournaments";
import { highHandLabel, highHandsAtDoor, highHandsOf, type HighHandsInput } from "@shared/domain/high-hands";
import { isFreeEntry, type EntryInput } from "@shared/domain/prize-pool";
import { toCents, type Cents } from "@shared/domain/money";

/**
 * A tournament that shows bank transfer details after sign-up (round 8), as the payment desk needs it:
 * the buy-in, which is all a sign-up is told to transfer (the high hand is paid at the door).
 */
export interface TransferDesk {
  buyInCents: Cents;
}

/** The desk's bank-transfer view of the tournament, or null where its players are not told to transfer. */
export function transferDeskOf(tournament: Pick<TournamentDetailDto, "showBankTransfer" | "buyInAmount">): TransferDesk | null {
  return tournament.showBankTransfer === true ? { buyInCents: toCents(tournament.buyInAmount) } : null;
}

/** How an entry's amount is paid where players may transfer ahead: what the transfer covers, and what is left for the door. */
export interface TransferSplit {
  /** The buy-ins, as the sign-up's card asked for them (server paymentInstructionsFor); 0 for a free entry. */
  transferCents: Cents;
  /** The rest: the high-hand entry, and any re-buys or add-ons already recorded. */
  doorCents: Cents;
  /** What the door part is for, in words: "high hand", "high hand, re-buys". */
  doorFor: string;
  /** The same, one thing each ("First half high hand", "re-buys"), for a sentence that names them. */
  doorParts: string[];
}

/**
 * What of the door part is high hands, in words: "high hand" in a game with one, else each one the
 * entry chose ("First half high hand", "Second half high hand", round 10).
 */
function highHandWords(entry: Pick<EntryInput, "enteringHighHands" | "highHandIds">, tournament: HighHandsInput | undefined): string[] {
  if (!tournament || highHandsOf(tournament).length <= 1) return entry.enteringHighHands ? ["high hand"] : [];
  return highHandsAtDoor(tournament, entry).map((highHand) => highHandLabel(highHand.name));
}

/**
 * The entry's amount (owed or paid, in dollars as the desk lists send it) split into the transfer and
 * the door; `tournament` names the high hands the entry chose.
 */
export function transferSplit(
  entry: Pick<EntryInput, "buyIns" | "rebuys" | "addons" | "enteringHighHands" | "highHandIds" | "freeEntry">,
  amount: number,
  { buyInCents }: TransferDesk,
  tournament?: HighHandsInput,
): TransferSplit {
  const totalCents = toCents(amount);
  const transferCents = Math.min(isFreeEntry(entry) ? 0 : buyInCents * (entry.buyIns ?? 0), totalCents);
  const parts = [...highHandWords(entry, tournament), ...((entry.rebuys ?? 0) > 0 ? ["re-buys"] : []), ...((entry.addons ?? 0) > 0 ? ["add-ons"] : [])];
  return { transferCents, doorCents: totalCents - transferCents, doorFor: parts.join(", "), doorParts: parts };
}

/**
 * What the TD still collects at the door before confirming the transfer, as a sentence: "The high hand
 * is paid at the door…", "The First half high hand and Second half high hand are paid at the door…".
 */
export function doorSentence({ doorParts }: Pick<TransferSplit, "doorParts">): string {
  const last = doorParts[doorParts.length - 1] ?? "rest";
  const what = doorParts.length > 1 ? `${doorParts.slice(0, -1).join(", ")} and ${last} are` : `${last} is`;
  return `The ${what} paid at the door: confirm once you have it.`;
}
