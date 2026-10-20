import { TOURNAMENT_STATUSES, type TournamentStatus } from "@shared/domain/tournaments";
import { cn } from "@/lib/utils";

export const TOURNAMENT_STATUS_LABELS: Readonly<Record<TournamentStatus, string>> = {
  scheduled: "Scheduled",
  registration: "Registration Open",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

// Whole class names, so Tailwind sees each one; the colours are theme tokens (index.css --status-*).
const STATUS_CLASSES: Readonly<Record<TournamentStatus, string>> = {
  scheduled: "bg-status-scheduled text-status-scheduled-foreground",
  registration: "bg-status-registration text-status-registration-foreground",
  in_progress: "bg-status-live text-status-live-foreground",
  completed: "bg-status-completed text-status-completed-foreground",
  cancelled: "bg-status-cancelled text-status-cancelled-foreground",
};

function isTournamentStatus(value: string): value is TournamentStatus {
  return (TOURNAMENT_STATUSES as readonly string[]).includes(value);
}

/** A status the API sent, as people read it; an unknown one (legacy data) shows as it is. */
export function tournamentStatusLabel(status: string): string {
  return isTournamentStatus(status) ? TOURNAMENT_STATUS_LABELS[status] : status;
}

interface StatusBadgeProps {
  status: string;
  /** Overrides the label, e.g. "Live" on a club's public page. */
  label?: string;
  className?: string;
}

/** A tournament's status as a coloured pill; a running tournament gets a pulsing dot. */
export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const known = isTournamentStatus(status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold",
        known ? STATUS_CLASSES[status] : STATUS_CLASSES.completed,
        className,
      )}
    >
      {status === "in_progress" ? (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current motion-reduce:animate-none" aria-hidden="true" />
      ) : null}
      {label ?? tournamentStatusLabel(status)}
    </span>
  );
}
