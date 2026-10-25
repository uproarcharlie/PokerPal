import { describe, expect, it } from "vitest";
import { clockDto, liveDisplayDto, runningClock, shortStructure } from "@test/helpers/clock-dto";
import { DEFAULT_DISPLAY_SETTINGS } from "@shared/api/clock";
import { deriveClock } from "@shared/domain/clock";
import { clockStateOf } from "../../hooks";
import { chipText } from "../clock-status-chip";
import { parseClockTime } from "../set-time-dialog";
import { centreText, NOT_SET_UP_LINE } from "./centre-piece";
import { breakNote, breakText, nextText, periodName, periodTitle, statusWord, timerTemplate, timerTone } from "./clock-face";
import { displayTiles, rebuyWindowName } from "./display-stats";
import { qrCaption } from "./display-qr";

const NOW = Date.parse("2026-10-23T08:00:00.000Z");

/** Every optional figure switched on. */
const EVERY_FIGURE = {
  ...DEFAULT_DISPLAY_SETTINGS,
  showRebuyWindow: true,
  showEntries: true,
  showRebuys: true,
  showAddons: true,
  showEarlyBirds: true,
  showChipsInPlay: true,
  showTables: true,
};
const derivedAt = (index: number, overrides = {}) => {
  const clock = runningClock(NOW, { levelIndex: index, remainingMs: 90_000, ...overrides });
  const derived = deriveClock(clockStateOf(clock), clock.structure.levels, NOW);
  if (!derived) throw new Error("no levels");
  return derived;
};

