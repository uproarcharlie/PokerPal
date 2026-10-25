import { act, screen } from "@testing-library/react";
import { HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clockDto, liveDisplayDto, mockDisplay, pausedClock, resetServerTime, runningClock, serveDisplay } from "@test/helpers/clock-dto";
import { apiError, mockSignedOut, renderWithApp } from "@test/helpers/web";
import { formatClock } from "@shared/domain/clock";
import { CLOSED_FOLLOW_MS, CLOSED_REFRESH_MS } from "@/lib/live-refresh";
import { DISPLAY_REFRESH_MS, tvRefreshMs } from "./api";
import { CLOCK_TICK_MS, liveDisplayInterval, OFFLINE_AFTER_MS, offlineAfterMs, useLiveClock } from "./hooks";

/** Moves the time on tick by tick, letting React draw after each one as it would in the browser. */
async function tickFor(ms: number) {
  for (let elapsed = 0; elapsed < ms; elapsed += CLOCK_TICK_MS) await act(() => vi.advanceTimersByTimeAsync(CLOCK_TICK_MS));
}

/** Shows what a screen shows of the live clock, and counts how often it is drawn. */
function Probe({ refetchMs = 60_000, onRender }: { refetchMs?: number; onRender?: () => void }) {
  const { derived, offline } = useLiveClock("t1", { refetchMs });
  onRender?.();
  if (!derived) return <p>no clock</p>;
  return (
    <div>
      <p data-testid="level">{derived.levelIndex}</p>
      <p data-testid="time">{formatClock(derived.remainingMs)}</p>
      <p data-testid="status">{derived.status}</p>
      {offline ? <p>offline</p> : null}
    </div>
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  resetServerTime();
  mockSignedOut();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useLiveClock", () => {
  it("counts down between polls, from the anchors the server sent", async () => {
    serveDisplay({ clock: runningClock(Date.now(), { remainingMs: 12 * 60_000 }) });
    renderWithApp(<Probe />);
    expect(await screen.findByTestId("time")).toHaveTextContent("12:00");

    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(screen.getByTestId("time")).toHaveTextContent("11:59");
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(screen.getByTestId("time")).toHaveTextContent("10:59");
  });

  it("moves on to the next level by itself when the time runs out", async () => {
    serveDisplay({ clock: runningClock(Date.now(), { remainingMs: 2000 }) });
    renderWithApp(<Probe />);
    expect(await screen.findByTestId("level")).toHaveTextContent("0");

    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(screen.getByTestId("level")).toHaveTextContent("1");
    expect(screen.getByTestId("time")).toHaveTextContent("19:59");
  });

  it("ticks on the server's time, not this device's own clock", async () => {
    // The server is 10 minutes ahead of this device; its level has 2 minutes left.
    const serverNow = Date.now() + 10 * 60_000;
    mockDisplay(() => liveDisplayDto({ serverNow: Date.now() + 10 * 60_000, clock: runningClock(serverNow, { remainingMs: 2 * 60_000 }) }));
    renderWithApp(<Probe />);
    expect(await screen.findByTestId("time")).toHaveTextContent(/^(2:00|1:59)$/);
  });

  it("draws the screen once per second shown, not on every tick", async () => {
    serveDisplay({ clock: runningClock(Date.now(), { remainingMs: 5 * 60_000 }) });
    const onRender = vi.fn();
    renderWithApp(<Probe onRender={onRender} />);
    await screen.findByTestId("time");
    onRender.mockClear();

    await tickFor(3000);
    // Twelve ticks, three seconds shown.
    expect(onRender.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(onRender.mock.calls.length).toBeLessThanOrEqual(4);
    expect(screen.getByTestId("time")).toHaveTextContent("4:57");
  });

  it("does not redraw a paused clock at all while nothing changes", async () => {
    serveDisplay({ clock: pausedClock({ remainingMs: 61_000 }) });
    const onRender = vi.fn();
    renderWithApp(<Probe onRender={onRender} />);
    expect(await screen.findByTestId("time")).toHaveTextContent("1:01");
    onRender.mockClear();

    await tickFor(5000);
    expect(onRender).not.toHaveBeenCalled();
    expect(screen.getByTestId("status")).toHaveTextContent("paused");
  });

  it("says it is offline after 30 s without a good answer, and keeps ticking", async () => {
    let failing = false;
    const now = Date.now();
    mockDisplay(() => (failing ? apiError(503, "INTERNAL", "Down") : liveDisplayDto({ serverNow: Date.now(), clock: runningClock(now, { remainingMs: 10 * 60_000 }) })));
    renderWithApp(<Probe refetchMs={3000} />);
    expect(await screen.findByTestId("time")).toHaveTextContent("10:00");
    failing = true;

    await act(() => vi.advanceTimersByTimeAsync(OFFLINE_AFTER_MS - 5000));
    expect(screen.queryByText("offline")).not.toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(6000));
    expect(screen.getByText("offline")).toBeInTheDocument();
    expect(screen.getByTestId("time")).toHaveTextContent("9:29");
  });

  it("stops asking once the tournament is gone", async () => {
    const display = mockDisplay(() => HttpResponse.json({ error: "Tournament not found", code: "NOT_FOUND" }, { status: 404 }));
    renderWithApp(<Probe refetchMs={3000} />);
    await vi.waitFor(() => expect(display.calls()).toBe(1));
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(display.calls()).toBe(1);
  });
});

