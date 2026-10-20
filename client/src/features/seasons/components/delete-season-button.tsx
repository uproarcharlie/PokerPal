import { useState } from "react";
import { useLocation } from "wouter";
import { Trash2 } from "lucide-react";
import type { PublicSeason } from "@shared/api/public";
import { routes } from "@/app/routes";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useDeleteSeason } from "../staff-hooks";

/** "Delete Season", after a confirmation; then back to the seasons list. Only for the club's owner or an admin. */
export function DeleteSeasonButton({ season }: { season: PublicSeason }) {
  const [confirming, setConfirming] = useState(false);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const remove = useDeleteSeason(season.id);

  return (
    <>
      <Button variant="destructive" size="sm" onClick={() => setConfirming(true)}>
        <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
        Delete Season
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Delete ${season.name}?`}
        description="Its points systems are deleted with it. Its tournaments and their results are kept, but they no longer belong to a season or count toward a season leaderboard. This cannot be undone."
        confirmLabel="Delete Season"
        pendingLabel="Deleting…"
        destructive
        onConfirm={async () => {
          await remove.mutateAsync();
          toast({ title: "Season deleted successfully!" });
          navigate(routes.seasons());
        }}
      />
    </>
  );
}
