import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery, type QueryKey } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/http";
import { CLOSED_REFRESH_MS, liveRegistrationsInterval, liveTournamentInterval } from "@/lib/live-refresh";
import { BEHIND_AFTER_INTERVALS, behind, LiveStatus, type FollowedQuery } from "./live-status";

const NOW = Date.parse("2026-10-23T07:30:00.000Z");
const KEY: QueryKey = ["tournaments", "detail", "t1"];

/** A client whose followed query loaded at NOW and whose next refresh failed with `error`. */
function failedRefresh(error: unknown): QueryClient {
  const client = new QueryClient();
  client.getQueryCache().build(client, { queryKey: KEY }).setState({
    data: [],
    dataUpdatedAt: NOW,
    status: "error",
    error: error as Error,
    errorUpdatedAt: NOW,
  });
  return client;
}

function renderFollowing(client: QueryClient, ui: ReactNode) {
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}
const answered = (msAgo: number, isRefetchError = false, error: unknown = null): FollowedQuery => ({
  data: [],
  dataUpdatedAt: NOW - msAgo,
  isRefetchError,
  error,
});

describe("LiveStatus (P3REV4-PERF-03)", () => {
  it("is quiet while every followed query is up to date, or before anything has loaded", () => {
    expect(behind([{ query: answered(1000), interval: 5000 }, { query: answered(4000), interval: 5000 }], NOW)).toBeNull();
    expect(behind([{ query: { data: undefined, dataUpdatedAt: 0, isRefetchError: false, error: null }, interval: 5000 }], NOW)).toBeNull();
  });

  it("says since when the data is behind: a refresh failed, or no answer for a few polls", () => {
    expect(behind([{ query: answered(1000), interval: 5000 }, { query: answered(2000, true), interval: 5000 }], NOW)).toEqual({
      since: NOW - 2000,
      refused: null,
    });
    expect(behind([{ query: answered(BEHIND_AFTER_INTERVALS * 5000 + 1), interval: 5000 }], NOW)?.since).toBe(
      NOW - BEHIND_AFTER_INTERVALS * 5000 - 1,
    );
    // A query that is not polled is never late: only a failed refresh of it counts.
    expect(behind([{ query: answered(10 * 60_000), interval: false }], NOW)).toBeNull();
    expect(behind([{ query: answered(10 * 60_000, true), interval: false }], NOW)?.since).toBe(NOW - 10 * 60_000);
  });

  it("stays quiet after a finalize, when the tournament is still followed slowly and its registrations are not (P3REV0-PARITY-02)", () => {
    const finalizedAt = NOW - 4 * 60_000;
    const tournament = { status: "completed" as const, finalizedAt: new Date(finalizedAt).toISOString() };
    expect(liveTournamentInterval(tournament, NOW)).toBe(CLOSED_REFRESH_MS);
    expect(liveRegistrationsInterval(tournament)).toBe(false);

    // At `now`: the tournament polled 10 s ago; its registrations last asked for when the finalize came in.
    const followsAt = (now: number) => [
      { query: { ...answered(0), dataUpdatedAt: now - 10_000 }, interval: liveTournamentInterval(tournament, now) },
      { query: { ...answered(0), dataUpdatedAt: finalizedAt + 5000 }, interval: liveRegistrationsInterval(tournament) },
    ];
    expect(behind(followsAt(NOW), NOW)).toBeNull();
    expect(behind(followsAt(NOW + 60 * 60_000), NOW + 60 * 60_000)).toBeNull();
  });

  it("tells the people reading the figures that they may be out of date, and when they were last current", () => {
    renderFollowing(failedRefresh(new ApiError({ status: 503, error: "Busy" })), <LiveStatus follows={[{ queryKey: KEY, interval: 5000 }]} timeZone="Pacific/Auckland" />);

    expect(screen.getByRole("status")).toHaveTextContent("Not updated since 8:30 pm. Reconnecting… The figures on screen may be out of date.");
  });

  it("says what the server said, not 'Reconnecting', when it refused for good (P3REV4-PERF-D)", () => {
    const gone = new ApiError({ status: 404, error: "Tournament not found" });
    renderFollowing(failedRefresh(gone), <LiveStatus follows={[{ queryKey: KEY, interval: 5000 }]} timeZone="Pacific/Auckland" />);

    expect(screen.getByRole("status")).toHaveTextContent("Not updated since 8:30 pm. Tournament not found. This page has stopped updating.");
    expect(screen.getByRole("status")).not.toHaveTextContent("Reconnecting");
  });
});

describe("LiveStatus while the page is hidden (P3REV-PERF-LIVESTATUS-HIDDEN)", () => {
  const visibility = (state: DocumentVisibilityState) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
    document.dispatchEvent(new Event("visibilitychange"));
  };
  afterEach(() => {
    Reflect.deleteProperty(document, "visibilityState");
    vi.useRealTimers();
  });

  it("does not count the time nobody could see the page, when its polls wait", () => {
    vi.useFakeTimers({ now: NOW });
    const client = new QueryClient();
    client.setQueryData(KEY, []);
    renderFollowing(client, <LiveStatus follows={[{ queryKey: KEY, interval: 5000 }]} timeZone="Pacific/Auckland" />);

    // Locked for two minutes: polls stop, and the data ages, unseen.
    act(() => visibility("hidden"));
    act(() => vi.advanceTimersByTime(2 * 60_000));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();

    // Unlocked: no alarm while the refocus refetch is on its way...
    act(() => visibility("visible"));
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();

    // ...but a stall after that is still said, a few polls on.
    act(() => vi.advanceTimersByTime(BEHIND_AFTER_INTERVALS * 5000 + 5000));
    expect(screen.getByRole("status")).toHaveTextContent("Not updated since 8:30 pm");
  });
});

describe("LiveStatus and the page that owns the queries (P3REV-PERF-POLL-RERENDER)", () => {
  it("re-draws itself when a poll answers, not the page, when the answer changed nothing", async () => {
    let pageDrawn = 0;
    let asked = 0;
    function Page() {
      pageDrawn += 1;
      const tournament = useQuery({
        queryKey: KEY,
        queryFn: () => {
          asked += 1;
          return Promise.resolve({ name: "Friday Freezeout" });
        },
        refetchInterval: 20,
      });
      return (
        <>
          <p>{tournament.data?.name}</p>
          <LiveStatus follows={[{ queryKey: KEY, interval: 20 }]} />
        </>
      );
    }
    renderFollowing(new QueryClient(), <Page />);
    expect(await screen.findByText("Friday Freezeout")).toBeInTheDocument();
    const drawnOnceLoaded = pageDrawn;

    await waitFor(() => expect(asked).toBeGreaterThan(5));

    expect(pageDrawn).toBe(drawnOnceLoaded);
  });
});
