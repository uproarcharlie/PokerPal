import { Trophy } from "lucide-react";
import { ordinal } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The podium places' colours, strongest first, from the theme's accent so a club's colours carry
 * through (Phase 5): the one podium style of every place the app shows, in the prize tables, the
 * leaderboards and both standings tables alike (P3REV5-CQ-09, P3REV3-CQ-09).
 */
export const PODIUM: Readonly<Record<number, string>> = {
  1: "bg-accent text-accent-foreground",
  2: "bg-accent/60 text-accent-foreground",
  3: "bg-accent/30 text-foreground",
};

export const isPodium = (place: number) => PODIUM[place] !== undefined;

/** A place in a prize table: "1st", with the podium's trophy before the top three. */
export function PlaceName({ place, suffix }: { place: number; suffix?: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      {isPodium(place) ? (
        <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full", PODIUM[place])} aria-hidden="true">
          <Trophy className="h-3.5 w-3.5" />
        </span>
      ) : null}
      {ordinal(place)}
      {suffix ? ` ${suffix}` : null}
    </span>
  );
}

/** A player still in: the live colour, as the tournament's status shows a game being played. */
const STILL_IN = "bg-status-live text-status-live-foreground";
const OFF_PODIUM = "bg-muted text-muted-foreground";

/**
 * A standing's place in a round badge, the same on the TD's page and the players' phones: the
 * podium's colours for 1st to 3rd, the live colour and "–" (said "Still in") for a player still in,
 * muted for the rest. `finished`: the tournament is over, so a missing place is not "still in".
 */
export function PlaceBadge({ place, finished = false }: { place: number | null; finished?: boolean }) {
  const stillIn = place === null && !finished;
  return (
    <span
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold",
        stillIn ? STILL_IN : place === null ? OFF_PODIUM : (PODIUM[place] ?? OFF_PODIUM),
      )}
      data-testid="place-badge"
    >
      {place ?? (
        <>
          <span aria-hidden="true">–</span>
          <span className="sr-only">{stillIn ? "Still in" : "No place"}</span>
        </>
      )}
    </span>
  );
}

const PILL = "inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold";

/**
 * Where a player stands, as a pill, on both standings tables: their place once the tournament is
 * over (never "Active" for the winner), else Eliminated or Active.
 */
export function StandingStatus({ place, eliminated, completed }: { place: number | null; eliminated: boolean; completed: boolean }) {
  if (completed) return <span className={cn(PILL, "bg-muted text-foreground")}>{place ? ordinal(place) : "Finished"}</span>;
  return eliminated ? (
    <span className={cn(PILL, "bg-destructive/10 text-destructive")}>Eliminated</span>
  ) : (
    <span className={cn(PILL, STILL_IN)}>Active</span>
  );
}