describe("liveDisplayInterval (P4REV4-CQ-01)", () => {
  const now = Date.parse("2026-10-23T12:00:00.000Z");
  const completed = (finishedMsAgo: number) =>
    liveDisplayDto({ tournament: { status: "completed" }, clock: clockDto({ status: "finished", updatedAt: new Date(now - finishedMsAgo).toISOString() }) });

  it("asks at the screen's pace while the tournament is open, and before a first answer", () => {
    expect(liveDisplayInterval(undefined, 3000, now)).toBe(3000);
    expect(liveDisplayInterval(liveDisplayDto({ tournament: { status: "registration" } }), 3000, now)).toBe(3000);
    expect(liveDisplayInterval(liveDisplayDto({ clock: null }), 15_000, now)).toBe(15_000);
  });

  it("asks once a minute for a few hours after the results were written, then never", () => {
    expect(liveDisplayInterval(completed(60_000), 3000, now)).toBe(CLOSED_REFRESH_MS);
    expect(liveDisplayInterval(completed(CLOSED_FOLLOW_MS), 3000, now)).toBe(false);
    expect(liveDisplayInterval(liveDisplayDto({ tournament: { status: "completed" }, clock: null }), 3000, now)).toBe(false);
  });

  it("never asks again about a cancelled tournament", () => {
    expect(liveDisplayInterval(liveDisplayDto({ tournament: { status: "cancelled" } }), 3000, now)).toBe(false);
  });

  it("stops the poll of a screen left on a cancelled tournament", async () => {
    const display = serveDisplay({ tournament: { status: "cancelled" } });
    renderWithApp(<Probe refetchMs={3000} />);
    await vi.waitFor(() => expect(display.calls()).toBe(1));
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(display.calls()).toBe(1);
  });
});

describe("offlineAfterMs (P4REV1-CC-02)", () => {
  it("allows two missed polls, never less than OFFLINE_AFTER_MS, and nothing when no poll is due", () => {
    expect(offlineAfterMs(DISPLAY_REFRESH_MS.tv)).toBe(OFFLINE_AFTER_MS);
    expect(offlineAfterMs(DISPLAY_REFRESH_MS.phone)).toBe(2 * DISPLAY_REFRESH_MS.phone);
    expect(offlineAfterMs(CLOSED_REFRESH_MS)).toBe(2 * CLOSED_REFRESH_MS);
    expect(offlineAfterMs(false)).toBeNull();
  });
});

describe("tvRefreshMs (TDN2-TABLET-AS-PHONE)", () => {
  it("asks at the venue's rate except on a player's handheld screen", () => {
    expect(tvRefreshMs({ handheld: false, venueScreen: false, canControl: false })).toBe(DISPLAY_REFRESH_MS.tv);
    expect(tvRefreshMs({ handheld: true, venueScreen: false, canControl: false })).toBe(DISPLAY_REFRESH_MS.phone);
    expect(tvRefreshMs({ handheld: true, venueScreen: true, canControl: false })).toBe(DISPLAY_REFRESH_MS.tv);
    expect(tvRefreshMs({ handheld: true, venueScreen: false, canControl: true })).toBe(DISPLAY_REFRESH_MS.tv);
  });
});
