import { PODIUM } from "@/components/shared/podium";
import { cn } from "@/lib/utils";

const SIZES = { sm: "h-8 w-8", md: "h-10 w-10" } as const;

/**
 * A leaderboard place in a circle (ties share one, as the server ranks them), coloured for the podium:
 * the one rank style of every leaderboard (the public tables, the staff leaderboard, the dashboard).
 * `labelled` adds "Rank" for screen readers where no column header says so.
 */
export function RankBadge({ rank, size = "md", labelled = false }: { rank: number; size?: keyof typeof SIZES; labelled?: boolean }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full text-sm font-bold",
        SIZES[size],
        PODIUM[rank] ?? "bg-muted text-muted-foreground",
      )}
    >
      {labelled ? <span className="sr-only">Rank </span> : null}
      {rank}
    </span>
  );
}

