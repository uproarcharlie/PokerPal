/**
 * The TV clock's chimes: a level change, one minute left, and a break starting. Drawn with Web Audio
 * oscillators (no sound files to fetch, nothing the page's media policy blocks). Browsers keep audio
 * silent until the page is touched, so the screen offers "Tap to enable sound" until it may play.
 * Muting is remembered on this screen (localStorage; every access guarded: private windows refuse it).
 */
import { useCallback, useEffect, useRef, useState } from "react";

export const SOUND_PREFERENCE_KEY = "pokerpal.clock.sound";

export type ClockCue = "level" | "minute" | "break";

/** Each cue's pitch, beep count and beep length. */
const CUES: Readonly<Record<ClockCue, { frequency: number; beeps: number; ms: number }>> = {
  level: { frequency: 880, beeps: 3, ms: 120 },
  minute: { frequency: 660, beeps: 1, ms: 250 },
  break: { frequency: 520, beeps: 2, ms: 600 },
};

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

function beep(context: AudioContext, cue: ClockCue): void {
  const { frequency, beeps, ms } = CUES[cue];
  const length = ms / 1000;
  for (let i = 0; i < beeps; i++) {
    const at = context.currentTime + i * length * 2;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.5, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(at);
    oscillator.stop(at + length + 0.02);
  }
}

export interface ClockSound {
  /** The browser can play the chimes at all. */
  supported: boolean;
  /** Not muted on this screen. */
  on: boolean;
  /** On, but the browser is still holding audio back until the page is touched. */
  needsTap: boolean;
  unlock: () => void;
  toggle: () => void;
  play: (cue: ClockCue) => void;
}

export function useClockSound(): ClockSound {
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
        beep(audio, cue);
      } catch {
        // A browser that refuses to schedule a sound: the clock goes on silently.
      }
    },
    [on],
  );

  const toggle = useCallback(() => {
    setOn(!on);
    writeSoundOn(!on);
    if (!on) unlock();
  }, [on, unlock]);

  return { supported, on, needsTap: supported && on && !running, unlock, toggle, play };
}
