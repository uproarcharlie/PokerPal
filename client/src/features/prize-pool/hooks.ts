/**
 * The prize-pool read. Followed like the tournament's registrations (lib/live-refresh): asked again every
 * LIVE_REFRESH_MS while the tournament is open, since a QR sign-up or a request confirmed on another
 * device changes the pool. Whenever its results are written (it closes, or a Correct Results), the
 * page's useRegistrations asks for it once more (invalidateWrittenResults), so what was paid shows up
 * even when the last poll ran before the finalize, without cancelling a refetch already on its way.
 */
import { useQuery } from "@tanstack/react-query";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { liveRegistrationsInterval, unlessRefused } from "@/lib/live-refresh";
import { prizePoolQueries } from "./api";

type Followed = Pick<TournamentDetailDto, "status" | "finalizedAt">;

export function usePrizePool(tournamentId: string, { follow }: { follow?: Followed } = {}) {
  return useQuery({
    ...prizePoolQueries.detail(tournamentId),
    enabled: Boolean(tournamentId),
    refetchInterval: ({ state }) => unlessRefused(state.error, liveRegistrationsInterval(follow)),
  });
}
