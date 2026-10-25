import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  AA_TEXT,
  CENTRAL_STARS_THEME,
  contrastRatio,
  LOVEPOKER_THEME,
  parseHexColor,
  SCHEME_SURFACES,
  type ClubTheme,
  type Rgb,
} from "@shared/domain/theme";
import {
  colourProblem,
  coloursReducer,
  draftColours,
  draftProblems,
  hasChanges,
  initialDraft,
  matchingPreset,
  normalizeHex,
  previewVariables,
  readabilityNotes,
  savedValue,
  themeFor,
  themeName,
  type ColoursAction,
  type ColoursDraft,
} from "./colours-draft";

const apply = (draft: ColoursDraft, ...actions: ColoursAction[]) => actions.reduce(coloursReducer, draft);
const own = (colors: ClubTheme["colors"]): ClubTheme => ({ v: 1, preset: null, colors });
const rgbOf = (triplet: string): Rgb => triplet.split(" ").map(Number) as unknown as Rgb;

describe("normalizeHex", () => {
  it("reads a colour typed with or without #, short or long, in any case", () => {
    expect(normalizeHex("#1e7bff")).toBe("#1E7BFF");
    expect(normalizeHex(" 1E7BFF ")).toBe("#1E7BFF");
    expect(normalizeHex("#abc")).toBe("#AABBCC");
    expect(normalizeHex("fff")).toBe("#FFFFFF");
  });

  it("refuses anything else", () => {
    for (const text of ["", "#12", "#1E7BF", "#1E7BFFF", "blue", "#GGGGGG", "rgb(0,0,0)"]) expect(normalizeHex(text)).toBeNull();
  });
});

describe("the editor's starting point", () => {
  it("is the LovePoker colours for a club without a theme", () => {
    const draft = initialDraft(null);
    expect(draft.text).toEqual({ primary: "#6B46C1", accent: "#F59E0B", primaryGlow: "#9333EA", accentDeep: "" });
    expect(matchingPreset(draft.shown)?.key).toBe("lovepoker");
    expect(hasChanges(draftColours(draft), null)).toBe(false);
  });

  it("is the club's own theme, in upper case", () => {
    const draft = initialDraft(own({ primary: "#c0392b", accent: "#f1c40f" }));
    expect(draft.text).toEqual({ primary: "#C0392B", accent: "#F1C40F", primaryGlow: "", accentDeep: "" });
    expect(matchingPreset(draft.shown)).toBeNull();
  });
});

