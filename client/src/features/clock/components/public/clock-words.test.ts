import { describe, expect, it } from "vitest";
import { clockDto, liveDisplayDto, runningClock, shortStructure } from "@test/helpers/clock-dto";
import { deriveClock } from "@shared/domain/clock";
import { clockStateOf } from "../../hooks";
import { chipText } from "../clock-status-chip";
import { parseClockTime } from "../set-time-dialog";
import { breakNote, nextText, periodName, periodTitle, statusWord } from "./clock-face";
import { displayTiles, rebuyWindowName } from "./display-stats";
import { qrCaption } from "./display-qr";

const NOW = Date.parse("2026-10-23T08:00:00.000Z");
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

  it("lists the room's figures, the average in big blinds of the level being played", () => {
    const display = liveDisplayDto({ stats: { rebuys: 3, addons: 2, earlyBirds: 12, activeTables: 3 }, tournament: { offersRebuys: true, offersAddons: true, rebuyPeriodMinutes: 135 } });
    const tiles = displayTiles(display, derivedAt(2));
    expect(tiles.map((tile) => [tile.label, tile.value, tile.detail])).toEqual([
      ["Players", "18 / 20", undefined],
      ["Entries", "23", "incl. 3 re-buys"],
      ["Add-ons", "2", undefined],
      ["Early birds", "12", undefined],
      ["Average stack", "88,889", "111.1 BB"],
      ["Chips in play", "1,600,000", undefined],
      ["Tables", "3", undefined],
      // Level 3 with 1:30 left is 58:30 into the clock: 76:30 to 135 minutes.
      ["Re-buys & add-ons close in", "1:16:30", undefined],
    ]);
  });

  it("says when the re-buys have closed, and leaves out what is not there", () => {
    const display = liveDisplayDto({ stats: { totalChips: null, averageStack: null }, tournament: { offersRebuys: true, rebuyPeriodMinutes: 30 } });
    expect(displayTiles(display, derivedAt(2)).map((tile) => [tile.label, tile.value])).toEqual([
      ["Players", "18 / 20"],
      ["Entries", "20"],
      ["Re-buys", "Closed"],
    ]);
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
