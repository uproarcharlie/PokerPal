import { useState } from "react";
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@test/msw/server";
import { apiError, mockSignedOut, renderWithApp } from "@test/helpers/web";
import type { ActivityDto } from "@shared/api/public";
import { LIVE_REFRESH_MS, RATE_LIMITED_REFRESH_MS } from "@/lib/live-refresh";
import { ACTIVITY_FEED_LIMIT } from "../hooks";
import { ActivityFeed, RELATIVE_TIME_TICK_MS } from "./activity-feed";

const entry = (id: string, eventType: string, description: string, overrides: Partial<ActivityDto> = {}): ActivityDto => ({
  id,
  tournamentId: "t1",
  playerId: null,
  eventType,
  eventData: null,
  description,
  timestamp: "2026-10-23T08:00:00.000Z",
  player: null,
  ...overrides,
});

beforeEach(() => {
  mockSignedOut();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ActivityFeed (P2REV4-CQ-07)", () => {
  it("labels every event the server writes, and an old unknown one plainly", async () => {
    server.use(
      http.get("/api/tournaments/t1/activity", () =>
        HttpResponse.json([
          entry("1", "prize_pool_adjusted", "Prize pool set manually to $300"),
          entry("2", "rake_rates_changed", "AP rates changed"),
          entry("3", "tournament_refinalized", "Tournament finalized again"),
          entry("4", "reentry", "Ann is back in with a re-buy"),
          entry("5", "registration_removed", "Bob's entry was removed"),
          entry("6", "something_from_2024", "An old entry"),
        ]),
      ),
    );
    renderWithApp(<ActivityFeed tournamentId="t1" live />);

    for (const label of ["Prize Pool", "Rates", "Results Corrected", "Re-entry", "Entry Removed", "Event"]) {
      expect(await screen.findByText(label)).toBeInTheDocument();
    }
  });

  it("names the player and when it happened", async () => {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60_000).toISOString();
    server.use(
      http.get("/api/tournaments/t1/activity", () =>
        HttpResponse.json([entry("1", "elimination", "Ann was eliminated", { timestamp: twoMinutesAgo, player: { id: "p1", name: "Ann", imageUrl: null } })]),
      ),
    );
    renderWithApp(<ActivityFeed tournamentId="t1" live />);

    expect(await screen.findByText("Player: Ann")).toBeInTheDocument();
    expect(screen.getByText("2 minutes ago")).toHaveAttribute("dateTime", twoMinutesAgo);
  });

  it("moves its 'minutes ago' on with the clock, though no poll brings anything new (P3REV-PERF-POLL-RERENDER)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const twoMinutesAgo = new Date(Date.now() - 2 * 60_000).toISOString();
    server.use(http.get("/api/tournaments/t1/activity", () => HttpResponse.json([entry("1", "elimination", "Ann was eliminated", { timestamp: twoMinutesAgo })])));
    renderWithApp(<ActivityFeed tournamentId="t1" live={false} />);
    expect(await screen.findByText("2 minutes ago")).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(4 * RELATIVE_TIME_TICK_MS));

    expect(screen.getByText("4 minutes ago")).toBeInTheDocument();
  });

  it("says when nothing has happened yet", async () => {
    server.use(http.get("/api/tournaments/t1/activity", () => HttpResponse.json([])));
    renderWithApp(<ActivityFeed tournamentId="t1" live />);

    expect(await screen.findByText("No activity yet")).toBeInTheDocument();
  });

  it("says the feed could not be loaded rather than that nothing happened, and tries again", async () => {
    let fail = true;
    server.use(
      http.get("/api/tournaments/t1/activity", () =>
        fail ? apiError(500, "INTERNAL", "Something went wrong on our side. Please try again.") : HttpResponse.json([entry("1", "registration", "Ann registered")]),
      ),
    );
    renderWithApp(<ActivityFeed tournamentId="t1" live />);

    expect(await screen.findByRole("alert")).toHaveTextContent("The activity could not be loaded");
    expect(screen.queryByText("No activity yet")).not.toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Ann registered")).toBeInTheDocument();
  });

  it("follows an open tournament, and reads a finished one's feed once (P3REV2-CQ-13)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let asked = 0;
    server.use(
      http.get("/api/tournaments/t1/activity", () => {
        asked += 1;
        return HttpResponse.json([entry("1", "registration", "Ann registered")]);
      }),
    );
    function Page() {
      const [live, setLive] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setLive(false)}>
            Finish
          </button>
          <ActivityFeed tournamentId="t1" live={live} />
        </>
      );
    }
    renderWithApp(<Page />);
    expect(await screen.findByText("Ann registered")).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS + 100);
    expect(asked).toBe(2);

    await userEvent.click(screen.getByRole("button", { name: "Finish" }));
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS * 4);
    expect(asked).toBe(2);
  });

  it("slows its polling while the server refuses too many requests from the venue, then keeps up again (P3REV-PERF-LIVE-BUDGET-429)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let asked = 0;
    let limited = false;
    server.use(
      http.get("/api/tournaments/t1/activity", () => {
        asked += 1;
        return limited ? apiError(429, "RATE_LIMITED", "Too many requests, please try again later.") : HttpResponse.json([entry("1", "registration", "Ann registered")]);
      }),
    );
    renderWithApp(<ActivityFeed tournamentId="t1" live />);
    expect(await screen.findByText("Ann registered")).toBeInTheDocument();

    limited = true;
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS + 100);
    expect(asked).toBe(2);
    // Refused: not asked again every few seconds, which would only spend the venue's next window faster.
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS * 6);
    expect(asked).toBe(2);
    expect(screen.getByText("Ann registered")).toBeInTheDocument();

    // A minute after the refusal it asks again; answered, it keeps up every few seconds once more.
    limited = false;
    await vi.advanceTimersByTimeAsync(RATE_LIMITED_REFRESH_MS - LIVE_REFRESH_MS * 6);
    expect(asked).toBe(3);
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS + 100);
    expect(asked).toBe(4);
  });
});

