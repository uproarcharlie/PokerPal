import { describe, expect, it } from "vitest";
import { DEFAULT_DISPLAY_SETTINGS } from "@shared/api/clock";
import { screenPrefsOf } from "./screen-prefs";

describe("a clock screen's sound and edge margin (round 5, items 20 and 22)", () => {
  it("are the tournament's TV display settings: by default every sound at 80% and a 2.5% margin on a TV", () => {
    expect(screenPrefsOf(DEFAULT_DISPLAY_SETTINGS, false)).toEqual({
      volume: 0.8,
      cues: { minute: true, countdown: true, level: true, break: true },
      edgeMargin: 2.5,
      applied: 2.5,
    });
  });

  it("follow what the TD chose for the tournament", () => {
    const chosen = { ...DEFAULT_DISPLAY_SETTINGS, soundVolume: 0.35, soundMinute: false, soundBreak: false, edgeMargin: 5 as const };
    expect(screenPrefsOf(chosen, false)).toEqual({ volume: 0.35, cues: { minute: false, countdown: true, level: true, break: false }, edgeMargin: 5, applied: 5 });
  });

  it("keep no margin on a phone or a tablet, which never crops its picture, while knowing the TV's", () => {
    expect(screenPrefsOf({ ...DEFAULT_DISPLAY_SETTINGS, edgeMargin: 5 }, true)).toMatchObject({ edgeMargin: 5, applied: 0 });
  });

  it("are the defaults while there is no clock", () => {
    expect(screenPrefsOf(null, false)).toEqual(screenPrefsOf(DEFAULT_DISPLAY_SETTINGS, false));
  });
});
