/**
 * A club's colours (round 5, item 13; Phase 5 extends the same `clubs.theme` with fonts, backgrounds
 * and panels): the stored shape, its presets, WCAG contrast maths, and the CSS variables a themed
 * page sets. PURE: no imports, no I/O, no zod (the public pages and the TV load it).
 *
 * The app's colours are CSS variables holding "r g b" triplets (client/src/index.css), used as
 * `rgb(var(--primary) / <alpha>)`. A club theme replaces the brand ones (primary, its tints, the
 * accent) and leaves the neutral surfaces alone. Every pair that carries text is checked against
 * WCAG 2.1 AA and the brand colour is darkened (light scheme) or lightened (dark scheme) just enough
 * to pass, so a club can pick any colour and every screen stays readable.
 */

export type Rgb = readonly [number, number, number];

/** "#RRGGBB", upper case. */
export type HexColor = string;

export const THEME_VERSION = 1 as const;

export const THEME_PRESET_KEYS = ["lovepoker", "central_stars"] as const;
export type ThemePresetKey = (typeof THEME_PRESET_KEYS)[number];

/** What `clubs.theme` holds. Null (no theme) is the LovePoker look. */
export interface ClubTheme {
  v: typeof THEME_VERSION;
  /** The preset it was started from (the editor shows it selected), or null for the club's own. */
  preset: ThemePresetKey | null;
  colors: {
    /** Buttons, tabs, links, highlights. */
    primary: HexColor;
    /** Highlights beside the primary: badges, the 1st place, the clock's "next level". */
    accent: HexColor;
    /** A brighter primary for glows and gradients (the TV clock, headers); the primary when absent. */
    primaryGlow?: HexColor;
    /** A deeper accent for gradients (metallic gold); the accent when absent. */
    accentDeep?: HexColor;
  };
}

export const THEME_COLOR_KEYS = ["primary", "accent", "primaryGlow", "accentDeep"] as const satisfies readonly (keyof ClubTheme["colors"])[];
export type ThemeColorKey = (typeof THEME_COLOR_KEYS)[number];

export const THEME_COLOR_LABELS: Readonly<Record<ThemeColorKey, string>> = {
  primary: "Main colour",
  accent: "Accent colour",
  primaryGlow: "Glow",
  accentDeep: "Accent shade",
};

/** Central Stars, from their flyer: electric blue with metallic gold. */
export const CENTRAL_STARS_THEME: ClubTheme = Object.freeze({
  v: THEME_VERSION,
  preset: "central_stars",
  colors: Object.freeze({ primary: "#1E7BFF", primaryGlow: "#3FA9FF", accent: "#F2C14E", accentDeep: "#B8862B" }),
}) as ClubTheme;

/** The app's own purple and gold (index.css), for a club that picked a preset and wants it back. */
export const LOVEPOKER_THEME: ClubTheme = Object.freeze({
  v: THEME_VERSION,
  preset: "lovepoker",
  colors: Object.freeze({ primary: "#6B46C1", primaryGlow: "#9333EA", accent: "#F59E0B" }),
}) as ClubTheme;

export interface ThemePreset {
  key: ThemePresetKey;
  name: string;
  description: string;
  theme: ClubTheme;
}

export const THEME_PRESETS: readonly ThemePreset[] = Object.freeze([
  { key: "lovepoker", name: "LovePoker purple", description: "The app's own royal purple and warm gold", theme: LOVEPOKER_THEME },
  { key: "central_stars", name: "Central Stars", description: "Electric blue with metallic gold, from the Central Stars flyer", theme: CENTRAL_STARS_THEME },
]);

export function themePreset(key: ThemePresetKey): ClubTheme {
  const preset = THEME_PRESETS.find((candidate) => candidate.key === key) ?? THEME_PRESETS[0];
  return { ...preset.theme, colors: { ...preset.theme.colors } };
}

// ---------------------------------------------------------------------------------------------------
// Colour maths (WCAG 2.1)

const HEX = /^#([0-9a-f]{6})$/i;

