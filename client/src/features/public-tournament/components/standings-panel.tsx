import type { PublicRegistration, PublicSeason } from "@shared/api/public";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { TabHost } from "@/components/shared/tab-host";
import { SeasonLeaderboardCard } from "@/features/seasons/components/season-leaderboard-card";
import { HighHandWinners } from "./high-hand-winners";
import { StandingsTable } from "./standings-table";
import { WaitingListCard } from "./waiting-list-card";
import { lineupOf } from "../waiting-list";
import { offersHighHand } from "@shared/domain/player-actions";
import { isClosedStatus } from "@shared/domain/tournaments";

interface StandingsPanelProps {
  tournament: TournamentDetailDto;
  registrations: readonly PublicRegistration[];
  season: PublicSeason | undefined;
}

/**
 * The Standings tab: tonight's standings (and high-hand winners), the waiting list behind a full field
 * while sign-ups are open (round 5, item 15: its players are not in the standings), and the season's
 * leaderboard beside them.
 */
export function StandingsPanel({ tournament, registrations, season }: StandingsPanelProps) {
  const { field, waiting } = lineupOf(registrations, tournament.maxPlayers);
  const tonight = (
    <div className="space-y-6">
      {offersHighHand(tournament) ? <HighHandWinners registrations={registrations} /> : null}
      <StandingsTable registrations={field} completed={tournament.status === "completed"} trackPoints={tournament.trackPoints === true} />
      {isClosedStatus(tournament.status) ? null : <WaitingListCard waiting={waiting} />}
    </div>
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
