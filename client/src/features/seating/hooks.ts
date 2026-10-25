/**
 * The seating read the public pages make: "Find your seat" follows it while the tournament runs. The
 * staff panel's reads and changes are in staff-hooks.ts, so the public pages never load them.
 */
import { useQuery } from "@tanstack/react-query";
import type { PublicSeatingDto } from "@shared/api/seating";
import { isClosedStatus } from "@shared/domain/tournaments";
import { unlessRefused } from "@/lib/live-refresh";
import { PUBLIC_SEATING_REFRESH_MS, publicSeatingQueries } from "./api";

/**
 * How often the seat finder asks again: every `everyMs` (PUBLIC_SEATING_REFRESH_MS) while the
 * tournament is open, never once it is over. Before it ever loaded, only a screen that `keepsTrying`
 * asks again (a page with someone at it offers to try again).
 */
export function publicSeatingInterval(
  seating: Pick<PublicSeatingDto, "tournament"> | undefined,
  everyMs = PUBLIC_SEATING_REFRESH_MS,
  keepsTrying = false,
): number | false {
  if (seating === undefined) return keepsTrying ? everyMs : false;
  return isClosedStatus(seating.tournament.status) ? false : everyMs;
}

interface PublicSeatingOptions {
  /**
   * How often to ask again while the tournament is open, or how often given the seating so far (false:
   * not again, as the public tournament page once it knows seats are drawn).
   */
  refetchMs?: number | ((seating: PublicSeatingDto | undefined) => number | false);
  enabled?: boolean;
  /** An unattended screen (the TV's seating overlay) asks again after a failed first load: nobody is there to tap Try again. */
  keepTrying?: boolean;
}

/** Who sits where, for anyone: followed while the tournament runs (balancing and broken tables move players). */
export function usePublicSeating(tournamentId: string, { refetchMs = PUBLIC_SEATING_REFRESH_MS, enabled = true, keepTrying = false }: PublicSeatingOptions = {}) {
  return useQuery({
    ...publicSeatingQueries.detail(tournamentId),
    enabled: enabled && Boolean(tournamentId),
    staleTime: 0,
    refetchInterval: ({ state }) => {
      const everyMs = typeof refetchMs === "function" ? refetchMs(state.data) : refetchMs;
      return unlessRefused(state.error, everyMs === false ? false : publicSeatingInterval(state.data, everyMs, keepTrying));
    },
  });
}
