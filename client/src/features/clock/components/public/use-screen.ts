/**
 * What the TV clock asks of the screen it runs on: to stay awake while the tournament is on, to fill
 * the screen, and the size of what is really visible (round 5, item 22). The first two are optional
 * browser features; where one is missing or refused, the clock simply runs without it.
 */
import { useCallback, useEffect, useLayoutEffect, useState, useSyncExternalStore, type RefObject } from "react";

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

export interface StageSize {
  width: number;
  height: number;
}

/**
 * The size of `stage` as the screen shows it, in whole CSS pixels: measured (never 100vh, which a phone's
 * toolbar or a TV's browser gets wrong), and again whenever it may have changed: a resize, a phone
 * turned, full screen entered or left, a browser's toolbar shown or hidden. Before the first measure,
 * the window's size.
 */
export function useStageSize(stage: RefObject<HTMLElement | null>): StageSize {
  const [size, setSize] = useState<StageSize>(() => ({ width: window.innerWidth, height: window.innerHeight }));
  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) return;
    const measure = () => {
      const box = element.getBoundingClientRect();
      const width = Math.floor(box.width);
      const height = Math.floor(box.height);
      if (width <= 0 || height <= 0) return;
      setSize((last) => (last.width === width && last.height === height ? last : { width, height }));
    };
    measure();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(element);
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    document.addEventListener("fullscreenchange", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
      document.removeEventListener("fullscreenchange", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, [stage]);
  return size;
}

/** How many times the guard may shrink the plan for one size of screen. */
const MAX_SQUEEZE = 8;

/**
 * The last word on fitting: once the screen has drawn `content` at this size, if `stage` or any part of
 * it marked `data-fit` holds more than it shows (a font that came out wider than planned), one more
 * step of shrinking for this size of screen. A new size starts again from none.
 */
export function useOverflowGuard(stage: RefObject<HTMLElement | null>, size: StageSize, content: string): number {
  const key = `${String(size.width)}x${String(size.height)}`;
  const [squeeze, setSqueeze] = useState({ key, steps: 0 });
  const steps = squeeze.key === key ? squeeze.steps : 0;
  useEffect(() => {
    const element = stage.current;
    if (!element || steps >= MAX_SQUEEZE) return;
    // After the browser has laid the screen out.
    const frame = requestAnimationFrame(() => {
      const parts = [element, ...Array.from(element.querySelectorAll<HTMLElement>("[data-fit]"))];
      const over = parts.some((part) => part.scrollHeight > part.clientHeight + 1 || part.scrollWidth > part.clientWidth + 1);
      if (over) setSqueeze({ key, steps: steps + 1 });
    });
    return () => cancelAnimationFrame(frame);
  }, [stage, key, steps, content]);
  return steps;
}
