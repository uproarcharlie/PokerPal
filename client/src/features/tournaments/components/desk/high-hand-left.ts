import { formatMoney } from "@/lib/format";
import type { PaymentConfirmedDto } from "@shared/api/registrations";
import { highHandLabel, LEGACY_HIGH_HAND_ID } from "@shared/domain/high-hands";

/**
 * What the TD is told when a payment taken grew a high-hand pot whose every prize was already awarded
 * (the server's highHandUnawardedCents: only paid entries are in the pot, round 6): nobody is due that
 * money until it is added to a winner's prize (R6REV0-MONEY-01). Round 10: pot by pot, named, for a
 * game that lists its high hands ("$5 of the First half high hand pot is not awarded yet"). Null when
 * nothing is left over.
 */
export function highHandLeftText(paid: Pick<PaymentConfirmedDto, "highHandUnawardedCents" | "highHandsUnawarded">): string | null {
  const pots = (paid.highHandsUnawarded ?? []).filter((pot) => pot.cents > 0);
  const named = pots.length > 0 && pots.some((pot) => pot.highHandId !== LEGACY_HIGH_HAND_ID);
  if (named) {
    const parts = pots.map((pot) => `${formatMoney(pot.cents)} of the ${highHandLabel(pot.name)} pot`).join(" and ");
    return `${parts} ${pots.length === 1 ? "is" : "are"} not awarded yet: add it to a winner's prize from Award High Hand.`;
  }
  // Also null for an answer without the figure.
  if (!(paid.highHandUnawardedCents > 0)) return null;
  return `${formatMoney(paid.highHandUnawardedCents)} of the high-hand pot is not awarded yet: add it to a winner's prize from Award High Hand.`;
}
