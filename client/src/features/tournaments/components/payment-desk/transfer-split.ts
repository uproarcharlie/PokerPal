import type { TournamentDetailDto } from "@shared/api/tournaments";
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
}

/** The entry's amount (owed or paid, in dollars as the desk lists send it) split into the transfer and the door. */
export function transferSplit(
  entry: Pick<EntryInput, "buyIns" | "rebuys" | "addons" | "enteringHighHands" | "freeEntry">,
  amount: number,
  { buyInCents }: TransferDesk,
): TransferSplit {
  const totalCents = toCents(amount);
  const transferCents = Math.min(isFreeEntry(entry) ? 0 : buyInCents * (entry.buyIns ?? 0), totalCents);
  const parts = [entry.enteringHighHands ? "high hand" : null, (entry.rebuys ?? 0) > 0 ? "re-buys" : null, (entry.addons ?? 0) > 0 ? "add-ons" : null];
  return { transferCents, doorCents: totalCents - transferCents, doorFor: parts.filter(Boolean).join(", ") };
}
