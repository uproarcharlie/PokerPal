import type { ReactNode } from "react";
import { Trophy } from "lucide-react";
import type { PublicHighHandPotDto } from "@shared/api/live-display";
import type { PublicRegistration } from "@shared/api/public";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { highHandAwardsOf, highHandLabel, highHandsOf, type HighHandSettings } from "@shared/domain/high-hands";
import type { Cents } from "@shared/domain/money";
import { MoneyText } from "@/components/shared/money-text";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BuyInPrice } from "./buy-in-price";
import { offersAddons, offersRebuys } from "@shared/domain/player-actions";

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
  /** Round 10: each high hand's pot to show (the server's, never its AP), or null while the club keeps the money hidden. */
  highHandPots?: readonly PublicHighHandPotDto[] | null;
  /** The players, for the names of each high hand's winners so far. */
  registrations?: readonly PublicRegistration[];
}

/**
 * What it costs to play, and the high hands. A high-hand amount is each entrant's fee, not a prize:
 * the prize is the pot those fees make (PUB-13). A game with several high hands (round 10) lists each:
 * its fee, its note, its pot and its winners so far.
 */
export function EntryDetails({ tournament, highHandPotCents, highHandPots = null, registrations = [] }: EntryDetailsProps) {
  const highHands = highHandsOf(tournament);
  const highHand = highHands.length === 1;
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      <Card>
        <CardHeader className="border-b border-border">
          <CardTitle className="text-lg sm:text-2xl">Entry Details</CardTitle>
        </CardHeader>
        <CardContent className="p-4 text-sm sm:p-6">
          <dl className="space-y-3">
            <Row label="Buy-in">
              <BuyInPrice tournament={tournament} />
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
            {highHands.map((entry) => (
              <Row key={entry.id} label={highHand ? "High hand entry (optional)" : `${highHandLabel(entry.name)} (optional)`}>
                <MoneyText amount={entry.entryFee} />
              </Row>
            ))}
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
              Enter for <MoneyText amount={highHands[0].entryFee} className="font-semibold text-foreground" /> when you register: the
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
      ) : highHands.length > 1 ? (
        <HighHandsCard tournament={tournament} highHands={highHands} pots={highHandPots} registrations={registrations} />
      ) : null}
    </div>
  );
}

interface HighHandsCardProps {
  tournament: TournamentDetailDto;
  highHands: readonly HighHandSettings[];
  pots: readonly PublicHighHandPotDto[] | null;
  registrations: readonly PublicRegistration[];
}

/** "High Hands": each one players can enter, its fee and note, its pot (when the club shows the money) and who has won it. */
function HighHandsCard({ tournament, highHands, pots, registrations }: HighHandsCardProps) {
  const potOf = new Map((pots ?? []).map((pot) => [pot.id, pot]));
  const names = new Map(registrations.map((registration) => [registration.id, registration.player?.name ?? "Unknown Player"]));
  const awards = highHandAwardsOf(tournament, registrations);
  return (
    <Card>
      <CardHeader className="border-b border-border">
        <CardTitle className="flex items-center gap-2 text-lg sm:text-2xl">
          <Trophy className="h-5 w-5 text-accent" aria-hidden="true" />
          High Hands
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <p className="px-4 pt-4 text-sm text-muted-foreground sm:px-6">Enter the ones you want when you register: each is its own pot, made by its entry fees.</p>
        <ul role="list" aria-label="High hands" className="divide-y divide-border" data-testid="public-high-hands">
          {highHands.map((highHand) => {
            const pot = potOf.get(highHand.id);
            const won = awards.filter((award) => award.highHandId === highHand.id);
            return (
              <li key={highHand.id} className="space-y-1 px-4 py-4 sm:px-6" data-testid={`public-high-hand-${highHand.id}`}>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 font-semibold text-foreground">{highHandLabel(highHand.name)}</p>
                  <p className="shrink-0 text-sm text-muted-foreground">
                    Enter for <MoneyText amount={highHand.entryFee} className="font-semibold text-foreground" />
                  </p>
                </div>
                {highHand.note ? <p className="text-sm text-muted-foreground">{highHand.note}</p> : null}
                {pot ? (
                  <p className="text-foreground" data-testid={`high-hand-pot-${highHand.id}`}>
                    <span className="text-sm text-muted-foreground">Pot: </span>
                    <MoneyText cents={pot.potCents} className="text-xl font-bold text-accent-text" />
                  </p>
                ) : null}
                {won.length > 0 ? (
                  <p className="text-sm text-foreground">
                    <span className="text-muted-foreground">Won by </span>
                    {won.map((award, index) => (
                      <span key={award.registrationId}>
                        {index > 0 ? ", " : ""}
                        {names.get(award.registrationId) ?? "Unknown Player"} (<MoneyText cents={award.amountCents} />)
                      </span>
                    ))}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