describe("coloursReducer", () => {
  it("fills every box from a preset, clearing problems", () => {
    const draft = apply(initialDraft(null), { type: "change", key: "primary", text: "#12" }, { type: "check", key: "primary" }, { type: "preset", key: "central_stars" });
    expect(draft.text).toEqual({ primary: "#1E7BFF", accent: "#F2C14E", primaryGlow: "#3FA9FF", accentDeep: "#B8862B" });
    expect(draft.errors).toEqual({});
    expect(matchingPreset(draft.shown)?.key).toBe("central_stars");
  });

  it("keeps the last colour that read while a box is half typed, and says what is wrong once the person leaves it", () => {
    const typing = apply(initialDraft(null), { type: "preset", key: "central_stars" }, { type: "change", key: "accent", text: "#C0" });
    expect(typing.text.accent).toBe("#C0");
    expect(typing.shown.accent).toBe("#F2C14E");
    expect(typing.errors).toEqual({});
    expect(draftColours(typing)).toBeNull();

    const left = coloursReducer(typing, { type: "check", key: "accent" });
    expect(left.errors.accent).toBe("Accent colour: use a colour like #1E7BFF");

    const fixed = coloursReducer(left, { type: "change", key: "accent", text: "#c0392b" });
    expect(fixed.errors).toEqual({});
    expect(fixed.shown.accent).toBe("#C0392B");
    expect(coloursReducer(fixed, { type: "check", key: "accent" }).text.accent).toBe("#C0392B");
  });

  it("drops a preset's glow when its main colour changes, so the TV does not keep the preset's blue", () => {
    const draft = apply(initialDraft(null), { type: "preset", key: "central_stars" }, { type: "change", key: "primary", text: "#C0392B" });
    expect(draft.text.primaryGlow).toBe("");
    expect(draft.shown.primaryGlow).toBeUndefined();
    // The gold's shade stays: only the accent goes with it.
    expect(draft.text.accentDeep).toBe("#B8862B");
    expect(draftColours(draft)).toEqual({ primary: "#C0392B", accent: "#F2C14E", accentDeep: "#B8862B" });
  });

  it("keeps a glow the person set themselves when they then change the main colour", () => {
    const draft = apply(
      initialDraft(null),
      { type: "preset", key: "central_stars" },
      { type: "change", key: "primaryGlow", text: "#FF8800" },
      { type: "change", key: "primary", text: "#C0392B" },
    );
    expect(draft.text.primaryGlow).toBe("#FF8800");
    expect(draft.shown.primaryGlow).toBe("#FF8800");
  });

  it("lets an optional colour be emptied (it then follows its own), never a required one", () => {
    const cleared = apply(initialDraft(CENTRAL_STARS_THEME), { type: "change", key: "accentDeep", text: "" }, { type: "check", key: "accentDeep" });
    expect(cleared.errors).toEqual({});
    expect(cleared.shown.accentDeep).toBeUndefined();

    const emptied = apply(initialDraft(CENTRAL_STARS_THEME), { type: "change", key: "primary", text: "" }, { type: "check", key: "primary" });
    expect(emptied.errors.primary).toBe("Main colour: use a colour like #1E7BFF");
    expect(emptied.shown.primary).toBe("#1E7BFF");
  });

  it("puts a save's problems on their boxes, and starts again from what was saved", () => {
    const draft = apply(initialDraft(null), { type: "errors", errors: { primary: "Main colour: use a colour like #1E7BFF" } });
    expect(draft.errors.primary).toBeDefined();
    expect(coloursReducer(draft, { type: "load", theme: CENTRAL_STARS_THEME })).toEqual(initialDraft(CENTRAL_STARS_THEME));
  });
});

describe("draftProblems and colourProblem", () => {
  it("name every box that does not read, the server's words", () => {
    const draft = apply(initialDraft(null), { type: "change", key: "primary", text: "red" }, { type: "change", key: "primaryGlow", text: "#12345" });
    expect(draftProblems(draft)).toEqual({ primary: "Main colour: use a colour like #1E7BFF", primaryGlow: "Glow: use a colour like #1E7BFF" });
    expect(colourProblem("accentDeep", "  ")).toBeNull();
    expect(colourProblem("accent", "#abc")).toBeNull();
  });
});

describe("what a save stores", () => {
  it("is the theme, naming the preset its colours are", () => {
    expect(savedValue({ ...CENTRAL_STARS_THEME.colors })).toEqual(CENTRAL_STARS_THEME);
    expect(savedValue({ primary: "#C0392B", accent: "#F1C40F" })).toEqual(own({ primary: "#C0392B", accent: "#F1C40F" }));
  });

  it("is null for the LovePoker colours untouched, so the club wears the app's own look", () => {
    expect(savedValue({ ...LOVEPOKER_THEME.colors })).toBeNull();
    // Changed at all, they are the club's own.
    expect(savedValue({ ...LOVEPOKER_THEME.colors, accent: "#F59E0C" })?.preset).toBeNull();
  });

  it("counts as a change only when the colours differ from what the club wears", () => {
    expect(hasChanges({ ...CENTRAL_STARS_THEME.colors }, CENTRAL_STARS_THEME)).toBe(false);
    expect(hasChanges({ ...LOVEPOKER_THEME.colors }, null)).toBe(false);
    expect(hasChanges({ ...LOVEPOKER_THEME.colors }, LOVEPOKER_THEME)).toBe(false);
    expect(hasChanges({ ...LOVEPOKER_THEME.colors }, CENTRAL_STARS_THEME)).toBe(true);
    expect(hasChanges({ ...CENTRAL_STARS_THEME.colors, accentDeep: undefined }, CENTRAL_STARS_THEME)).toBe(true);
    // A box that does not read is a change that cannot be saved yet.
    expect(hasChanges(null, CENTRAL_STARS_THEME)).toBe(true);
  });

  it("is named for the owner", () => {
    expect(themeName(null)).toBe("the LovePoker purple (the app's own colours)");
    expect(themeName(CENTRAL_STARS_THEME)).toBe("Central Stars");
    expect(themeName(own({ primary: "#C0392B", accent: "#F1C40F" }))).toBe("your own colours");
    expect(themeFor({ ...CENTRAL_STARS_THEME.colors }).preset).toBe("central_stars");
  });
});

