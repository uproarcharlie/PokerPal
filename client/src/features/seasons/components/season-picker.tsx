import type { PublicSeason } from "@shared/api/public";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ActiveSeasonBadge } from "./active-season-badge";

interface SeasonPickerProps {
  seasons: readonly PublicSeason[];
  /** The club's name for a season, or "" while the clubs load. */
  clubName: (clubId: string) => string;
  /** The chosen season's id; undefined for none. */
  value: string | undefined;
  onChange: (seasonId: string) => void;
  disabled?: boolean;
}

/** Which season's leaderboard to show: each season with its club, the active ones marked. */
export function SeasonPicker({ seasons, clubName, value, onChange, disabled = false }: SeasonPickerProps) {
  return (
    <Select value={value ?? ""} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="w-full sm:w-72" aria-label="Season" data-testid="season-selector">
        <SelectValue placeholder="Select a season" />
      </SelectTrigger>
      <SelectContent>
        {seasons.length === 0 ? (
          <SelectItem value="no-seasons" disabled>
            No seasons available
          </SelectItem>
        ) : (
          seasons.map((season) => {
            const club = clubName(season.clubId);
            return (
              <SelectItem key={season.id} value={season.id}>
                {club ? `${season.name} - ${club}` : season.name}
                {season.isActive ? <ActiveSeasonBadge label="Active" className="ml-2" /> : null}
              </SelectItem>
            );
          })
        )}
      </SelectContent>
    </Select>
  );
}