describe("ActivityFeed: a long night (P3REV-PERF-ACTIVITY-FULL-LIST-POLL)", () => {
  const events = (count: number, from = 0) =>
    Array.from({ length: count }, (_, index) => entry(`e${from + index}`, "registration", `Player ${from + index} registered`));

  it("follows only the newest events, and fetches the rest of the night once, when asked", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const asked: string[] = [];
    const newest = events(ACTIVITY_FEED_LIMIT);
    const all = [...newest, ...events(30, ACTIVITY_FEED_LIMIT)];
    server.use(
      http.get("/api/tournaments/t1/activity", ({ request }) => {
        const limit = new URL(request.url).searchParams.get("limit");
        asked.push(limit ?? "all");
        return HttpResponse.json(limit === null ? all : all.slice(0, Number(limit)));
      }),
    );
    renderWithApp(<ActivityFeed tournamentId="t1" live />);

    expect(await screen.findByText("Player 0 registered")).toBeInTheDocument();
    expect(asked).toEqual([String(ACTIVITY_FEED_LIMIT)]);
    expect(screen.getAllByTestId("activity-entry")).toHaveLength(ACTIVITY_FEED_LIMIT);

    await userEvent.click(screen.getByRole("button", { name: "Show earlier activity" }));
    expect(await screen.findByText(`Player ${ACTIVITY_FEED_LIMIT + 29} registered`)).toBeInTheDocument();
    expect(screen.getAllByTestId("activity-entry")).toHaveLength(ACTIVITY_FEED_LIMIT + 30);
    expect(screen.queryByRole("button", { name: "Show earlier activity" })).not.toBeInTheDocument();
    // The button went with the load: focus is on the line that says everything is shown.
    expect(screen.getByText(`Showing all ${ACTIVITY_FEED_LIMIT + 30} events.`)).toHaveFocus();

    // The newest are still followed; the whole feed is not asked for again.
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS * 2 + 100);
    expect(asked.filter((limit) => limit === "all")).toHaveLength(1);
    expect(asked.filter((limit) => limit === String(ACTIVITY_FEED_LIMIT)).length).toBeGreaterThanOrEqual(3);
  });

  it("offers nothing more when the newest events are all there is", async () => {
    server.use(http.get("/api/tournaments/t1/activity", () => HttpResponse.json(events(3))));
    renderWithApp(<ActivityFeed tournamentId="t1" live />);

    expect(await screen.findByText("Player 2 registered")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show earlier activity" })).not.toBeInTheDocument();
  });

  it("says the earlier events could not be loaded, keeps the newest, and tries again", async () => {
    let fail = true;
    server.use(
      http.get("/api/tournaments/t1/activity", ({ request }) => {
        if (new URL(request.url).searchParams.has("limit")) return HttpResponse.json(events(ACTIVITY_FEED_LIMIT));
        return fail ? apiError(500, "INTERNAL", "Something went wrong on our side. Please try again.") : HttpResponse.json(events(ACTIVITY_FEED_LIMIT + 5));
      }),
    );
    renderWithApp(<ActivityFeed tournamentId="t1" live={false} />);
    await userEvent.click(await screen.findByRole("button", { name: "Show earlier activity" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The earlier activity could not be loaded.");
    expect(screen.getAllByTestId("activity-entry")).toHaveLength(ACTIVITY_FEED_LIMIT);
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText(`Player ${ACTIVITY_FEED_LIMIT + 4} registered`)).toBeInTheDocument();
  });
});
