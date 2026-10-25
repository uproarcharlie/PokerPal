import { useEffect, useState } from "react";
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpResponse } from "msw";
import { clockDto, liveDisplayDto, recordClockActions, resetServerTime, runningClock, undoDto } from "@test/helpers/clock-dto";
import { recordRequests } from "@test/helpers/requests";
import type { ClockDisplaySettings, ClockUndoDto } from "@shared/api/clock";
import { mockSignedOut, renderWithApp } from "@test/helpers/web";
import { deriveClock, type DerivedClock } from "@shared/domain/clock";
import { clockStateOf } from "../hooks";
import { DisplayControls, LEVEL_KEY_DEBOUNCE_MS, SHORTCUTS } from "./display-controls";
import type { ScreenTools } from "./public/clock-screen";

function tools(): ScreenTools {
  return {
    sound: { supported: true, on: true, needsTap: false, unlock: vi.fn(), toggle: vi.fn(), play: vi.fn() },
    fullscreen: { supported: true, active: false, toggle: vi.fn() },
    awake: true,
  };
}

function derivedAt(levelIndex: number, status: "running" | "idle" = "running"): DerivedClock {
  const clock = runningClock(Date.now(), { levelIndex });
  const derived = deriveClock(clockStateOf(status === "idle" ? { ...clock, status: "idle", periodEndsAt: null } : clock), clock.structure.levels, Date.now());
  if (!derived) throw new Error("no levels");
  return derived;
}

type Layer = ClockDisplaySettings["overlay"];

function showControls(derived = derivedAt(1), screenTools = tools(), undo: ClockUndoDto | null = null, overlay: Layer = "none") {
  const sent = recordClockActions(() => liveDisplayDto({ clock: runningClock(Date.now(), { levelIndex: derived.levelIndex }), viewer: { canControl: true } }));
  const layers = recordRequests(
    [["patch", "/api/tournaments/t1/clock/display"]],
    (request) => HttpResponse.json(liveDisplayDto({ clock: clockDto({ displaySettings: { ...clockDto().displaySettings, ...(request.body as object) } }) })),
    (request) => request.body,
  );
  const setLayer: { current: ((shown: Layer) => void) | null } = { current: null };
  function Screen() {
    // The layer the TV's next poll would bring, set by the test.
    const [shown, setShown] = useState(overlay);
    useEffect(() => {
      setLayer.current = setShown;
    }, []);
    return <DisplayControls tournamentId="t1" derived={derived} undo={undo} overlay={shown} tools={screenTools} />;
  }
  const view = renderWithApp(
    <>
      <label>
        Notes <input />
      </label>
      <Screen />
    </>,
  );
  return { ...view, sent, layers, tools: screenTools, showLayer: (shown: Layer) => act(() => setLayer.current?.(shown)) };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  resetServerTime();
  mockSignedOut();
});

afterEach(() => {
  vi.useRealTimers();
});

const user = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

