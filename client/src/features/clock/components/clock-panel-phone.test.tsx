import { act, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clockTournamentDto,
  liveDisplayDto,
  mockClockTabReads,
  mockDisplay,
  recordClockActions,
  recordClockChanges,
  resetServerTime,
  runningClock,
  serveDisplay,
  shortStructure,
} from "@test/helpers/clock-dto";
import { screenWidth } from "@test/helpers/f1-tournaments";
import { apiError, mockSignedOut, renderWithApp } from "@test/helpers/web";
import { structureHash, type ClockStructure } from "@shared/domain/clock";
import { DEFAULT_DISPLAY_SETTINGS, type ClockConfigInput, type ClockDisplaySettings } from "@shared/api/clock";
import { ClockPanel } from "./clock-panel";
import { VOLUME_SAVE_MS } from "./public/screen-settings";

const user = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

function showPanel() {
  return renderWithApp(<ClockPanel tournament={clockTournamentDto()} />);
}

/** A browser's audio, counting the contexts made (one per Test sounds on this device). */
class FakeAudioContext {
  static made = 0;
  state = "running";
  currentTime = 0;
  destination = {};
  constructor() {
    FakeAudioContext.made += 1;
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
  createOscillator() {
    return { type: "sine", frequency: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
  }
  createGain() {
    return { gain: { value: 1, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() };
  }
  createDynamicsCompressor() {
    return { threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 }, attack: { value: 0 }, release: { value: 0 }, connect: vi.fn() };
  }
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  resetServerTime();
  mockSignedOut();
  mockClockTabReads();
  FakeAudioContext.made = 0;
  // jsdom has no AudioContext: defined here, and deleted after each test.
  Object.defineProperty(window, "AudioContext", { configurable: true, writable: true, value: FakeAudioContext });
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(window, "AudioContext");
});

describe("the Clock tab on a phone, 390 px wide (round 5, items 10 and 17)", () => {
  beforeEach(() => screenWidth(390));

  it("runs the clock from one hand: Start / Pause the width of the screen, then Previous and Next, a minute either way, Undo", async () => {
    serveDisplay({ clock: runningClock(Date.now(), { levelIndex: 1 }) });
    const sent = recordClockActions(() => liveDisplayDto({ clock: runningClock(Date.now(), { levelIndex: 2 }) }));
    showPanel();

    const controls = await screen.findByTestId("clock-phone-controls");
    const pause = within(controls).getByRole("button", { name: "Pause" });
    // The main button the width of the screen; every target's 44 px is measured in a browser (test/e2e/touch-targets.spec.ts).
    expect(pause).toHaveClass("w-full");
    for (const name of ["Previous", "Next", "−1 min", "+1 min", "More clock actions"]) expect(within(controls).getByRole("button", { name })).toBeInTheDocument();
    expect(within(controls).getByTestId("clock-undo")).toBeInTheDocument();

    await user().click(within(controls).getByRole("button", { name: "Next" }));
    await vi.waitFor(() => expect(sent).toEqual([{ action: "next", expectedLevelIndex: 1 }]));
  });

  it("keeps the rarer actions in More: set the time, go to a level, reset and remove, each asked first", async () => {
    serveDisplay({ clock: runningClock(Date.now(), { levelIndex: 1 }) });
    const sent = recordClockActions(() => liveDisplayDto({ clock: runningClock(Date.now(), { levelIndex: 3 }) }));
    showPanel();
    const keys = user();

    await keys.click(await screen.findByRole("button", { name: "More clock actions" }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Set time…", "Go to a level…", "Reset clock…", "Remove clock…"]);
    await keys.click(within(menu).getByRole("menuitem", { name: "Go to a level…" }));
    const dialog = await screen.findByRole("dialog", { name: "Go to a level" });
    await keys.selectOptions(within(dialog).getByLabelText("Jump to level"), "Break · Colour up");
    await keys.click(within(dialog).getByRole("button", { name: "Go to level" }));
    await vi.waitFor(() => expect(sent).toEqual([{ action: "jump", levelIndex: 3, expectedLevelIndex: 1 }]));
    await vi.waitFor(() => expect(screen.queryByRole("dialog", { name: "Go to a level" })).not.toBeInTheDocument());

    await keys.click(screen.getByRole("button", { name: "More clock actions" }));
    await keys.click(await screen.findByRole("menuitem", { name: "Reset clock…" }));
    expect(await screen.findByRole("alertdialog", { name: "Reset the clock?" })).toBeInTheDocument();
  });

  it("opens the structure, the TV's settings and early birds each in a sheet of its own, the whole screen", async () => {
    serveDisplay({ clock: runningClock(Date.now(), { levelIndex: 1 }) });
    showPanel();
    const keys = user();

    await keys.click(await screen.findByRole("button", { name: /^Edit the blind structure/ }));
    const structure = await screen.findByRole("dialog", { name: "Blind structure" });
    expect(structure).toHaveClass("w-full");
    expect(within(structure).getByRole("form", { name: "Blind structure" })).toBeInTheDocument();
    expect(within(structure).getByTestId("level-row-0")).toBeInTheDocument();
    await keys.click(within(structure).getByRole("button", { name: "Close" }));

    await keys.click(screen.getByRole("button", { name: /^TV display/ }));
    const tv = await screen.findByRole("dialog", { name: "TV display" });
    expect(within(tv).getByLabelText("Show the prize pool")).toBeInTheDocument();
    await keys.click(within(tv).getByRole("button", { name: "Test sounds on this device" }));
    expect(FakeAudioContext.made).toBe(1);
    await keys.click(within(tv).getByRole("button", { name: "Close" }));

    await keys.click(screen.getByRole("button", { name: /^Early birds/ }));
    expect(await screen.findByRole("dialog", { name: "Early birds" })).toBeInTheDocument();
  });
});

describe("the TV's settings from a phone, 390 px wide (round 5, items 20–26)", () => {
  beforeEach(() => screenWidth(390));

  /** The display as the server keeps it: each change the sheet sends is stored and answered. */
  function serveSettings() {
    let settings: ClockDisplaySettings = { ...DEFAULT_DISPLAY_SETTINGS };
    const now = Date.now();
    const display = () => liveDisplayDto({ serverNow: Date.now(), clock: runningClock(now, { levelIndex: 1, displaySettings: settings }) });
    mockDisplay(display);
    const sent = recordClockChanges(({ body }) => {
      settings = { ...settings, ...(body as Partial<ClockDisplaySettings>) };
      return display();
    });
    return () => sent.map((request) => request.body);
  }

  async function openTvSheet() {
    const keys = user();
    await keys.click(await screen.findByRole("button", { name: /^TV display/ }));
    return { keys, tv: await screen.findByRole("dialog", { name: "TV display" }) };
  }

  it("shows the core set by default, and switches each other figure on for the TV", async () => {
    const sent = serveSettings();
    showPanel();
    const { keys, tv } = await openTvSheet();

    const figures = within(tv).getByRole("group", { name: "More on the TV" });
    for (const name of ["Level number (LEVEL 3)", "Entries", "Re-buys", "Add-ons", "Early birds", "Chips in play", "Tables", "Time left to re-buy (Re-buys close in …)"]) {
      expect(within(figures).getByRole("switch", { name })).not.toBeChecked();
    }
    expect(within(tv).getByRole("switch", { name: "Show the average stack" })).toBeChecked();

    await keys.click(within(figures).getByRole("switch", { name: "Early birds" }));
    await vi.waitFor(() => expect(within(figures).getByRole("switch", { name: "Early birds" })).toBeChecked());
    await keys.click(within(figures).getByRole("switch", { name: "Level number (LEVEL 3)" }));
    await vi.waitFor(() => expect(sent()).toEqual([{ showEarlyBirds: true }, { showLevel: true }]));
  });

  it("switches the chips in play on and off by themselves, whether or not the average stack is shown", async () => {
    const sent = serveSettings();
    showPanel();
    const { keys, tv } = await openTvSheet();

    await keys.click(within(tv).getByRole("switch", { name: "Show the average stack" }));
    await vi.waitFor(() => expect(within(tv).getByRole("switch", { name: "Show the average stack" })).not.toBeChecked());
    const chips = within(tv).getByRole("switch", { name: "Chips in play" });
    expect(chips).toBeEnabled();
    await keys.click(chips);
    await vi.waitFor(() => expect(sent()).toEqual([{ showAverageStack: false }, { showChipsInPlay: true }]));
  });

  it("sets the TV's sounds and edge margin for the tournament, and tests the sounds here at that volume", async () => {
    const sent = serveSettings();
    showPanel();
    const { keys, tv } = await openTvSheet();

    const sounds = within(tv).getByRole("group", { name: "Sounds" });
    for (const name of ["One minute left (alarm)", "The last 10 seconds (beeps)", "A new level (blinds up)", "A break starting and ending"]) {
      expect(within(sounds).getByRole("switch", { name })).toBeChecked();
    }
    await keys.click(within(sounds).getByRole("switch", { name: "One minute left (alarm)" }));
    await vi.waitFor(() => expect(within(sounds).getByRole("switch", { name: "One minute left (alarm)" })).not.toBeChecked());

    const volume = within(sounds).getByRole("slider", { name: "Volume" });
    expect(volume).toHaveValue("80");
    fireEvent.change(volume, { target: { value: "65" } });
    fireEvent.change(volume, { target: { value: "50" } });
    await act(() => vi.advanceTimersByTimeAsync(VOLUME_SAVE_MS + 50));

    expect(within(tv).getByRole("radio", { name: "2.5%" })).toBeChecked();
    await keys.click(within(tv).getByRole("radio", { name: "None" }));
    await vi.waitFor(() => expect(within(tv).getByRole("radio", { name: "None" })).toBeChecked());
    expect(sent()).toEqual([{ soundMinute: false }, { soundVolume: 0.5 }, { edgeMargin: 0 }]);

    await keys.click(within(sounds).getByRole("button", { name: "Test sounds on this device" }));
    expect(FakeAudioContext.made).toBe(1);
  });
});

describe("Change the rest of the structure (round 5, item 3)", () => {
  const structure = shortStructure();

  async function openSheet() {
    const keys = user();
    await keys.click(await screen.findByRole("button", { name: /^Change the rest of the structure/ }));
    return { keys, sheet: await screen.findByRole("dialog", { name: "Change the rest of the structure" }) };
  }

  it("previews every later level beside what it was, and saves through the editor's save with the structure's hash", async () => {
    screenWidth(390);
    serveDisplay({ clock: runningClock(Date.now(), { levelIndex: 1 }) });
    const sent = recordClockChanges((request) => {
      const body = request.body as ClockConfigInput;
      return liveDisplayDto({ clock: runningClock(Date.now(), { levelIndex: 1, structure: body.structure, structureHash: structureHash(body.structure) }) });
    });
    showPanel();
    const { keys, sheet } = await openSheet();

    expect(within(sheet).getByTestId("rest-from")).toHaveTextContent("The clock is on Level 2. Changes start with Level 3.");
    const save = screen.getByRole("button", { name: "Save the new levels" });
    expect(save).toBeDisabled();

    await keys.click(within(sheet).getByRole("switch", { name: "Same length for every later level" }));
    const minutes = within(sheet).getByLabelText("Minutes per level");
    expect(minutes).toHaveValue("20");
    expect(minutes).toHaveAttribute("inputmode", "numeric");
    for (let i = 0; i < 5; i++) await keys.click(within(sheet).getByRole("button", { name: "Fewer minutes per level" }));
    expect(minutes).toHaveValue("15");

    const preview = within(sheet).getByTestId("rest-preview");
    expect(within(preview).getAllByRole("listitem").map((row) => row.textContent)).toEqual([
      "Level 3400/800 · BB ante 800 · 15 minWas 400/800 · BB ante 800 · 20 min",
      "Break10 min · Colour up",
      "Level 4500/1,000 · BB ante 1,000 · 15 min",
    ]);
    expect(save).toBeEnabled();
    await keys.click(save);

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    const body = sent[0].body as ClockConfigInput;
    expect(body.baseHash).toBe(structureHash(structure));
    expect(body.presetKey).toBeNull();
    // Played levels and the one on the clock are as they were.
    expect(body.structure.levels.slice(0, 2)).toEqual(structure.levels.slice(0, 2));
    expect(body.structure.levels.map((level) => level.durationMinutes)).toEqual([20, 20, 15, 10, 15]);
    expect(await screen.findByText("Rest of the structure changed")).toBeInTheDocument();
    await vi.waitFor(() => expect(screen.queryByRole("dialog", { name: "Change the rest of the structure" })).not.toBeInTheDocument());
  });

  it("regenerates the later blinds with a tap of the multiplier, and says what is wrong with a typed one", async () => {
    screenWidth(390);
    serveDisplay({ clock: runningClock(Date.now(), { levelIndex: 1 }) });
    showPanel();
    const { keys, sheet } = await openSheet();

    await keys.click(within(sheet).getByRole("radio", { name: /^Work out new blinds/ }));
    expect(within(sheet).getByText("Rising from 300/600 (Level 2)")).toBeInTheDocument();
    await keys.click(within(sheet).getByRole("button", { name: "×2" }));
    expect(within(sheet).getByRole("button", { name: "×2" })).toHaveAttribute("aria-pressed", "true");
    expect(within(within(sheet).getByTestId("rest-preview")).getAllByRole("listitem")[0]).toHaveTextContent("Level 3600/1,200");

    await keys.click(within(sheet).getByRole("button", { name: "Custom" }));
    const custom = within(sheet).getByLabelText("Custom increase");
    expect(custom).toHaveAttribute("inputmode", "decimal");
    await keys.clear(custom);
    await keys.type(custom, "9");
    expect(within(sheet).getByText("Choose an increase between ×1.05 and ×3")).toBeInTheDocument();
    expect(within(sheet).queryByTestId("rest-preview")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save the new levels" })).toBeDisabled();
  });

  it("says when someone else edited the structure first, keeps the sheet open and previews from theirs", async () => {
    screenWidth(390);
    serveDisplay({ clock: runningClock(Date.now(), { levelIndex: 1 }) });
    const theirs: ClockStructure = { ...structure, levels: structure.levels.map((level) => (level.id === "l4" ? { ...level, durationMinutes: 25 } : level)) };
    recordClockChanges(() =>
      apiError(409, "STRUCTURE_CHANGED", "Someone else changed the structure", {
        display: liveDisplayDto({ clock: runningClock(Date.now(), { levelIndex: 1, structure: theirs, structureHash: structureHash(theirs) }) }),
      }),
    );
    showPanel();
    const { keys, sheet } = await openSheet();
    await keys.click(within(sheet).getByRole("radio", { name: "No more breaks" }));
    await keys.click(screen.getByRole("button", { name: "Save the new levels" }));

    expect(await screen.findByText("Someone else edited the structure — reloaded")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Change the rest of the structure" })).toBeInTheDocument();
    expect(within(sheet).getByText("The structure was changed on another device: the preview shows it as it is now.")).toBeInTheDocument();
    expect(within(within(sheet).getByTestId("rest-preview")).getAllByRole("listitem")[1]).toHaveTextContent("Level 4500/1,000 · BB ante 1,000 · 25 min");
  });

  it("is offered from the structure card on a larger screen", async () => {
    serveDisplay({ clock: runningClock(Date.now(), { levelIndex: 1 }) });
    showPanel();
    await user().click(await screen.findByRole("button", { name: "Change the rest…" }));
    expect(await screen.findByRole("dialog", { name: "Change the rest of the structure" })).toBeInTheDocument();
  });
});
