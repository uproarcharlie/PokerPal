import type { ReactNode } from "react";
import { Trophy } from "lucide-react";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import type { Cents } from "@shared/domain/money";
import { MoneyText } from "@/components/shared/money-text";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { offersAddons, offersHighHand, offersRebuys } from "@shared/domain/player-actions";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-semibold text-foreground">{children}</dd>
    </div>
  );
}

interface EntryDetailsProps {
  tournament: TournamentDetailDto;
  /** The high-hand pot to show (the server's), or null while the club keeps the money hidden. */
  highHandPotCents: Cents | null;
}

/**
 * What it costs to play, and the high hand. The high-hand amount is each entrant's fee, not a prize:
 * the prize is the pot those fees make (PUB-13).
 */
export function EntryDetails({ tournament, highHandPotCents }: EntryDetailsProps) {
  const highHand = offersHighHand(tournament);
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      <Card>
        <CardHeader className="border-b border-border">
          <CardTitle className="text-lg sm:text-2xl">Entry Details</CardTitle>
        </CardHeader>
        <CardContent className="p-4 text-sm sm:p-6">
          <dl className="space-y-3">
            <Row label="Buy-in">
              <MoneyText amount={tournament.buyInAmount} />
            </Row>
            {offersRebuys(tournament) ? (
              <Row label="Re-buy">
                <MoneyText amount={tournament.rebuyAmount} />
              </Row>
            ) : null}
            {offersAddons(tournament) ? (
              <Row label="Add-on">
                <MoneyText amount={tournament.addonAmount} />
              </Row>
            ) : null}
            {highHand ? (
              <Row label="High hand entry (optional)">
                <MoneyText amount={tournament.highHandAmount} />
              </Row>
            ) : null}
          </dl>
        </CardContent>
      </Card>

      {highHand ? (
        <Card>
          <CardHeader className="border-b border-border">
            <CardTitle className="flex items-center gap-2 text-lg sm:text-2xl">
              <Trophy className="h-5 w-5 text-accent" aria-hidden="true" />
              High Hand
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-4 sm:p-6">
            <p className="text-sm text-muted-foreground">
              Enter for <MoneyText amount={tournament.highHandAmount} className="font-semibold text-foreground" /> when you register: the
              entry fees make the high-hand pot.
            </p>
            {highHandPotCents !== null ? (
              <p className="text-foreground" data-testid="high-hand-pot">
                <span className="text-sm text-muted-foreground">High hand pot: </span>
                <MoneyText cents={highHandPotCents} className="text-2xl font-bold text-accent-text" />
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
