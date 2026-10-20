import { useRef, useState } from "react";
import type { PublicPointsSystem } from "@shared/api/public";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { QueryState } from "@/components/shared/query-state";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { usePointsSystems } from "../hooks";
import { useDeletePointsSystem } from "../staff-hooks";
import { PointsSystemCard } from "./points-system-card";

/** "Existing Points Systems": the season's systems, each with its position points, deleted after a confirmation. */
export function PointsSystemList({ seasonId }: { seasonId: string }) {
  const systems = usePointsSystems(seasonId);
  const remove = useDeletePointsSystem();
  const { toast } = useToast();
  const [deleting, setDeleting] = useState<PublicPointsSystem | null>(null);
  // The deleted system's card, and the Delete that opened the confirmation, are gone once it closes.
  const heading = useRef<HTMLHeadingElement>(null);

  return (
    <Card>
      <CardContent className="pt-6">
        <h2 ref={heading} tabIndex={-1} className="mb-4 text-lg font-semibold text-foreground focus:outline-none">
          Existing Points Systems
        </h2>
        <QueryState
          query={systems}
          errorTitle="Points systems could not be loaded"
          empty={<p className="text-sm text-muted-foreground">No points systems yet. Create one below to award season points.</p>}
        >
          {(list) => (
            <ul role="list" aria-label="Points systems" className="space-y-3">
              {list.map((system) => (
                <PointsSystemCard key={system.id} system={system} onDelete={() => setDeleting(system)} />
              ))}
            </ul>
          )}
        </QueryState>
        <ConfirmDialog
          open={deleting !== null}
          onOpenChange={(open) => !open && setDeleting(null)}
          title={`Delete ${deleting?.name ?? "this points system"}?`}
          description="Tournaments that use it keep the points they have already awarded, but score no season points when they are finalized from now on. This cannot be undone."
          confirmLabel="Delete points system"
          pendingLabel="Deleting…"
          destructive
          returnFocusTo={heading}
          onConfirm={async () => {
            if (!deleting) return;
            await remove.mutateAsync(deleting.id);
            toast({ title: "Points system deleted successfully!" });
          }}
        />
      </CardContent>
    </Card>
  );
}
