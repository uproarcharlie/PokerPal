import { useState, type ReactNode } from "react";
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
}

interface TabHostProps {
  tabs: readonly HostedTab[];
  /** The tab shown first (default: the first). */
  defaultValue?: string;
  /** The tab shown, for a page that keeps the choice itself (with `onValueChange`). */
  value?: string;
  onValueChange?: (value: string) => void;
  className?: string;
}

/**
 * Every set of tabs in the app, one entry each: the TD's tournament page, club and season settings, and
 * the players' pages (the tournament, its standings, a club and its seasons: P3REV5-CQ-03), so they all
 * look and behave alike and Phase 5's club theme styles tabs in one place. A new tab (Phase 4's
 * Seating) is one more entry. The list scrolls sideways on a phone when the tabs do not fit; each tab
 * is at least 40 px tall.
 */
export function TabHost({ tabs, defaultValue, value, onValueChange, className }: TabHostProps) {
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
      <TabsList className="mb-6 flex h-auto w-full justify-start overflow-x-auto">
        {tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value} className="min-h-10 flex-1 basis-auto">
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
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
