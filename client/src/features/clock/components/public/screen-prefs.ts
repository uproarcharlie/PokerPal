/**
 * What a clock screen plays and keeps clear (round 5, items 20 and 22): how loud, which sounds, and
 * the edge margin for a TV that crops its picture's edges (overscan). They are the tournament's TV
 * display settings, set by the club's staff on the Clock tab or on the TV itself, so every screen
 * showing the clock follows the same choice and the TD can change it from their phone. Only muting is
 * the screen's own (use-clock-sound). A phone or a tablet never crops its picture: it keeps no margin.
 */
import type { ClockDisplaySettings } from "@shared/api/clock";
import { DEFAULT_EDGE_MARGIN, DEFAULT_SOUND_VOLUME, type EdgeMargin } from "@shared/domain/clock";
import type { CueSettings } from "./clock-cues";

export interface ScreenPrefs {
  /** 0–1. */
  volume: number;
  cues: CueSettings;
  /** The tournament's margin for its TVs. */
  edgeMargin: EdgeMargin;
  /** What this screen keeps clear: the tournament's margin on a TV, none on a handheld. */
  applied: EdgeMargin;
}

export type ScreenSettings = Pick<ClockDisplaySettings, "soundVolume" | "soundMinute" | "soundCountdown" | "soundLevel" | "soundBreak" | "edgeMargin">;

/** The screen's settings from the clock's (the defaults while there is no clock: nothing sounds then). */
export function screenPrefsOf(settings: ScreenSettings | null, handheld: boolean): ScreenPrefs {
  const edgeMargin = settings?.edgeMargin ?? DEFAULT_EDGE_MARGIN;
  return {
    volume: settings?.soundVolume ?? DEFAULT_SOUND_VOLUME,
    cues: {
      minute: settings?.soundMinute ?? true,
      countdown: settings?.soundCountdown ?? true,
      level: settings?.soundLevel ?? true,
      break: settings?.soundBreak ?? true,
    },
    edgeMargin,
    applied: handheld ? 0 : edgeMargin,
  };
}
