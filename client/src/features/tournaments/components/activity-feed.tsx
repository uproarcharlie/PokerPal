import { createContext, memo, useContext, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowLeftRight,
  Armchair,
  Bird,
  Calculator,
  CheckCircle,
  DollarSign,
  Handshake,
  ListOrdered,
  Lock,
  Percent,
  PlayCircle,
  PlusCircle,
  RotateCcw,
  Scale,
  Shuffle,
  Swords,
  Table2,
  Timer,
  Trophy,
  Undo2,
  UserMinus,
  UserPlus,
  UserX,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, LoadingRows, QueryState } from "@/components/shared/query-state";
import { ScrollRegion } from "@/components/shared/scroll-region";
import { formatRelativeTime, plural } from "@/lib/format";
import { useFocusOnChange } from "@/hooks/use-focus-on-change";
import { cn } from "@/lib/utils";
import { ACTIVITY_EVENT_TYPES, type ActivityEventType } from "@shared/domain/tournaments";
import type { ActivityDto } from "@shared/api/public";
import { ACTIVITY_FEED_LIMIT, useActivity, useWholeActivity } from "../hooks";
import { useNow } from "@/hooks/use-now";

type Tone = "primary" | "accent" | "destructive" | "muted";

/** Theme tokens only: the feed is also on the public page, which a club's theme restyles. */
const TONE_CLASSES: Readonly<Record<Tone, string>> = {
  primary: "text-primary",
  accent: "text-accent-text",
  destructive: "text-destructive",
  muted: "text-muted-foreground",
};

interface EventStyle {
  Icon: typeof Activity;
  tone: Tone;
  label: string;
}

/** How every event the server writes is shown; a Record, so a new event type cannot be left out (P2REV4-CQ-07). */
const EVENT_STYLES: Readonly<Record<ActivityEventType, EventStyle>> = {
  registration: { Icon: UserPlus, tone: "primary", label: "Registration" },
  registration_removed: { Icon: UserMinus, tone: "muted", label: "Entry Removed" },
  elimination: { Icon: UserX, tone: "destructive", label: "Elimination" },
  knockout_credited: { Icon: Swords, tone: "destructive", label: "Knockout" },
  player_restored: { Icon: RotateCcw, tone: "primary", label: "Restored" },
  rebuy: { Icon: DollarSign, tone: "primary", label: "Re-buy" },
  addon: { Icon: PlusCircle, tone: "primary", label: "Add-on" },
  reentry: { Icon: RotateCcw, tone: "primary", label: "Re-entry" },
  payment_confirmed: { Icon: CheckCircle, tone: "primary", label: "Payment" },
  high_hand: { Icon: Trophy, tone: "accent", label: "High Hand" },
  status_change: { Icon: PlayCircle, tone: "muted", label: "Status Change" },
  prize_pool_locked: { Icon: Lock, tone: "muted", label: "Pool Locked" },
  prize_pool_adjusted: { Icon: Calculator, tone: "muted", label: "Prize Pool" },
  rake_rates_changed: { Icon: Percent, tone: "muted", label: "Rates" },
  tournament_refinalized: { Icon: ListOrdered, tone: "muted", label: "Results Corrected" },
  tables_added: { Icon: Table2, tone: "muted", label: "Tables" },
  table_updated: { Icon: Table2, tone: "muted", label: "Table" },
  table_removed: { Icon: Table2, tone: "muted", label: "Table Removed" },
  table_broken: { Icon: Table2, tone: "muted", label: "Table Broken" },
  seating_drawn: { Icon: Shuffle, tone: "primary", label: "Seat Draw" },
  seat_assigned: { Icon: Armchair, tone: "primary", label: "Seat" },
  seats_swapped: { Icon: ArrowLeftRight, tone: "primary", label: "Seats Swapped" },
  seat_released: { Icon: Armchair, tone: "muted", label: "Unseated" },
  seating_balanced: { Icon: Scale, tone: "primary", label: "Tables Balanced" },
  final_table: { Icon: Trophy, tone: "accent", label: "Final Table" },
  seating_undone: { Icon: Undo2, tone: "muted", label: "Seats Undone" },
  clock_started: { Icon: Timer, tone: "primary", label: "Clock" },
  clock_paused: { Icon: Timer, tone: "muted", label: "Clock" },
  clock_resumed: { Icon: Timer, tone: "primary", label: "Clock" },
  clock_level_changed: { Icon: Timer, tone: "primary", label: "Level" },
  clock_time_adjusted: { Icon: Timer, tone: "muted", label: "Clock" },
  clock_reset: { Icon: Timer, tone: "muted", label: "Clock" },
  clock_undone: { Icon: Timer, tone: "muted", label: "Clock" },
  clock_structure_updated: { Icon: Timer, tone: "muted", label: "Structure" },
  early_bird: { Icon: Bird, tone: "muted", label: "Early Bird" },
  payouts_changed: { Icon: Calculator, tone: "muted", label: "Payouts" },
  deal: { Icon: Handshake, tone: "accent", label: "Deal" },
  table_opened: { Icon: Table2, tone: "primary", label: "Table Opened" },
  seat_waiting: { Icon: Armchair, tone: "accent", label: "Waiting" },
};

/** Rows written before Phase 2 may hold an event type the app no longer writes. */
const OTHER_EVENT: EventStyle = { Icon: Activity, tone: "muted", label: "Event" };

const KNOWN_EVENT_TYPES: ReadonlySet<string> = new Set(ACTIVITY_EVENT_TYPES);

