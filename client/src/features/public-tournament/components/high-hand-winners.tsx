import { Trophy } from "lucide-react";
import type { PublicRegistration } from "@shared/api/public";
import { PlayerAvatar } from "@/components/image/player-avatar";
import { MoneyText } from "@/components/shared/money-text";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** The night's high-hand winners and what each was awarded; nothing until someone has won. */
export function HighHandWinners({ registrations }: { registrations: readonly PublicRegistration[] }) {
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
