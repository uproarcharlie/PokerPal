/**
 * The club Colours tab's editor state (round 5, item 13), pure so every rule is tested on its own:
 * what each colour box holds, the last colours that all read (what the preview shows while a box is
 * half typed), which preset the colours are, what the save sends, and the plain sentences that say
 * where a colour was adjusted for readability. The colour maths are shared/domain/theme's.
 */
import {
  INK,
  LOVEPOKER_THEME,
  SCHEME_SURFACES,
  THEME_COLOR_KEYS,
  THEME_PRESETS,
  THEME_VERSION,
  parseHexColor,
  readTheme,
  relativeLuminance,
  rgbTriplet,
  themePreset,
  themeProblems,
  themeVariables,
  toHexColor,
  type ClubTheme,
  type ColorSchemeName,
  type HexColor,
  type Rgb,
  type ThemeColorKey,
  type ThemePreset,
  type ThemePresetKey,
  type ThemeVariables,
} from "@shared/domain/theme";

type Colours = ClubTheme["colors"];

/** The colours a club must set; the other two fall back to them (glow: the main colour; shade: the accent). */
export const REQUIRED_COLOURS: readonly ThemeColorKey[] = ["primary", "accent"];
export const isRequiredColour = (key: ThemeColorKey) => REQUIRED_COLOURS.includes(key);

/** The colour an optional one falls back to when it is left empty. */
export const FALLBACK_COLOUR: Readonly<Partial<Record<ThemeColorKey, ThemeColorKey>>> = { primaryGlow: "primary", accentDeep: "accent" };

/** The optional colour that goes with a required one. */
const PAIRED_COLOUR: Readonly<Partial<Record<ThemeColorKey, ThemeColorKey>>> = { primary: "primaryGlow", accent: "accentDeep" };

export interface ColoursDraft {
  /** What each box holds, as typed or picked; "" for an optional colour left empty. */
  text: Record<ThemeColorKey, string>;
  /** The last colours that all read: the preview and the swatches show these while a box is half typed. */
  shown: Colours;
  /** A box's problem, shown once the person leaves it or a save is refused. */
  errors: Partial<Record<ThemeColorKey, string>>;
}

export type ColoursAction =
  | { type: "preset"; key: ThemePresetKey }
  /** Typed into a box, or picked with the colour picker. */
  | { type: "change"; key: ThemeColorKey; text: string }
  /** The person left a box: say what is wrong with it, or tidy it to "#RRGGBB". */
  | { type: "check"; key: ThemeColorKey }
  /** Problems found when saving (here or by the server), by colour. */
  | { type: "errors"; errors: Partial<Record<ThemeColorKey, string>> }
  /** Start again from what is saved (after a save, or Reset). */
  | { type: "load"; theme: ClubTheme | null };

/**
 * "#1e7bff", "1E7BFF", " #abc " → "#1E7BFF" / "#AABBCC"; null when it is not a colour. The short
 * form is accepted because people copy it from design tools; it is stored long.
 */
