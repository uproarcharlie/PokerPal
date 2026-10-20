import { useId, useMemo, useState } from "react";
import { TrendingUp } from "lucide-react";
import type { UseQueryResult } from "@tanstack/react-query";
import type { PublicSeason } from "@shared/api/public";
import { EmptyState, QueryState } from "@/components/shared/query-state";
import { TabHost } from "@/components/shared/tab-host";
import { ActiveSeasonBadge } from "@/features/seasons/components/active-season-badge";
import { SeasonLeaderboardCard } from "@/features/seasons/components/season-leaderboard-card";
import { seasonDates } from "@/lib/season-dates";
import { NativeSelect } from "@/components/ui/native-select";

/** Up to this many seasons are tabs; more are a list to pick from. */
const MAX_TABS = 3;

/** Running seasons first, then the most recent start. */
function seasonOrder(a: PublicSeason, b: PublicSeason): number {
  if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
  return new Date(b.startDate).getTime() - new Date(a.startDate).getTime();
}

function SeasonSwitcher({ seasons }: { seasons: PublicSeason[] }) {
  const selectId = useId();
  const ordered = useMemo(() => [...seasons].sort(seasonOrder), [seasons]);
  const [chosen, setChosen] = useState<string | null>(null);
  const selected = ordered.find((season) => season.id === chosen) ?? ordered[0];

  if (ordered.length > MAX_TABS) {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <label htmlFor={selectId} className="text-sm font-medium text-foreground">
            Season
          </label>
          <NativeSelect id={selectId} value={selected.id} onChange={(event) => setChosen(event.target.value)} className="sm:max-w-sm">
            {ordered.map((season) => (
              <option key={season.id} value={season.id}>
                {season.isActive ? `${season.name} (Active)` : season.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <SeasonLeaderboardCard season={selected} subtitle={seasonDates(selected)} />
      </div>
    );
  }

  return (
    <TabHost
      value={selected.id}
      onValueChange={setChosen}
      tabs={ordered.map((season) => ({
        value: season.id,
        label: (
          <>
            {season.name}
            {season.isActive ? <ActiveSeasonBadge label="Active" className="ml-2" /> : null}
          </>
        ),
        content: <SeasonLeaderboardCard season={season} subtitle={seasonDates(season)} />,
      }))}
    />
  );
}

/** The club's season leaderboards, on its public page; only the season shown is fetched. */
export function SeasonStandings({ seasons }: { seasons: UseQueryResult<PublicSeason[]> }) {
  return (
    <QueryState
      query={seasons}
      errorTitle="The club's seasons could not be loaded"
      empty={<EmptyState icon={<TrendingUp className="h-12 w-12" />} title="No seasons available" />}
    >
      {(list) => <SeasonSwitcher seasons={list} />}
    </QueryState>
  );
}
