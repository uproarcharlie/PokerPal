import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clockDto, liveDisplayDto, pausedClock, recordClockActions, resetServerTime, runningClock, serveDisplay } from "@test/helpers/clock-dto";
import { mockSignedOut, renderWithApp } from "@test/helpers/web";
import { chipTapFocuses, ClockStatusChip } from "./clock-status-chip";

beforeEach(() => {
  resetServerTime();
  mockSignedOut();
});

describe("ClockStatusChip", () => {
  it("shows the level, the time left and the blinds, and opens the clock", async () => {
    serveDisplay({ clock: runningClock(Date.now(), { levelIndex: 1, remainingMs: 12 * 60_000 + 34_000 }) });
    const onOpen = vi.fn();
    renderWithApp(<ClockStatusChip tournamentId="t1" onOpen={onOpen} />);

    const chip = await screen.findByRole("button", { name: /^Clock, running: L2 · 12:3\d · 300\/600$/ });
    await userEvent.setup().click(chip);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("asks for Start / Pause to be focused from the keyboard or a finger, never a mouse (TDN2-CHIP-FOCUS-SPACE)", async () => {
    serveDisplay({ clock: runningClock(Date.now(), { levelIndex: 1 }) });
    const onOpen = vi.fn();
    renderWithApp(<ClockStatusChip tournamentId="t1" onOpen={onOpen} />);
    const chip = await screen.findByTestId("clock-status-chip");
    const user = userEvent.setup();

    await user.click(chip);
    expect(onOpen).toHaveBeenLastCalledWith({ focus: false });
    chip.focus();
    await user.keyboard("{Enter}");
    expect(onOpen).toHaveBeenLastCalledWith({ focus: true });
    expect(onOpen).toHaveBeenCalledTimes(2);

    // A browser's click is a pointer event that names what pressed it.
    const tap = (pointerType: string) => chipTapFocuses({ detail: 1, nativeEvent: Object.assign(new MouseEvent("click"), { pointerType }) });
    expect(tap("touch")).toBe(true);
    expect(tap("pen")).toBe(true);
    expect(tap("mouse")).toBe(false);
  });

  it("says when the clock is paused or on a break", async () => {
    serveDisplay({ clock: pausedClock({ levelIndex: 3, remainingMs: 5 * 60_000 }) });
    const { unmount } = renderWithApp(<ClockStatusChip tournamentId="t1" onOpen={() => undefined} />);
    expect(await screen.findByRole("button", { name: "Clock, paused: Break · 5:00" })).toBeInTheDocument();
    unmount();

    serveDisplay({ clock: runningClock(Date.now(), { levelIndex: 3, remainingMs: 5 * 60_000 }) });
    renderWithApp(<ClockStatusChip tournamentId="t1" onOpen={() => undefined} />);
    expect(await screen.findByRole("button", { name: /^Clock, on a break: Break · (5:00|4:59)$/ })).toBeInTheDocument();
  });

  it("shows nothing while the tournament has no clock", async () => {
    const display = serveDisplay({ clock: null });
    renderWithApp(<ClockStatusChip tournamentId="t1" onOpen={() => undefined} />);
    await vi.waitFor(() => expect(display.calls()).toBe(1));
    expect(screen.queryByTestId("clock-status-chip")).not.toBeInTheDocument();
  });

  it("puts Pause beside the chip for the club's staff, sent with the status on screen (P4REV0-PHONE-PAUSE-FOLD)", async () => {
    serveDisplay({ clock: runningClock(Date.now(), { levelIndex: 1 }), viewer: { canControl: true } });
    const sent = recordClockActions(() => liveDisplayDto({ clock: pausedClock({ levelIndex: 1 }), viewer: { canControl: true } }));
    renderWithApp(<ClockStatusChip tournamentId="t1" onOpen={() => undefined} />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Pause the clock" }));
    await vi.waitFor(() => expect(sent).toEqual([{ action: "toggle", alsoStartTournament: false, expectedStatus: "running" }]));
    expect(await screen.findByRole("button", { name: "Resume the clock" })).toBeInTheDocument();
  });

  it("offers no Pause to anyone else, nor before the clock has started", async () => {
    serveDisplay({ clock: runningClock(Date.now()) });
    const { unmount } = renderWithApp(<ClockStatusChip tournamentId="t1" onOpen={() => undefined} />);
    await screen.findByTestId("clock-status-chip");
    expect(screen.queryByTestId("clock-quick-toggle")).not.toBeInTheDocument();
    unmount();

    serveDisplay({ clock: clockDto(), viewer: { canControl: true } });
    renderWithApp(<ClockStatusChip tournamentId="t1" onOpen={() => undefined} />);
    await screen.findByTestId("clock-status-chip");
    expect(screen.queryByTestId("clock-quick-toggle")).not.toBeInTheDocument();
  });
});
