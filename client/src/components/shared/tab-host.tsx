import { useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export interface HostedTab {
  value: string;
  /** Usually words; may carry a badge (a season's "Active"). */
  label: ReactNode;
  content: ReactNode;
  /**
   * Kept in the page, hidden, while another tab shows, so a half-made edit survives a look at another
   * tab. Other tabs leave the page when hidden (a hidden activity feed stops asking the server).
   */
  keepMounted?: boolean;
  /** Drawn above the label in the bottom bar (`variant="bottom-bar"`); the row of tabs shows none. */
  icon?: LucideIcon;
}

interface TabHostProps {
  tabs: readonly HostedTab[];
  /** The tab shown first (default: the first). */
  defaultValue?: string;
  /** The tab shown, for a page that keeps the choice itself (with `onValueChange`). */
  value?: string;
  onValueChange?: (value: string) => void;
  className?: string;
  /**
   * "row" (the default): the tabs in a row above their content. "bottom-bar": a phone's tab bar, fixed
   * to the bottom of the screen within thumb reach, each tab an icon over its label, at least 56 px
   * tall, clear of the home indicator (round5-contracts §8.1). The content stays where it is.
   */
  variant?: "row" | "bottom-bar";
  /** What the bottom bar is called to a screen reader ("Tournament sections"). */
  label?: string;
}

/** The phone's tab bar: one cell per tab across the width; the open one's icon sits on a primary pill. */
function BottomBar({ tabs, label }: { tabs: readonly HostedTab[]; label?: string }) {
  return (
    <TabsList
      aria-label={label}
      // Marks the screen as having a bar at its foot: the toasts rise above it (toaster.tsx).
      data-bottom-bar=""
      className="fixed inset-x-0 bottom-0 z-30 flex h-auto items-stretch justify-between gap-0 rounded-none border-t border-border bg-card p-0 pb-[env(safe-area-inset-bottom)] text-muted-foreground"
    >
      {tabs.map(({ value, label: name, icon: Icon }) => (
        <TabsTrigger
          key={value}
          value={value}
          className="group flex min-h-14 min-w-0 flex-1 basis-0 flex-col gap-0.5 whitespace-normal rounded-none px-1 py-1.5 text-xs leading-tight data-[state=active]:bg-transparent data-[state=active]:font-semibold data-[state=active]:text-foreground data-[state=active]:shadow-none"
        >
          {Icon ? (
            <span className="flex h-7 w-12 items-center justify-center rounded-full group-data-[state=active]:bg-primary group-data-[state=active]:text-primary-foreground">
              <Icon className="h-5 w-5" aria-hidden="true" />
            </span>
          ) : null}
          <span className="max-w-full truncate">{name}</span>
        </TabsTrigger>
      ))}
    </TabsList>
  );
}

/**
 * Every set of tabs in the app, one entry each: the TD's tournament page, club and season settings, and
 * the players' pages (the tournament, its standings, a club and its seasons: P3REV5-CQ-03), so they all
 * look and behave alike and Phase 5's club theme styles tabs in one place. A new tab (Phase 4's
 * Seating) is one more entry. The list scrolls sideways on a phone when the tabs do not fit; each tab
 * is at least 40 px tall. The TD's page on a phone puts its tabs in a bottom bar instead (`variant`).
 */
export function TabHost({ tabs, defaultValue, value, onValueChange, className, variant = "row", label }: TabHostProps) {
  const [ownChoice, setOwnChoice] = useState(defaultValue ?? tabs[0]?.value ?? "");
  const chosen = value ?? ownChoice;
  const choose = (next: string) => {
    setOwnChoice(next);
    onValueChange?.(next);
  };
  // A tab that is no longer offered (its viewer lost access) falls back to the first.
  const active = tabs.some((tab) => tab.value === chosen) ? chosen : (tabs[0]?.value ?? "");
  return (
    <Tabs value={active} onValueChange={choose} className={cn("w-full", className)}>
      {variant === "bottom-bar" ? (
        <BottomBar tabs={tabs} label={label} />
      ) : (
        <TabsList aria-label={label} className="mb-6 flex h-auto w-full justify-start overflow-x-auto">
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="min-h-10 flex-1 basis-auto">
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      )}
      {tabs.map(({ value, content, keepMounted }) =>
        keepMounted ? (
          <TabsContent key={value} value={value} forceMount hidden={active !== value} className="mt-0">
            {content}
          </TabsContent>
        ) : (
          <TabsContent key={value} value={value} className="mt-0">
            {content}
          </TabsContent>
        ),
      )}
    </Tabs>
  );
}
