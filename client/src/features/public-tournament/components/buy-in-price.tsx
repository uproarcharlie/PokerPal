import { bountyCents, hasBounty, type BountySettings } from "@shared/domain/bounty";
import { MoneyText } from "@/components/shared/money-text";

interface BuyInPriceProps {
  tournament: BountySettings;
  forceCents?: boolean;
  className?: string;
}

/**
 * The buy-in as players see it (round 11): "$50", or in a bounty game "$50 + $100 bounty". The bounty
 * is part of the price, so it shows wherever the buy-in does.
 */
export function BuyInPrice({ tournament, forceCents, className }: BuyInPriceProps) {
  return (
    <span className={className}>
      <MoneyText amount={tournament.buyInAmount} forceCents={forceCents} />
      {hasBounty(tournament) ? (
        <>
          {" + "}
          <MoneyText cents={bountyCents(tournament)} forceCents={forceCents} /> bounty
        </>
      ) : null}
    </span>
  );
}