function eventStyle(eventType: string): EventStyle {
  return KNOWN_EVENT_TYPES.has(eventType) ? EVENT_STYLES[eventType as ActivityEventType] : OTHER_EVENT;
}

function FeedCard({ description, children }: { description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader className="border-b border-border">
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5" aria-hidden="true" />
          Activity Feed
        </CardTitle>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </CardHeader>
      <CardContent className="p-4 sm:p-6">{children}</CardContent>
    </Card>
  );
}

interface ActivityFeedProps {
  tournamentId: string;
  /** Followed every few seconds while the tournament is open; read once when it is over (PUB-11). */
  live: boolean;
}

/**
 * The newest events, then (once the whole feed was asked for) the older ones it holds. Every event in
 * the whole feed that is not among the newest is older than all of them, so the order holds.
 */
function feedOf(latest: readonly ActivityDto[], whole: readonly ActivityDto[] | undefined): readonly ActivityDto[] {
  if (whole === undefined) return latest;
  const shown = new Set(latest.map((entry) => entry.id));
  return [...latest, ...whole.filter((entry) => !shown.has(entry.id))];
}

/**
 * What has happened in a tournament, newest first: the newest ACTIVITY_FEED_LIMIT followed, and the
 * rest of the night fetched once, when asked for, and never polled (P3REV-PERF-ACTIVITY-FULL-LIST-POLL).
 */
export function ActivityFeed({ tournamentId, live }: ActivityFeedProps) {
  const activity = useActivity(tournamentId, { live });
  const [showEarlier, setShowEarlier] = useState(false);
  const whole = useWholeActivity(tournamentId, { enabled: showEarlier });
  // The button goes once the rest is in: focus moves to the line that says so, not to the top of the page.
  const wholeShown = useFocusOnChange<HTMLParagraphElement>(whole.data === undefined ? "newest" : "whole");
  return (
    <FeedCard description="Real-time tournament events">
      <QueryState
        query={activity}
        loading={<LoadingRows rows={5} />}
        errorTitle="The activity could not be loaded"
        empty={
          <EmptyState
            icon={<Activity className="h-8 w-8" />}
            title="No activity yet"
            description="Events will appear here as they happen"
          />
        }
      >
        {(latest) => {
          const entries = feedOf(latest, whole.data);
          return (
            <>
              <ActivityList entries={entries} />
              {whole.data !== undefined ? (
                <p ref={wholeShown} tabIndex={-1} className="mt-4 border-t border-border pt-4 text-center text-sm text-muted-foreground focus:outline-none">
                  Showing all {plural(entries.length, "event")}.
                </p>
              ) : null}
              {/* A full page of the newest may have more behind it; the whole feed is all there is. */}
              {latest.length >= ACTIVITY_FEED_LIMIT && whole.data === undefined ? (
                <div className="mt-4 flex flex-col items-center gap-2 border-t border-border pt-4">
                  {whole.isError ? (
                    <p role="alert" className="text-sm text-destructive">
                      The earlier activity could not be loaded.
                    </p>
                  ) : null}
                  <Button
                    variant="outline"
                    busy={whole.isFetching}
                    onClick={() => (showEarlier ? void whole.refetch() : setShowEarlier(true))}
                    data-testid="show-earlier-activity"
                  >
                    {whole.isFetching ? "Loading…" : whole.isError ? "Try again" : "Show earlier activity"}
                  </Button>
                </div>
              ) : null}
            </>
          );
        }}
      </QueryState>
    </FeedCard>
  );
}

/** How often the "2 minutes ago" labels move on, whether or not anything new has happened. */
export const RELATIVE_TIME_TICK_MS = 30_000;

/** The list's clock: only the time labels read it, so its tick redraws them and not every row. */
const FeedClock = createContext(0);

function ActivityList({ entries }: { entries: readonly ActivityDto[] }) {
  // Its own clock: a poll that brings nothing new no longer re-draws the page, and the labels with it.
  const now = useNow(RELATIVE_TIME_TICK_MS);
  return (
    <FeedClock.Provider value={now}>
      <ScrollRegion label="Tournament activity" className="max-h-[600px] overflow-y-auto pr-2">
        <ol role="list" className="space-y-4">
          {entries.map((entry) => (
            <ActivityRow key={entry.id} entry={entry} />
          ))}
        </ol>
      </ScrollRegion>
    </FeedClock.Provider>
  );
}

/**
 * One event. Drawn again only when it changes: a poll keeps an unchanged event's object, so a new event
 * draws one row, not the whole feed (P3REV-PERF-ACTIVITY-FULL-LIST-POLL).
 */
const ActivityRow = memo(function ActivityRow({ entry }: { entry: ActivityDto }) {
  const { Icon, tone, label } = eventStyle(entry.eventType);
  return (
    <li className="flex items-start gap-3 border-b border-border pb-4 last:border-0 last:pb-0" data-testid="activity-entry">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
        <Icon className={cn("h-4 w-4", TONE_CLASSES[tone])} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={cn("text-xs", TONE_CLASSES[tone])}>
            {label}
          </Badge>
          {entry.timestamp ? <RelativeTime timestamp={entry.timestamp} /> : null}
        </div>
        <p className="text-sm text-foreground">{entry.description}</p>
        {entry.player ? <p className="mt-1 text-xs text-muted-foreground">Player: {entry.player.name}</p> : null}
      </div>
    </li>
  );
});

function RelativeTime({ timestamp }: { timestamp: string }) {
  const now = useContext(FeedClock);
  return (
    <time dateTime={timestamp} className="text-xs text-muted-foreground">
      {formatRelativeTime(timestamp, new Date(now))}
    </time>
  );
}
