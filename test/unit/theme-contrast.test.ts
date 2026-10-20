/**
 * The theme's colour pairs that carry meaning meet WCAG contrast in both themes: a form field's edge
 * against what it sits on (1.4.11, 3:1), a field's example text on the field (1.4.3, 4.5:1), the open
 * tab against its tab list (1.4.11), a switch's off track and knob, an upload's progress fill on its track
 * (1.4.11), and the phone menu's Delete on its own highlight (MA-09, MA-13, MA-14). Read from index.css,
 * so a retuned token that breaks one fails here.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "../../client/src/index.css"), "utf8");
const tabs = readFileSync(resolve(__dirname, "../../client/src/components/ui/tabs.tsx"), "utf8");
const switches = readFileSync(resolve(__dirname, "../../client/src/components/ui/switch.tsx"), "utf8");
const imageField = readFileSync(resolve(__dirname, "../../client/src/components/image/image-field.tsx"), "utf8");
const publicHome = readFileSync(resolve(__dirname, "../../client/src/features/clubs/pages/public-home.tsx"), "utf8");

type Rgb = [number, number, number];

function tokens(selector: ":root" | ".dark"): Map<string, Rgb> {
  const block = new RegExp(`${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
  return new Map(
    Array.from(block.matchAll(/--([\w-]+):\s*(\d+)\s+(\d+)\s+(\d+)\s*;/g), ([, name, r, g, b]) => [name, [Number(r), Number(g), Number(b)] as Rgb]),
  );
}

const channel = (value: number) => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: Rgb) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const contrast = (a: Rgb, b: Rgb) => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
};
/** `color` at `alpha` over `under`, as Tailwind's `bg-x/10` paints it. */
const over = (color: Rgb, alpha: number, under: Rgb): Rgb => color.map((c, i) => c * alpha + under[i] * (1 - alpha)) as Rgb;

describe("the rich-text editor's example text", () => {
  it("is drawn from tiptap's empty-line mark, in the fields' example-text colour (MA-REV-06)", () => {
    const rule = /\.ProseMirror p\.is-editor-empty:first-child::before\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toContain("content: attr(data-placeholder)");
    expect(rule).toContain("color: rgb(var(--placeholder))");
  });
});

describe("the players' home page band", () => {
  it("keeps its white words at 4.5:1 or better on every colour of its gradient (P3REV-MA-HOME-HERO-CONTRAST)", () => {
    // Public pages are always light (PublicLayout).
    const light = tokens(":root");
    const band = /<header className="[^"]*bg-gradient-to-br ([^"]*) text-primary-foreground"/.exec(publicHome)?.[1] ?? "";
    const stops = Array.from(band.matchAll(/(?:from|via|to)-([a-z-]+)/g), ([, name]) => name);
    expect(stops.length).toBeGreaterThan(0);
    expect(publicHome).not.toMatch(/opacity-\d+[^>]*>Where Poker Communities Thrive/);
    for (const stop of stops) {
      const colour = light.get(stop);
      if (!colour) throw new Error(`--${stop} is not set`);
      expect(contrast(light.get("primary-foreground") as Rgb, colour), stop).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe.each([":root", ".dark"] as const)("the %s theme", (selector) => {
  const own = tokens(selector);
  const light = tokens(":root");
  const token = (name: string): Rgb => {
    const value = own.get(name) ?? light.get(name);
    if (!value) throw new Error(`--${name} is not set`);
    return value;
  };

  it("draws a form field's edge at 3:1 or better on the card and the page", () => {
    expect(contrast(token("control-border"), token("card"))).toBeGreaterThanOrEqual(3);
    expect(contrast(token("control-border"), token("background"))).toBeGreaterThanOrEqual(3);
  });

  it("writes a field's example text at 4.5:1 or better on the field, in a colour apart from the brand's", () => {
    expect(contrast(token("placeholder"), token("background"))).toBeGreaterThanOrEqual(4.5);
    expect(token("placeholder")).not.toEqual(token("primary"));
  });

  it("marks the open tab with a fill 3:1 or better against the tab list, every tab's words readable (MA-REV-05)", () => {
    // The tokens tabs.tsx paints the list and the open tab with.
    expect(tabs).toContain("bg-muted p-1 text-muted-foreground");
    expect(tabs).toContain("data-[state=active]:bg-primary data-[state=active]:text-primary-foreground");
    expect(contrast(token("primary"), token("muted"))).toBeGreaterThanOrEqual(3);
    expect(contrast(token("primary-foreground"), token("primary"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token("muted-foreground"), token("muted"))).toBeGreaterThanOrEqual(4.5);
  });

  it("draws a switch that is off, and its knob, at 3:1 or better, so the control and its state show (P3REV-MA-SWITCH-CONTRAST)", () => {
    // The tokens switch.tsx paints the track (off and on) and the knob with.
    expect(switches).toContain("data-[state=checked]:bg-primary data-[state=unchecked]:bg-control");
    expect(switches).toContain("rounded-full bg-background");
    for (const surface of ["background", "card"]) expect(contrast(token("control-border"), token(surface))).toBeGreaterThanOrEqual(3);
    expect(contrast(token("background"), token("control-border"))).toBeGreaterThanOrEqual(3);
    expect(contrast(token("background"), token("primary"))).toBeGreaterThanOrEqual(3);
  });

  it("fills an upload's progress bar at 3:1 or better against its track (P3REV-MA-UPLOAD-PROGRESS-CONTRAST)", () => {
    expect(imageField).toMatch(/role="progressbar"[\s\S]*?rounded-full bg-muted"[\s\S]*?className="h-full bg-primary/);
    expect(contrast(token("primary"), token("muted"))).toBeGreaterThanOrEqual(3);
  });

  it("keeps a destructive menu item readable on its highlight", () => {
    expect(contrast(token("destructive"), over(token("destructive"), 0.1, token("popover")))).toBeGreaterThanOrEqual(4.5);
  });
});
