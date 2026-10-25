/**
 * The TV clock's sounds (round 5, item 20): made to cut through a noisy room. A rising two-tone alarm
 * with a minute left, a beep each of the last ten seconds (shorter, higher and louder for the last
 * three), a strong "blinds up" at 0:00, and their own chimes for a break starting and play resuming.
 * Drawn with Web Audio oscillators (no sound files to fetch, nothing a media policy blocks), each note
 * with a quick attack and a clean decay, through the tournament's volume and a compressor, so they
 * are loud without clipping. Browsers keep audio silent until the page is touched, so the screen offers
 * "Tap to enable sound" until it may play. Muting is remembered on this screen (localStorage; every
 * access guarded: private windows refuse it).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_SOUND_VOLUME } from "@shared/domain/clock";

export const SOUND_PREFERENCE_KEY = "pokerpal.clock.sound";

export type ClockCue = "minute" | "count" | "final_count" | "level" | "break_start" | "break_end";

interface Note {
  /** Seconds after the cue starts. */
  at: number;
  frequency: number;
  /** Glides to this pitch over the note (the alarm's rise). */
  glideTo?: number;
  seconds: number;
  wave: OscillatorType;
  /** The note's loudness before the screen's volume, 0–1. */
  peak: number;
}

const note = (at: number, frequency: number, seconds: number, wave: OscillatorType, peak: number, glideTo?: number): Note => ({ at, frequency, seconds, wave, peak, glideTo });

/** Two notes an octave apart, sounded together: brighter and easier to hear over a room than one. */
const pair = (at: number, frequency: number, seconds: number, peak: number, glide?: number): Note[] => [
  note(at, frequency, seconds, "square", peak * 0.55, glide),
  note(at, frequency / 2, seconds, "triangle", peak, glide ? glide / 2 : undefined),
];

/** About 1.5 s of alternating low and high tones, each pair a step higher: hard to miss, not a fire alarm. */
const MINUTE_ALARM: Note[] = [0, 1, 2, 3, 4, 5].flatMap((step) => {
  const high = step % 2 === 1;
  const base = (high ? 988 : 740) * 2 ** (Math.floor(step / 2) / 12);
  return pair(step * 0.25, base, 0.21, 0.85, base * 1.04);
});

/** C, E, G, C rising fast, then the top two held: the room hears the blinds go up. */
const BLINDS_UP: Note[] = [
  ...[523.25, 659.25, 783.99].flatMap((frequency, i) => pair(i * 0.11, frequency, 0.13, 0.9)),
  note(0.33, 1046.5, 1.0, "sawtooth", 0.35),
  note(0.33, 783.99, 1.0, "triangle", 0.8),
  note(0.33, 523.25, 1.0, "triangle", 0.8),
];

export const CUE_NOTES: Readonly<Record<ClockCue, readonly Note[]>> = {
  minute: MINUTE_ALARM,
  count: pair(0, 1046.5, 0.14, 0.75),
  final_count: pair(0, 1567.98, 0.1, 1),
  level: BLINDS_UP,
  // Falling, slower and softer: play has stopped.
  break_start: [note(0, 783.99, 0.7, "triangle", 0.9), note(0, 1567.98, 0.5, "sine", 0.3), note(0.55, 523.25, 1.0, "triangle", 0.9), note(0.55, 1046.5, 0.7, "sine", 0.3)],
  // Rising three: back to the tables.
  break_end: [523.25, 783.99, 1046.5].flatMap((frequency, i) => [note(i * 0.28, frequency, 0.45, "triangle", 0.9), note(i * 0.28, frequency * 2, 0.3, "sine", 0.3)]),
};

/** Every sound once, for the screen's "Test sounds": the minute alarm, a count, the last count, blinds up. */
export const TEST_SEQUENCE: ReadonlyArray<{ cue: ClockCue; at: number }> = [
  { cue: "minute", at: 0 },
  { cue: "count", at: 2 },
  { cue: "final_count", at: 3 },
  { cue: "level", at: 4 },
];

/** The pitch each oscillator of a cue starts at, in the order they are made (what a test hears). */
export const cueFrequencies = (cue: ClockCue): number[] => CUE_NOTES[cue].map((each) => each.frequency);

type AudioContextClass = typeof AudioContext;

function audioContextClass(): AudioContextClass | null {
  if (typeof AudioContext === "function") return AudioContext;
  return (window as Window & { webkitAudioContext?: AudioContextClass }).webkitAudioContext ?? null;
}

function readSoundOn(): boolean {
  try {
    return window.localStorage.getItem(SOUND_PREFERENCE_KEY) !== "off";
  } catch {
    return true;
  }
}

function writeSoundOn(on: boolean): void {
  try {
    window.localStorage.setItem(SOUND_PREFERENCE_KEY, on ? "on" : "off");
  } catch {
    // Not remembered (a private window): the choice still holds while the page is open.
  }
}

