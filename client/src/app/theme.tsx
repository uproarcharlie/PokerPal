/**
 * The one owner of the <html> element's theme: the `dark` class, `color-scheme`, `data-surface` and
 * any theme CSS variables. Nothing else in the app touches them.
 *
 * Layouts declare what their part of the app looks like with <ThemeScope>: the staff screens follow
 * the signed-in person's light/dark preference, public and sign-in screens are light. A scope inside
 * another wins while it is mounted, so a club's own colours nest inside a layout and replace its
 * variables without either overwriting the other; whatever the inner scope leaves out (the scheme, the
 * surface) it keeps from the scopes around it. Variables go on <html>, not on a wrapper, because Radix
 * portals (dialogs, selects, toasts) render outside the page's tree.
 */
import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

export type ColorScheme = "light" | "dark";

/** CSS custom properties, e.g. { "--primary": "30 123 255" }. */
export type ThemeVariables = Readonly<Record<`--${string}`, string>>;

/** What a scope sets while it is the innermost one. Each part left out is the enclosing scope's. */
export interface ThemeLayer {
  /** The scheme; "preference" follows the person's choice. Left out: the enclosing scope's (light at the top). */
  colorScheme?: ColorScheme | "preference";
  /** Names the part of the app for CSS, as <html data-surface="...">. Left out: the enclosing scope's. */
  surface?: string;
  /**
   * CSS custom properties set on <html>, or a function of the scheme on screen for colours that differ
   * between light and dark (a club's theme: the same blue is darkened on a light page and lightened on
   * the TV). They replace the enclosing scope's set; left out, that set stays.
   */
  variables?: ThemeVariables | ((scheme: ColorScheme) => ThemeVariables);
}

interface Registration {
  depth: number;
  order: number;
  /** The scope this one is inside, whose layer fills in what this one leaves out. */
  parent: symbol | null;
  layer: ThemeLayer;
}

/** A layer with nothing left out: what <html> shows. */
interface ResolvedLayer {
  colorScheme: ColorScheme | "preference";
  surface: string;
  variables?: ThemeLayer["variables"];
}

interface ThemeContextValue {
  /** The person's own light/dark choice (staff screens). */
  preference: ColorScheme;
  setPreference: (scheme: ColorScheme) => void;
  /** The scheme on screen now. */
  colorScheme: ColorScheme;
  register: (id: symbol, registration: Omit<Registration, "order">) => void;
  unregister: (id: symbol) => void;
}

const PREFERENCE_KEY = "theme";
const DEFAULT_LAYER: ResolvedLayer = { colorScheme: "light", surface: "public" };
const NO_VARIABLES: ThemeVariables = {};

const ThemeContext = createContext<ThemeContextValue | null>(null);
/** The scope a ThemeScope is inside: how deep it is, and which one (null at the top). */
const ScopeContext = createContext<{ depth: number; id: symbol | null }>({ depth: 0, id: null });

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

/** The innermost scope's layer, each part it leaves out taken from the scopes around it. */
function innermost(registrations: ReadonlyMap<symbol, Registration>): ResolvedLayer {
  let best: Registration | undefined;
  for (const registration of Array.from(registrations.values())) {
    if (!best || registration.depth > best.depth || (registration.depth === best.depth && registration.order > best.order)) {
      best = registration;
    }
  }
  const layer: ThemeLayer = {};
  for (let at = best; at; at = at.parent ? registrations.get(at.parent) : undefined) {
    layer.colorScheme ??= at.layer.colorScheme;
    layer.surface ??= at.layer.surface;
    layer.variables ??= at.layer.variables;
  }
  return { colorScheme: layer.colorScheme ?? DEFAULT_LAYER.colorScheme, surface: layer.surface ?? DEFAULT_LAYER.surface, variables: layer.variables };
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

  const register = useCallback((id: symbol, registration: Omit<Registration, "order">) => {
    setRegistrations((current) => {
      // A scope keeps its place among equals when its layer changes; a new one goes after them.
      const order = current.get(id)?.order ?? (registered.current += 1);
      return new Map(current).set(id, { ...registration, order });
    });
  }, []);
  const unregister = useCallback((id: symbol) => {
    setRegistrations((current) => {
      const next = new Map(current);
      next.delete(id);
      return next;
    });
  }, []);

  const layer = useMemo(() => innermost(registrations), [registrations]);
  const colorScheme: ColorScheme = layer.colorScheme === "preference" ? preference : layer.colorScheme;
  const { surface, variables: layerVariables } = layer;
  const variables = useMemo(
    () => (typeof layerVariables === "function" ? layerVariables(colorScheme) : (layerVariables ?? NO_VARIABLES)),
    [layerVariables, colorScheme],
  );

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", colorScheme === "dark");
    root.style.colorScheme = colorScheme;
    root.dataset.surface = surface;

    for (const name of Array.from(applied.current)) {
      if (!(name in variables)) root.style.removeProperty(name);
    }
    for (const [name, value] of Object.entries(variables)) root.style.setProperty(name, value);
    applied.current = new Set(Object.keys(variables));
  }, [colorScheme, surface, variables]);

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
 * Applies `layer` to <html> while mounted, unless a scope inside it says otherwise; what the layer
 * leaves out is the enclosing scope's. Pass a stable layer (a constant, or memoised on what it is
 * built from): a new object re-registers it.
 */
export function ThemeScope({ layer, children }: { layer: ThemeLayer; children: ReactNode }) {
  const { register, unregister } = useThemeContext();
  const outer = useContext(ScopeContext);
  const depth = outer.depth + 1;
  const parent = outer.id;
  const [id] = useState(() => Symbol("theme-scope"));

  useLayoutEffect(() => {
    register(id, { depth, parent, layer });
  }, [register, id, depth, parent, layer]);
  useLayoutEffect(() => () => unregister(id), [unregister, id]);

  const scope = useMemo(() => ({ depth, id }), [depth, id]);
  return <ScopeContext.Provider value={scope}>{children}</ScopeContext.Provider>;
}
