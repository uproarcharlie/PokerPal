import { Trophy } from "lucide-react";
import type { PublicRegistration } from "@shared/api/public";
import { highHandAwardsOf, highHandLabel, highHandsOf, listsHighHands, type HighHandsInput } from "@shared/domain/high-hands";
import { PlayerAvatar } from "@/components/image/player-avatar";
import { MoneyText } from "@/components/shared/money-text";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface HighHandWinnersProps {
  /** The tournament, for its high hands: one that lists them (round 10) names each winner's. */
  tournament: HighHandsInput;
  registrations: readonly PublicRegistration[];
}

/** The night's high-hand winners and what each was awarded, each with the high hand they won where there are several; nothing until someone has won. */
export function HighHandWinners({ tournament, registrations }: HighHandWinnersProps) {
  if (listsHighHands(tournament)) return <ListedWinners tournament={tournament} registrations={registrations} />;
  const winners = registrations.filter((registration) => registration.highHandWinner);
  if (winners.length === 0) return null;
  return (
    <Card className="mb-6">
      <CardHeader className="border-b border-border">
        <CardTitle className="flex items-center gap-2 text-lg sm:text-2xl">
          <Trophy className="h-5 w-5 text-accent" aria-hidden="true" />
          High Hand Winners
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ul role="list" className="divide-y divide-border" aria-label="High hand winners">
          {winners.map((winner) => {
            const name = winner.player?.name ?? "Unknown Player";
            return (
              <li key={winner.id} className="flex items-center justify-between gap-3 px-4 py-4">
                <span className="flex min-w-0 items-center gap-3">
                  <PlayerAvatar name={name} imageUrl={winner.player?.imageUrl} size="md" />
                  <span className="truncate font-semibold text-foreground">{name}</span>
                </span>
                {winner.highHandAmount ? <MoneyText amount={winner.highHandAmount} className="text-xl font-bold text-accent-text" /> : null}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

/** Every award of a game that lists its high hands, pot by pot (highHandAwardsOf). */
function ListedWinners({ tournament, registrations }: HighHandWinnersProps) {
  const awards = highHandAwardsOf(tournament, registrations);
  if (awards.length === 0) return null;
  const byId = new Map(registrations.map((registration) => [registration.id, registration]));
  const names = new Map(highHandsOf(tournament).map((highHand) => [highHand.id, highHandLabel(highHand.name)]));
  const named = names.size > 1;
  return (
    <Card className="mb-6">
      <CardHeader className="border-b border-border">
        <CardTitle className="flex items-center gap-2 text-lg sm:text-2xl">
          <Trophy className="h-5 w-5 text-accent" aria-hidden="true" />
          High Hand Winners
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ul role="list" className="divide-y divide-border" aria-label="High hand winners">
          {awards.map((award) => {
            const winner = byId.get(award.registrationId);
            const name = winner?.player?.name ?? "Unknown Player";
            return (
              <li key={`${award.highHandId}-${award.registrationId}`} className="flex items-center justify-between gap-3 px-4 py-4">
                <span className="flex min-w-0 items-center gap-3">
                  <PlayerAvatar name={name} imageUrl={winner?.player?.imageUrl} size="md" />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-foreground">{name}</span>
                    {named ? <span className="block truncate text-sm text-muted-foreground">{names.get(award.highHandId)}</span> : null}
                  </span>
                </span>
                <MoneyText cents={award.amountCents} className="text-xl font-bold text-accent-text" />
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
