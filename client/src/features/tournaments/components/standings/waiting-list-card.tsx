import { Hourglass, Trash2 } from "lucide-react";
import { PlayerAvatar } from "@/components/image/player-avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { WaitingListed } from "@/features/public-tournament/waiting-list";
import type { PublicRegistration } from "@shared/api/public";
import { playerName } from "../../player-name";

interface WaitingListCardProps {
  waiting: readonly WaitingListed<PublicRegistration>[];
  maxPlayers: number;
  /** Why nobody more can be accepted now ("18 of 18 players accepted: raise Max players to accept more"), or null. */
  full: string | null;
  /** Remove a sign-up from the list (the standings' own confirm); absent once the tournament is closed. */
  onRemove?: (registration: PublicRegistration) => void;
}

/**
 * The sign-ups past Max players, numbered in sign-up order (round 5, item 15), under the TD's
 * standings. They are not in the field: not seated, not counted in the entries or the pool, and left
 * out of the bust and re-buy pickers. Accepting one is taking their payment, which the server refuses
 * while Max players are accepted: the card says so, and how to make room.
 */
export function WaitingListCard({ waiting, maxPlayers, full, onRemove }: WaitingListCardProps) {
  if (waiting.length === 0) return null;
  return (
    <Card data-testid="waiting-list">
      <CardHeader className="border-b border-border">
        <CardTitle className="flex items-center gap-2">
          <Hourglass className="h-5 w-5 text-accent-text" aria-hidden="true" />
          Waiting list
        </CardTitle>
        <CardDescription>
          Signed up after the field of {maxPlayers} filled. They play once accepted: take their payment when a place opens.
        </CardDescription>
        {full ? (
          <p className="mt-2 rounded-md bg-muted px-3 py-2 text-sm font-medium text-foreground" data-testid="waiting-list-full">
            {full}.
          </p>
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        <ol role="list" aria-label="Waiting list" className="divide-y divide-border">
          {waiting.map(({ registration, position }) => {
            const name = playerName(registration);
            return (
              <li key={registration.id} className="flex min-h-14 items-center gap-3 px-4 py-2" data-testid={`waiting-${registration.id}`}>
                <span className="w-8 shrink-0 text-center text-sm font-bold tabular-nums text-muted-foreground">
                  <span aria-hidden="true">#{position}</span>
                  <span className="sr-only">Number {position}</span>
                </span>
                <PlayerAvatar name={name} imageUrl={registration.player?.imageUrl} size="md" />
                <span className="min-w-0 flex-1 break-words font-medium text-foreground">{name}</span>
                {onRemove ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11 shrink-0 md:h-10 md:w-10"
                    onClick={() => onRemove(registration)}
                    aria-label={`Remove ${name}'s entry`}
                    data-testid={`remove-registration-${registration.id}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
