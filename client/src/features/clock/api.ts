/**
 * The live display read anyone may make (GET /api/public/tournaments/:id/display): the TV clock, the
 * TD's clock panel and the header's clock chip all read it, under one key. Its answers feed the
 * server-time estimate. Staff reads and every change are in staff-api.ts, so the TV page never loads
 * them; the key comes from `qk`, the type from shared/api.
 */
import { queryOptions } from "@tanstack/react-query";
import type { LiveDisplayDto } from "@shared/api/live-display";
import { apiGet, segment } from "@/lib/api/http";
import { qk } from "@/lib/api/query-keys";
import { withServerTime } from "./server-time";

/** How often each screen asks for the display again while it is shown (phase4-contracts §7). */
export const DISPLAY_REFRESH_MS = {
  /** The TV clock at the venue. */
  tv: 3000,
  /**
   * The same page on a player's phone (opened from the public tournament page): every phone on the
   * venue's Wi-Fi shares the TV's request budget, so they ask far less often and let the TV keep its
   * 3 s (P4SEC-LIVE-BUDGET-TV). Between answers the clock still ticks on the server's time.
   */
  phone: 20_000,
  /** The TD's clock tab. */
  panel: 5000,
  /** The clock chip in the tournament page's header. */
  chip: 15_000,
} as const;

/** A phone or a small tablet held in the hand (touch, narrower than a laptop): not the venue's screen. */
export const HANDHELD_QUERY = "(pointer: coarse) and (max-width: 1023px)";

interface TvScreen {
  /** The screen matches HANDHELD_QUERY. */
  handheld: boolean;
  /** Opened from the staff's TV link (`?screen=tv`): the venue's own screen, whatever its size. */
  venueScreen: boolean;
  /** The viewer runs the clock (LiveDisplayDto viewer.canControl). */
  canControl: boolean;
}

/**
 * How often the TV page asks for the display: the venue's rate, except on a handheld screen of a
 * player's. A tablet the club props up at the bar or the desk (an iPad in portrait is "handheld") keeps
 * the venue's rate when opened from the staff's TV link or signed in as staff, so a pause made on the
 * TD's phone shows within seconds, not 20 (TDN2-TABLET-AS-PHONE).
 */
export function tvRefreshMs({ handheld, venueScreen, canControl }: TvScreen): number {
  return handheld && !venueScreen && !canControl ? DISPLAY_REFRESH_MS.phone : DISPLAY_REFRESH_MS.tv;
}

export const liveDisplayQueries = {
  /** The tournament's clock and live figures (PII-free); 404 for an unknown tournament. */
  detail: (tournamentId: string) =>
    queryOptions({
      queryKey: qk.tournaments.display(tournamentId),
      queryFn: ({ signal }) => withServerTime(() => apiGet<LiveDisplayDto>(`/api/public/tournaments/${segment(tournamentId)}/display`, { signal })),
    }),
};
