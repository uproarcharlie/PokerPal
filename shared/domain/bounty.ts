/**
 * Round 11: bounty games ("$50 buy-in + $100 bounty", the owner, 2026-11-21). Each buy-in pays the
 * tournament's bounty on top of its buy-in. The bounty never goes in the prize pool or the AP and is
 * not the club's: the player who knocks a player out collects that player's bounty (registrations'
 * `knockouts` count them). A free entry (round 7) covers the buy-in only, so its bounty is still paid.
 */
import { toCents, type Cents, type MoneyInput } from "./money";

export interface BountySettings {
  buyInAmount?: MoneyInput;
  /** Null, absent or $0: not a bounty game. */
  bountyAmount?: MoneyInput;
}

/** The bounty on each buy-in, in cents (0 for a game with no bounty). */
export function bountyCents(tournament: Pick<BountySettings, "bountyAmount">): Cents {
  return Math.max(0, toCents(tournament.bountyAmount));
}

export function hasBounty(tournament: Pick<BountySettings, "bountyAmount">): boolean {
  return bountyCents(tournament) > 0;
}

/** What one entry costs at the door: the buy-in plus the bounty ($50 + $100 = $150). */
export function entryPriceCents(tournament: BountySettings): Cents {
  return toCents(tournament.buyInAmount) + bountyCents(tournament);
}

/** The bounties a player has collected: one per knockout. */
export function bountiesWonCents(tournament: Pick<BountySettings, "bountyAmount">, knockouts: number | null | undefined): Cents {
  return bountyCents(tournament) * Math.max(0, knockouts ?? 0);
}
