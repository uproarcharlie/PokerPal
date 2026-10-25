import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  AA_TEXT,
  CENTRAL_STARS_THEME,
  contrastRatio,
  INK,
  LOVEPOKER_THEME,
  mix,
  parseHexColor,
  readableTextOn,
  readTheme,
  relativeLuminance,
  rgbTriplet,
  SCHEME_SURFACES,
  THEME_PRESETS,
  themePreset,
  themeProblems,
  themeVariables,
  toHexColor,
  WHITE,
  withContrast,
  type ClubTheme,
  type ColorSchemeName,
  type Rgb,
} from "./theme";

const rgbOf = (triplet: string): Rgb => triplet.split(" ").map(Number) as unknown as Rgb;
const theme = (primary: string, accent: string, extra: Partial<ClubTheme["colors"]> = {}): ClubTheme => ({ v: 1, preset: null, colors: { primary, accent, ...extra } });

describe("colour maths", () => {
  it("reads and writes #RRGGBB", () => {
    expect(parseHexColor("#1E7BFF")).toEqual([30, 123, 255]);
    expect(parseHexColor(" #1e7bff ")).toEqual([30, 123, 255]);
    expect(parseHexColor("#1E7BF")).toBeNull();
    expect(parseHexColor("1E7BFF")).toBeNull();
    expect(parseHexColor("#GGGGGG")).toBeNull();
    expect(parseHexColor(0x1e7bff)).toBeNull();
    expect(toHexColor([30, 123, 255])).toBe("#1E7BFF");
    expect(toHexColor([300, -4, 12.6])).toBe("#FF000D");
    expect(rgbTriplet([30.4, 122.6, 255])).toBe("30 123 255");
  });

  it("measures WCAG contrast", () => {
    expect(relativeLuminance(WHITE)).toBeCloseTo(1, 10);
    expect(relativeLuminance([0, 0, 0])).toBe(0);
    expect(contrastRatio(WHITE, [0, 0, 0])).toBeCloseTo(21, 10);
    expect(contrastRatio([0, 0, 0], WHITE)).toBeCloseTo(21, 10);
    expect(contrastRatio([118, 118, 118], WHITE)).toBeCloseTo(4.54, 2);
    expect(contrastRatio(WHITE, WHITE)).toBe(1);
  });

  it("mixes two colours", () => {
    expect(mix([0, 0, 0], WHITE, 0.5)).toEqual([127.5, 127.5, 127.5]);
    expect(mix([10, 20, 30], WHITE, 0)).toEqual([10, 20, 30]);
  });

  it("picks white or ink, whichever reads better", () => {
    expect(readableTextOn([30, 123, 255])).toBe(WHITE);
    expect(readableTextOn([242, 193, 78])).toBe(INK);
  });

  it("darkens or lightens a colour just enough to reach a contrast", () => {
    const blue: Rgb = [30, 123, 255];
    expect(contrastRatio(blue, WHITE)).toBeLessThan(AA_TEXT);
    const darker = withContrast(blue, [WHITE], AA_TEXT, "darker");
    expect(contrastRatio(darker, WHITE)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(mix(darker, blue, 0.1), WHITE)).toBeLessThan(AA_TEXT + 1);
    expect(withContrast([0, 0, 0], [WHITE], AA_TEXT, "darker")).toEqual([0, 0, 0]);
    expect(withContrast(WHITE, [WHITE], 30, "lighter")).toEqual(WHITE);
  });
});

