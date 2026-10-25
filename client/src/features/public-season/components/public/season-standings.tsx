import { useId, useState } from "react";
import { Trophy } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/shared/query-state";
import { SeasonLeaderboardTable } from "@/features/seasons/components/season-leaderboard-table";
import { plural } from "@/lib/format";
import { nameMatches } from "@/lib/name-search";
import type { LeaderboardEntryDto } from "@shared/api/seasons";

/**
 * Players whose name matches what was typed, by the seat finder's rule (word starts, any case or
 * accent: "zoe" finds "Zoë"); their ranks stay the season's (never re-ranked).
 */
export function matchingEntries(entries: readonly LeaderboardEntryDto[], query: string): readonly LeaderboardEntryDto[] {
  if (query.trim() === "") return entries;
  return entries.filter((entry) => nameMatches(entry.player.name, query));
}

interface SeasonStandingsProps {
  entries: readonly LeaderboardEntryDto[];
  seasonName: string;
}

/** The standings with a "Find me" box, so a player who scanned the QR code finds their place at once. */
export function SeasonStandings({ entries, seasonName }: SeasonStandingsProps) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  if (entries.length === 0) {
    return (
      <EmptyState
        icon={<Trophy className="h-10 w-10" />}
        title="No points awarded yet"
        description="Points show here once a tournament in this season is finalized."
      />
    );
  }
  const shown = matchingEntries(entries, query);
  const searching = query.trim() !== "";
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor={searchId}>Find me</Label>
        <Input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Type your name"
          autoComplete="off"
          enterKeyHint="search"
        />
      </div>
      <p role="status" className="text-sm text-muted-foreground" data-testid="standings-count">
        {searching ? `${plural(shown.length, "player")} found of ${entries.length}` : `${plural(entries.length, "player")} with points`}
      </p>
      {shown.length === 0 ? (
        <p className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          Nobody called &ldquo;{query.trim()}&rdquo; has points yet this season.
        </p>
      ) : (
        <Card>
          <CardContent className="p-0">
            <SeasonLeaderboardTable entries={shown} seasonName={seasonName} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
