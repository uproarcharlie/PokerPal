import { cn } from "@/lib/utils";

/** The mark on a player who has not paid yet: an amber dot, and the words for screen readers. */
export function UnpaidDot({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center", className)}>
      <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-status-scheduled-foreground" />
      <span className="sr-only">, not paid</span>
    </span>
  );
}