/** "#1E7BFF" → [30, 123, 255]; null for anything but #RRGGBB. */
export function parseHexColor(value: unknown): Rgb | null {
  if (typeof value !== "string") return null;
  const match = HEX.exec(value.trim());
  if (!match) return null;
  const n = Number.parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHexColor(rgb: Rgb): HexColor {
  return `#${rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/** "30 123 255": the form the app's CSS variables hold. */
export const rgbTriplet = (rgb: Rgb): string => rgb.map((c) => Math.round(c)).join(" ");

const channel = (value: number) => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

export function relativeLuminance([r, g, b]: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** The WCAG contrast ratio of two colours, 1 to 21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** WCAG 2.1 AA: body text 4.5:1; large text (24 px, or 18.66 px bold) and UI parts (borders, focus rings) 3:1. */
export const AA_TEXT = 4.5;
export const AA_LARGE = 3;

/** `a` mixed with `b`: share 0 is `a`, 1 is `b`. */
export function mix(a: Rgb, b: Rgb, share: number): Rgb {
  return [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * share) as unknown as Rgb;
}

export const WHITE: Rgb = [255, 255, 255];
/** The app's dark text (index.css --foreground in the light scheme). */
export const INK: Rgb = [31, 41, 55];

/** White or the app's dark ink, whichever reads better on `background`. */
export function readableTextOn(background: Rgb): Rgb {
  return contrastRatio(WHITE, background) >= contrastRatio(INK, background) ? WHITE : INK;
}

/**
 * `color`, moved towards black (`toward: "darker"`) or white just far enough to reach `min` contrast
 * against every one of `backgrounds`, in steps of 2%. The colour itself when it already passes; black
 * or white at the end if nothing short of them does.
 */
export function withContrast(color: Rgb, backgrounds: readonly Rgb[], min: number, toward: "darker" | "lighter"): Rgb {
  const target: Rgb = toward === "darker" ? [0, 0, 0] : WHITE;
  for (let step = 0; step <= 50; step++) {
    // Rounded before it is measured: the CSS variable holds whole channels.
    const candidate = mix(color, target, step / 50).map((channel) => Math.round(channel)) as unknown as Rgb;
    if (backgrounds.every((background) => contrastRatio(candidate, background) >= min)) return candidate;
  }
  return target;
}

// ---------------------------------------------------------------------------------------------------
// Validation

export interface ThemeProblem {
  path: string[];
  message: string;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * What is wrong with a theme as sent or stored: version 1, a known preset or null, and colours as
 * "#RRGGBB" (primary and accent required). Unknown keys are refused, so nothing unchecked is stored.
 */
export function themeProblems(value: unknown): ThemeProblem[] {
  if (!isObject(value)) return [{ path: [], message: "A theme is an object" }];
  const problems: ThemeProblem[] = [];
  for (const key of Object.keys(value)) if (!["v", "preset", "colors"].includes(key)) problems.push({ path: [key], message: "Unknown theme setting" });
  if (value.v !== THEME_VERSION) problems.push({ path: ["v"], message: `Theme version must be ${THEME_VERSION}` });
  if (value.preset !== null && !(THEME_PRESET_KEYS as readonly unknown[]).includes(value.preset)) {
    problems.push({ path: ["preset"], message: "Unknown preset" });
  }
  const colors = value.colors;
  if (!isObject(colors)) return [...problems, { path: ["colors"], message: "Choose the colours" }];
  for (const key of Object.keys(colors)) {
    if (!(THEME_COLOR_KEYS as readonly string[]).includes(key)) problems.push({ path: ["colors", key], message: "Unknown colour" });
  }
  for (const key of THEME_COLOR_KEYS) {
    const color = colors[key];
    const required = key === "primary" || key === "accent";
    if (color === undefined && !required) continue;
    if (parseHexColor(color) === null) problems.push({ path: ["colors", key], message: `${THEME_COLOR_LABELS[key]}: use a colour like #1E7BFF` });
  }
  return problems;
}

/** A stored theme, with its colours in upper case; null when there is none or it does not pass themeProblems. */
export function readTheme(value: unknown): ClubTheme | null {
  if (value === null || value === undefined || themeProblems(value).length > 0) return null;
  const theme = value as ClubTheme;
  const colors: ClubTheme["colors"] = { primary: theme.colors.primary.trim().toUpperCase(), accent: theme.colors.accent.trim().toUpperCase() };
  if (theme.colors.primaryGlow !== undefined) colors.primaryGlow = theme.colors.primaryGlow.trim().toUpperCase();
  if (theme.colors.accentDeep !== undefined) colors.accentDeep = theme.colors.accentDeep.trim().toUpperCase();
  return { v: THEME_VERSION, preset: theme.preset, colors };
}