describe("themeProblems and readTheme", () => {
  it("accept the presets and a club's own colours", () => {
    for (const preset of THEME_PRESETS) expect(themeProblems(preset.theme)).toEqual([]);
    expect(themeProblems(theme("#112233", "#AABBCC"))).toEqual([]);
    expect(themeProblems(theme("#112233", "#aabbcc", { primaryGlow: "#445566" }))).toEqual([]);
  });

  it.each([
    [null, [{ path: [], message: "A theme is an object" }]],
    [[], [{ path: [], message: "A theme is an object" }]],
    [{ v: 2, preset: null, colors: { primary: "#112233", accent: "#445566" } }, [{ path: ["v"], message: "Theme version must be 1" }]],
    [{ v: 1, preset: "pink", colors: { primary: "#112233", accent: "#445566" } }, [{ path: ["preset"], message: "Unknown preset" }]],
    [{ v: 1, preset: null }, [{ path: ["colors"], message: "Choose the colours" }]],
    [{ v: 1, preset: null, colors: { primary: "#112233" } }, [{ path: ["colors", "accent"], message: "Accent colour: use a colour like #1E7BFF" }]],
    [{ v: 1, preset: null, colors: { primary: "blue", accent: "#445566" } }, [{ path: ["colors", "primary"], message: "Main colour: use a colour like #1E7BFF" }]],
    [{ v: 1, preset: null, colors: { primary: "#112233", accent: "#445566", accentDeep: "#12" } }, [{ path: ["colors", "accentDeep"], message: "Accent shade: use a colour like #1E7BFF" }]],
    [{ v: 1, preset: null, colors: { primary: "#112233", accent: "#445566", border: "#000000" } }, [{ path: ["colors", "border"], message: "Unknown colour" }]],
    [{ v: 1, preset: null, colors: { primary: "#112233", accent: "#445566" }, font: "Comic" }, [{ path: ["font"], message: "Unknown theme setting" }]],
  ])("refuse %j", (value, problems) => {
    expect(themeProblems(value)).toEqual(problems);
  });

  it("read a stored theme with its colours in upper case, or null", () => {
    expect(readTheme(theme("#1e7bff", "#f2c14e", { primaryGlow: "#3fa9ff", accentDeep: "#b8862b" }))).toEqual({
      v: 1,
      preset: null,
      colors: { primary: "#1E7BFF", accent: "#F2C14E", primaryGlow: "#3FA9FF", accentDeep: "#B8862B" },
    });
    expect(readTheme(theme("#1e7bff", "#f2c14e"))).toEqual({ v: 1, preset: null, colors: { primary: "#1E7BFF", accent: "#F2C14E" } });
    expect(readTheme(null)).toBeNull();
    expect(readTheme(undefined)).toBeNull();
    expect(readTheme({ v: 1, preset: null, colors: { primary: "nope", accent: "#000000" } })).toBeNull();
  });
});

describe("the presets", () => {
  it("give Central Stars its flyer's electric blue and metallic gold", () => {
    expect(CENTRAL_STARS_THEME).toEqual({
      v: 1,
      preset: "central_stars",
      colors: { primary: "#1E7BFF", primaryGlow: "#3FA9FF", accent: "#F2C14E", accentDeep: "#B8862B" },
    });
    expect(Object.isFrozen(CENTRAL_STARS_THEME)).toBe(true);
    expect(themePreset("central_stars")).toEqual(CENTRAL_STARS_THEME);
    expect(themePreset("central_stars")).not.toBe(CENTRAL_STARS_THEME);
    expect(themePreset("lovepoker")).toEqual(LOVEPOKER_THEME);
    expect(THEME_PRESETS.map((preset) => preset.key)).toEqual(["lovepoker", "central_stars"]);
  });

  it("keep the LovePoker purple as it is in the light scheme", () => {
    expect(themeVariables(LOVEPOKER_THEME, "light")["--primary"]).toBe("107 70 193");
  });
});

