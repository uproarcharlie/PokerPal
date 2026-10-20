/**
 * The one owner of the <html> element's theme: the `dark` class, `color-scheme`, `data-surface` and
 * any theme CSS variables. Nothing else in the app touches them.
 *
 * Layouts declare what their part of the app looks like with <ThemeScope>: the staff screens follow
 * the signed-in person's light/dark preference, public and sign-in screens are light. A scope inside
 * another wins while it is mounted, so a club's own theme (Phase 5) nests inside the public layout and
 * replaces its scheme and variables without either overwriting the other. Variables go on <html>, not
 * on a wrapper, because Radix portals (dialogs, selects, toasts) render outside the page's tree.
 */
import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

export type ColorScheme = "light" | "dark";

export interface ThemeLayer {
  /** The scheme while this scope is the innermost one; "preference" follows the person's choice. */
  colorScheme: ColorScheme | "preference";
  /** Names the part of the app for CSS, as <html data-surface="...">. */
  surface: string;
  /** CSS custom properties set on <html> while this scope is the innermost one, e.g. { "--primary": "30 123 255" }. */
  variables?: Readonly<Record<`--${string}`, string>>;
}

interface Registration {
  depth: number;
  order: number;
  layer: ThemeLayer;
}

interface ThemeContextValue {
  /** The person's own light/dark choice (staff screens). */
  preference: ColorScheme;
  setPreference: (scheme: ColorScheme) => void;
  /** The scheme on screen now. */
  colorScheme: ColorScheme;
  register: (id: symbol, depth: number, layer: ThemeLayer) => void;
  unregister: (id: symbol) => void;
}

const PREFERENCE_KEY = "theme";
const DEFAULT_LAYER: ThemeLayer = { colorScheme: "light", surface: "public" };

const ThemeContext = createContext<ThemeContextValue | null>(null);
const DepthContext = createContext(0);

/** The stored choice, else the device's; storage can be unavailable (private mode), which is not an error. */
function initialPreference(): ColorScheme {
  try {
    const saved = window.localStorage.getItem(PREFERENCE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // fall through to the device setting
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function innermost(registrations: ReadonlyMap<symbol, Registration>): ThemeLayer {
  let best: Registration | undefined;
  for (const registration of Array.from(registrations.values())) {
    if (!best || registration.depth > best.depth || (registration.depth === best.depth && registration.order > best.order)) {
      best = registration;
    }
  }
  return best?.layer ?? DEFAULT_LAYER;
}

export function ThemeController({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ColorScheme>(initialPreference);
  const [registrations, setRegistrations] = useState<ReadonlyMap<symbol, Registration>>(() => new Map());
  const applied = useRef<Set<string>>(new Set());

  const setPreference = useCallback((scheme: ColorScheme) => {
    setPreferenceState(scheme);
    try {
      window.localStorage.setItem(PREFERENCE_KEY, scheme);
    } catch {
      // the choice still holds for this visit
    }
  }, []);

  const registered = useRef(0);

  const register = useCallback((id: symbol, depth: number, layer: ThemeLayer) => {
    setRegistrations((current) => {
      // A scope keeps its place among equals when its layer changes; a new one goes after them.
      const order = current.get(id)?.order ?? (registered.current += 1);
      return new Map(current).set(id, { depth, order, layer });
    });
  }, []);
  const unregister = useCallback((id: symbol) => {
    setRegistrations((current) => {
      const next = new Map(current);
      next.delete(id);
      return next;
    });
  }, []);

  const layer = innermost(registrations);
  const colorScheme: ColorScheme = layer.colorScheme === "preference" ? preference : layer.colorScheme;

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", colorScheme === "dark");
    root.style.colorScheme = colorScheme;
    root.dataset.surface = layer.surface;

    const variables = layer.variables ?? {};
    for (const name of Array.from(applied.current)) {
      if (!(name in variables)) root.style.removeProperty(name);
    }
    for (const [name, value] of Object.entries(variables)) root.style.setProperty(name, value);
    applied.current = new Set(Object.keys(variables));
  }, [colorScheme, layer]);

  const value = useMemo(
    () => ({ preference, setPreference, colorScheme, register, unregister }),
    [preference, setPreference, colorScheme, register, unregister],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

function useThemeContext(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("Theme hooks need a <ThemeController> above them");
  return context;
}

/** The person's light/dark preference and the scheme on screen, for a theme toggle. */
export function useTheme(): Pick<ThemeContextValue, "preference" | "setPreference" | "colorScheme"> {
  const { preference, setPreference, colorScheme } = useThemeContext();
  return { preference, setPreference, colorScheme };
}

/**
 * Applies `layer` to <html> while mounted, unless a scope inside it says otherwise. Pass a stable
 * layer (a constant, or memoised on what it is built from): a new object re-registers it.
 */
export function ThemeScope({ layer, children }: { layer: ThemeLayer; children: ReactNode }) {
  const { register, unregister } = useThemeContext();
  const depth = useContext(DepthContext) + 1;
  const [id] = useState(() => Symbol("theme-scope"));

  useLayoutEffect(() => {
    register(id, depth, layer);
  }, [register, id, depth, layer]);
  useLayoutEffect(() => () => unregister(id), [unregister, id]);

  return <DepthContext.Provider value={depth}>{children}</DepthContext.Provider>;
}