// ---------------------------------------------------------------------------------------------------
// CSS variables

export type ColorSchemeName = "light" | "dark";

/** The neutral surfaces of each scheme (index.css --background and --card), which every text colour is checked against. */
export const SCHEME_SURFACES: Readonly<Record<ColorSchemeName, { background: Rgb; card: Rgb }>> = {
  light: { background: [243, 244, 246], card: WHITE },
  dark: { background: [17, 24, 39], card: [31, 41, 55] },
};

/**
 * A fill and the text drawn on it (white or ink, whichever reads better), the fill deepened or
 * lightened, away from that text, until the pair reaches 4.5:1.
 */
function fillWithText(color: Rgb): { fill: Rgb; text: Rgb } {
  const text = readableTextOn(color);
  return { fill: withContrast(color, [text], AA_TEXT, text === WHITE ? "darker" : "lighter"), text };
}

/** The CSS variables a theme sets, e.g. { "--primary": "21 101 214" }. */
export type ThemeVariables = Record<`--${string}`, string>;

/**
 * The variables `theme` sets in `scheme`. Each text pair passes AA:
 * - --primary: the main colour as text on the card and the page (4.5:1; also every primary button's
 *   fill), with --primary-foreground (white or ink) at 4.5:1 on it; --ring the same colour;
 * - --secondary: the glow colour, deepened so --secondary-foreground (white) reads on it;
 * - --accent: the accent as a fill, with --accent-foreground at 4.5:1 on it; --accent-text: the accent
 *   as text on the card and the page (4.5:1);
 * - light scheme only, the purple tints the LovePoker look has: --muted (a pale tint of the primary),
 *   --muted-foreground (a deep primary, 4.5:1 on the card, the page and --muted), --border, --input;
 *   dark scheme: --border (a deep primary). The other dark tokens are neutral already.
 * - --chart-1..3: primary, secondary, accent.
 */
export function themeVariables(theme: ClubTheme, scheme: ColorSchemeName): ThemeVariables {
  const surfaces = SCHEME_SURFACES[scheme];
  const text = [surfaces.card, surfaces.background];
  const toward = scheme === "light" ? "darker" : "lighter";
  const brand = parseHexColor(theme.colors.primary) ?? [107, 70, 193];
  const glow = parseHexColor(theme.colors.primaryGlow) ?? brand;
  const accent = parseHexColor(theme.colors.accent) ?? [245, 158, 11];

  const primary = fillWithText(withContrast(scheme === "light" ? brand : glow, text, AA_TEXT, toward));
  const secondary = withContrast(glow, [WHITE], AA_TEXT, "darker");
  const accentFill = fillWithText(accent);
  const accentText = withContrast(accent, text, AA_TEXT, toward);
  const variables: ThemeVariables = {
    "--primary": rgbTriplet(primary.fill),
    "--primary-foreground": rgbTriplet(primary.text),
    "--ring": rgbTriplet(primary.fill),
    "--secondary": rgbTriplet(secondary),
    "--secondary-foreground": rgbTriplet(WHITE),
    "--accent": rgbTriplet(accentFill.fill),
    "--accent-foreground": rgbTriplet(accentFill.text),
    "--accent-text": rgbTriplet(accentText),
    "--chart-1": rgbTriplet(primary.fill),
    "--chart-2": rgbTriplet(secondary),
    "--chart-3": rgbTriplet(accentFill.fill),
  };
  if (scheme === "light") {
    // Rounded before the words are measured against it: the CSS variable holds whole channels.
    const muted = mix(brand, WHITE, 0.9).map((channel) => Math.round(channel)) as unknown as Rgb;
    variables["--muted"] = rgbTriplet(muted);
    variables["--muted-foreground"] = rgbTriplet(withContrast(mix(brand, INK, 0.35), [...text, muted], AA_TEXT, "darker"));
    variables["--border"] = rgbTriplet(mix(brand, WHITE, 0.7));
    variables["--input"] = rgbTriplet(mix(brand, WHITE, 0.88));
  } else {
    variables["--border"] = rgbTriplet(mix(brand, surfaces.background, 0.55));
  }
  return variables;
}