describe("themeVariables", () => {
  const schemes: ColorSchemeName[] = ["light", "dark"];

  it.each(schemes)("dresses the %s scheme in Central Stars' blue and gold, every text pair at AA", (scheme) => {
    const variables = themeVariables(CENTRAL_STARS_THEME, scheme);
    const token = (name: string) => rgbOf(variables[`--${name}` as const]);
    const { card, background } = SCHEME_SURFACES[scheme];
    for (const surface of [card, background]) {
      expect(contrastRatio(token("primary"), surface)).toBeGreaterThanOrEqual(AA_TEXT);
      expect(contrastRatio(token("accent-text"), surface)).toBeGreaterThanOrEqual(AA_TEXT);
    }
    expect(contrastRatio(token("primary-foreground"), token("primary"))).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(token("secondary-foreground"), token("secondary"))).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(token("accent-foreground"), token("accent"))).toBeGreaterThanOrEqual(AA_TEXT);
    // Still blue: the blue channel leads.
    const [r, g, b] = token("primary");
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
    expect(variables["--accent"]).toBe("242 193 78");
  });

  it("replaces the light scheme's purple tints, and the dark scheme's purple border", () => {
    const light = themeVariables(CENTRAL_STARS_THEME, "light");
    expect(Object.keys(light).sort()).toEqual(
      [
        "--accent",
        "--accent-foreground",
        "--accent-text",
        "--border",
        "--chart-1",
        "--chart-2",
        "--chart-3",
        "--input",
        "--muted",
        "--muted-foreground",
        "--primary",
        "--primary-foreground",
        "--ring",
        "--secondary",
        "--secondary-foreground",
      ].sort(),
    );
    const muted = rgbOf(light["--muted"]);
    for (const surface of [WHITE, SCHEME_SURFACES.light.background, muted]) {
      expect(contrastRatio(rgbOf(light["--muted-foreground"]), surface)).toBeGreaterThanOrEqual(AA_TEXT);
    }
    const dark = themeVariables(CENTRAL_STARS_THEME, "dark");
    expect(dark["--border"]).toBeDefined();
    expect(dark["--muted"]).toBeUndefined();
    expect(dark["--muted-foreground"]).toBeUndefined();
  });

  it("keeps every text pair at AA for any colours a club picks, in both schemes", () => {
    const hex = fc.integer({ min: 0, max: 0xffffff }).map((n) => `#${n.toString(16).padStart(6, "0").toUpperCase()}`);
    fc.assert(
      fc.property(hex, hex, fc.option(hex, { nil: undefined }), fc.constantFrom<ColorSchemeName>("light", "dark"), (primary, accent, glow, scheme) => {
        const variables = themeVariables(theme(primary, accent, glow ? { primaryGlow: glow } : {}), scheme);
        const token = (name: string) => rgbOf(variables[`--${name}` as const]);
        const { card, background } = SCHEME_SURFACES[scheme];
        for (const surface of [card, background]) {
          expect(contrastRatio(token("primary"), surface)).toBeGreaterThanOrEqual(AA_TEXT);
          expect(contrastRatio(token("accent-text"), surface)).toBeGreaterThanOrEqual(AA_TEXT);
        }
        expect(contrastRatio(token("primary-foreground"), token("primary"))).toBeGreaterThanOrEqual(AA_TEXT);
        expect(contrastRatio(token("secondary-foreground"), token("secondary"))).toBeGreaterThanOrEqual(AA_TEXT);
        expect(contrastRatio(token("accent-foreground"), token("accent"))).toBeGreaterThanOrEqual(AA_TEXT);
        if (scheme === "light") {
          for (const surface of [card, background, token("muted")]) {
            expect(contrastRatio(token("muted-foreground"), surface)).toBeGreaterThanOrEqual(AA_TEXT);
          }
        }
        for (const value of Object.values(variables)) expect(value).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/);
      }),
      { numRuns: 1000 },
    );
  });

  it("falls back to the LovePoker colours for a colour it cannot read", () => {
    const variables = themeVariables({ v: 1, preset: null, colors: { primary: "oops", accent: "nope" } }, "light");
    expect(variables["--primary"]).toBe("107 70 193");
    expect(variables["--accent"]).toBe("245 158 11");
  });
});
