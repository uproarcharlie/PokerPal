import { act, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { clockDto, liveDisplayDto, mockDisplay, pausedClock, recordClockActions, resetServerTime, runningClock, serveDisplay } from "@test/helpers/clock-dto";
import { server } from "@test/msw/server";
import { apiError, mockSignedOut, renderWithApp } from "@test/helpers/web";
import { recordRequests } from "@test/helpers/requests";
import type { PublicSeatingDto } from "@shared/api/seating";
import type { LiveDisplayDto } from "@shared/api/live-display";
import { CENTRAL_STARS_THEME, themeVariables } from "@shared/domain/theme";
import { DISPLAY_REFRESH_MS, HANDHELD_QUERY } from "../api";
import { noPayoutsNote } from "../components/public/display-overlays";
import { VOLUME_SAVE_MS } from "../components/public/screen-settings";
import { cueFrequencies, SOUND_PREFERENCE_KEY, type ClockCue } from "../components/public/use-clock-sound";
import { ThemeScope } from "@/app/theme";
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
    const oscillator = {
      type: "sine",
      frequency: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    queueMicrotask(() => this.beeps.push(oscillator.frequency.value));
    return oscillator;
  }
  createGain() {
    return { gain: { value: 1, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() };
  }
  createDynamicsCompressor() {
    const param = () => ({ value: 0 });
    return { threshold: param(), knee: param(), ratio: param(), attack: param(), release: param(), connect: vi.fn() };
  }
}

const beeps = () => FakeAudioContext.instances.flatMap((context) => context.beeps);

/**
 * Lets `ms` pass a step at a time, each drawn: a screen draws every second it shows, but one act()
 * over many seconds would let React draw only the last of them.
 */
async function pass(ms: number, step = 250) {
  for (let left = ms; left > 0; left -= step) await act(() => vi.advanceTimersByTimeAsync(Math.min(step, left)));
}

/** What the room hears for these sounds, one after another. */
const heard = (...cues: ClockCue[]) => cues.flatMap(cueFrequencies);

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
  window.sessionStorage.clear();
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
    expect(await screen.findByTestId("clock-centrepiece")).toBeInTheDocument();
  });

  it("shows the time left, the blinds with the ante as its headline, what comes next and the time to the break, and no level number (round 5, item 21)", async () => {
    const now = Date.now();
    serveDisplay({ clock: runningClock(now, { levelIndex: 2, remainingMs: 12 * 60_000 + 5_000 }) });
    showPage();

    expect(await screen.findByTestId("clock-face")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Friday Freezeout" })).toBeInTheDocument();
    // The tournament's name is the only heading: no "LEVEL 3" over the countdown.
    expect(screen.getAllByRole("heading").map((heading) => heading.textContent)).toEqual(["Friday Freezeout"]);
    expect(screen.getByTestId("clock-face")).not.toHaveTextContent(/Level/);
    expect(screen.getByRole("timer", { name: "Time left" })).toHaveTextContent("12:05");
    expect(screen.getByText("400/800")).toBeInTheDocument();
    expect(screen.getByText("BB ante 800")).toBeInTheDocument();
    expect(screen.getByText("Break (10 min)")).toBeInTheDocument();
    expect(screen.getByTestId("break-line")).toHaveTextContent("Break in 12:05");
    expect(screen.getByText("Level 3: blinds 400/800, BB ante 800")).toHaveAttribute("aria-live", "polite");
    // No total of levels anywhere (round 5, item 21).
    expect(screen.getByTestId("clock-face")).not.toHaveTextContent(/of \d/);

    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(screen.getByRole("timer", { name: "Time left" })).toHaveTextContent("12:00");
  });

  it("heads the level with its number where the TD shows it", async () => {
    const now = Date.now();
    serveDisplay({ clock: runningClock(now, { levelIndex: 2, displaySettings: { ...clockDto().displaySettings, showLevel: true } }) });
    showPage();
    expect(await screen.findByRole("heading", { name: "Level 3" })).toBeInTheDocument();
    expect(screen.getByText("400/800")).toBeInTheDocument();
  });

  it("shows only the core figures by default: players left of those who entered and the average stack in big blinds (round 5, items 25 and 26)", async () => {
    const now = Date.now();
    serveDisplay({
      clock: runningClock(now, { levelIndex: 1 }),
      stats: { earlyBirds: 4, addons: 6, rebuys: 3, activeTables: 2 },
      tournament: { offersRebuys: true, offersAddons: true, rebuyPeriodMinutes: 135 },
    });
    showPage();

    const stats = await screen.findByTestId("display-stats");
    expect(within(stats).getAllByRole("term").map((term) => term.textContent)).toEqual(["Players", "Average stack"]);
    expect(within(stats).getByText("Players").nextSibling).toHaveTextContent("18 / 20");
    expect(within(stats).getByText("Average stack").nextSibling).toHaveTextContent("88,889 148.1 BB");
  });

  it("adds each figure the TD switched on: early birds, add-ons, re-buys, entries, chips in play, tables, the re-buy window", async () => {
    const now = Date.now();
    const settings = {
      ...clockDto().displaySettings,
      showEarlyBirds: true,
      showAddons: true,
      showRebuys: true,
      showEntries: true,
      showChipsInPlay: true,
      showTables: true,
      showRebuyWindow: true,
    };
    serveDisplay({
      clock: runningClock(now, { levelIndex: 1, displaySettings: settings }),
      stats: { earlyBirds: 4, addons: 6, rebuys: 3, activeTables: 2 },
      tournament: { offersRebuys: true, offersAddons: true, rebuyPeriodMinutes: 135 },
    });
    showPage();

    const stats = await screen.findByTestId("display-stats");
    // As many as a 1024 × 768 test screen has room for, in their order.
    const shown = within(stats).getAllByRole("term").map((term) => term.textContent);
    expect(shown.slice(0, 4)).toEqual(["Players", "Average stack", "Re-buys & add-ons close in", "Entries"]);
    expect(["Re-buys", "Add-ons", "Early birds", "Chips in play", "Tables"].slice(0, shown.length - 4)).toEqual(shown.slice(4));
  });

  it("makes the logo the centrepiece on a break: Break — back in over its countdown, its note, the blinds play resumes at (TDN2-BREAK-WORD-MISSING, round 5, item 24)", async () => {
    const now = Date.now();
    serveDisplay({ clock: runningClock(now, { levelIndex: 3, remainingMs: 4 * 60_000 }), club: { imageUrl: "/uploads/central-stars.png" } });
    showPage();

    const centre = await screen.findByTestId("clock-centrepiece");
    expect(within(centre).getByRole("heading", { name: "Break — back in" })).toHaveAttribute("data-testid", "break-line");
    expect(within(centre).getByRole("timer", { name: "Time left" })).toHaveTextContent("4:00");
    expect(within(centre).getByText("Colour up")).toBeInTheDocument();
    expect(within(centre).getByText("Next: 500/1,000 · BB ante 1,000")).toBeInTheDocument();
    // The logo is in the middle, not over the event's name.
    expect(within(centre).getByRole("img", { name: "Central Stars logo" })).toBeInTheDocument();
    expect(screen.getAllByTestId("display-logo")).toHaveLength(1);
    expect(screen.queryByTestId("clock-face")).not.toBeInTheDocument();
  });

  it("makes the logo the centrepiece before the start, with Starting soon and the first blinds, and puts it back over the name once the clock runs (round 5, item 24)", async () => {
    let clock = clockDto();
    mockDisplay(() => liveDisplayDto({ serverNow: Date.now(), clock, club: { imageUrl: "/uploads/central-stars.png" } }));
    const { queryClient } = showPage();

    const centre = await screen.findByTestId("clock-centrepiece");
    expect(within(centre).getByRole("heading", { name: "Starting soon" })).toBeInTheDocument();
    expect(within(centre).getByText("First blinds: 200/400")).toBeInTheDocument();
    expect(within(centre).getByRole("img", { name: "Central Stars logo" })).toBeInTheDocument();
    // The room's figures and the QR code are there while the players arrive.
    expect(screen.getByTestId("display-qr")).toBeInTheDocument();

    clock = runningClock(Date.now());
    await act(() => queryClient.invalidateQueries());
    expect(await screen.findByTestId("clock-face")).toBeInTheDocument();
    expect(screen.queryByTestId("clock-centrepiece")).not.toBeInTheDocument();
    expect(screen.getByRole("banner")).toContainElement(screen.getByRole("img", { name: "Central Stars logo" }));
  });

  it("says PAUSED and marks the time paused, and so does the strip over the seats (TDN2-TV-STATE-TOO-SMALL)", async () => {
    server.use(http.get("/api/public/tournaments/t1/seating", () => HttpResponse.json({ tournament: { id: "t1", name: "Friday Freezeout", status: "in_progress" }, club: { id: "c1", name: "Central Stars", slug: "central-stars", imageUrl: null, theme: null }, tables: [], players: [], unseatedCount: 0 })));
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
    expect(within(overlay).getByTestId("overlay-strip")).toHaveTextContent(/^Paused · 8:00 · 300\/600$/);
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
    await screen.findByTestId("clock-centrepiece");
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

  it("says beside the pool where the difference went: kept by the club, carried in and over (round 5, item 16)", async () => {
    serveDisplay({
      money: {
        show: true,
        estimated: false,
        netCents: 60_000,
        apCents: 8_000,
        payouts: [{ position: 1, amountCents: 60_000 }],
        lines: [
          { kind: "carried_in", label: "Carried over from Test Wednesday", cents: 5_000 },
          { kind: "carried_over", label: "Carried over to Winter League", cents: 12_000 },
        ],
      },
    });
    showPage();
    const money = await screen.findByTestId("display-money");
    const lines = within(money).getByRole("list", { name: "Prize pool breakdown" });
    expect(within(lines).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Carried over from Test Wednesday$50", "Carried over to Winter League$120"]);
    expect(within(money).getByTestId("display-ap")).toHaveTextContent("AP$80");
  });

  it("says nothing more beside the pool when the prizes are what is available", async () => {
    serveDisplay({ money: { show: true, estimated: false, netCents: 60_000, payouts: [{ position: 1, amountCents: 60_000 }], lines: [] } });
    showPage();
    const money = await screen.findByTestId("display-money");
    expect(within(money).queryByTestId("display-pool-lines")).not.toBeInTheDocument();
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
    expect(await screen.findByTestId("clock-centrepiece")).toBeInTheDocument();
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

  it("beeps the last second and sounds blinds up when the level changes while running, never on the first draw", async () => {
    serveDisplay({ clock: runningClock(Date.now(), { remainingMs: 2500 }) });
    showPage();
    await screen.findByTestId("clock-face");
    expect(beeps()).toEqual([]);

    await pass(3000);
    expect(screen.getByText("300/600")).toBeInTheDocument();
    expect(beeps()).toEqual(heard("final_count", "final_count", "level"));
  });

  it("sounds the alarm at a minute left, a beep for each of the last ten seconds, then the break's chime (round 5, item 20)", async () => {
    const now = Date.now();
    serveDisplay({ clock: runningClock(now, { levelIndex: 2, remainingMs: 61_500 }) });
    showPage();
    await screen.findByTestId("clock-face");

    await pass(2000);
    expect(beeps()).toEqual(heard("minute"));
    await act(() => vi.advanceTimersByTimeAsync(45_000));
    await pass(15_000);
    expect(screen.getByRole("heading", { name: "Break — back in" })).toBeInTheDocument();
    expect(beeps()).toEqual(heard("minute", ...Array<ClockCue>(7).fill("count"), "final_count", "final_count", "final_count", "break_start"));
  });

  it("sounds each threshold once: time added back past it, or a refresh, never plays it again", async () => {
    const now = Date.now();
    serveDisplay({ clock: runningClock(now, { levelIndex: 1, remainingMs: 60_800 }) });
    const { unmount } = showPage();
    await screen.findByTestId("clock-face");
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(beeps()).toEqual(heard("minute"));
    unmount();

    // The TD added a minute; the screen was reloaded meanwhile: the clock crosses 1:00 again, silently.
    serveDisplay({ clock: runningClock(Date.now(), { levelIndex: 1, remainingMs: 60_800 }) });
    showPage();
    await screen.findByTestId("clock-face");
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(beeps()).toEqual(heard("minute"));
  });

  it("plays only the sounds the TD switched on for the tournament, at its volume, and shows the settings to a visitor without letting them change them (round 5, items 20 and 22)", async () => {
    const settings = { ...clockDto().displaySettings, soundVolume: 0.5, soundMinute: false, edgeMargin: 0 as const };
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    serveDisplay({ clock: runningClock(Date.now(), { levelIndex: 1, remainingMs: 60_800, displaySettings: settings }) });
    showPage();
    await screen.findByTestId("clock-face");
    expect(screen.getByTestId("clock-screen")).toHaveAttribute("data-edge-margin", "0");
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(beeps()).toEqual([]);

    await user.pointer({ target: screen.getByTestId("clock-screen"), coords: { x: 10, y: 10 } });
    await user.click(screen.getByRole("button", { name: "Screen settings: sound and edge margin" }));
    const dialog = await screen.findByRole("dialog", { name: "Sound and edge margin" });
    expect(dialog).toHaveTextContent("Set for this tournament by the club's staff");
    expect(within(dialog).getByRole("slider", { name: "Volume" })).toHaveValue("50");
    expect(within(dialog).getByRole("slider", { name: "Volume" })).toBeDisabled();
    expect(within(dialog).getByRole("switch", { name: "One minute left (alarm)" })).not.toBeChecked();
    expect(within(dialog).getByRole("switch", { name: "One minute left (alarm)" })).toBeDisabled();
    expect(within(dialog).getByRole("radio", { name: "None" })).toBeChecked();
    expect(within(dialog).getByRole("radio", { name: "5%" })).toBeDisabled();
    // Muting and a test of the sounds are this screen's own.
    expect(within(dialog).getByRole("switch", { name: "Sounds on this screen" })).toBeEnabled();
    await user.click(within(dialog).getByRole("button", { name: "Test sounds" }));
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(beeps()).toEqual(heard("minute", "count", "final_count", "level"));
  });

  it("lets the club's staff at the TV change the tournament's volume, sounds and edge margin, saved for every screen (round 5, items 20 and 22)", async () => {
    let settings = { ...clockDto().displaySettings };
    const now = Date.now();
    mockDisplay(() => liveDisplayDto({ serverNow: Date.now(), clock: runningClock(now, { levelIndex: 1, displaySettings: settings }), viewer: { canControl: true } }));
    const sent = recordRequests(
      [["patch", "/api/tournaments/t1/clock/display"]],
      (request) => {
        settings = { ...settings, ...(request.body as object) };
        return HttpResponse.json(liveDisplayDto({ serverNow: Date.now(), clock: runningClock(now, { levelIndex: 1, displaySettings: settings }), viewer: { canControl: true } }));
      },
      (request) => request.body,
    );
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    showPage();
    await screen.findByRole("toolbar", { name: "Clock controls" });

    await user.click(screen.getByRole("button", { name: "Screen settings: sound and edge margin" }));
    const dialog = await screen.findByRole("dialog", { name: "Sound and edge margin" });
    await vi.waitFor(() => expect(within(dialog).getByRole("slider", { name: "Volume" })).toBeEnabled());
    expect(dialog).toHaveTextContent("Saved for this tournament");

    await user.click(within(dialog).getByRole("switch", { name: "The last 10 seconds (beeps)" }));
    await vi.waitFor(() => expect(within(dialog).getByRole("switch", { name: "The last 10 seconds (beeps)" })).not.toBeChecked());
    await user.click(within(dialog).getByRole("radio", { name: "5%" }));
    await vi.waitFor(() => expect(screen.getByTestId("clock-screen")).toHaveAttribute("data-edge-margin", "5"));

    // A drag sends one change once the slider rests, not one per step.
    const slider = within(dialog).getByRole("slider", { name: "Volume" });
    fireEvent.change(slider, { target: { value: "60" } });
    fireEvent.change(slider, { target: { value: "45" } });
    expect(slider).toHaveValue("45");
    await act(() => vi.advanceTimersByTimeAsync(VOLUME_SAVE_MS + 50));
    await vi.waitFor(() => expect(sent).toEqual([{ soundCountdown: false }, { edgeMargin: 5 }, { soundVolume: 0.45 }]));
    expect(within(dialog).getByRole("slider", { name: "Volume" })).toHaveValue("45");
  });

  it("keeps a TV's edge margin of 2.5% by default, and none on a phone", async () => {
    serveDisplay();
    const { unmount } = showPage();
    expect(await screen.findByTestId("clock-screen")).toHaveAttribute("data-edge-margin", "2.5");
    unmount();
    window.localStorage.clear();

    const matchMedia = window.matchMedia;
    const handheld = vi.spyOn(window, "matchMedia").mockImplementation((query) => ({ ...matchMedia(query), matches: query === HANDHELD_QUERY }));
    onTestFinished(() => handheld.mockRestore());
    serveDisplay();
    showPage();
    expect(await screen.findByTestId("clock-screen")).toHaveAttribute("data-edge-margin", "0");
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
    await screen.findByTestId("clock-centrepiece");
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
    await screen.findByTestId("clock-centrepiece");
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
    const alice = { id: "p1", name: "Alice Smith", imageUrl: null };
    const bob = { id: "p2", name: "Bob Jones", imageUrl: null };
    const seating: PublicSeatingDto = {
      tournament: { id: "t1", name: "Friday Freezeout", status: "in_progress" },
      club: { id: "c1", name: "Central Stars", slug: "central-stars", imageUrl: null, theme: null },
      tables: [
        { tableNumber: 1, displayName: "Table 1", seatCount: 9, shape: "rectangle", seats: [{ seatNumber: 7, player: bob }] },
        { tableNumber: 2, displayName: "Table 2", seatCount: 9, shape: "rectangle", seats: [{ seatNumber: 4, player: alice }] },
      ],
      players: [
        { player: alice, tableNumber: 2, tableName: "Table 2", seatNumber: 4 },
        { player: bob, tableNumber: 1, tableName: "Table 1", seatNumber: 7 },
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
    expect(within(overlay).getByText("Alice Smith").nextSibling).toHaveTextContent("Table 2, Seat 4");
    // Drawn as the tables, each player at their seat.
    expect(within(overlay).getAllByTestId("tv-table")).toHaveLength(2);
    expect(within(overlay).getByText("Alice S.")).toBeInTheDocument();
    expect(within(overlay).getByText(/^1[12]:\d\d · 200\/400$/)).toBeInTheDocument();
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
              club: { id: "c1", name: "Central Stars", slug: "central-stars", imageUrl: null, theme: null },
              tables: [{ tableNumber: 2, displayName: "Table 2", seatCount: 9, shape: "oval", seats: [{ seatNumber: 4, player: { id: "p1", name: "Alice Smith", imageUrl: null } }] }],
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
    await screen.findByTestId("clock-centrepiece");
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

describe("the TV clock in the club's colours (round 5, item 13)", () => {
  // <html> outlives each test's app: start every test from no colours set on it.
  beforeEach(() => document.documentElement.removeAttribute("style"));

  it("wears the club's theme, worked out for the TV's dark screen", async () => {
    mockDisplay(() => liveDisplayDto({ serverNow: Date.now(), club: { theme: CENTRAL_STARS_THEME } }));
    // Inside the TV's layout, as the router mounts it: a dark display screen.
    renderWithApp(
      <ThemeScope layer={{ colorScheme: "dark", surface: "display" }}>
        <ClockDisplayPage />
      </ThemeScope>,
      { path: "/clock/t1", route: "/clock/:tournamentId" },
    );

    expect(await screen.findByTestId("clock-centrepiece")).toBeInTheDocument();
    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe(themeVariables(CENTRAL_STARS_THEME, "dark")["--primary"]);
  });

  it("keeps the LovePoker look for a club without a theme", async () => {
    mockDisplay(() => liveDisplayDto({ serverNow: Date.now() }));
    showPage();

    expect(await screen.findByTestId("clock-centrepiece")).toBeInTheDocument();
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe("");
  });
});
