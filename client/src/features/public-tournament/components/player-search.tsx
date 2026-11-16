import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Search } from "lucide-react";
import { sameNameSearch } from "@shared/api/players";
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
                <PlayerRow
                  player={player}
                  onClick={() => onSelect(player)}
                  pressed={isSelected}
                  testId={`player-option-${player.id}`}
                  trailing={isSelected ? <Check className="h-4 w-4 text-primary" aria-hidden="true" /> : null}
                />
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

interface PlayerRowProps {
  player: PublicPlayer;
  onClick: () => void;
  /** For a row that picks the player (the search's): whether it is the one picked. */
  pressed?: boolean;
  trailing: ReactNode;
  testId: string;
}

/** A player to tap: their picture, big enough to know yourself by (round 5, item 6; initials without one), and name. */
function PlayerRow({ player, onClick, pressed, trailing, testId }: PlayerRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      className={cn(
        "flex min-h-14 w-full items-center gap-3 rounded-lg border-2 px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        pressed ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
      )}
      data-testid={testId}
    >
      <PlayerAvatar name={player.name} imageUrl={player.imageUrl} size="md" />
      <span className="min-w-0 flex-1 break-words font-medium text-foreground">{player.name}</span>
      {trailing}
    </button>
  );
}

/**
 * Who a new player might already be (round 7, item 9): the players the tournament's name search finds
 * (the club's, or for its staff everyone who has played) called exactly that name, as PublicPlayer,
 * found by the server however many other names contain theirs (R7FREV1-01). Asked once the name is
 * typed, before a new player is made, with or without a mobile number (R7FREV1-02). Here, not in
 * ../hooks, as only the sign-up screens need it: the pages that only show things load no request
 * schemas (test/unit/public-bundle.test.ts).
 */
export function useSameNameLookup(tournamentId: string): (name: string) => Promise<PublicPlayer[]> {
  const queryClient = useQueryClient();
  return useCallback(
    async (name: string) => {
      const search = sameNameSearch(name);
      if (!search) return [];
      return await queryClient.fetchQuery(publicTournamentQueries.sameNamePlayers(tournamentId, search));
    },
    [queryClient, tournamentId],
  );
}

/** "Already played here? That's me": the QR page speaks to the player, the TD's desk about them. */
export interface SameNameWording {
  title: string;
  /** Under the title, for one player with the name or several. */
  description: (count: number) => string;
  /** On each player's row. */
  choose: string;
}

const PLAYER_SAME_NAME: SameNameWording = {
  title: "Already played here?",
  description: (count) =>
    count === 1
      ? "Someone with your name has played here before. If it's you, tap your name, so your results stay together."
      : "Players with your name have played here before. If one of them is you, tap your name, so your results stay together.",
  choose: "That's me",
};

interface SameNameSuggestionProps {
  /** The players with the name typed (useSameNameLookup): picture and name only. */
  players: readonly PublicPlayer[];
  onChoose: (player: PublicPlayer) => void;
  wording?: SameNameWording;
}

/**
 * Who a new player without a mobile number might already be (round 7, item 9): with no number to
 * know them by, the players with the same name are offered first, so a returning player signs up as
 * themselves rather than as a second player. It takes focus when it appears, in place of the sign-up
 * the player asked for.
 */
export function SameNameSuggestion({ players, onChoose, wording = PLAYER_SAME_NAME }: SameNameSuggestionProps) {
  const titleId = useId();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <section
      ref={ref}
      tabIndex={-1}
      aria-labelledby={titleId}
      className="space-y-3 rounded-lg border border-primary/40 bg-primary/5 p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid="same-name-suggestion"
    >
      <div className="space-y-1">
        <p id={titleId} className="text-base font-semibold text-foreground">
          {wording.title}
        </p>
        <p className="text-sm text-muted-foreground">{wording.description(players.length)}</p>
      </div>
      <ul role="list" className="space-y-2">
        {players.map((player) => (
          <li key={player.id}>
            <PlayerRow
              player={player}
              onClick={() => onChoose(player)}
              testId={`same-name-${player.id}`}
              trailing={
                <span className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground">{wording.choose}</span>
              }
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
