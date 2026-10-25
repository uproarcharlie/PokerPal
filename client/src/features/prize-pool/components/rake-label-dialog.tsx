import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api/http";
import { formResolver, showServerFieldErrors } from "@/lib/forms";
import { rakeLabelSchema } from "@shared/api/clubs";
import { DEFAULT_RAKE_LABEL } from "@shared/domain/prize-pool";
import { useUpdateClub } from "@/features/clubs/staff-hooks";
import { RakeLabelInput } from "./rake-label-input";

const renameSchema = z.object({ rakeLabel: rakeLabelSchema });

interface RakeLabelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  club: { id: string; name: string; rakeLabel: string | null };
}

/** Renames the club's AP: one setting for every tournament the club runs (display only, never in the maths). */
export function RakeLabelDialog({ open, onOpenChange, club }: RakeLabelDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">{open ? <RenameForm club={club} onClose={() => onOpenChange(false)} /> : null}</DialogContent>
    </Dialog>
  );
}

function RenameForm({ club, onClose }: { club: RakeLabelDialogProps["club"]; onClose: () => void }) {
  const { toast } = useToast();
  const rename = useUpdateClub(club.id);
  const form = useForm<{ rakeLabel: string }>({
    resolver: formResolver(renameSchema),
    defaultValues: { rakeLabel: club.rakeLabel ?? "" },
  });

  const submit = form.handleSubmit(async (values) => {
    const rakeLabel = renameSchema.parse(values).rakeLabel ?? null;
    try {
      await rename.mutateAsync({ rakeLabel });
    } catch (error) {
      if (!showServerFieldErrors(form.setError, error, { fields: ["rakeLabel"] })) {
        toast({ title: "Could not rename it", description: errorMessage(error), variant: "destructive" });
      }
      return;
    }
    toast({ title: `Now called ${rakeLabel ?? DEFAULT_RAKE_LABEL}`, description: `Across every tournament in ${club.name}` });
    onClose();
  });

  return (
    <Form {...form}>
      <form onSubmit={submit} noValidate>
        <DialogHeader>
          <DialogTitle>What does {club.name} call its rake?</DialogTitle>
          <DialogDescription>Applies to every tournament in {club.name}. It is only a name: the amounts stay the same.</DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <FormField
            control={form.control}
            name="rakeLabel"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Name</FormLabel>
                <FormControl>
                  <RakeLabelInput {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" busy={rename.isPending} data-testid="save-rake-label">
            Save
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
