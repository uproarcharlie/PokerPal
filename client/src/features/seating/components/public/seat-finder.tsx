import { useEffect, useId, useRef } from "react";
import { Search } from "lucide-react";
import type { PublicSeatingDto } from "@shared/api/seating";
import { PlayerAvatar } from "@/components/image/player-avatar";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { plural } from "@/lib/format";
import { nameMatches } from "@/lib/name-search";

/** Enough results for a common first name; a longer name narrows them. */
const MAX_RESULTS = 12;

type SeatedPlayer = PublicSeatingDto["players"][number];

interface SeatFinderProps {
  players: PublicSeatingDto["players"];
  unseatedCount: number;
  query: string;
  onQueryChange: (query: string) => void;
}

/** The players whose names match what is typed, in name order (the list arrives sorted by name). */
export function findSeats(players: readonly SeatedPlayer[], query: string): SeatedPlayer[] {
  return players.filter((entry) => nameMatches(entry.player.name, query)).slice(0, MAX_RESULTS);
}

/** A seat as the room says it: "Table 3 · Seat 7" (a named table by its name). */
export const seatLine = (entry: Pick<SeatedPlayer, "tableName" | "seatNumber">): string => `${entry.tableName} · Seat ${entry.seatNumber}`;

/**
 * "Find your seat": a player types their name and sees their table and seat in large type. The box
 * takes focus when the page opens, as the page is for this one search (a QR code at the door leads
 * here).
 */
export function SeatFinder({ players, unseatedCount, query, onQueryChange }: SeatFinderProps) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
  }, []);
  const typed = query.trim();
  const matches = typed === "" ? [] : findSeats(players, typed);
  const waiting = plural(unseatedCount, "player is", "players are");

  return (
    <section aria-label="Find your seat" className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor={inputId} className="text-base">
          Type your name
        </Label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            ref={input}
            id={inputId}
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            autoComplete="off"
            autoCapitalize="words"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            className="h-12 pl-10 text-lg"
            data-testid="seat-search"
          />
        </div>
      </div>
      <div aria-live="polite" data-testid="seat-results">
        {typed === "" ? (
          <p className="text-sm text-muted-foreground">Your table and seat show here as you type.</p>
        ) : matches.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            Nobody seated has that name.{unseatedCount > 0 ? ` ${waiting} still waiting for a seat: ask the tournament director.` : ""}
          </p>
        ) : (
          <ul role="list" className="space-y-3">
            {matches.map((entry) => (
              <li key={entry.player.id}>
                <Card className="flex items-center gap-4 p-4">
                  <PlayerAvatar name={entry.player.name} imageUrl={entry.player.imageUrl} size="lg" />
                  <div className="min-w-0">
                    <p className="break-words font-semibold text-foreground">{entry.player.name}</p>
                    <p className="text-2xl font-bold tabular-nums text-primary sm:text-3xl">{seatLine(entry)}</p>
                    {entry.tableName !== `Table ${entry.tableNumber}` ? <p className="text-sm text-muted-foreground">Table {entry.tableNumber}</p> : null}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
