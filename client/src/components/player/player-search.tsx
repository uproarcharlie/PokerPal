import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, Search, User } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { apiJson } from "@/lib/queryClient";
import type { PublicPlayer } from "@shared/api/public";

/** Fewer letters than this match too many people to be useful (the API accepts one). */
export const MIN_SEARCH_LENGTH = 2;
const DEBOUNCE_MS = 250;

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

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
}

/**
 * "Find yourself" for the QR register page, and "find a player" for the TD:
 * GET /api/public/tournaments/:id/players?q= searches by name the players who have played at this
 * tournament's club, or for its staff everyone who has played at any club.
 */
export function PlayerSearch({ tournamentId, selected, onSelect, wording = PLAYER_WORDING }: PlayerSearchProps) {
  const [text, setText] = useState("");
  const q = useDebounced(text.trim(), DEBOUNCE_MS);
  const searching = q.length >= MIN_SEARCH_LENGTH;

  const { data: players = [], isFetching, error } = useQuery<PublicPlayer[]>({
    queryKey: ["/api/public/tournaments", tournamentId, "players", q],
    queryFn: () =>
      apiJson<PublicPlayer[]>(
        "GET",
        `/api/public/tournaments/${encodeURIComponent(tournamentId)}/players?q=${encodeURIComponent(q)}`,
      ),
    enabled: searching,
    staleTime: 30_000,
  });

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={wording.placeholder}
          aria-label={wording.label}
          autoComplete="off"
          className="pl-9"
          data-testid="player-search"
        />
        {isFetching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />}
      </div>

      {!searching ? (
        <p className="text-sm text-muted-foreground">{wording.tooShort}</p>
      ) : error ? (
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      ) : !isFetching && players.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="player-search-empty">
          {wording.noMatch}
        </p>
      ) : (
        <ul className="space-y-2" aria-label="Matching players">
          {players.map((player) => {
            const isSelected = selected?.id === player.id;
            return (
              <li key={player.id}>
                <button
                  type="button"
                  onClick={() => onSelect(player)}
                  aria-pressed={isSelected}
                  className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 text-left transition-colors ${
                    isSelected ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                  }`}
                  data-testid={`player-option-${player.id}`}
                >
                  <Avatar className="w-8 h-8">
                    <AvatarImage src={player.imageUrl ?? undefined} alt={player.name} />
                    <AvatarFallback>
                      <User className="w-4 h-4" />
                    </AvatarFallback>
                  </Avatar>
                  <span className="flex-1 font-medium">{player.name}</span>
                  {isSelected && <Check className="w-4 h-4 text-primary" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
