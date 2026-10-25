import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { clockDto, liveDisplayDto, mockDisplay, pausedClock, recordClockActions, resetServerTime, runningClock, serveDisplay } from "@test/helpers/clock-dto";
import { server } from "@test/msw/server";
import { apiError, mockSignedOut, renderWithApp } from "@test/helpers/web";
import type { PublicSeatingDto } from "@shared/api/seating";
import type { LiveDisplayDto } from "@shared/api/live-display";
import { DISPLAY_REFRESH_MS, HANDHELD_QUERY } from "../api";
import { noPayoutsNote } from "../components/public/display-overlays";
import { SOUND_PREFERENCE_KEY } from "../components/public/use-clock-sound";
import ClockDisplayPage from "./clock-display";

/** A browser's audio, recording every beep scheduled. */
class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  static startState: AudioContextState = "running";
  state: AudioContextState = FakeAudioContext.startState;
  currentTime = 0;
  destination = {};
  beeps: number[] = [];
  constructor() {
    FakeAudioContext.instances.push(this);
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
  createOscillator() {
    const oscillator = { type: "sine", frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
    queueMicrotask(() => this.beeps.push(oscillator.frequency.value));
    return oscillator;
  }
  createGain() {
    return { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() };
  }
}

const beeps = () => FakeAudioContext.instances.flatMap((context) => context.beeps);

function showPage() {
  return renderWithApp(<ClockDisplayPage />, { path: "/clock/t1", route: "/clock/:tournamentId" });
}

// The staff's controls load on demand (a script of their own). Their first load compiles that module
// graph, which can take seconds when every worker is busy: loaded once here, under the hook's own limit,
// the 1 s waits below never time a compile, whichever test draws the controls first.
beforeAll(async () => {
  await import("../components/display-controls");
});

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  resetServerTime();
  mockSignedOut();
  FakeAudioContext.instances = [];
  FakeAudioContext.startState = "running";
  vi.stubGlobal("AudioContext", FakeAudioContext);
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the TV clock", () => {
  it("says it is loading until the first answer", async () => {
    mockDisplay(async () => {
      await delay(200);
      return liveDisplayDto({ serverNow: Date.now() });
    });
    showPage();
    expect(screen.getByRole("status")).toHaveTextContent("Loading the clock");
    expect(await screen.findByTestId("clock-face")).toBeInTheDocument();
  });

  it("shows the level, the time left, the blinds with the ante, what comes next and the time to the break", async () => {
    const now = Date.now();
    serveDisplay({ clock: runningClock(now, { levelIndex: 2, remainingMs: 12 * 60_000 + 5_000 }) });
    showPage();

    expect(await screen.findByRole("heading", { name: "Level 3" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Friday Freezeout" })).toBeInTheDocument();
    expect(screen.getByRole("timer", { name: "Time left" })).toHaveTextContent("12:05");
    expect(screen.getByText("400/800")).toBeInTheDocument();
    expect(screen.getByText("BB ante 800")).toBeInTheDocument();
    expect(screen.getByText("Break (10 min)")).toBeInTheDocument();
    expect(screen.getByText("Break in").nextSibling).toHaveTextContent("12:05");
    expect(screen.getByText("Level 3: blinds 400/800, BB ante 800")).toHaveAttribute("aria-live", "polite");

    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(screen.getByRole("timer", { name: "Time left" })).toHaveTextContent("12:00");
  });

  it("shows the room's figures: players left, entries, the average stack in big blinds", async () => {
    const now = Date.now();
    serveDisplay({ clock: runningClock(now, { levelIndex: 1 }), stats: { earlyBirds: 4 } });
    showPage();

    const stats = await screen.findByTestId("display-stats");
    expect(within(stats).getByText("Players").nextSibling).toHaveTextContent("18 / 20");
    expect(within(stats).getByText("Early birds").nextSibling).toHaveTextContent("4");
    expect(within(stats).getByText("Average stack").nextSibling).toHaveTextContent("88,889 148.1 BB");
  });

  it("heads a break Break, with its note under it, and shows the blinds play resumes at (TDN2-BREAK-WORD-MISSING)", async () => {
    const now = Date.now();
    serveDisplay({ clock: runningClock(now, { levelIndex: 3, remainingMs: 4 * 60_000 }) });
    showPage();

    expect(await screen.findByRole("heading", { name: "Break" })).toBeInTheDocument();
    expect(within(screen.getByTestId("clock-face")).getByText("Colour up")).toBeInTheDocument();
    expect(screen.getByText("500/1,000 · BB ante 1,000")).toBeInTheDocument();
    expect(screen.queryByText("Break in")).not.toBeInTheDocument();
  });

  it("says PAUSED and marks the time paused, and so does the strip over the seats (TDN2-TV-STATE-TOO-SMALL)", async () => {
    server.use(http.get("/api/public/tournaments/t1/seating", () => HttpResponse.json({ tournament: { id: "t1", name: "Friday Freezeout", status: "in_progress" }, club: { id: "c1", name: "Central Stars", slug: "central-stars", imageUrl: null }, tables: [], players: [], unseatedCount: 0 })));
    serveDisplay({ clock: pausedClock({ levelIndex: 1, remainingMs: 8 * 60_000 }) });
    const { unmount } = showPage();
    const paused = await screen.findByTestId("clock-paused");
    expect(paused).toHaveTextContent("Paused");
    expect(paused).toHaveAttribute("data-tone", "paused");
    expect(screen.getByRole("timer", { name: "Time left" })).toHaveAttribute("data-tone", "paused");
    unmount();

    serveDisplay({ clock: pausedClock({ levelIndex: 1, remainingMs: 8 * 60_000, displaySettings: { ...clockDto().displaySettings, overlay: "seating" } }) });
    showPage();
    const overlay = await screen.findByRole("region", { name: "Seats" });
    expect(within(overlay).getByTestId("overlay-strip")).toHaveTextContent(/^Paused · Level 2 · 8:00 · 300\/600$/);
    expect(within(overlay).getByText("Paused ·")).toHaveAttribute("data-tone", "paused");
  });

  it("has a QR code to the season leaderboard, captioned with the season", async () => {
    serveDisplay();
    showPage();

    const qr = await screen.findByTestId("display-qr");
    expect(within(qr).getByText("Scan for the Winter 2026 leaderboard", { selector: "figcaption span" })).toBeInTheDocument();
    expect(within(qr).getByText(/\/season\/s1$/)).toBeInTheDocument();
    expect(qr.querySelector("svg title")).toHaveTextContent("Scan for the Winter 2026 leaderboard");
  });

  it("falls back to the tournament's live results without a season, and shows no QR when the TD chose none", async () => {
    serveDisplay({ season: null, qr: { target: "tournament", path: "/tournament/t1" } });
    const { unmount } = showPage();
    expect(await screen.findByText("Scan for live results", { selector: "figcaption span" })).toBeInTheDocument();
    expect(screen.getByText(/\/tournament\/t1$/)).toBeInTheDocument();
    unmount();

    serveDisplay({ qr: null });
    showPage();
    await screen.findByTestId("clock-face");
    expect(screen.queryByTestId("display-qr")).not.toBeInTheDocument();
  });

  it("shows the prize pool (marked est.), the top places and the AP once they may be shown", async () => {
    serveDisplay({
      money: {
        show: true,
        estimated: true,
        netCents: 190_000,
        apCents: 10_000,
        payouts: [
          { position: 1, amountCents: 95_000 },
          { position: 2, amountCents: 57_000 },
          { position: 3, amountCents: 38_000 },
        ],
      },
    });
    showPage();

    const money = await screen.findByTestId("display-money");
    expect(within(money).getByText("est.")).toBeInTheDocument();
    expect(within(money).getByText("$1,900")).toBeInTheDocument();
    expect(within(within(money).getByRole("list", { name: "Payouts" })).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["1st$950", "2nd$570", "3rd$380"]);
    expect(within(money).getByText("AP").nextSibling).toHaveTextContent("$100");
  });

  it("says what of the pool no place is paid while fewer players are in than the places it pays (MONEY-AP-05)", async () => {
    // A $500 pool paying 3 places, with 2 players in: 1st and 2nd take $400, the 3rd place's $100 is not paid.
    serveDisplay({
      stats: { entrants: 2, remaining: 2 },
      clock: runningClock(Date.now(), { displaySettings: { ...clockDto().displaySettings, overlay: "payouts" } }),
      money: { show: true, estimated: true, netCents: 50_000, payouts: [{ position: 1, amountCents: 25_000 }, { position: 2, amountCents: 15_000 }] },
    });
    showPage();
    const note = "Only 2 players: $100 of the pool is not paid out unless more players enter.";
    expect(await within(await screen.findByTestId("display-money")).findByTestId("display-unpaid")).toHaveTextContent(note);
    expect(within(screen.getByRole("region", { name: "Payouts" })).getByText(note)).toBeInTheDocument();
  });

  it("says nothing is unpaid when every place is paid, and what the club adds to a guaranteed pool", async () => {
    serveDisplay({ money: { show: true, estimated: false, netCents: 60_000, apCents: 0, clubAddedCents: 10_000, payouts: [{ position: 1, amountCents: 60_000 }] } });
    showPage();
    const money = await screen.findByTestId("display-money");
    expect(within(money).queryByTestId("display-unpaid")).not.toBeInTheDocument();
    expect(within(money).getByTestId("display-ap")).toHaveTextContent("Added by the club$100");
    expect(within(money).queryByText("AP")).not.toBeInTheDocument();
  });

  it("says the pool is shown once it is locked, while it is not", async () => {
    serveDisplay();
    showPage();
    expect(await screen.findByText("The prize pool is shown once it is locked")).toBeInTheDocument();
  });

  it("says when the clock is not set up yet, still with the QR code", async () => {
    serveDisplay({ clock: null });
    showPage();
    expect(await screen.findByRole("heading", { name: "Clock not set up yet" })).toBeInTheDocument();
    expect(screen.getByTestId("display-qr")).toBeInTheDocument();
  });

  it("says when the tournament is complete, with its results", async () => {
    // A layer left up from the bubble does not hide the result.
    serveDisplay({ tournament: { status: "completed" }, clock: clockDto({ status: "finished", displaySettings: { ...clockDto().displaySettings, overlay: "payouts" } }) });
    showPage();
    expect(await screen.findByRole("heading", { name: "Tournament complete" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See the results" })).toHaveAttribute("href", "/tournament/t1");
    expect(screen.queryByTestId("display-overlay")).not.toBeInTheDocument();
  });

  it("says when the tournament was cancelled", async () => {
    serveDisplay({ tournament: { status: "cancelled" } });
    showPage();
    expect(await screen.findByRole("heading", { name: "This tournament was cancelled" })).toBeInTheDocument();
  });

  it("says when the tournament does not exist", async () => {
    mockDisplay(() => apiError(404, "NOT_FOUND", "Tournament not found"));
    showPage();
    expect(await screen.findByRole("heading", { name: "Tournament not found" })).toBeInTheDocument();
  });

  it("offers to try again when the clock could not be loaded", async () => {
    let fail = true;
    mockDisplay(() => (fail ? apiError(500, "INTERNAL", "Something broke") : liveDisplayDto()));
    showPage();
    expect(await screen.findByRole("heading", { name: "The clock could not be loaded" })).toBeInTheDocument();
    fail = false;
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("clock-face")).toBeInTheDocument();
  });

  it("says it is offline after 30 s without an answer, and keeps counting down", async () => {
    let down = false;
    const now = Date.now();
    mockDisplay(() => (down ? HttpResponse.error() : liveDisplayDto({ serverNow: Date.now(), clock: runningClock(now, { remainingMs: 10 * 60_000 }) })));
    showPage();
    await screen.findByTestId("clock-face");
    down = true;

    await act(() => vi.advanceTimersByTimeAsync(31_000));
    expect(screen.getByText("Offline · reconnecting")).toBeInTheDocument();
    expect(screen.getByRole("timer", { name: "Time left" })).toHaveTextContent("9:29");
  });

  it("says it is offline over the seats or the payouts too, which cover the header (TDN3-OVERLAY-STUCK)", async () => {
    let down = false;
    const now = Date.now();
    const settings = { ...clockDto().displaySettings, overlay: "payouts" as const };
    mockDisplay(() => (down ? HttpResponse.error() : liveDisplayDto({ serverNow: Date.now(), clock: runningClock(now, { remainingMs: 10 * 60_000, displaySettings: settings }) })));
    showPage();
    const overlay = await screen.findByRole("region", { name: "Payouts" });
    down = true;

    await act(() => vi.advanceTimersByTimeAsync(31_000));
    expect(within(overlay).getByText("Offline · reconnecting")).toBeInTheDocument();
    expect(screen.getAllByText("Offline · reconnecting")).toHaveLength(1);
  });

  it("says it is offline only after two missed polls, and never on a game that is over (P4REV1-CC-02)", async () => {
    const matchMedia = window.matchMedia;
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({ ...matchMedia(query), matches: query === HANDHELD_QUERY }));
    let down = false;
    mockDisplay(() => (down ? HttpResponse.error() : liveDisplayDto({ serverNow: Date.now(), clock: runningClock(Date.now()) })));
    const { unmount } = showPage();
    await screen.findByTestId("clock-face");
    down = true;
    // A phone asks every 20 s: 31 s without an answer is one missed poll, not an outage.
    await act(() => vi.advanceTimersByTimeAsync(31_000));
    expect(screen.queryByText("Offline · reconnecting")).not.toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(screen.getByText("Offline · reconnecting")).toBeInTheDocument();
    unmount();
    vi.mocked(window.matchMedia).mockRestore();

    // Nothing more is asked once the game is over: no answer is expected, so none is missed.
    serveDisplay({ tournament: { status: "cancelled" }, clock: null });
    const { unmount: closeCancelled } = showPage();
    await screen.findByText("This tournament was cancelled");
    await act(() => vi.advanceTimersByTimeAsync(5 * 60_000));
    expect(screen.queryByText("Offline · reconnecting")).not.toBeInTheDocument();
    closeCancelled();

    serveDisplay({ tournament: { status: "completed" }, clock: clockDto({ status: "finished", updatedAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString() }) });
    showPage();
    await screen.findByText("Tournament complete");
    await act(() => vi.advanceTimersByTimeAsync(5 * 60_000));
    expect(screen.queryByText("Offline · reconnecting")).not.toBeInTheDocument();
  });

  it("chimes when the level changes while running, never on the first draw", async () => {
    serveDisplay({ clock: runningClock(Date.now(), { remainingMs: 1500 }) });
    showPage();
    await screen.findByTestId("clock-face");
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(beeps()).toEqual([]);

    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(screen.getByRole("heading", { name: "Level 2" })).toBeInTheDocument();
    expect(beeps()).toEqual([880, 880, 880]);
  });

  it("chimes once a minute is left, and when a break starts", async () => {
    const now = Date.now();
    serveDisplay({ clock: runningClock(now, { levelIndex: 2, remainingMs: 61_500 }) });
    showPage();
    await screen.findByTestId("clock-face");

    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(beeps()).toEqual([660]);
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(screen.getByRole("heading", { name: "Break" })).toBeInTheDocument();
    expect(beeps()).toEqual([660, 520, 520]);
  });

  it("stays silent once muted, and remembers it on this screen", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const now = Date.now();
    serveDisplay({ clock: runningClock(now, { remainingMs: 1500 }) });
    showPage();
    await user.click(await screen.findByRole("button", { name: "Mute the clock" }));

    expect(window.localStorage.getItem(SOUND_PREFERENCE_KEY)).toBe("off");
    expect(screen.getByRole("button", { name: "Turn the clock's sound on" })).toHaveAttribute("aria-pressed", "true");
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(beeps()).toEqual([]);
  });

  it("asks for a tap while the browser holds the sound back", async () => {
    FakeAudioContext.startState = "suspended";
    serveDisplay();
    showPage();
    expect(await screen.findByRole("button", { name: "Tap to enable sound" })).toBeInTheDocument();
  });

  it("keeps the screen awake for the whole game, paused or not started, and lets it sleep once it is over", async () => {
    const release = vi.fn(() => Promise.resolve());
    const request = vi.fn(() => Promise.resolve({ released: false, release }));
    Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request } });
    onTestFinished(() => {
      Reflect.deleteProperty(navigator, "wakeLock");
    });
    // Before the start: Level 1 and the QR code on show while the players arrive (P4REV0-WAKELOCK-PAUSED).
    let display: LiveDisplayDto = liveDisplayDto({ tournament: { status: "registration" }, clock: clockDto() });
    mockDisplay(() => ({ ...display, serverNow: Date.now() }));
    const { queryClient } = showPage();
    await screen.findByTestId("clock-face");
    await vi.waitFor(() => expect(request).toHaveBeenCalledWith("screen"));

    // A paused dispute, then a clock removed: still awake, on the one lock.
    display = liveDisplayDto({ clock: pausedClock() });
    await act(() => queryClient.invalidateQueries());
    display = liveDisplayDto({ clock: null });
    await act(() => queryClient.invalidateQueries());
    await screen.findByRole("heading", { name: "Clock not set up yet" });
    expect(request).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();

    display = liveDisplayDto({ tournament: { status: "completed" }, clock: pausedClock({ status: "finished" }) });
    await act(() => queryClient.invalidateQueries());
    await vi.waitFor(() => expect(release).toHaveBeenCalled());
  });

  it("offers full screen only where the browser can do it", async () => {
    serveDisplay();
    const { unmount } = showPage();
    await screen.findByTestId("clock-face");
    expect(screen.queryByRole("button", { name: "Full screen" })).not.toBeInTheDocument();
    unmount();

    const requestFullscreen = vi.fn(() => Promise.resolve());
    Object.defineProperty(document.documentElement, "requestFullscreen", { configurable: true, value: requestFullscreen });
    try {
      showPage();
      await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(await screen.findByRole("button", { name: "Full screen" }));
      expect(requestFullscreen).toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(document.documentElement, "requestFullscreen");
    }
  });

  it("puts everyone's seat over the clock when the TD chooses it, asking for the seats only then", async () => {
    const seating: PublicSeatingDto = {
      tournament: { id: "t1", name: "Friday Freezeout", status: "in_progress" },
      club: { id: "c1", name: "Central Stars", slug: "central-stars", imageUrl: null },
      tables: [],
      players: [
        { player: { id: "p1", name: "Alice Smith", imageUrl: null }, tableNumber: 2, tableName: "Table 2", seatNumber: 4 },
        { player: { id: "p2", name: "Bob Jones", imageUrl: null }, tableNumber: 1, tableName: "Table 1", seatNumber: 7 },
      ],
      unseatedCount: 0,
    };
    let asked = 0;
    server.use(
      http.get("/api/public/tournaments/t1/seating", () => {
        asked += 1;
        return HttpResponse.json(seating);
      }),
    );
    const now = Date.now();
    serveDisplay({ clock: runningClock(now, { displaySettings: { ...clockDto().displaySettings, overlay: "seating" } }) });
    showPage();

    const overlay = await screen.findByRole("region", { name: "Seats" });
    expect(await within(overlay).findByText("Alice Smith")).toBeInTheDocument();
    expect(within(overlay).getByText("Alice Smith").nextSibling).toHaveTextContent("T2 · S4");
    expect(within(overlay).getByText(/^Level 1 · 1[12]:\d\d · 200\/400$/)).toBeInTheDocument();
    expect(asked).toBe(1);
  });

  it("puts the payouts over the clock, or says when they will be announced", async () => {
    const now = Date.now();
    serveDisplay({ clock: runningClock(now, { displaySettings: { ...clockDto().displaySettings, overlay: "payouts" } }) });
    showPage();
    const overlay = await screen.findByRole("region", { name: "Payouts" });
    expect(within(overlay).getByText("Payouts are announced when the prize pool is locked")).toBeInTheDocument();
  });

  it("never promises payouts the TD chose not to show, and says when no place is paid yet (MONEY-AP-06)", async () => {
    const settings = { ...clockDto().displaySettings, overlay: "payouts" as const };
    expect(noPayoutsNote({ show: false }, { ...settings, showPrizePool: "never" })).toBe("Payouts are not shown on this screen");
    expect(noPayoutsNote({ show: true }, { ...settings, showPrizePool: "always", showPayouts: false })).toBe("Payouts are not shown on this screen");
    expect(noPayoutsNote({ show: true }, { ...settings, showPrizePool: "always", showPayouts: true })).toBe("No places are paid yet");

    // Locked, but the TD switched the payouts off: the room is not told they are coming.
    serveDisplay({
      tournament: { prizePoolLocked: true },
      clock: runningClock(Date.now(), { displaySettings: { ...settings, showPayouts: false } }),
      money: { show: true, estimated: false, netCents: 50_000, netSource: "calculated", payouts: null },
    });
    showPage();
    const overlay = await screen.findByRole("region", { name: "Payouts" });
    expect(within(overlay).getByText("Payouts are not shown on this screen")).toBeInTheDocument();
    expect(within(overlay).queryByText(/announced when the prize pool is locked/)).not.toBeInTheDocument();
  });

  it("keeps asking for the seats when their first load failed: nobody is at the TV to try again (P4REV4-CQ-06)", async () => {
    let asked = 0;
    server.use(
      http.get("/api/public/tournaments/t1/seating", () => {
        asked += 1;
        return asked === 1
          ? HttpResponse.json({ error: "Server error" }, { status: 500 })
          : HttpResponse.json({
              tournament: { id: "t1", name: "Friday Freezeout", status: "in_progress" },
              club: { id: "c1", name: "Central Stars", slug: "central-stars", imageUrl: null },
              tables: [],
              players: [{ player: { id: "p1", name: "Alice Smith", imageUrl: null }, tableNumber: 2, tableName: "Table 2", seatNumber: 4 }],
              unseatedCount: 0,
            } satisfies PublicSeatingDto);
      }),
    );
    serveDisplay({ clock: runningClock(Date.now(), { displaySettings: { ...clockDto().displaySettings, overlay: "seating" } }) });
    showPage();
    const overlay = await screen.findByRole("region", { name: "Seats" });
    expect(await within(overlay).findByText("The seats could not be loaded")).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(16_000));
    expect(await within(overlay).findByText("Alice Smith")).toBeInTheDocument();
  });

  it("asks every few seconds on the venue's screen, and far less often on a phone (P4SEC-LIVE-BUDGET-TV)", async () => {
    const display = serveDisplay({ clock: runningClock(Date.now()) });
    const { unmount } = showPage();
    await screen.findByTestId("clock-face");
    await act(() => vi.advanceTimersByTimeAsync(DISPLAY_REFRESH_MS.tv * 3 + 100));
    expect(display.calls()).toBe(4);
    unmount();

    const matchMedia = window.matchMedia;
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({ ...matchMedia(query), matches: query === HANDHELD_QUERY }));
    const phone = serveDisplay({ clock: runningClock(Date.now()) });
    showPage();
    await screen.findByTestId("clock-face");
    await act(() => vi.advanceTimersByTimeAsync(DISPLAY_REFRESH_MS.phone - 1000));
    expect(phone.calls()).toBe(1);
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(phone.calls()).toBe(2);
  });

  it("keeps the venue's rate on a tablet opened from the staff's TV link, or signed in as staff (TDN2-TABLET-AS-PHONE)", async () => {
    const matchMedia = window.matchMedia;
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({ ...matchMedia(query), matches: query === HANDHELD_QUERY }));
    const fromLink = serveDisplay({ clock: runningClock(Date.now()) });
    const { unmount } = renderWithApp(<ClockDisplayPage />, { path: "/clock/t1?screen=tv", route: "/clock/:tournamentId" });
    await screen.findByTestId("clock-face");
    await act(() => vi.advanceTimersByTimeAsync(DISPLAY_REFRESH_MS.tv * 3 + 100));
    expect(fromLink.calls()).toBe(4);
    unmount();

    const staff = serveDisplay({ clock: runningClock(Date.now()), viewer: { canControl: true } });
    showPage();
    await screen.findByTestId("clock-face");
    await act(() => vi.advanceTimersByTimeAsync(DISPLAY_REFRESH_MS.tv * 3 + 100));
    expect(staff.calls()).toBe(4);
  });

  it("gives the club's staff its controls, and nobody else", async () => {
    serveDisplay();
    const { unmount } = showPage();
    await screen.findByTestId("clock-face");
    expect(screen.queryByRole("toolbar", { name: "Clock controls" })).not.toBeInTheDocument();
    unmount();

    const now = Date.now();
    serveDisplay({ clock: runningClock(now, { levelIndex: 1 }), viewer: { canControl: true } });
    const sent = recordClockActions(() => liveDisplayDto({ clock: pausedClock({ levelIndex: 1 }), viewer: { canControl: true } }));
    showPage();
    expect(await screen.findByRole("toolbar", { name: "Clock controls" })).toBeInTheDocument();

    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).keyboard(" ");
    await vi.waitFor(() => expect(sent).toEqual([{ action: "toggle", alsoStartTournament: false, expectedStatus: "running" }]));
    expect(await screen.findByText("Paused")).toBeInTheDocument();
  });
});
