import { QueryClient, type DefaultOptions } from "@tanstack/react-query";
import { isApiError, isTimeout } from "./http";

/** How long fetched data counts as fresh: a remount or refocus within this reuses it without asking again. */
export const STALE_TIME_MS = 30_000;

/**
 * How long a lookup that rarely changes while a page is open stays fresh: a club, a season, its points
 * rules, its leaderboard. Players' phones at a venue share one address and so one request budget on
 * the server; without this, every unlock or reconnect asked for all of them again (P3REV4-PERF-06).
 * Changes made in the app still refresh them at once, through the invalidation helpers.
 */
export const LOOKUP_STALE_MS = 10 * 60_000;

/**
 * Server or network trouble may pass, so a read asks twice more; a 4xx answer never changes on its own.
 * A request that timed out is not asked again at once: each try already waited the whole timeout, so
 * two more kept a skeleton up for 48 s (93 s for a send) before saying anything; the error's Try again
 * and the next poll ask again instead (P3REV-PERF-TIMEOUT-RETRIES). Every read follows this rule and
 * `retryDelay`, the session check at start-up included (P3REV5-CQ-14).
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (isApiError(error) && error.status >= 400 && error.status < 500) return false;
  if (isTimeout(error)) return false;
  return failureCount < 2;
}

/** How long a read waits before asking again: 1 s, then 2 s, doubling (TanStack Query's own backoff). */
export function retryDelay(failureCount: number): number {
  return Math.min(1000 * 2 ** failureCount, 30_000);
}

/**
 * The app's query client; tests pass `{ queries: { retry: false } }` so a failing request fails at once.
 * There is no default fetcher: every query comes from a feature's `queryOptions` (a `qk` key and its fetcher).
 */
export function createQueryClient(overrides: DefaultOptions = {}): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE_TIME_MS,
        refetchOnWindowFocus: true,
        retry: shouldRetry,
        retryDelay,
        // Always sent, never paused while the browser says it is offline: a paused request never started
        // its timeout, so a first load spun for ever and a desk action replayed minutes later, after the
        // TD had done it another way. Sent, it fails fast with "Could not reach the server" and the
        // error states, toasts and LiveStatus say so (P3REV-PERF-OFFLINE-PAUSE).
        networkMode: "always",
        ...overrides.queries,
      },
      mutations: {
        retry: false,
        networkMode: "always",
        ...overrides.mutations,
      },
    },
  });
}

/** The one client the app renders with (AppProviders). Components reach it through useQueryClient(). */
export const queryClient = createQueryClient();
