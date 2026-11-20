/**
 * Round 11: a bounty game's price, as the staff's screens show it. The bounty is paid on top of the
 * buy-in (shared/domain/bounty) and never goes in the prize pool.
 */
import { bountyCents, entryPriceCents, hasBounty, type BountySettings } from "@shared/domain/bounty";
import { formatAmount, formatMoney } from "@/lib/format";

/** The buy-in: "$50.00", or in a bounty game "$50 + $100 bounty". */
export function buyInPriceText(tournament: BountySettings): string {
  if (!hasBounty(tournament)) return formatAmount(tournament.buyInAmount, { forceCents: true });
  return `${formatAmount(tournament.buyInAmount)} + ${formatMoney(bountyCents(tournament))} bounty`;
}

/** One line of a bounty game's price: what it is for and how much. */
export interface PriceLine {
  label: string;
  amount: string;
}

/**
 * A bounty game's price as separate line items, as the form and the desk show it: the buy-in (the prize
 * pool the places are paid from), the bounty (collected on knockouts, not in the prize pool) and what
 * each player pays. Null with no bounty.
 */
export function bountyPriceLines(tournament: BountySettings): PriceLine[] | null {
  if (!hasBounty(tournament)) return null;
  return [
    { label: "Prize pool (paid to the places)", amount: formatAmount(tournament.buyInAmount) },
    { label: "Bounty (collected on knockouts, not in the prize pool)", amount: formatMoney(bountyCents(tournament)) },
    { label: "Each player pays", amount: formatMoney(entryPriceCents(tournament)) },
  ];
}