describe("the TV's staff controls", () => {
  it("run the clock from the keyboard, sending the level, the status and the undo on screen", async () => {
    const undo = undoDto();
    const { sent } = showControls(derivedAt(1), tools(), undo);
    const keys = user();
    for (const key of [" ", "{ArrowRight}", "{ArrowUp}", "+", "{ArrowDown}", "−", "{Shift>}{ArrowUp}{/Shift}", "{Shift>}{ArrowDown}{/Shift}", "u"]) {
      await keys.keyboard(key);
    }
    await vi.waitFor(() => expect(sent).toHaveLength(9));
    expect(sent).toEqual([
      { action: "toggle", alsoStartTournament: false, expectedStatus: "running" },
      { action: "next", expectedLevelIndex: 1 },
      { action: "adjust", deltaSeconds: 60, expectedLevelIndex: 1 },
      { action: "adjust", deltaSeconds: 60, expectedLevelIndex: 1 },
      { action: "adjust", deltaSeconds: -60, expectedLevelIndex: 1 },
      { action: "adjust", deltaSeconds: -60, expectedLevelIndex: 1 },
      { action: "adjust", deltaSeconds: 300, expectedLevelIndex: 1 },
      { action: "adjust", deltaSeconds: -300, expectedLevelIndex: 1 },
      { action: "undo", expectedUndo: { at: undo.at, redo: false } },
    ]);
  });

  it("undoes once for a bounced U, naming the undo it shows, so a second press can never redo it (TDN2-UNDO-REDO-TRAP)", async () => {
    const undo = undoDto();
    const { sent } = showControls(derivedAt(1), tools(), undo);
    const keys = user();
    await keys.keyboard("u");
    await keys.keyboard("U");
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    await act(() => vi.advanceTimersByTimeAsync(LEVEL_KEY_DEBOUNCE_MS));
    expect(sent).toEqual([{ action: "undo", expectedUndo: { at: undo.at, redo: false } }]);
    expect(screen.getByRole("button", { name: "Undo: Moved to Level 2 (300/600)" })).toBeEnabled();
  });

  it("sends no undo of a change it never showed, and says there is nothing to undo", async () => {
    const { sent } = showControls();
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    await user().keyboard("u");
    expect(await screen.findByText("Nothing to undo")).toBeInTheDocument();
    expect(sent).toEqual([]);
  });

  it("greys Undo out once its two minutes are up, even on a paused screen that redraws nothing", async () => {
    showControls(derivedAt(1), tools(), undoDto({ at: Date.now() - 119_000 }));
    expect(screen.getByRole("button", { name: "Undo: Moved to Level 2 (300/600)" })).toBeEnabled();
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  });

  it("starts a tournament that has not begun when the clock is started from the TV", async () => {
    const { sent } = showControls(derivedAt(0, "idle"));
    await user().keyboard(" ");
    await vi.waitFor(() => expect(sent).toEqual([{ action: "toggle", alsoStartTournament: true, expectedStatus: "idle" }]));
  });

  it("moves one level for a bounced key, and again once it settles", async () => {
    const { sent } = showControls();
    const keys = user();
    await keys.keyboard("{ArrowRight}");
    await keys.keyboard("n");
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    await act(() => vi.advanceTimersByTimeAsync(LEVEL_KEY_DEBOUNCE_MS));
    await keys.keyboard("{ArrowLeft}");
    await vi.waitFor(() => expect(sent).toEqual([{ action: "next", expectedLevelIndex: 1 }, { action: "prev", expectedLevelIndex: 1 }]));
  });

  it("leaves keys alone while someone types", async () => {
    const { sent } = showControls();
    const keys = user();
    await keys.click(screen.getByRole("textbox", { name: "Notes" }));
    await keys.keyboard("n u ");
    expect(screen.getByRole("textbox", { name: "Notes" })).toHaveValue("n u ");
    expect(sent).toEqual([]);
  });

  it("pauses on Space after a bar button was clicked, which keeps no focus (P4REV0-TV-SPACE-FOCUS)", async () => {
    const { sent } = showControls();
    const keys = user();
    const next = screen.getByRole("button", { name: "Next level" });
    await keys.click(next);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    // Focus left on the button would hand it Space, and keep the bar over the TV for good.
    expect(next).not.toHaveFocus();
    await act(() => vi.advanceTimersByTimeAsync(LEVEL_KEY_DEBOUNCE_MS));
    await keys.keyboard(" ");
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(sent).toEqual([
      { action: "next", expectedLevelIndex: 1 },
      { action: "toggle", alsoStartTournament: false, expectedStatus: "running" },
    ]);
  });

  it("takes Space for Start / Pause even with a button focused from the keyboard, without pressing it", async () => {
    const { sent } = showControls();
    const keys = user();
    screen.getByRole("button", { name: "Next level" }).focus();
    await keys.keyboard(" ");
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    await act(() => vi.advanceTimersByTimeAsync(LEVEL_KEY_DEBOUNCE_MS));
    expect(sent).toEqual([{ action: "toggle", alsoStartTournament: false, expectedStatus: "running" }]);
  });

  it("goes on taking Space for the clock once the shortcuts are closed", async () => {
    const { sent } = showControls();
    const keys = user();
    await keys.click(screen.getByRole("button", { name: "Shortcuts" }));
    await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    await keys.keyboard("{Escape}");
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await keys.keyboard(" ");
    await vi.waitFor(() => expect(sent).toEqual([{ action: "toggle", alsoStartTournament: false, expectedStatus: "running" }]));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("toggles full screen and the sound, and lists the shortcuts", async () => {
    const { tools: screenTools } = showControls();
    const keys = user();
    await keys.keyboard("f");
    await keys.keyboard("m");
    expect(screenTools.fullscreen.toggle).toHaveBeenCalledTimes(1);
    expect(screenTools.sound.toggle).toHaveBeenCalledTimes(1);

    await keys.keyboard("?");
    const help = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    expect(help).toHaveTextContent(SHORTCUTS.map((shortcut) => `${shortcut.keys}${shortcut.does}`).join(""));
  });

  it("puts the seats or the payouts over the clock and takes them down, from the keys and the bar (TDN3-OVERLAY-STUCK)", async () => {
    const { layers, showLayer } = showControls();
    const keys = user();
    // Esc with nothing up is the browser's (leaving full screen): nothing is sent.
    await keys.keyboard("{Escape}");
    await keys.keyboard("s");
    await vi.waitFor(() => expect(layers).toEqual([{ overlay: "seating" }]));
    await keys.keyboard("$");
    await vi.waitFor(() => expect(layers).toHaveLength(2));
    expect(screen.getByRole("button", { name: "Seats" })).toHaveAttribute("aria-pressed", "false");

    // The seats are up: S, Esc and the bar's pressed Seats take them down; Payouts swaps them for the payouts.
    await showLayer("seating");
    expect(screen.getByRole("button", { name: "Seats" })).toHaveAttribute("aria-pressed", "true");
    await keys.keyboard("s");
    await keys.keyboard("{Escape}");
    await keys.click(screen.getByRole("button", { name: "Seats" }));
    await keys.click(screen.getByRole("button", { name: "Payouts" }));
    await vi.waitFor(() => expect(layers).toHaveLength(6));
    expect(layers).toEqual([{ overlay: "seating" }, { overlay: "payouts" }, { overlay: "none" }, { overlay: "none" }, { overlay: "none" }, { overlay: "payouts" }]);
  });

  it("names the toggle by what it will do", () => {
    showControls(derivedAt(0, "idle"));
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
  });
});
