import { useState } from "react";
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clockDto,
  clockTournamentDto,
  liveDisplayDto,
  mockClockTabReads,
  mockDisplay,
  pausedClock,
  recordClockActions,
  recordClockChanges,
  resetServerTime,
  runningClock,
  serveDisplay,
  shortStructure,
  undoDto,
} from "@test/helpers/clock-dto";
import { registrationDto, VISITOR_VIEW } from "@test/helpers/dto";
import { recordRequests } from "@test/helpers/requests";
import { apiError, mockSignedOut, renderWithApp } from "@test/helpers/web";
import { server } from "@test/msw/server";
import { presetStructure } from "@shared/domain/blind-structures";
import { structureHash } from "@shared/domain/clock";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { ClockPanel } from "./clock-panel";
import type { ClockOpenRequest } from "./clock-status-chip";
import { qrDestination } from "./display-settings-card";

const user = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

function showPanel(tournament: TournamentDetailDto = clockTournamentDto()) {
  return renderWithApp(<ClockPanel tournament={tournament} />);
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  resetServerTime();
  mockSignedOut();
  mockClockTabReads();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ClockPanel without a clock", () => {
  it("says it is loading until the clock comes", async () => {
    mockDisplay(async () => {
      await delay(200);
      return liveDisplayDto({ serverNow: Date.now(), clock: null });
    });
    showPanel();
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    expect(await screen.findByRole("heading", { name: "Set up the clock" })).toBeInTheDocument();
  });

  it("sets the clock up from Central Stars' preset, listed first", async () => {
    serveDisplay({ clock: null, tournament: { status: "registration" } });
    const sent = recordClockChanges(() =>
      liveDisplayDto({ clock: clockDto({ structure: presetStructure("central_stars_one_life_line"), presetKey: "central_stars_one_life_line" }), tournament: { status: "registration" } }),
    );
    showPanel();

    expect(await screen.findByRole("heading", { name: "Set up the clock" })).toBeInTheDocument();
    const presets = screen.getAllByTestId(/^preset-/);
    expect(presets[0]).toHaveTextContent("Central Stars · One Life Line");
    expect(presets[0]).toHaveTextContent("One life line: one $25 re-buy or one $25 add-on (120,000), not both");

    await user().click(screen.getByRole("button", { name: "Use this: Central Stars · One Life Line" }));
    await vi.waitFor(() =>
      expect(sent).toEqual([
        {
          method: "PUT",
          path: "/api/tournaments/t1/clock",
          body: { structure: presetStructure("central_stars_one_life_line"), presetKey: "central_stars_one_life_line", baseHash: null },
        },
      ]),
    );
    expect(await screen.findByText("Clock set up")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Blind structure" })).toBeInTheDocument();
    expect(screen.getByText("Not started · Central Stars · One Life Line")).toBeInTheDocument();
  });

  it("shows the clock someone else set up first", async () => {
    serveDisplay({ clock: null });
    recordClockChanges(() => apiError(409, "CLOCK_EXISTS", "The clock is already set up", { display: liveDisplayDto({ clock: clockDto() }) }));
    showPanel();

    await user().click(await screen.findByRole("button", { name: "Use this: Turbo · 10-minute levels" }));
    expect(await screen.findByText("The clock was already set up")).toBeInTheDocument();
    expect(await screen.findByTestId("clock-face")).toBeInTheDocument();
  });

  it("copies the structure of an earlier game, leaving this one out", async () => {
    const earlier = shortStructure({ startingStack: 50_000 });
    mockClockTabReads({
      structures: [
        { tournamentId: "t1", tournamentName: "This game", startDateTime: "2026-10-23T07:00:00.000Z", presetKey: null, structure: shortStructure(), structureHash: "aaaaaaaa" },
        { tournamentId: "t0", tournamentName: "Last Friday", startDateTime: "2026-10-16T07:00:00.000Z", presetKey: null, structure: earlier, structureHash: structureHash(earlier) },
      ],
    });
    serveDisplay({ clock: null });
    const sent = recordClockChanges(() => liveDisplayDto({ clock: clockDto({ structure: earlier }) }));
    showPanel();

    const game = await screen.findByRole("combobox", { name: "Game" });
    expect(within(game).getAllByRole("option").map((option) => option.textContent)).toEqual([expect.stringMatching(/^Last Friday · .* · 4 levels · from 200\/400 · 1 h 25 min$/)]);
    await user().click(screen.getByRole("button", { name: "Copy this structure" }));
    await vi.waitFor(() => expect(sent[0]?.body).toEqual({ structure: earlier, presetKey: null, baseHash: null }));
  });

  it("says there is no clock to anyone who cannot set one up", async () => {
    serveDisplay({ clock: null });
    showPanel(clockTournamentDto({ viewer: VISITOR_VIEW }));
    expect(await screen.findByRole("heading", { name: "No clock yet" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Set up the clock" })).not.toBeInTheDocument();
  });

  it("offers to try again when the clock could not be loaded", async () => {
    let fail = true;
    mockDisplay(() => (fail ? apiError(500, "INTERNAL", "Something broke") : liveDisplayDto({ clock: null, serverNow: Date.now() })));
    showPanel();
    expect(await screen.findByRole("heading", { name: "The clock could not be loaded" })).toBeInTheDocument();
    fail = false;
    await user().click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Set up the clock" })).toBeInTheDocument();
  });
});

describe("ClockPanel controls", () => {
  const paused = (overrides: Parameters<typeof pausedClock>[0] = {}) => pausedClock({ levelIndex: 1, remainingMs: 8 * 60_000, ...overrides });

  it("shows the clock, its chip figures and the TV links", async () => {
    serveDisplay({ clock: paused() });
    showPanel();

    expect(await screen.findByRole("heading", { name: "Level 2" })).toBeInTheDocument();
    expect(screen.getByRole("timer", { name: "Time left" })).toHaveTextContent("8:00");
    const chips = screen.getByTestId("chip-figures");
    expect(within(chips).getByText("Chips in play").nextSibling).toHaveTextContent("1,600,000");
    expect(within(chips).getByText("Average stack").nextSibling).toHaveTextContent("88,889(148.1 BB)");
    // The venue's screen, polled at the TV's rate even on a tablet (TDN2-TABLET-AS-PHONE).
    expect(screen.getByRole("link", { name: "Open TV display" })).toHaveAttribute("href", "/clock/t1?screen=tv");
    expect(screen.getByRole("link", { name: "Open TV display" })).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("button", { name: "Copy TV link" })).toBeInTheDocument();
  });

  it("says when the TV would close re-buys before the structure's re-buy break, and lines the two up in one tap (TDN3-REBUY-WINDOW-MISMATCH)", async () => {
    const structure = presetStructure("central_stars_one_life_line");
    // Set up from the preset on this tab: the tournament keeps the form's 60-minute re-buy period.
    let period: number | null = 60;
    mockDisplay(() =>
      liveDisplayDto({
        serverNow: Date.now(),
        tournament: { offersRebuys: true, offersAddons: true, rebuyPeriodMinutes: period },
        clock: clockDto({ structure, presetKey: "central_stars_one_life_line" }),
      }),
    );
    const updates = recordRequests(
      [["put", "/api/tournaments/t1"]],
      ({ body }) => {
        period = (body as { rebuyPeriodMinutes: number }).rebuyPeriodMinutes;
        return HttpResponse.json(clockTournamentDto({ rebuyPeriodMinutes: period }));
      },
      ({ body }) => body,
    );
    showPanel();

    const notice = await screen.findByTestId("rebuy-window-notice");
    expect(notice).toHaveTextContent("The TV closes re-buys & add-ons at another time");
    expect(notice).toHaveTextContent("break ends 2 h 15 min into the game, but the TV closes them after 1 h.");
    await user().click(within(notice).getByRole("button", { name: "Close them with the break (2 h 15 min)" }));
    await vi.waitFor(() => expect(updates).toEqual([{ rebuyPeriodMinutes: 135 }]));
    expect(await screen.findByText("Re-buys & add-ons now close at 2 h 15 min")).toBeInTheDocument();
    await vi.waitFor(() => expect(screen.queryByTestId("rebuy-window-notice")).not.toBeInTheDocument());
  });

  it("says which stack to set while the chips in play cannot be counted, and nothing once they can (P4REV4-R3-CQ-05)", async () => {
    serveDisplay({ clock: paused({ structure: { ...shortStructure(), startingStack: null } }) });
    const { unmount } = showPanel();
    const chips = await screen.findByTestId("chip-figures");
    expect(within(chips).getByText("Chips in play").nextSibling).toHaveTextContent("–");
    expect(screen.getByText("Set the starting stack in the structure to count the chips in play.")).toBeInTheDocument();
    unmount();

    serveDisplay({ clock: paused({ structure: { ...shortStructure(), addonStack: null } }), stats: { addons: 2 } });
    const { unmount: closeAddons } = showPanel();
    await screen.findByTestId("chip-figures");
    expect(screen.getByText("Set the add-on stack in the structure: add-ons have been taken.")).toBeInTheDocument();
    closeAddons();

    serveDisplay({ clock: paused() });
    showPanel();
    await screen.findByTestId("chip-figures");
    expect(screen.queryByText(/^Set the .* in the structure/)).not.toBeInTheDocument();
  });

  it("says nothing of re-buys when the TV already closes them with the break, or the tournament sells none", async () => {
    const clock = clockDto({ structure: presetStructure("central_stars_one_life_line"), presetKey: "central_stars_one_life_line" });
    serveDisplay({ tournament: { offersRebuys: true, rebuyPeriodMinutes: 135 }, clock });
    const { unmount } = showPanel();
    await screen.findByTestId("chip-figures");
    expect(screen.queryByTestId("rebuy-window-notice")).not.toBeInTheDocument();
    unmount();

    serveDisplay({ tournament: { rebuyPeriodMinutes: 60 }, clock });
    showPanel();
    await screen.findByTestId("chip-figures");
    expect(screen.queryByTestId("rebuy-window-notice")).not.toBeInTheDocument();
  });

  it("puts what the TV shows before the blind structure, which is folded away once the clock has started (TDN2-TV-CARD-BURIED)", async () => {
    serveDisplay({ clock: paused() });
    showPanel();
    const overTheClock = await screen.findByRole("combobox", { name: "Over the clock" });
    const structure = screen.getByRole("button", { name: "Show and edit the blind structure" });
    expect(overTheClock.compareDocumentPosition(structure) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(structure).toHaveAttribute("aria-expanded", "false");
  });

  it("names the change Undo takes back, sends the undo it showed, then offers to redo it (TDN2-UNDO-REDO-TRAP, R2-CQ-01)", async () => {
    const undo = undoDto();
    serveDisplay({ clock: paused({ undo }), viewer: { canControl: true } });
    const redo = undoDto({ redo: true, at: Date.now() });
    const sent = recordClockActions(() => liveDisplayDto({ clock: pausedClock({ levelIndex: 1, remainingMs: 8 * 60_000, undo: redo }), viewer: { canControl: true } }));
    showPanel();

    await user().click(await screen.findByRole("button", { name: "Undo: Moved to Level 2 (300/600)" }));
    await vi.waitFor(() => expect(sent).toEqual([{ action: "undo", expectedUndo: { at: undo.at, redo: false } }]));
    // A second tap now puts the change back, and says so before it is pressed.
    expect(await screen.findByRole("button", { name: "Redo: Moved to Level 2 (300/600)" })).toBeEnabled();
  });

  it("greys Undo out when there is nothing to undo, or the clock has moved on from the level the change left it on", async () => {
    serveDisplay({ clock: paused({ undo: undoDto({ levelIndex: 0 }) }) });
    showPanel();
    expect(await screen.findByRole("button", { name: "Undo" })).toBeDisabled();
  });

  it("sends the level on screen with Next, and the status with Resume (also starting the tournament)", async () => {
    serveDisplay({ clock: paused(), tournament: { status: "registration" } });
    const sent = recordClockActions((body) =>
      liveDisplayDto({ clock: body.action === "next" ? pausedClock({ levelIndex: 2, remainingMs: 20 * 60_000 }) : paused(), tournament: { status: "registration" } }),
    );
    showPanel();
    const keys = user();

    await keys.click(await screen.findByRole("button", { name: "Next" }));
    expect(await screen.findByRole("heading", { name: "Level 3" })).toBeInTheDocument();
    await keys.click(screen.getByRole("button", { name: "Resume" }));
    await keys.click(screen.getByRole("checkbox", { name: "Also start the tournament (status In Progress)" }));
    await keys.click(screen.getByRole("button", { name: "Resume" }));
    await vi.waitFor(() =>
      expect(sent).toEqual([
        { action: "next", expectedLevelIndex: 1 },
        { action: "toggle", alsoStartTournament: true, expectedStatus: "paused" },
        { action: "toggle", alsoStartTournament: false, expectedStatus: "paused" },
      ]),
    );
  });

  it("keeps the pressed control busy while its request runs, and the others usable", async () => {
    serveDisplay({ clock: paused() });
    server.use(
      http.post("/api/tournaments/t1/clock/actions", async () => {
        await delay(500);
        return HttpResponse.json(liveDisplayDto({ clock: paused() }));
      }),
    );
    showPanel();
    await user().click(await screen.findByRole("button", { name: "Resume" }));
    expect(screen.getByRole("button", { name: "Resume" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Next" })).not.toHaveAttribute("aria-disabled", "true");
    await act(() => vi.advanceTimersByTimeAsync(600));
    expect(screen.getByRole("button", { name: "Resume" })).not.toHaveAttribute("aria-disabled", "true");
  });

  it("shows where the clock went when another device moved it first", async () => {
    serveDisplay({ clock: paused() });
    const moved = liveDisplayDto({ clock: pausedClock({ levelIndex: 3, remainingMs: 10 * 60_000 }) });
    recordClockActions(() => apiError(409, "LEVEL_CHANGED", "The clock has moved on since you looked", { display: moved }));
    showPanel();

    await user().click(await screen.findByRole("button", { name: "Next" }));
    expect(await screen.findByText("The clock moved on — check the level")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Break" })).toBeInTheDocument();
    expect(screen.getByText("Colour up")).toBeInTheDocument();
  });

  it("says why an action was refused", async () => {
    serveDisplay({ clock: paused({ undo: undoDto() }) });
    recordClockActions(() => apiError(409, "NOTHING_TO_UNDO", "Too late to undo", { display: liveDisplayDto({ clock: paused() }) }));
    showPanel();
    await user().click(await screen.findByRole("button", { name: "Undo: Moved to Level 2 (300/600)" }));
    expect(await screen.findByText("The clock did not change")).toBeInTheDocument();
    expect(screen.getByText("Too late to undo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  });

  it("adds and takes off a minute, sets the time and jumps to a level", async () => {
    serveDisplay({ clock: paused() });
    const sent = recordClockActions(() => liveDisplayDto({ clock: paused() }));
    showPanel();
    const keys = user();

    await keys.click(await screen.findByRole("button", { name: "+1 min" }));
    await keys.click(screen.getByRole("button", { name: "−1 min" }));
    await keys.click(screen.getByRole("button", { name: "Set time…" }));
    const dialog = await screen.findByRole("dialog", { name: "Set the time left" });
    const box = within(dialog).getByRole("textbox", { name: /Time left/ });
    expect(box).toHaveValue("8:00");
    await keys.clear(box);
    await keys.type(box, "12:75");
    await keys.click(within(dialog).getByRole("button", { name: "Set time" }));
    expect(await within(dialog).findByText("Type minutes, or minutes and seconds, e.g. 12:30")).toBeInTheDocument();
    await keys.clear(box);
    await keys.type(box, "12:30");
    await keys.click(within(dialog).getByRole("button", { name: "Set time" }));
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await keys.selectOptions(screen.getByRole("combobox", { name: "Jump to level" }), "Break · Colour up");
    await keys.click(screen.getByRole("button", { name: "Go to level" }));
    await vi.waitFor(() =>
      expect(sent).toEqual([
        { action: "adjust", deltaSeconds: 60, expectedLevelIndex: 1 },
        { action: "adjust", deltaSeconds: -60, expectedLevelIndex: 1 },
        { action: "set_remaining", remainingSeconds: 750, expectedLevelIndex: 1 },
        { action: "jump", levelIndex: 3, expectedLevelIndex: 1 },
      ]),
    );
  });

  it("sets the time of the level it was opened on: when that level ends while the TD types, nothing is set and the dialog says so (P4REV1-03)", async () => {
    const start = Date.now();
    // Level 1 has 3 seconds left as the dialog opens; the clock moves on to Level 2 while the TD types.
    serveDisplay({ clock: runningClock(start, { levelIndex: 0, remainingMs: 3000 }) });
    const onLevel2 = () => liveDisplayDto({ clock: runningClock(start + 3000, { levelIndex: 1, remainingMs: 20 * 60_000 }) });
    const sent = recordClockActions((body) =>
      body.expectedLevelIndex === 1 ? onLevel2() : apiError(409, "LEVEL_CHANGED", "The clock has moved on since you looked", { display: onLevel2() }),
    );
    showPanel();
    const keys = user();
    await keys.click(await screen.findByRole("button", { name: "Set time…" }));
    const dialog = await screen.findByRole("dialog", { name: "Set the time left" });
    expect(dialog).toHaveTextContent("How long Level 1 has left");
    await act(() => vi.advanceTimersByTimeAsync(4000));
    const box = within(dialog).getByRole("textbox", { name: /Time left/ });
    await keys.clear(box);
    await keys.type(box, "12:30");
    await keys.click(within(dialog).getByRole("button", { name: "Set time" }));

    expect(await within(dialog).findByText(/The clock moved on to another level, so the time was not set/)).toBeInTheDocument();
    expect(dialog).toHaveTextContent("How long Level 2 has left");
    await keys.click(within(dialog).getByRole("button", { name: "Set time" }));
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(sent).toEqual([
      { action: "set_remaining", remainingSeconds: 750, expectedLevelIndex: 0 },
      { action: "set_remaining", remainingSeconds: 750, expectedLevelIndex: 1 },
    ]);
  });

  it("keeps the reset dialog open with the server's reason when the reset is refused (P4REV4-CQ-15)", async () => {
    serveDisplay({ clock: paused() });
    recordClockActions(() => apiError(409, "TOURNAMENT_CLOSED", "The tournament is over", { display: liveDisplayDto({ clock: paused() }) }));
    showPanel();
    const keys = user();
    await keys.click(await screen.findByRole("button", { name: "Reset clock…" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Reset the clock?" });
    await keys.click(within(dialog).getByRole("button", { name: "Reset clock" }));
    expect(await within(dialog).findByText("The tournament is over")).toBeInTheDocument();
    expect(screen.getByRole("alertdialog", { name: "Reset the clock?" })).toBeInTheDocument();
    expect(screen.queryByText("The clock did not change")).not.toBeInTheDocument();
  });

  it("brings Start / Pause into view each time the header's chip asks, and focuses it only when asked (P4REV0-PHONE-PAUSE-FOLD, TDN2-CHIP-FOCUS-SPACE)", async () => {
    serveDisplay({ clock: paused() });
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
    function WithChip() {
      const [request, setRequest] = useState<ClockOpenRequest | null>(null);
      return (
        <>
          <button type="button" onClick={() => setRequest({ focus: false })}>
            Chip clicked
          </button>
          <button type="button" onClick={() => setRequest({ focus: true })}>
            Chip from the keyboard
          </button>
          <ClockPanel tournament={clockTournamentDto()} openRequest={request} />
        </>
      );
    }
    renderWithApp(<WithChip />);
    const resume = await screen.findByRole("button", { name: "Resume" });
    expect(resume).not.toHaveFocus();
    await user().click(screen.getByRole("button", { name: "Chip clicked" }));
    await vi.waitFor(() => expect(scrolled).toHaveBeenCalledTimes(1));
    // A mouse's tap leaves focus where it was: Space would otherwise pause the room's clock unseen.
    expect(resume).not.toHaveFocus();
    await user().click(screen.getByRole("button", { name: "Chip from the keyboard" }));
    await vi.waitFor(() => expect(resume).toHaveFocus());
    expect(scrolled).toHaveBeenCalledTimes(2);
    scrolled.mockRestore();
  });

  it("resets the clock and removes it, each asked first", async () => {
    serveDisplay({ clock: paused() });
    const actions = recordClockActions(() => liveDisplayDto({ clock: clockDto() }));
    const changes = recordClockChanges(() => liveDisplayDto({ clock: null }));
    showPanel();
    const keys = user();

    await keys.click(await screen.findByRole("button", { name: "Reset clock…" }));
    const reset = await screen.findByRole("alertdialog", { name: "Reset the clock?" });
    expect(reset).toHaveTextContent("For 2 minutes, Undo brings it back to where it is now.");
    await keys.click(within(reset).getByRole("button", { name: "Reset clock" }));
    await vi.waitFor(() => expect(actions).toEqual([{ action: "reset" }]));

    await keys.click(screen.getByRole("button", { name: "Remove clock…" }));
    await keys.click(within(await screen.findByRole("alertdialog", { name: "Remove the clock?" })).getByRole("button", { name: "Remove clock" }));
    await vi.waitFor(() => expect(changes).toEqual([{ method: "DELETE", path: "/api/tournaments/t1/clock", body: undefined }]));
    expect(await screen.findByText("Clock removed")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Set up the clock" })).toBeInTheDocument();
  });

  it("is read-only for anyone who cannot manage the tournament, and once it is closed", async () => {
    serveDisplay({ clock: paused() });
    const { unmount } = showPanel(clockTournamentDto({ viewer: VISITOR_VIEW }));
    expect(await screen.findByTestId("clock-face")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resume" })).not.toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Blind structure" })).toBeInTheDocument();
    unmount();

    showPanel(clockTournamentDto({ status: "completed" }));
    expect(await screen.findByTestId("clock-face")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resume" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "TV display" })).not.toBeInTheDocument();
  });
});

describe("ClockPanel TV settings", () => {
  it("says the tournament has no season only when the season was chosen and fell back (P4REV4-CQ-08)", () => {
    const tournamentQr = { qr: { target: "tournament" as const, path: "/tournament/t1" } };
    expect(qrDestination({ ...tournamentQr, season: null }, "season")).toBe("The QR code opens this tournament's live results (it has no season).");
    expect(qrDestination({ ...tournamentQr, season: { id: "s1", name: "Winter 2026" } }, "tournament")).toBe("The QR code opens this tournament's live results.");
    expect(qrDestination({ qr: null, season: null }, "none")).toBe("The TV shows no QR code.");
  });

  it("changes what the TV shows at once, and says where the QR code leads", async () => {
    serveDisplay({ clock: clockDto() });
    const sent = recordClockChanges(({ body }) => liveDisplayDto({ clock: clockDto({ displaySettings: { ...clockDto().displaySettings, ...(body as object) } }), qr: { target: "seats", path: "/tournament/t1/seats" } }));
    showPanel();
    const keys = user();

    expect(await screen.findByText("The QR code opens the Winter 2026 leaderboard.")).toBeInTheDocument();
    await keys.selectOptions(screen.getByRole("combobox", { name: "The QR code leads to" }), "Find your seat");
    expect(await screen.findByText("The QR code opens the seat finder.")).toBeInTheDocument();
    await keys.click(screen.getByRole("switch", { name: "Show the AP" }));
    await vi.waitFor(() =>
      expect(sent.map((request) => [request.method, request.path, request.body])).toEqual([
        ["PATCH", "/api/tournaments/t1/clock/display", { qrTarget: "seats" }],
        ["PATCH", "/api/tournaments/t1/clock/display", { showAp: true }],
      ]),
    );
  });
});

describe("ClockPanel early birds", () => {
  const players = [
    registrationDto("r1", "Ann", { registrationTime: "2026-10-23T06:30:00.000Z" }),
    registrationDto("r2", "Bob", { registrationTime: "2026-10-23T06:45:00.000Z", earlyBird: true }),
    registrationDto("r3", "Cat", { registrationTime: "2026-10-23T06:50:00.000Z" }),
    registrationDto("r4", "Dan", { registrationTime: "2026-10-23T07:20:00.000Z" }),
  ];

  it("gives the bonus to everyone registered before the start, or to one player", async () => {
    mockClockTabReads({ registrations: players });
    serveDisplay({ clock: clockDto() });
    const sent = recordClockChanges(({ body }) => {
      const { registrationIds } = body as { registrationIds: string[] };
      return { changed: registrationIds, earlyBirds: 1 + registrationIds.length };
    });
    showPanel();
    const keys = user();

    expect(await screen.findByText("Early birds: 1 × 25,000")).toBeInTheDocument();
    await keys.click(await screen.findByRole("button", { name: "Give it to everyone registered before the start who has paid (2)" }));
    expect(await screen.findByText("Early-bird bonus given to 2 players")).toBeInTheDocument();
    await keys.click(screen.getByRole("checkbox", { name: /^Dan/ }));
    await vi.waitFor(() =>
      expect(sent.map((request) => request.body)).toEqual([
        { registrationIds: ["r1", "r3"], earlyBird: true },
        { registrationIds: ["r4"], earlyBird: true },
      ]),
    );
  });
});

describe("ClockPanel early birds and payment", () => {
  it("leaves out early sign-ups who have not paid, marks them, and takes a bulk give back in one tap (TDN3-EARLYBIRD-UNPAID)", async () => {
    const managed = (registration: ReturnType<typeof registrationDto>, paymentConfirmed: boolean) => ({ ...registration, paymentConfirmed });
    mockClockTabReads({
      registrations: [
        managed(registrationDto("r1", "Ann", { registrationTime: "2026-10-23T06:30:00.000Z" }), true),
        managed(registrationDto("r2", "Bob", { registrationTime: "2026-10-21T09:00:00.000Z" }), false),
        managed(registrationDto("r3", "Cat", { registrationTime: "2026-10-23T06:50:00.000Z" }), true),
      ],
    });
    serveDisplay({ clock: clockDto() });
    const sent = recordClockChanges(({ body }) => {
      const { registrationIds } = body as { registrationIds: string[] };
      return { changed: registrationIds, earlyBirds: registrationIds.length };
    });
    showPanel();
    const keys = user();

    const give = await screen.findByRole("button", { name: "Give it to everyone registered before the start who has paid (2)" });
    expect(give).toHaveAccessibleDescription("Left out: 1 player registered before the start who has not paid. Tick them once they pay.");
    expect(screen.getByRole("checkbox", { name: /^Bob\s*not paid/ })).toBeInTheDocument();
    await keys.click(give);
    const toast = within(screen.getByTestId("notifications"));
    expect(await toast.findByText("Early-bird bonus given to 2 players")).toBeInTheDocument();
    await keys.click(toast.getByRole("button", { name: "Undo" }));
    expect(await toast.findByText("Early-bird bonus taken back from 2 players")).toBeInTheDocument();
    expect(sent.map((request) => request.body)).toEqual([
      { registrationIds: ["r1", "r3"], earlyBird: true },
      { registrationIds: ["r1", "r3"], earlyBird: false },
    ]);
  });
});

describe("ClockPanel when the clock is removed elsewhere", () => {
  it("shows the setup again after the refusal", async () => {
    let removed = false;
    mockDisplay(() => liveDisplayDto({ serverNow: Date.now(), clock: removed ? null : pausedClock() }));
    recordClockActions(() => {
      removed = true;
      return HttpResponse.json({ error: "There is no clock", code: "NO_CLOCK" }, { status: 404 });
    });
    showPanel();
    await user().click(await screen.findByRole("button", { name: "Resume" }));
    expect(await screen.findByRole("heading", { name: "Set up the clock" })).toBeInTheDocument();
  });
});
