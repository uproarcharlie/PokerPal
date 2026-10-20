import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { hashKey, useQueryClient, type QueryKey, type QueryState } from "@tanstack/react-query";
import { WifiOff } from "lucide-react";
import { useNow } from "@/hooks/use-now";
import { errorMessage, isLastingRefusal } from "@/lib/api/http";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/** What LiveStatus reads of each followed query. */
export interface FollowedQuery {
  data: unknown;
  dataUpdatedAt: number;
  isRefetchError: boolean;
  error: unknown;
}

/** A followed query as it stands, and how often it asks again: false when it is not polled. */
export interface FollowedState {
  query: FollowedQuery;
  interval: number | false;
}

/** A query the page follows, by its key, and how often it asks again: false when it is not polled. */
export interface Followed {
  queryKey: QueryKey;
  interval: number | false;
}

/** The followed data counts as behind once no answer has arrived for this many poll intervals. */
export const BEHIND_AFTER_INTERVALS = 3;

/** How often the notice checks whether the data has fallen behind. */
const CHECK_EVERY_MS = 5000;

const isHidden = () => document.visibilityState === "hidden";

/**
 * When the page was last brought back into view (or first shown). Polls do not run while it is hidden,
 * so data that only aged while nobody could see it is not "behind" (P3REV-PERF-LIVESTATUS-HIDDEN).
 */
function useShownSince(): number {
  const [since, setSince] = useState(() => Date.now());
  useEffect(() => {
    const shown = () => {
      if (!isHidden()) setSince(Date.now());
    };
    document.addEventListener("visibilitychange", shown);
    window.addEventListener("pageshow", shown);
    return () => {
      document.removeEventListener("visibilitychange", shown);
      window.removeEventListener("pageshow", shown);
    };
  }, []);
  return since;
}

function followedQuery(state: QueryState | undefined): FollowedQuery {
  return {
    data: state?.data,
    dataUpdatedAt: state?.dataUpdatedAt ?? 0,
    isRefetchError: state?.status === "error" && state.data !== undefined,
    error: state?.error ?? null,
  };
}

/**
 * The followed queries as they stand, read from the cache by key. LiveStatus watches them itself, so
 * only it re-draws when a poll answers: the page that owns the queries is not re-drawn, with all its
 * tables, by every answer that changed nothing (P3REV-PERF-POLL-RERENDER).
 */
function useFollowedQueries(keys: readonly QueryKey[]): FollowedQuery[] {
  const queryClient = useQueryClient();
  const hashes = keys.map((key) => hashKey(key)).join("\n");
  const subscribe = useCallback(
    (onChange: () => void) => {
      const watched = new Set(hashes.split("\n"));
      return queryClient.getQueryCache().subscribe((event) => {
        if (watched.has(event.query.queryHash)) onChange();
      });
    },
    [queryClient, hashes],
  );
  const snapshot = () =>
    keys
      .map((key) => {
        const state = queryClient.getQueryState(key);
        return `${state?.status}:${state?.data === undefined}:${state?.dataUpdatedAt}:${state?.errorUpdatedAt}`;
      })
      .join("|");
  useSyncExternalStore(subscribe, snapshot, snapshot);
  return keys.map((key) => followedQuery(queryClient.getQueryState(key)));
}

export interface Behind {
  /** When the data now on screen arrived (the oldest of the queries behind). */
  since: number;
  /** The server's sentence when it refused for good (gone, or no longer the viewer's): asking again cannot help. */
  refused: string | null;
}

/**
 * Whether the data on screen is behind: a loaded query's last refresh failed, or one that polls has had
 * no answer for BEHIND_AFTER_INTERVALS of its own intervals. A query that is not polled (a finished
 * tournament's registrations) is never "late": only a failed refresh of it counts (P3REV0-PARITY-02).
 * Lateness counts from `countFrom` at the earliest: when the page was last shown, as polls wait while
 * it is hidden (P3REV-PERF-LIVESTATUS-HIDDEN).
 */
export function behind(follows: readonly FollowedState[], now: number, countFrom = 0): Behind | null {
  const late = follows
    .filter(({ query }) => query.data !== undefined)
    .filter(
      ({ query, interval }) =>
        query.isRefetchError || (interval !== false && now - Math.max(query.dataUpdatedAt, countFrom) > BEHIND_AFTER_INTERVALS * interval),
    )
    .map(({ query }) => query);
  if (late.length === 0) return null;
  const refusal = late.find((query) => query.isRefetchError && isLastingRefusal(query.error));
  return { since: Math.min(...late.map((query) => query.dataUpdatedAt)), refused: refusal ? errorMessage(refusal.error) : null };
}

/** The server's words with a full stop, whether or not they end with one ("Tournament not found"). */
const asSentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);

interface LiveStatusProps {
  /** The queries the page follows (e.g. a tournament and its registrations), by key, each with its own interval. */
  follows: readonly Followed[];
  timeZone?: string;
  className?: string;
}

/**
 * Says so when a page that follows a live tournament has stopped keeping up: its last refresh failed,
 * or no answer has come for a while (a request stalled on the venue's Wi-Fi). The page keeps its data
 * on screen meanwhile, so the TD and players can tell the pool and counts may be out of date
 * (P3REV4-PERF-03). Nothing shows while the data is current.
 */
export function LiveStatus({ follows, timeZone, className }: LiveStatusProps) {
  const queries = useFollowedQueries(follows.map(({ queryKey }) => queryKey));
  const now = useNow(CHECK_EVERY_MS);
  const shownSince = useShownSince();
  const status = isHidden() ? null : behind(follows.map(({ interval }, index) => ({ query: queries[index], interval })), now, shownSince);
  return (
    <div role="status" aria-live="polite" className={cn(status === null && "sr-only", className)}>
      {status === null ? null : (
        <p className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            {status.refused === null
              ? `Not updated since ${formatTime(status.since, timeZone)}. Reconnecting… The figures on screen may be out of date.`
              : `Not updated since ${formatTime(status.since, timeZone)}. ${asSentence(status.refused)} This page has stopped updating.`}
          </span>
        </p>
      )}
    </div>
  );
}
