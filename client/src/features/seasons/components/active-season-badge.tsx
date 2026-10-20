import { cn } from "@/lib/utils";

/** "Active Season" (or `label`), in the theme's live-status colours. */
export function ActiveSeasonBadge({ label = "Active Season", className }: { label?: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full bg-status-live px-2.5 py-0.5 text-xs font-semibold text-status-live-foreground",
        className,
      )}
    >
      {label}
    </span>
  );
}
