import { useId, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Check, Loader2, Search } from "lucide-react";
import type { PublicPlayer } from "@shared/api/public";
import { PlayerAvatar } from "@/components/image/player-avatar";
import { Input } from "@/components/ui/input";
import { useDebounced } from "@/hooks/use-debounced";
import { errorMessage } from "@/lib/api/http";
import { cn } from "@/lib/utils";
import { publicTournamentQueries } from "../api";

/** Fewer letters than this match too many people to be useful (the API accepts one). */
export const MIN_SEARCH_LENGTH = 2;
const DEBOUNCE_MS = 250;
/** A search result is good for this long: the players known at a club change slowly. */
const SEARCH_STALE_MS = 30_000;

/** The search's wording: the QR page speaks to the player, the TD's desk about them. */
export interface PlayerSearchWording {
  placeholder: string;
  label: string;
  tooShort: string;
  noMatch: string;
}

const PLAYER_WORDING: PlayerSearchWording = {
  placeholder: "Start typing your name",
  label: "Search for your name",
  tooShort: `Type at least ${MIN_SEARCH_LENGTH} letters of your name.`,
  noMatch: 'No players found with that name here. Go back and choose "New Player" if this is your first game with us.',
};

interface PlayerSearchProps {
  tournamentId: string;
  selected: PublicPlayer | null;
  onSelect: (player: PublicPlayer) => void;
  wording?: PlayerSearchWording;
  /**
   * The id of the visible words that ask for the name (the QR sign-up's "Find Your Name"): they become
   * the box's name, so a player using Voice Control can say what they see (WCAG 2.5.3, MA-REV-08).
   * Without it the box is named `wording.label`.
   */
  labelledBy?: string;
}

/**
 * "Find yourself" for the QR register page, and "find a player" for the TD:
 * GET /api/public/tournaments/:id/players?q= searches by name the players known at this tournament's
 * club, or for its staff everyone who has played at any club.
 */
export function PlayerSearch({ tournamentId, selected, onSelect, wording = PLAYER_WORDING, labelledBy }: PlayerSearchProps) {
  const [text, setText] = useState("");
  const q = useDebounced(text.trim(), DEBOUNCE_MS);
  const searching = q.length >= MIN_SEARCH_LENGTH;
  const hintId = useId();

  const search = useQuery({
    ...publicTournamentQueries.playerSearch(tournamentId, q),
    enabled: searching,
    staleTime: SEARCH_STALE_MS,
    // The last matches stay, tappable, while the next letters' answer comes: on venue Wi-Fi the list
    // went blank at every pause in typing (P3REV4-PERF-F).
    placeholderData: keepPreviousData,
  });
  const players = search.data ?? [];
  const waiting = search.isPending || search.isPlaceholderData;

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          type="search"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={wording.placeholder}
          aria-label={labelledBy ? undefined : wording.label}
          aria-labelledby={labelledBy}
          aria-describedby={hintId}
          autoComplete="off"
          enterKeyHint="search"
          className="h-11 pl-9"
          data-testid="player-search"
        />
        {search.isFetching ? (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : null}
      </div>

      <div id={hintId} aria-live="polite">
        {!searching ? (
          <p className="text-sm text-muted-foreground">{wording.tooShort}</p>
        ) : search.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage(search.error)}
          </p>
        ) : waiting && players.length === 0 ? (
          <p className="sr-only">Searching</p>
        ) : !waiting && players.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="player-search-empty">
            {wording.noMatch}
          </p>
        ) : null}
      </div>

      {searching && players.length > 0 ? (
        <ul role="list" className="space-y-2" aria-label="Matching players">
          {players.map((player) => {
            const isSelected = selected?.id === player.id;
            return (
              <li key={player.id}>
                <button
                  type="button"
                  onClick={() => onSelect(player)}
                  aria-pressed={isSelected}
                  className={cn(
                    "flex min-h-14 w-full items-center gap-3 rounded-lg border-2 px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isSelected ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
                  )}
                  data-testid={`player-option-${player.id}`}
                >
                  {/* Big enough to know yourself by (round 5, item 6); initials for a player with no picture. */}
                  <PlayerAvatar name={player.name} imageUrl={player.imageUrl} size="md" />
                  <span className="flex-1 font-medium text-foreground">{player.name}</span>
                  {isSelected ? <Check className="h-4 w-4 text-primary" aria-hidden="true" /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
