import { useState } from "react";
import { useForm } from "react-hook-form";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api/http";
import { createClubFormSchema, profileValues, type ClubProfileValues } from "../club-form";
import { useCreateClub } from "../staff-hooks";
import { ClubProfileFields } from "./club-profile-fields";
import { formResolver, showServerFieldErrors } from "@/lib/forms";

const FIELDS = ["name", "slug", "description", "imageUrl", "address", "timezone"] as const;

interface CreateClubDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** The slide-out form for a new club; the person who creates it becomes its owner. */
export function CreateClubDialog({ open, onOpenChange }: CreateClubDialogProps) {
  const { toast } = useToast();
  const create = useCreateClub();
  const [uploading, setUploading] = useState(false);
  const form = useForm<ClubProfileValues>({ resolver: formResolver(createClubFormSchema), defaultValues: profileValues() });

  const onSubmit = form.handleSubmit(async (values) => {
    if (uploading) return;
    try {
      await create.mutateAsync(createClubFormSchema.parse(values));
    } catch (error) {
      if (!showServerFieldErrors(form.setError, error, { fields: FIELDS, codes: { SLUG_TAKEN: "slug" } })) {
        toast({ title: "Could not create the club", description: errorMessage(error), variant: "destructive" });
      }
      return;
    }
    toast({ title: "Club created successfully!" });
    onOpenChange(false);
    form.reset(profileValues());
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-[540px] md:max-w-[640px]">
        <SheetHeader className="shrink-0">
          <SheetTitle>Create New Club</SheetTitle>
          <SheetDescription>Set up a new poker club to organize tournaments and manage your poker community.</SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
            <div className="flex-1 space-y-4 overflow-y-auto px-1 py-4">
              <ClubProfileFields form={form} slugFromNameAsTyped onUploadingChange={setUploading} />
            </div>
            <SheetFooter className="shrink-0 gap-2 border-t pt-4">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} data-testid="cancel-club">
                Cancel
              </Button>
              <Button type="submit" disabled={uploading} busy={create.isPending} data-testid="create-club-final">
                <Check className="mr-2 h-4 w-4" aria-hidden="true" />
                {uploading ? "Uploading image…" : create.isPending ? "Creating..." : "Create Club"}
              </Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
