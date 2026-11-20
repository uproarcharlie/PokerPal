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

/**
 * What the form's helper says under a bounty typed in: "Players pay $150: $50 buy-in + $100 bounty. …";
 * null with no bounty.
 */
export function bountyHelpText(tournament: BountySettings): string | null {
  if (!hasBounty(tournament)) return null;
  const buyIn = formatAmount(tournament.buyInAmount);
  const bounty = formatMoney(bountyCents(tournament));
  return `Players pay ${formatMoney(entryPriceCents(tournament))}: ${buyIn} buy-in + ${bounty} bounty. The bounty isn't in the prize pool — whoever knocks a player out collects it.`;
}
