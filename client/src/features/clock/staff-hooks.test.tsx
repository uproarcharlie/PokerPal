import { useEffect, type MutableRefObject } from "react";
import { act, screen, waitFor } from "@testing-library/react";
import { HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { liveDisplayDto, pausedClock, recordClockActions, resetServerTime, serveDisplay } from "@test/helpers/clock-dto";
import { apiError, mockSignedOut, renderWithApp } from "@test/helpers/web";
import { ApiError } from "@/lib/api/http";
import { useLiveClock } from "./hooks";
import { clockRequest, conflictDisplay, useClockActions } from "./staff-hooks";

describe("clockRequest", () => {
  const shown = { levelIndex: 4, status: "running" as const };

  it("sends the level on screen with every move, so a double tap never skips a level", () => {
    expect(clockRequest({ action: "next" }, shown)).toEqual({ action: "next", expectedLevelIndex: 4 });
    expect(clockRequest({ action: "prev" }, shown)).toEqual({ action: "prev", expectedLevelIndex: 4 });
    expect(clockRequest({ action: "jump", levelIndex: 7 }, shown)).toEqual({ action: "jump", levelIndex: 7, expectedLevelIndex: 4 });
    expect(clockRequest({ action: "adjust", deltaSeconds: -60 }, shown)).toEqual({ action: "adjust", deltaSeconds: -60, expectedLevelIndex: 4 });
    expect(clockRequest({ action: "set_remaining", remainingSeconds: 600 }, shown)).toEqual({ action: "set_remaining", remainingSeconds: 600, expectedLevelIndex: 4 });
  });

  it("sends the status on screen with a toggle, so a second tap never undoes the first", () => {
    expect(clockRequest({ action: "toggle", alsoStartTournament: true }, shown)).toEqual({ action: "toggle", alsoStartTournament: true, expectedStatus: "running" });
    expect(clockRequest({ action: "toggle" }, { levelIndex: 0, status: "finished" })).toEqual({ action: "toggle" });
  });

  it("sends the idempotent actions as they are", () => {
    for (const action of ["start", "pause", "resume", "reset", "undo"] as const) expect(clockRequest({ action }, shown)).toEqual({ action });
  });
});

describe("conflictDisplay", () => {
  it("is the display a clock refusal carries", () => {
    const display = liveDisplayDto();
    expect(conflictDisplay(new ApiError({ status: 409, error: "Moved on", code: "LEVEL_CHANGED", details: { display } }))).toBe(display);
  });

  it("is null for any other failure", () => {
    expect(conflictDisplay(new ApiError({ status: 409, error: "Closed", code: "TOURNAMENT_CLOSED" }))).toBeNull();
    expect(conflictDisplay(new ApiError({ status: 409, error: "Odd", details: { display: "nope" } }))).toBeNull();
    expect(conflictDisplay(new ApiError({ status: 404, error: "No clock", code: "NO_CLOCK", details: { display: liveDisplayDto() } }))).toBeNull();
    expect(conflictDisplay(new Error("offline"))).toBeNull();
  });
});

type ClockActions = ReturnType<typeof useClockActions>;

/** The clock as a screen shows it, with its actions handed to the test. */
function Harness({ actionsRef }: { actionsRef: MutableRefObject<ClockActions | null> }) {
  const clock = useClockActions("t1");
  const { derived } = useLiveClock("t1", { refetchMs: 60_000 });
  useEffect(() => {
    actionsRef.current = clock;
  });
  return derived ? <p>Level index {derived.levelIndex}</p> : null;
}

describe("useClockActions", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    resetServerTime();
    mockSignedOut();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const atLevel = (levelIndex: number) => liveDisplayDto({ clock: pausedClock({ levelIndex }) });

  async function twoTaps(answers: Array<() => Response | ReturnType<typeof liveDisplayDto>>) {
    serveDisplay({ clock: pausedClock({ levelIndex: 1 }) });
    let call = 0;
    const sent = recordClockActions(() => answers[call++]());
    const actionsRef: MutableRefObject<ClockActions | null> = { current: null };
    renderWithApp(<Harness actionsRef={actionsRef} />);
    await screen.findByText("Level index 1");
    const shown = { levelIndex: 1, status: "paused" as const };
    let results: boolean[] = [];
    await act(async () => {
      const actions = actionsRef.current;
      results = await Promise.all([actions?.send({ action: "next" }, shown), actions?.send({ action: "next" }, shown)].map(async (sent) => (await sent) ?? false));
    });
    return { sent, results };
  }

  it("says nothing when a double tap's second Next finds the first one's level on screen", async () => {
    const { sent, results } = await twoTaps([() => atLevel(2), () => apiError(409, "LEVEL_CHANGED", "The clock has moved on", { display: atLevel(2) })]);
    expect(sent).toEqual([
      { action: "next", expectedLevelIndex: 1 },
      { action: "next", expectedLevelIndex: 1 },
    ]);
    expect(results).toEqual([true, false]);
    expect(await screen.findByText("Level index 2")).toBeInTheDocument();
    expect(screen.queryByText("The clock moved on — check the level")).not.toBeInTheDocument();
  });

  it("says so when another device had moved the clock somewhere else", async () => {
    const movedOn = () => apiError(409, "LEVEL_CHANGED", "The clock has moved on", { display: atLevel(3) });
    await twoTaps([movedOn, movedOn]);
    expect(await screen.findByText("The clock moved on — check the level")).toBeInTheDocument();
    expect(screen.getByText("Level index 3")).toBeInTheDocument();
  });

  it("says the clock moved on when a minute was added to a level that had just ended, though the screen already shows the next", async () => {
    serveDisplay({ clock: pausedClock({ levelIndex: 2 }) });
    const sent = recordClockActions(() => apiError(409, "LEVEL_CHANGED", "The clock has moved on", { display: atLevel(2) }));
    const actionsRef: MutableRefObject<ClockActions | null> = { current: null };
    renderWithApp(<Harness actionsRef={actionsRef} />);
    await screen.findByText("Level index 2");
    // Pressed on Level 2's last second; the screen moved on by itself before the answer came. Not a double tap: nothing was added.
    await act(async () => {
      await actionsRef.current?.send({ action: "adjust", deltaSeconds: 60 }, { levelIndex: 1, status: "running" });
    });
    expect(sent).toEqual([{ action: "adjust", deltaSeconds: 60, expectedLevelIndex: 1 }]);
    expect(await screen.findByText("The clock moved on — check the level")).toBeInTheDocument();
  });

  it("says no answer came, not that the clock did not change, when the answer is lost, and asks for the clock again (TDN3-TIMEOUT-TOAST)", async () => {
    const reads = serveDisplay({ clock: pausedClock({ levelIndex: 1 }) });
    const sent = recordClockActions(() => HttpResponse.error());
    const actionsRef: MutableRefObject<ClockActions | null> = { current: null };
    renderWithApp(<Harness actionsRef={actionsRef} />);
    await screen.findByText("Level index 1");
    const before = reads.calls();
    let result: boolean | undefined;
    await act(async () => {
      result = await actionsRef.current?.send({ action: "adjust", deltaSeconds: 60 }, { levelIndex: 1, status: "paused" });
    });
    expect(sent).toHaveLength(1);
    expect(result).toBe(false);
    expect(await screen.findByText("No answer from the server")).toBeInTheDocument();
    expect(screen.getByText("The change may have been made: check the clock before trying again.")).toBeInTheDocument();
    expect(screen.queryByText("The clock did not change")).not.toBeInTheDocument();
    await waitFor(() => expect(reads.calls()).toBeGreaterThan(before));
  });

  it("leaves the wording of a refusal to the caller with perform, which rejects with it", async () => {
    serveDisplay({ clock: pausedClock({ levelIndex: 1 }) });
    recordClockActions(() => apiError(409, "NOTHING_TO_UNDO", "There is no clock change to undo", { display: atLevel(1) }));
    const actionsRef: MutableRefObject<ClockActions | null> = { current: null };
    renderWithApp(<Harness actionsRef={actionsRef} />);
    await screen.findByText("Level index 1");
    let refusal: unknown = null;
    await act(async () => {
      await actionsRef.current?.perform({ action: "undo" }, { levelIndex: 1, status: "paused" }).catch((error: unknown) => {
        refusal = error;
      });
    });
    expect(refusal).toBeInstanceOf(ApiError);
    expect(screen.queryByText("The clock did not change")).not.toBeInTheDocument();
  });
});
