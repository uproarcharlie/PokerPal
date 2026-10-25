import { useId } from "react";
import type { SeatingDto } from "@shared/api/seating";
import { PlayerAvatar } from "@/components/image/player-avatar";
import { Button } from "@/components/ui/button";
import { playerName } from "@/features/tournaments/player-name";
import { cn } from "@/lib/utils";
import { UnpaidDot } from "./unpaid-dot";

interface UnseatedListProps {
  unseated: SeatingDto["unseated"];
  selectedId: string | null;
  readOnly: boolean;
  busy: boolean;
  /** The player is picked up, to be put in a seat of the TD's choosing. */
  onSelect: (registrationId: string) => void;
  /** The player gets a random empty seat. */
  onSeat: (registrationId: string) => void;
}

/** Players still in without a seat (late sign-ups, re-entries, unseated): pick one up, or seat them at random in one tap. */
export function UnseatedList({ unseated, selectedId, readOnly, busy, onSelect, onSeat }: UnseatedListProps) {
  const headingId = useId();
  if (unseated.length === 0) return null;
  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <h2 id={headingId} className="text-base font-semibold text-foreground">
        Waiting for a seat ({unseated.length})
      </h2>
      <ul role="list" className="flex flex-wrap gap-2" data-testid="unseated-list">
        {unseated.map((entry) => {
          const name = playerName(entry);
          const selected = entry.registrationId === selectedId;
          return (
            <li key={entry.registrationId} className={cn("flex items-center gap-1 rounded-full border bg-card p-1", selected ? "border-primary ring-2 ring-primary" : "border-border")}>
              {readOnly ? (
                <span className="flex min-h-11 items-center gap-2 px-2">
                  <PlayerAvatar name={name} imageUrl={entry.player.imageUrl} size="xs" />
                  <span className="text-sm text-foreground">{name}</span>
                  {entry.paymentConfirmed ? null : <UnpaidDot />}
                </span>
              ) : (
                <>
                  <button
                    type="button"
                    aria-pressed={selected}
                    aria-disabled={busy || undefined}
                    onClick={() => (busy ? undefined : onSelect(entry.registrationId))}
                    className="flex min-h-11 items-center gap-2 rounded-full px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <PlayerAvatar name={name} imageUrl={entry.player.imageUrl} size="xs" />
                    <span className="text-sm text-foreground">{name}</span>
                    {entry.paymentConfirmed ? null : <UnpaidDot />}
                  </button>
                  <Button type="button" size="sm" variant="secondary" className="h-11 rounded-full" busy={busy} aria-label={`Seat ${name} at random`} onClick={() => onSeat(entry.registrationId)}>
                    Seat
                  </Button>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
