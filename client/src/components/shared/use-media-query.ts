import { useCallback, useSyncExternalStore } from "react";

/**
 * Whether `query` matches now, following changes (e.g. a phone turned sideways). False where matchMedia
 * is missing. One listener per query for as long as it is shown: the subscription is kept across
 * re-renders, not dropped and made again on each (P3REV-PERF-POLL-RERENDER).
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window.matchMedia !== "function") return () => {};
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => typeof window.matchMedia === "function" && window.matchMedia(query).matches,
    () => false,
  );
}

/** Below Tailwind's `md` breakpoint: cards instead of tables. */
export const PHONE_QUERY = "(max-width: 767px)";
