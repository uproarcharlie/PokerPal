/**
 * What the TV clock asks of the screen it runs on: to stay awake while the tournament is on, and to fill
 * the screen. Both are optional browser features; where one is missing or refused, the clock simply runs
 * without it.
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";

/**
 * Keeps the screen from sleeping while `active` (a tournament not yet over, whatever its clock is
 * doing). The browser drops the lock when the page is hidden, so it is asked for again whenever the page
 * is shown.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    // Typed as always there; older browsers (and some TVs) have no Screen Wake Lock.
    const wakeLock = (navigator as Partial<Navigator>).wakeLock;
    if (!active || !wakeLock) return;
    let lock: WakeLockSentinel | null = null;
    let stopped = false;
    const acquire = async () => {
      if (document.visibilityState !== "visible" || (lock !== null && !lock.released)) return;
      try {
        const next = await wakeLock.request("screen");
        if (stopped) void next.release().catch(() => undefined);
        else lock = next;
      } catch {
        // Refused (battery saver, a page not in front): the clock runs on; the screen may dim.
      }
    };
    void acquire();
    const onVisibility = () => void acquire();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void lock?.release().catch(() => undefined);
    };
  }, [active]);
}

const subscribeFullscreen = (onChange: () => void) => {
  document.addEventListener("fullscreenchange", onChange);
  return () => document.removeEventListener("fullscreenchange", onChange);
};
const isFullscreen = () => document.fullscreenElement != null;

export interface Fullscreen {
  /** The browser can fill the screen (phones' Safari cannot). */
  supported: boolean;
  active: boolean;
  toggle: () => void;
}

export function useFullscreen(): Fullscreen {
  const supported = typeof document.documentElement.requestFullscreen === "function";
  const active = useSyncExternalStore(subscribeFullscreen, isFullscreen, () => false);
  const toggle = useCallback(() => {
    // Refused (no user gesture, a frame that does not allow it) or missing: the page stays as it is.
    try {
      const change = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
      void change.catch(() => undefined);
    } catch {
      return;
    }
  }, []);
  return { supported, active, toggle };
}

/** The Keyboard Lock API (Chromium browsers only, and only while the page fills the screen). */
interface KeyboardLock {
  lock: (keyCodes: string[]) => Promise<void>;
  unlock: () => void;
}

function keyboardLock(): KeyboardLock | null {
  const keyboard = (navigator as Navigator & { keyboard?: Partial<KeyboardLock> }).keyboard;
  return keyboard && typeof keyboard.lock === "function" && typeof keyboard.unlock === "function" ? (keyboard as KeyboardLock) : null;
}

/**
 * While the page fills the screen, keeps Esc for the page where the browser allows it (Keyboard Lock):
 * otherwise the browser takes Esc to leave full screen and the page never hears it, so Esc could not
 * take the seats or the payouts down there (TDN4-TV-ESC-FULLSCREEN). Holding Esc still leaves full
 * screen. Returns whether Esc reaches the page in full screen.
 */
export function useEscapeLock(fullscreen: boolean): boolean {
  const keyboard = keyboardLock();
  useEffect(() => {
    if (!fullscreen || !keyboard) return;
    // Refused (not in full screen after all, a frame that does not allow it): Esc stays the browser's.
    void keyboard.lock(["Escape"]).catch(() => undefined);
    return () => keyboard.unlock();
  }, [fullscreen, keyboard]);
  return keyboard !== null;
}
