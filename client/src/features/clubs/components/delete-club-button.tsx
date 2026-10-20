import { useState } from "react";
import { useLocation } from "wouter";
import { Trash2 } from "lucide-react";
import type { ClubDto } from "@shared/api/public";
import { routes } from "@/app/routes";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useDeleteClub } from "../staff-hooks";

/**
 * Delete Club, asked twice and only once the club's name is typed (CA-33); only the owner or an admin is
 * shown it (`viewer.canOwn`).
 */
export function DeleteClubButton({ club }: { club: ClubDto }) {
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const remove = useDeleteClub(club.id);

  const confirm = async () => {
    await remove.mutateAsync();
    navigate(routes.clubs());
    toast({ title: "Club deleted successfully!" });
  };

  return (
    <>
      <Button variant="destructive" onClick={() => setOpen(true)}>
        <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
        Delete Club
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete Club"
        description={`Are you sure you want to delete ${club.name}? This action cannot be undone and will remove all associated seasons, tournaments, and data.`}
        confirmLabel="Delete club"
        pendingLabel="Deleting…"
        destructive
        confirmText={club.name}
        onConfirm={confirm}
      />
    </>
  );
}
