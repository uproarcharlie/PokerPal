import type { CSSProperties } from "react";
import type { ClubTheme, ColorSchemeName } from "@shared/domain/theme";
import { badgeVariants } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { previewVariables } from "../colours-draft";

const PANELS: ReadonlyArray<{ scheme: ColorSchemeName; title: string; caption: string }> = [
  { scheme: "light", title: "Public pages", caption: "The club page, QR sign-up, seat finder and season leaderboard" },
  { scheme: "dark", title: "TV clock and dark mode", caption: "The TV clock, and staff screens in dark mode" },
];

/**
 * A small public page drawn in the colours being edited, once on a light page and once on a dark
 * screen: the header, the tabs, a primary button, badges, a link and a TV clock tile, painted with
 * the same tokens (and the same button and badge styles) the real pages use, so what it shows is what
 * the club's pages will look like. Decoration only: nothing in it can be pressed.
 */
export function ThemePreview({ colours, clubName }: { colours: ClubTheme["colors"]; clubName: string }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {PANELS.map(({ scheme, title, caption }) => (
        <figure key={scheme} className="min-w-0 space-y-2" data-testid={`theme-preview-${scheme}`}>
          <figcaption>
            <span className="block text-sm font-semibold text-foreground">{title}</span>
            <span className="block text-sm text-muted-foreground">{caption}</span>
          </figcaption>
          <div
            aria-hidden="true"
            className={cn("space-y-3 rounded-lg border border-border bg-background p-3 text-foreground", scheme === "dark" && "dark")}
            style={previewVariables(colours, scheme) as CSSProperties}
          >
            <div className="rounded-md bg-primary px-3 py-2 text-primary-foreground">
              <p className="truncate font-bold">{clubName}</p>
              <p className="text-sm">Friday Freezeout · 7:00 pm</p>
            </div>
            <div className="flex h-10 w-full items-center rounded-md bg-muted p-1 text-sm font-medium text-muted-foreground">
              <span className="flex-1 rounded-sm bg-primary px-2 py-1.5 text-center text-primary-foreground shadow-sm">Players</span>
              <span className="flex-1 px-2 py-1.5 text-center">Seats</span>
              <span className="flex-1 px-2 py-1.5 text-center">Payouts</span>
            </div>
            <div className="space-y-3 rounded-md border border-border bg-card p-3 text-card-foreground">
              <div className="flex flex-wrap items-center gap-2">
                <span className={badgeVariants()}>Live</span>
                <span className="inline-flex items-center rounded-full bg-accent px-2.5 py-0.5 text-xs font-semibold text-accent-foreground">1st $600</span>
              </div>
              <p className="text-sm">
                Prize pool <span className="font-semibold text-accent-text">$1,200</span> ·{" "}
                <span className="font-medium text-primary underline underline-offset-4">Find your seat</span>
              </p>
              <span className={cn(buttonVariants(), "w-full")}>Sign up</span>
            </div>
            <div className="rounded-md border border-border bg-card p-3 text-center text-card-foreground">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Level 4</p>
              <p className="font-display text-4xl font-bold tabular-nums leading-tight">12:34</p>
              <p className="font-bold tabular-nums">400 / 800</p>
              <p className="text-sm font-semibold tabular-nums text-accent-text">BB ante 800</p>
              <p className="text-sm text-muted-foreground">
                Next: <span className="font-semibold text-primary">600 / 1,200</span>
              </p>
            </div>
          </div>
        </figure>
      ))}
    </div>
  );
}