/** Each context's way out: the screen's volume into a compressor that keeps the peaks clean (made once). */
const outputs = new WeakMap<AudioContext, GainNode>();

/** The screen's volume (squared: a slider's middle sounds like half the loudness), set for the next cue. */
function outputOf(context: AudioContext, volume: number): AudioNode {
  let level = outputs.get(context);
  if (!level) {
    level = context.createGain();
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.knee.value = 6;
    compressor.ratio.value = 10;
    compressor.attack.value = 0.002;
    compressor.release.value = 0.2;
    level.connect(compressor);
    compressor.connect(context.destination);
    outputs.set(context, level);
  }
  level.gain.value = Math.max(0, Math.min(1, volume)) ** 2 * 1.4;
  return level;
}

/** Schedules `cue`'s notes `delay` seconds from now on `context`. */
function sound(context: AudioContext, cue: ClockCue, volume: number, delay = 0): void {
  const output = outputOf(context, volume);
  for (const each of CUE_NOTES[cue]) {
    const at = context.currentTime + delay + each.at;
    const end = at + each.seconds;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = each.wave;
    oscillator.frequency.value = each.frequency;
    oscillator.frequency.setValueAtTime(each.frequency, at);
    if (each.glideTo) oscillator.frequency.exponentialRampToValueAtTime(each.glideTo, end);
    // A fast attack (no click), a short hold, then a decay that ends in silence.
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(each.peak, at + 0.006);
    gain.gain.setValueAtTime(each.peak, at + Math.min(0.05, each.seconds / 3));
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(gain);
    gain.connect(output);
    oscillator.start(at);
    oscillator.stop(end + 0.02);
  }
}

/**
 * Plays every sound once on this device, at `volume`, from a tap (a staff phone's Clock tab: it has no
 * clock screen of its own open). The audio is let go when the sounds are over.
 */
export function playTestSounds(volume: number = DEFAULT_SOUND_VOLUME): void {
  const Context = audioContextClass();
  if (!Context) return;
  try {
    const context = new Context();
    void context.resume().catch(() => undefined);
    for (const { cue, at } of TEST_SEQUENCE) sound(context, cue, volume, at);
    const last = TEST_SEQUENCE[TEST_SEQUENCE.length - 1];
    const seconds = last.at + Math.max(...CUE_NOTES[last.cue].map((each) => each.at + each.seconds)) + 0.5;
    window.setTimeout(() => void context.close().catch(() => undefined), seconds * 1000);
  } catch {
    // No audio on this device: nothing to hear.
  }
}

export interface ClockSound {
  /** The browser can play sounds at all. */
  supported: boolean;
  /** Not muted on this screen. */
  on: boolean;
  /** On, but the browser is still holding audio back until the page is touched. */
  needsTap: boolean;
  unlock: () => void;
  toggle: () => void;
  play: (cue: ClockCue) => void;
  /** Plays every sound once (unmuting first), for the screen's settings: at `volume`, else the clock's. */
  test: (volume?: number) => void;
}

export function useClockSound({ volume = DEFAULT_SOUND_VOLUME }: { volume?: number } = {}): ClockSound {
  const [supported] = useState(() => audioContextClass() !== null);
  const [on, setOn] = useState(readSoundOn);
  const [running, setRunning] = useState(false);
  const context = useRef<AudioContext | null>(null);

  const unlock = useCallback(() => {
    const Context = audioContextClass();
    if (!Context) return;
    try {
      context.current ??= new Context();
      const audio = context.current;
      void audio.resume().then(
        () => setRunning(audio.state === "running"),
        () => setRunning(false),
      );
    } catch {
      // No audio on this screen (the browser refused a context): the clock goes on silently.
    }
  }, []);

  // Some screens (a kiosk browser, a page already touched) may play at once; any touch or key unlocks the rest.
  useEffect(() => {
    if (!supported) return;
    unlock();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      const audio = context.current;
      context.current = null;
      void audio?.close().catch(() => undefined);
    };
  }, [supported, unlock]);

  const play = useCallback(
    (cue: ClockCue) => {
      const audio = context.current;
      if (!on || !audio || audio.state !== "running") return;
      try {
        sound(audio, cue, volume);
      } catch {
        // A browser that refuses to schedule a sound: the clock goes on silently.
      }
    },
    [on, volume],
  );

  const toggle = useCallback(() => {
    setOn(!on);
    writeSoundOn(!on);
    if (!on) unlock();
  }, [on, unlock]);

  const test = useCallback(
    (loudness: number = volume) => {
      if (!on) {
        setOn(true);
        writeSoundOn(true);
      }
      unlock();
      const audio = context.current;
      if (!audio) return;
      try {
        for (const { cue, at } of TEST_SEQUENCE) sound(audio, cue, loudness, at);
      } catch {
        // As play: silently nothing.
      }
    },
    [on, unlock, volume],
  );

  return { supported, on, needsTap: supported && on && !running, unlock, toggle, play, test };
}
