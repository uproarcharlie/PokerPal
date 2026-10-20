import { RefreshCw, Trash2 } from "lucide-react";
import type { PublicPointsSystem } from "@shared/api/public";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api/http";
import { formatNumber } from "@/lib/format";
import { positionRange } from "../format";
import { usePointsAllocations } from "../hooks";

/** The points each finishing position earns under one system. */
function AllocationSummary({ system }: { system: PublicPointsSystem }) {
  const allocations = usePointsAllocations(system.id);

  if (allocations.isPending) {
    return (
      <div role="status" aria-live="polite" className="mt-3">
        <span className="sr-only">Loading position points</span>
        <Skeleton className="h-4 w-40" />
      </div>
    );
  }
  if (allocations.isError) {
    return (
      <div role="alert" className="mt-3 flex flex-wrap items-center gap-2 text-sm text-destructive">
        <span>Position points could not be loaded: {errorMessage(allocations.error)}</span>
        <Button variant="outline" size="sm" onClick={() => void allocations.refetch()} busy={allocations.isRefetching}>
          <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
          Try again
        </Button>
      </div>
    );
  }
  if (allocations.data.length === 0) {
    return <p className="mt-3 text-sm text-muted-foreground">No points for finishing positions.</p>;
  }
  return (
    <ul role="list" aria-label={`${system.name} position points`} className="mt-3 flex flex-wrap gap-2 text-sm">
      {allocations.data.map((allocation) => (
        <li key={allocation.id} className="rounded-md bg-muted px-2 py-1 text-foreground">
          <span className="font-medium">{positionRange(allocation.position, allocation.positionEnd)}</span>:{" "}
          {formatNumber(allocation.points)} pts
          {allocation.description ? <span className="text-muted-foreground"> ({allocation.description})</span> : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * One of the season's points systems: its rules, and Delete. The confirmation is the list's, since the
 * card goes as soon as the system is deleted (P3REV-MA-FOCUS-AFTER-REMOVE).
 */
export function PointsSystemCard({ system, onDelete }: { system: PublicPointsSystem; onDelete: () => void }) {
  return (
    <li className="rounded-lg border border-border p-4" data-testid={`points-system-${system.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words font-medium text-foreground">{system.name}</p>
          {system.description ? <p className="text-sm text-muted-foreground">{system.description}</p> : null}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {system.participationPoints ? <span>Participation: {formatNumber(system.participationPoints)} pts</span> : null}
            {system.knockoutPoints ? <span>Knockout: {formatNumber(system.knockoutPoints)} pts</span> : null}
          </div>
        </div>
        <Button variant="ghost" size="icon" aria-label={`Delete ${system.name}`} onClick={onDelete}>
          <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
        </Button>
      </div>
      <AllocationSummary system={system} />
    </li>
  );
}