describe("the clock's words", () => {
  it("heads a level by its number and every break with Break, its note under it (TDN2-BREAK-WORD-MISSING)", () => {
    expect(periodTitle(derivedAt(2))).toBe("Level 3");
    expect(breakNote(derivedAt(2))).toBeNull();
    expect(periodTitle(derivedAt(3))).toBe("Break");
    expect(breakNote(derivedAt(3))).toBe("Colour up");
    expect(periodName(derivedAt(3))).toBe("Break · Colour up");
    const noNote = shortStructure();
    noNote.levels[3] = { kind: "break", id: "b1", durationMinutes: 10, note: null };
    expect(periodTitle(derivedAt(3, { structure: noNote }))).toBe("Break");
    expect(periodName(derivedAt(3, { structure: noNote }))).toBe("Break");
  });

  it("says what comes next, with its ante in the structure's own words", () => {
    const { anteMode, levels } = shortStructure();
    expect(nextText(levels[1], { anteMode })).toBe("300/600");
    expect(nextText(levels[2], { anteMode })).toBe("400/800 · BB ante 800");
    expect(nextText(levels[2], { anteMode: "everyone" })).toBe("400/800 · Ante 800");
    expect(nextText(levels[3], { anteMode })).toBe("Break (10 min)");
    expect(nextText(null, { anteMode })).toBeNull();
  });

  it("names a clock that is not counting down", () => {
    const at = (status: "idle" | "paused" | "finished") => deriveClock(clockStateOf(clockDto({ status })), shortStructure().levels, NOW);
    expect(statusWord(at("idle")!)).toBe("Not started");
    expect(statusWord(at("paused")!)).toBe("Paused");
    expect(statusWord(at("finished")!)).toBe("Finished");
    expect(statusWord(derivedAt(1))).toBeNull();
    const last = runningClock(NOW, { levelIndex: 4, remainingMs: 0 });
    expect(statusWord(deriveClock(clockStateOf(last), last.structure.levels, NOW)!)).toBe("Final level");
  });

  it("says the time to the break, how long until play resumes on one, or that none is left (round 5, item 21)", () => {
    // Level 3 with 1:30 left; the break follows it.
    expect(breakText(derivedAt(2))).toBe("Break in 1:30");
    // Level 1 with 1:30 left, then two 20-minute levels.
    expect(breakText(derivedAt(0))).toBe("Break in 41:30");
    expect(breakText(derivedAt(3))).toBe("Break — back in 1:30");
    expect(breakText(derivedAt(4))).toBe("No more breaks");
  });

  it("sizes the countdown for the widest it gets on the level, so it never jumps as the minutes go down", () => {
    expect(timerTemplate(derivedAt(2))).toBe("00:00");
    expect(timerTemplate(derivedAt(2, { remainingMs: 2 * 60 * 60_000 }))).toBe("0:00:00");
  });

  it("turns the countdown amber for the last minute and red for the last ten seconds of a level (round 5, item 20)", () => {
    expect(timerTone(derivedAt(2, { remainingMs: 61_000 }))).toBe("plain");
    expect(timerTone(derivedAt(2, { remainingMs: 60_000 }))).toBe("final-minute");
    expect(timerTone(derivedAt(2, { remainingMs: 10_000 }))).toBe("final-seconds");
    expect(timerTone(derivedAt(3, { remainingMs: 5_000 }))).toBe("break");
    const paused = deriveClock(clockStateOf(clockDto({ status: "paused", pausedRemainingMs: 5_000 })), shortStructure().levels, NOW);
    expect(timerTone(paused!)).toBe("paused");
  });

  it("puts the header chip in a few characters", () => {
    expect(chipText(derivedAt(2))).toBe("L3 · 1:30 · 400/800");
    expect(chipText(derivedAt(3))).toBe("Break · 1:30");
  });

  it("captions the QR code by where it leads", () => {
    const season = { id: "s1", name: "Winter 2026" };
    expect(qrCaption({ target: "season", path: "/season/s1" }, season)).toBe("Scan for the Winter 2026 leaderboard");
    expect(qrCaption({ target: "tournament", path: "/tournament/t1" }, null)).toBe("Scan for live results");
    expect(qrCaption({ target: "seats", path: "/tournament/t1/seats" }, season)).toBe("Find your seat");
  });

  it("names the re-buy window by what the tournament sells", () => {
    expect(rebuyWindowName({ offersRebuys: true, offersAddons: true })).toBe("Re-buys & add-ons");
    expect(rebuyWindowName({ offersRebuys: true, offersAddons: false })).toBe("Re-buys");
    expect(rebuyWindowName({ offersRebuys: false, offersAddons: true })).toBe("Add-ons");
    expect(rebuyWindowName({ offersRebuys: false, offersAddons: false })).toBeNull();
  });

  it("shows only the core figures by default: the players left of those who entered and the average stack (round 5, items 25 and 26)", () => {
    const display = liveDisplayDto({ stats: { rebuys: 3, addons: 2, earlyBirds: 12, activeTables: 3 }, tournament: { offersRebuys: true, offersAddons: true, rebuyPeriodMinutes: 135 } });
    expect(displayTiles(display, derivedAt(2), DEFAULT_DISPLAY_SETTINGS).map((tile) => [tile.label, tile.value, tile.detail])).toEqual([
      ["Players", "18 / 20", undefined],
      ["Average stack", "88,889", "111.1 BB"],
    ]);
  });

  it("lists every figure the TD switched on, in the order the screen gives them room: the re-buy countdown, then the rest", () => {
    const display = liveDisplayDto({ stats: { rebuys: 3, addons: 2, earlyBirds: 12, activeTables: 3 }, tournament: { offersRebuys: true, offersAddons: true, rebuyPeriodMinutes: 135 } });
    const tiles = displayTiles(display, derivedAt(2), EVERY_FIGURE);
    expect(tiles.map((tile) => [tile.label, tile.value, tile.detail])).toEqual([
      ["Players", "18 / 20", undefined],
      ["Average stack", "88,889", "111.1 BB"],
      // Level 3 with 1:30 left is 58:30 into the clock: 76:30 to 135 minutes.
      ["Re-buys & add-ons close in", "1:16:30", undefined],
      ["Entries", "23", undefined],
      ["Re-buys", "3", undefined],
      ["Add-ons", "2", undefined],
      ["Early birds", "12", undefined],
      ["Chips in play", "1,600,000", undefined],
      ["Tables", "3", undefined],
    ]);
    // The entries name their re-buys while the re-buys have no tile of their own.
    expect(displayTiles(display, derivedAt(2), { ...DEFAULT_DISPLAY_SETTINGS, showEntries: true }).find((tile) => tile.label === "Entries")?.detail).toBe("incl. 3 re-buys");
  });

  it("says when the re-buys have closed, by the window's name, and leaves out what is not there", () => {
    const display = liveDisplayDto({ stats: { totalChips: null, averageStack: null }, tournament: { offersRebuys: true, rebuyPeriodMinutes: 30 } });
    expect(displayTiles(display, derivedAt(2), EVERY_FIGURE).map((tile) => [tile.label, tile.value])).toEqual([
      ["Players", "18 / 20"],
      ["Re-buys window", "Closed"],
      ["Entries", "20"],
      ["Re-buys", "0"],
    ]);
  });
});

