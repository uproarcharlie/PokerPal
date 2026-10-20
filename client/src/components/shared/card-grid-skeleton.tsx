import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface CardGridSkeletonProps {
  /** Read out while it shows, e.g. "Loading clubs". */
  label: string;
  /** The grid's columns, as the loaded grid has them. */
  className?: string;
}

/** A page of cards while it loads: three card-sized placeholders in the page's own grid. */
export function CardGridSkeleton({ label, className = "md:grid-cols-2 lg:grid-cols-3" }: CardGridSkeletonProps) {
  return (
    <div role="status" aria-live="polite" className={cn("grid grid-cols-1 gap-6", className)}>
      <span className="sr-only">{label}</span>
      {[1, 2, 3].map((key) => (
        <Skeleton key={key} className="h-64 rounded-lg" />
      ))}
    </div>
  );
}
