/**
 * The live clock every screen shows: the display query, polled at the screen's own pace, and the clock
 * derived from it every CLOCK_TICK_MS on the server's estimated time (never the device's own clock
 * alone). The stored clock holds anchors only (when the running period ends, or what is left of it),
 * so the level and the time left are worked out here, with the same pure deriveClock the server uses.
 * A screen re-renders when the second it shows, the level or the status changes, not on every tick.
 * Public: the TV page loads this module, so it holds no staff code and no zod.
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { ClockDto } from "@shared/api/clock";
import type { LiveDisplayDto } from "@shared/api/live-display";
import { deriveClock, type ClockState, type DerivedClock } from "@shared/domain/clock";
import { isClosedStatus } from "@shared/domain/tournaments";
import { CLOSED_FOLLOW_MS, CLOSED_REFRESH_MS, unlessRefused } from "@/lib/live-refresh";
import { liveDisplayQueries } from "./api";
import { serverTime } from "./server-time";

/** How often the clock on screen is worked out again. */
export const CLOCK_TICK_MS = 250;

/** After this long without a good answer, the screen says it is offline (it keeps ticking). */
export const OFFLINE_AFTER_MS = 30_000;

interface LiveDisplayOptions {
  /**
   * How often to ask again (DISPLAY_REFRESH_MS), or how often given the display so far (the TV's rate
   * depends on its viewer; false: not again, as the public page once it knows the clock is set up).
   */
  refetchMs: number | ((display: LiveDisplayDto | undefined) => number | false);
  enabled?: boolean;
}

/**
 * The display's poll as the screen wants it, within liveDisplayInterval's limits, measured on the
 * server's time like every other clock figure: a venue TV whose own clock is hours out still follows a
 * finished game for as long as the server says (P4REV1-R2-05).
 */
function displayInterval({ refetchMs }: LiveDisplayOptions, display: LiveDisplayDto | undefined): number | false {
  const everyMs = typeof refetchMs === "function" ? refetchMs(display) : refetchMs;
  return everyMs === false ? false : liveDisplayInterval(display, everyMs, serverTime.now());
}

/**
 * How long without a good answer means the screen is offline, given how often it asks
 * (liveDisplayInterval): two polls missed, and never less than OFFLINE_AFTER_MS; null when no poll is
 * due (a cancelled tournament, or a completed one followed long enough), so a screen left on a closed
 * game never says it is reconnecting (P4REV1-CC-02).
 */
export function offlineAfterMs(interval: number | false): number | null {
  return interval === false ? null : Math.max(OFFLINE_AFTER_MS, 2 * interval);
}

/**
 * How often a display is asked again, like a followed tournament (lib/live-refresh): every `everyMs`
 * while the tournament is open, and before a first answer (an unattended TV keeps trying a failed first
 * load); once it is completed, every CLOSED_REFRESH_MS for CLOSED_FOLLOW_MS after its results were
 * written (finalize finishes the clock then, so its `updatedAt` is when), so a Correct Results still
 * reaches a screen left on it; never once it is cancelled, or completed without a clock or long ago.
 */
export function liveDisplayInterval(display: Pick<LiveDisplayDto, "tournament" | "clock"> | undefined, everyMs: number, now = Date.now()): number | false {
  if (display === undefined || !isClosedStatus(display.tournament.status)) return everyMs;
  if (display.tournament.status !== "completed" || display.clock === null) return false;
  return now - Date.parse(display.clock.updatedAt) < CLOSED_FOLLOW_MS ? Math.max(everyMs, CLOSED_REFRESH_MS) : false;
}

/** The display, asked for every `refetchMs` while the tournament is on (liveDisplayInterval) until the server refuses it for good (gone, or a 403). */
export function useLiveDisplay(tournamentId: string, options: LiveDisplayOptions) {
  return useQuery({
    ...liveDisplayQueries.detail(tournamentId),
    enabled: (options.enabled ?? true) && Boolean(tournamentId),
    refetchInterval: ({ state }) => unlessRefused(state.error, displayInterval(options, state.data)),
    staleTime: 0,
  });
}

/** The anchors deriveClock reads, from the clock as the server sent it. */
export function clockStateOf(clock: ClockDto): ClockState {
  const { status, currentLevelIndex, periodEndsAt, pausedRemainingMs, startedAt } = clock;
  return { status, currentLevelIndex, periodEndsAt, pausedRemainingMs, startedAt };
}

/** The clock a display shows at `nowMs` (the server's time); null without a clock or levels. */
export function deriveDisplayClock(display: Pick<LiveDisplayDto, "clock"> | undefined, nowMs: number): DerivedClock | null {
  const clock = display?.clock;
  return clock ? deriveClock(clockStateOf(clock), clock.structure.levels, nowMs) : null;
}

export interface LiveClockSnapshot {
  derived: DerivedClock | null;
  /** The server's estimated time the snapshot was worked out at. */
  serverNow: number;
  /** No good answer for two polls (offlineAfterMs) while one is due: the screen says so and keeps ticking. */
  offline: boolean;
}

/** What a screen shows of a snapshot: when none of it changes, the screen does not re-render. */
function shownKey({ derived, offline }: LiveClockSnapshot): string {
  if (!derived) return `none|${String(offline)}`;
  return [derived.status, derived.levelIndex, Math.ceil(derived.remainingMs / 1000), offline].join("|");
}

/** A ticking store over one answer: its snapshot changes only when what a screen shows changes. */
function liveClockStore(clock: ClockDto | null, lastAnswerAt: number, offlineAfter: number | null) {
  let cached: { key: string; snapshot: LiveClockSnapshot } | null = null;
  const getSnapshot = (): LiveClockSnapshot => {
    const now = serverTime.now();
    const snapshot: LiveClockSnapshot = {
      derived: clock ? deriveClock(clockStateOf(clock), clock.structure.levels, now) : null,
      serverNow: now,
      offline: offlineAfter !== null && lastAnswerAt > 0 && Date.now() - lastAnswerAt > offlineAfter,
    };
    const key = shownKey(snapshot);
    if (cached === null || cached.key !== key) cached = { key, snapshot };
    return cached.snapshot;
  };
  const subscribe = (onChange: () => void) => {
    const timer = setInterval(onChange, CLOCK_TICK_MS);
    return () => clearInterval(timer);
  };
  return { getSnapshot, subscribe };
}

/** A page that was hidden may have slept: its server-time samples are no longer to be trusted. */
function useServerTimeReset(): void {
  useEffect(() => {
    const reset = () => serverTime.reset();
    document.addEventListener("visibilitychange", reset);
    return () => document.removeEventListener("visibilitychange", reset);
  }, []);
}

export interface LiveClock extends LiveClockSnapshot {
  query: UseQueryResult<LiveDisplayDto>;
  display: LiveDisplayDto | undefined;
}

/** The display and the clock it shows, ticking locally between polls. */
export function useLiveClock(tournamentId: string, options: LiveDisplayOptions): LiveClock {
  const query = useLiveDisplay(tournamentId, options);
  useServerTimeReset();
  const clock = query.data?.clock ?? null;
  const { dataUpdatedAt } = query;
  const offlineAfter = offlineAfterMs(displayInterval(options, query.data));
  const store = useMemo(() => liveClockStore(clock, dataUpdatedAt, offlineAfter), [clock, dataUpdatedAt, offlineAfter]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { query, display: query.data, ...snapshot };
}
