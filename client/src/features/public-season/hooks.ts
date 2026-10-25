/** The public season page's one read, polled while the page is open and stopped once the season is gone. */
import { useQuery } from "@tanstack/react-query";
import { unlessRefused } from "@/lib/live-refresh";
import { PUBLIC_SEASON_REFRESH_MS, publicSeasonQueries } from "./api";

export const usePublicSeasonLeaderboard = (seasonId: string) =>
  useQuery({
    ...publicSeasonQueries.leaderboard(seasonId),
    enabled: Boolean(seasonId),
    refetchInterval: ({ state }) => unlessRefused(state.error, PUBLIC_SEASON_REFRESH_MS),
  });
