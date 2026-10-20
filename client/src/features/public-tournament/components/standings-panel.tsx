import type { PublicRegistration, PublicSeason } from "@shared/api/public";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { TabHost } from "@/components/shared/tab-host";
import { SeasonLeaderboardCard } from "@/features/seasons/components/season-leaderboard-card";
import { HighHandWinners } from "./high-hand-winners";
import { StandingsTable } from "./standings-table";
import { offersHighHand } from "@shared/domain/player-actions";

interface StandingsPanelProps {
  tournament: TournamentDetailDto;
  registrations: readonly PublicRegistration[];
  season: PublicSeason | undefined;
}

/** The Standings tab: tonight's standings (and high-hand winners), and the season's leaderboard beside them. */
export function StandingsPanel({ tournament, registrations, season }: StandingsPanelProps) {
  const tonight = (
    <>
      {offersHighHand(tournament) ? <HighHandWinners registrations={registrations} /> : null}
      <StandingsTable registrations={registrations} completed={tournament.status === "completed"} trackPoints={tournament.trackPoints === true} />
    </>
  );
  // Short labels, so both fit a 375 px phone side by side ("Tournament Standings" beside a season's
  // name ran off the screen). The season's name is said with its tab, and shown on its card.
  return (
    <TabHost
      tabs={[
        { value: "tournament", label: "Tournament", content: tonight },
        ...(season
          ? [
              {
                value: "season",
                label: (
                  <>
                    Season<span className="sr-only"> {season.name}</span>
                  </>
                ),
                content: <SeasonLeaderboardCard season={season} />,
              },
            ]
          : []),
      ]}
    />
  );
}
