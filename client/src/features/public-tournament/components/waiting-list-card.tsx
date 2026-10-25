import { Hourglass } from "lucide-react";
import type { PublicRegistration } from "@shared/api/public";
import { PlayerAvatar } from "@/components/image/player-avatar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { WaitingListed } from "../waiting-list";

/**
 * The sign-ups behind a full field, numbered in the order they come in (round 5, item 15), under the
 * standings: a player who signed up past Max players finds their number here while they wait.
 */
export function WaitingListCard({ waiting }: { waiting: readonly WaitingListed<PublicRegistration>[] }) {
  if (waiting.length === 0) return null;
  return (
    <Card data-testid="waiting-list">
      <CardHeader className="border-b border-border">
        <CardTitle className="flex items-center gap-2 text-lg sm:text-2xl">
          <Hourglass className="h-5 w-5 text-accent" aria-hidden="true" />
          Waiting list
        </CardTitle>
        <CardDescription>The tournament is full. When a place opens, the tournament director calls the next player on the list.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <ol role="list" aria-label="Waiting list" className="divide-y divide-border">
          {waiting.map(({ registration, position }) => {
            const name = registration.player?.name ?? "Unknown Player";
            return (
              <li key={registration.id} className="flex items-center gap-3 px-4 py-3" data-testid={`waiting-${registration.id}`}>
                <span className="w-8 shrink-0 text-center text-sm font-bold tabular-nums text-muted-foreground">
                  <span aria-hidden="true">#{position}</span>
                  <span className="sr-only">Number {position}</span>
                </span>
                <PlayerAvatar name={name} imageUrl={registration.player?.imageUrl} size="sm" />
                <span className="min-w-0 break-words font-semibold text-foreground">{name}</span>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
