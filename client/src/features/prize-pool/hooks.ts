/**
 * The prize-pool read. Followed like the tournament's registrations (lib/live-refresh): asked again every
 * LIVE_REFRESH_MS while the tournament is open, since a QR sign-up or a request confirmed on another
 * device changes the pool, and once more whenever its results are written (it closes, or a Correct
 * Results), so what was paid shows up even when the last poll ran before the finalize.
 */
import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { qk } from "@/lib/api/query-keys";
import { liveRegistrationsInterval, resultsVersion, unlessRefused } from "@/lib/live-refresh";
import { prizePoolQueries } from "./api";

type Followed = Pick<TournamentDetailDto, "status" | "finalizedAt">;

export function usePrizePool(tournamentId: string, { follow }: { follow?: Followed } = {}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    ...prizePoolQueries.detail(tournamentId),
    enabled: Boolean(tournamentId),
    refetchInterval: ({ state }) => unlessRefused(state.error, liveRegistrationsInterval(follow)),
  });
  const version = follow === undefined ? undefined : resultsVersion(follow);
  const seenVersion = useRef(version);
  useEffect(() => {
    const previous = seenVersion.current;
    seenVersion.current = version;
    if (previous !== undefined && version !== undefined && version !== previous) {
      void queryClient.invalidateQueries({ queryKey: qk.tournaments.prizePool(tournamentId) });
    }
  }, [version, queryClient, tournamentId]);
  return query;
}