describe("the words under the logo when it is the centrepiece (round 5, item 24)", () => {
  const idle = (overrides = {}) => deriveClock(clockStateOf(clockDto({ status: "idle", ...overrides })), shortStructure().levels, NOW);

  it("say Starting soon before the clock starts, with the first blinds", () => {
    expect(centreText(liveDisplayDto(), idle())).toEqual({ headline: "Starting soon", status: null, timer: null, note: null, lines: [{ text: "First blinds: 200/400" }], action: false });
  });

  it("put the break's countdown under Break — back in, with its note and what comes next, and PAUSED when it is paused", () => {
    expect(centreText(liveDisplayDto(), derivedAt(3))).toEqual({
      headline: "Break — back in",
      status: null,
      timer: "00:00",
      note: "Colour up",
      lines: [{ text: "Next: 500/1,000 · BB ante 1,000" }],
      action: false,
    });
    const paused = deriveClock(clockStateOf(clockDto({ status: "paused", currentLevelIndex: 3, pausedRemainingMs: 4 * 60_000 })), shortStructure().levels, NOW);
    expect(centreText(liveDisplayDto(), paused)?.status).toBe("Paused");
  });

  it("say why there is no clock: not set up (Starting soon until the game is under way), complete with its results, cancelled", () => {
    expect(centreText(liveDisplayDto({ clock: null, tournament: { status: "registration" } }), null)).toMatchObject({ headline: "Starting soon", lines: [{ text: NOT_SET_UP_LINE, wrap: true }] });
    expect(centreText(liveDisplayDto({ clock: null }), null)?.headline).toBe("Clock not set up yet");
    expect(centreText(liveDisplayDto({ tournament: { status: "completed" } }), derivedAt(2))).toMatchObject({ headline: "Tournament complete", action: true });
    expect(centreText(liveDisplayDto({ tournament: { status: "cancelled" } }), derivedAt(2))?.headline).toBe("This tournament was cancelled");
  });

  it("leave the clock in play alone: a running or paused level is the clock's own face", () => {
    expect(centreText(liveDisplayDto(), derivedAt(2))).toBeNull();
    const paused = deriveClock(clockStateOf(clockDto({ status: "paused", currentLevelIndex: 1, pausedRemainingMs: 60_000 })), shortStructure().levels, NOW);
    expect(centreText(liveDisplayDto(), paused)).toBeNull();
  });
});

describe("parseClockTime", () => {
  it("reads minutes, minutes and seconds, or hours, minutes and seconds", () => {
    expect(parseClockTime("12")).toBe(720);
    expect(parseClockTime(" 12:30 ")).toBe(750);
    expect(parseClockTime("0:05")).toBe(5);
    expect(parseClockTime("1:02:30")).toBe(3750);
  });

  it("refuses anything else", () => {
    for (const text of ["", "12:60", "1:60:00", "a:10", "1:2:3:4", "-5", "12.5"]) expect(parseClockTime(text)).toBeNull();
  });
});
