import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TOURNAMENT_STATUS_LABELS } from "@/components/shared/status-badge";
import type { ClubDto } from "@shared/api/public";
import { TOURNAMENT_STATUSES, type TournamentStatus } from "@shared/domain/tournaments";

/** The menus' "no filter" choice (a menu item cannot have an empty value). */
const ANY = "any";

export interface TournamentFilterValues {
  clubId?: string;
  status?: TournamentStatus;
  /** True: only one-off games (no season, round 7); false: only season games. */
  oneOff?: boolean;
}

/** Whether any filter is set. */
export const hasFilters = (value: TournamentFilterValues) => Object.values(value).some((filter) => filter !== undefined);

/** The season menu's choices, and the `oneOff` filter each one sets. */
const GAME_KINDS = [
  { value: ANY, label: "All games", oneOff: undefined },
  { value: "season", label: "Season games", oneOff: false },
  { value: "one-off", label: "One-off games", oneOff: true },
] as const;

interface TournamentFiltersProps {
  /** The clubs to filter by; undefined until they have loaded (the club menu waits for them). */
  clubs: readonly ClubDto[] | undefined;
  value: TournamentFilterValues;
  onChange: (value: TournamentFilterValues) => void;
}

/** Narrows the list to one club, season games or one-off games, and one status; the server applies them together. */
export function TournamentFilters({ clubs, value, onChange }: TournamentFiltersProps) {
  const kind = GAME_KINDS.find((choice) => choice.oneOff === value.oneOff) ?? GAME_KINDS[0];
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end" role="search" aria-label="Filter tournaments">
      <div className="space-y-1 sm:w-56">
        <Label htmlFor="tournament-club-filter">Club</Label>
        <Select
          value={value.clubId ?? ANY}
          onValueChange={(clubId) => onChange({ ...value, clubId: clubId === ANY ? undefined : clubId })}
          disabled={clubs === undefined}
        >
          <SelectTrigger id="tournament-club-filter" data-testid="club-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All clubs</SelectItem>
            {(clubs ?? []).map((club) => (
              <SelectItem key={club.id} value={club.id}>
                {club.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1 sm:w-56">
        <Label htmlFor="tournament-season-filter">Season</Label>
        <Select
          value={kind.value}
          onValueChange={(choice) => onChange({ ...value, oneOff: GAME_KINDS.find((option) => option.value === choice)?.oneOff })}
        >
          <SelectTrigger id="tournament-season-filter" data-testid="season-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GAME_KINDS.map((choice) => (
              <SelectItem key={choice.value} value={choice.value}>
                {choice.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1 sm:w-56">
        <Label htmlFor="tournament-status-filter">Status</Label>
        <Select
          value={value.status ?? ANY}
          onValueChange={(status) => onChange({ ...value, status: status === ANY ? undefined : (status as TournamentStatus) })}
        >
          <SelectTrigger id="tournament-status-filter" data-testid="status-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All statuses</SelectItem>
            {TOURNAMENT_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {TOURNAMENT_STATUS_LABELS[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {hasFilters(value) ? (
        <Button variant="ghost" onClick={() => onChange({})} data-testid="clear-filters">
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}