export function normalizeHex(text: string): HexColor | null {
  const raw = text.trim().replace(/^#/, "");
  const long = /^[0-9a-f]{3}$/i.test(raw) ? raw.replace(/./g, (digit) => digit + digit) : raw;
  const rgb = parseHexColor(`#${long}`);
  return rgb ? toHexColor(rgb) : null;
}

/** The colours a theme sets, nothing else, in upper case. */
function coloursOf(theme: ClubTheme): Colours {
  return { ...(readTheme(theme) ?? LOVEPOKER_THEME).colors };
}

function textOf(colours: Colours): Record<ThemeColorKey, string> {
  return Object.fromEntries(THEME_COLOR_KEYS.map((key) => [key, colours[key] ?? ""])) as Record<ThemeColorKey, string>;
}

/** The editor for what the club has saved: its theme, or the LovePoker colours when it has none. */
export function initialDraft(saved: ClubTheme | null): ColoursDraft {
  const colours = coloursOf(saved ?? LOVEPOKER_THEME);
  return { text: textOf(colours), shown: colours, errors: {} };
}

/** The problem with what a box holds, or null when it reads (an optional box may be empty). */
export function colourProblem(key: ThemeColorKey, text: string): string | null {
  if (text.trim() === "" && !isRequiredColour(key)) return null;
  const candidate = normalizeHex(text) ?? text;
  const theme = { v: THEME_VERSION, preset: null, colors: { ...LOVEPOKER_THEME.colors, [key]: candidate } };
  return themeProblems(theme).find((problem) => problem.path[1] === key)?.message ?? null;
}

export function coloursReducer(draft: ColoursDraft, action: ColoursAction): ColoursDraft {
  switch (action.type) {
    case "preset": {
      const colours = coloursOf(themePreset(action.key));
      return { text: textOf(colours), shown: colours, errors: {} };
    }
    case "change": {
      const { key, text } = action;
      const next = { ...draft.text, [key]: text };
      const shown = { ...draft.shown };
      const colour = normalizeHex(text);
      if (colour) shown[key] = colour;
      else if (text.trim() === "" && !isRequiredColour(key)) delete shown[key];
      // A preset's glow (or shade) belongs to its main colour (or accent): changing that colour drops
      // it, or the TV would keep the preset's blue glow under a club's new red. One the person set stays.
      const paired = PAIRED_COLOUR[key];
      if (paired && matchingPreset(draft.shown) && draft.shown[key] !== shown[key]) {
        next[paired] = "";
        delete shown[paired];
      }
      const errors = { ...draft.errors };
      if (colourProblem(key, text) === null) delete errors[key];
      return { text: next, shown, errors };
    }
    case "check": {
      const { key } = action;
      const text = draft.text[key];
      const problem = colourProblem(key, text);
      if (problem) return { ...draft, errors: { ...draft.errors, [key]: problem } };
      const tidy = text.trim() === "" ? "" : (normalizeHex(text) as HexColor);
      return tidy === text ? draft : { ...draft, text: { ...draft.text, [key]: tidy } };
    }
    case "errors":
      return { ...draft, errors: { ...draft.errors, ...action.errors } };
    case "load":
      return initialDraft(action.theme);
  }
}

/** Every box's problem, for a save: an empty object when they all read. */
export function draftProblems(draft: ColoursDraft): Partial<Record<ThemeColorKey, string>> {
  const problems: Partial<Record<ThemeColorKey, string>> = {};
  for (const key of THEME_COLOR_KEYS) {
    const problem = colourProblem(key, draft.text[key]);
    if (problem) problems[key] = problem;
  }
  return problems;
}

const sameColours = (a: Colours, b: Colours) => THEME_COLOR_KEYS.every((key) => (a[key] ?? null) === (b[key] ?? null));

/** The preset whose colours these are exactly, if any. */
export function matchingPreset(colours: Colours): ThemePreset | null {
  return THEME_PRESETS.find((preset) => sameColours(coloursOf(preset.theme), colours)) ?? null;
}

/** The colours the boxes hold now, as a theme; null while a box does not read. */
export function draftColours(draft: ColoursDraft): Colours | null {
  if (Object.keys(draftProblems(draft)).length > 0) return null;
  const colours = {} as Colours;
  for (const key of THEME_COLOR_KEYS) {
    const colour = normalizeHex(draft.text[key]);
    if (colour) colours[key] = colour;
  }
  return colours;
}

/** A theme for `colours`, naming the preset they are (the editor shows it selected next time). */
export function themeFor(colours: Colours): ClubTheme {
  return { v: THEME_VERSION, preset: matchingPreset(colours)?.key ?? null, colors: { ...colours } };
}

/**
 * What a save stores in `clubs.theme`: the theme, or null when the colours are the LovePoker ones
 * untouched, so the club wears exactly the app's own look (index.css, tuned by hand) and follows it
 * if it ever changes, as every club without a theme does.
 */
export function savedValue(colours: Colours): ClubTheme | null {
  return matchingPreset(colours)?.key === "lovepoker" ? null : themeFor(colours);
}

/** Whether the boxes hold anything but the colours the club wears now (`saved`: read with readTheme). */
export function hasChanges(colours: Colours | null, saved: ClubTheme | null): boolean {
  return colours === null || !sameColours(colours, coloursOf(saved ?? LOVEPOKER_THEME));
}

/** What the club wears, in words: "Central Stars", "your own colours", or the LovePoker purple. */
export function themeName(saved: ClubTheme | null): string {
  if (saved === null) return "the LovePoker purple (the app's own colours)";
  return matchingPreset(saved.colors)?.name ?? "your own colours";
}

// ---------------------------------------------------------------------------------------------------
// Preview and readability notes

/**
 * The variables a preview panel sets: the club's colours for `scheme`, on that scheme's neutral page,
 * card and text, so a light panel reads as a public page even on a staff screen in dark mode (the dark
 * panel takes the rest of its neutrals from the `dark` class).
 */
export function previewVariables(colours: Colours, scheme: ColorSchemeName): ThemeVariables {
  const neutrals: ThemeVariables =
    scheme === "light"
      ? {
          "--background": rgbTriplet(SCHEME_SURFACES.light.background),
          "--card": rgbTriplet(SCHEME_SURFACES.light.card),
          "--foreground": rgbTriplet(INK),
          "--card-foreground": rgbTriplet(INK),
        }
      : {};
  return { ...neutrals, ...themeVariables(themeFor(colours), scheme) };
}

const tripletHex = (triplet: string | undefined): HexColor | null => {
  const channels = (triplet ?? "").split(" ").map(Number);
  return channels.length === 3 && channels.every((c) => Number.isInteger(c)) ? toHexColor(channels as unknown as Rgb) : null;
};

export interface ReadabilityNote {
  scheme: ColorSchemeName;
  /** The colour as picked. */
  picked: HexColor;
  /** The colour the screens use instead. */
  used: HexColor;
  message: string;
}

const WHERE: Readonly<Record<ColorSchemeName, { place: string; reason: string }>> = {
  light: { place: "on light pages", reason: "so it reads on white" },
  dark: { place: "on the TV and dark screens", reason: "so it reads on the dark background" },
};

/**
 * Where the screens use a colour other than the one picked so that text stays readable (WCAG AA),
 * one sentence each: "Main colour: deepened to #1A6EE5 on light pages, so links and button words stay
 * readable". Empty when every colour is used as picked. (Dark screens draw the main colour from the
 * glow, which is brighter.)
 */
export function readabilityNotes(colours: Colours): ReadabilityNote[] {
  const theme = themeFor(colours);
  const notes: ReadabilityNote[] = [];
  for (const scheme of ["light", "dark"] as const) {
    const variables = themeVariables(theme, scheme);
    const { place, reason } = WHERE[scheme];
    const main = scheme === "dark" && colours.primaryGlow ? { name: "Glow", colour: colours.primaryGlow } : { name: "Main colour", colour: colours.primary };
    const uses = [
      { ...main, triplet: variables["--primary"], why: "so links and button words stay readable" },
      { name: "Accent as text (prize money, antes)", colour: colours.accent, triplet: variables["--accent-text"], why: reason },
      { name: "Accent badges", colour: colours.accent, triplet: variables["--accent"], why: "so the words on them stay readable" },
    ];
    for (const { name, colour, triplet, why } of uses) {
      const used = tripletHex(triplet);
      const picked = parseHexColor(colour);
      if (!used || !picked || used === toHexColor(picked)) continue;
      const change = relativeLuminance(parseHexColor(used) as Rgb) < relativeLuminance(picked) ? "deepened" : "lightened";
      notes.push({ scheme, picked: toHexColor(picked), used, message: `${name}: ${change} to ${used} ${place}, ${why}` });
    }
  }
  return notes;
}
