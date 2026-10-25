import { formatMoney, type Cents } from "@/lib/format";

/**
 * What the TD is told when a payment taken grew a high-hand pot whose every prize was already awarded
 * (the server's highHandUnawardedCents: only paid entries are in the pot, round 6): nobody is due that
 * money until it is added to a winner's prize (R6REV0-MONEY-01). Null when nothing is left over.
 */
export function highHandLeftText(unawardedCents: Cents): string | null {
  // Also null for an answer without the figure.
  if (!(unawardedCents > 0)) return null;
  return `${formatMoney(unawardedCents)} of the high-hand pot is not awarded yet: add it to a winner's prize from Award High Hand.`;
}