describe("readabilityNotes", () => {
  it("say Central Stars' blue is deepened on light pages and its gold deepened as text, and nothing about the TV", () => {
    const notes = readabilityNotes({ ...CENTRAL_STARS_THEME.colors });
    expect(notes.map((note) => note.message)).toEqual([
      expect.stringMatching(/^Main colour: deepened to #[0-9A-F]{6} on light pages, so links and button words stay readable$/),
      expect.stringMatching(/^Accent as text \(prize money, antes\): deepened to #[0-9A-F]{6} on light pages, so it reads on white$/),
    ]);
    for (const note of notes) {
      expect(note.scheme).toBe("light");
      expect(note.used).not.toBe(note.picked);
    }
  });

  it("say a dark main colour is lightened on the TV, naming the glow when there is one", () => {
    const navy = readabilityNotes({ primary: "#0B1430", accent: "#FFFFFF" });
    expect(navy).toContainEqual(expect.objectContaining({ scheme: "dark", message: expect.stringMatching(/^Main colour: lightened to #[0-9A-F]{6} on the TV and dark screens/) }));
    const glow = readabilityNotes({ primary: "#1E7BFF", primaryGlow: "#0B1430", accent: "#F2C14E" });
    expect(glow).toContainEqual(expect.objectContaining({ scheme: "dark", message: expect.stringMatching(/^Glow: lightened to/) }));
  });

  it("leave out a colour that reads as picked: a deep main colour with a pale glow", () => {
    const notes = readabilityNotes({ primary: "#6B46C1", primaryGlow: "#A78BFA", accent: "#B45309" });
    // One accent cannot be text on white and on the dark TV both, so it is always adjusted for one of them.
    expect(notes.map((note) => [note.scheme, note.message.split(":")[0]])).toEqual([["dark", "Accent as text (prize money, antes)"]]);
  });
});

describe("previewVariables", () => {
  it("paint the light panel on a light page whatever the staff screen's scheme, the club's colours AA on it", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffffff }), fc.integer({ min: 0, max: 0xffffff }), (a, b) => {
        const hex = (n: number) => `#${n.toString(16).padStart(6, "0").toUpperCase()}`;
        const variables = previewVariables({ primary: hex(a), accent: hex(b) }, "light");
        expect(rgbOf(variables["--background"])).toEqual(SCHEME_SURFACES.light.background);
        expect(rgbOf(variables["--card"])).toEqual(SCHEME_SURFACES.light.card);
        for (const surface of ["--card", "--background"] as const) {
          expect(contrastRatio(rgbOf(variables["--primary"]), rgbOf(variables[surface]))).toBeGreaterThanOrEqual(AA_TEXT);
          expect(contrastRatio(rgbOf(variables["--foreground"]), rgbOf(variables[surface]))).toBeGreaterThanOrEqual(AA_TEXT);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("leave the dark panel's neutrals to the dark class", () => {
    const variables = previewVariables({ ...CENTRAL_STARS_THEME.colors }, "dark");
    expect(variables["--background"]).toBeUndefined();
    expect(parseHexColor("#3FA9FF")).toEqual(rgbOf(variables["--primary"]));
  });
});
