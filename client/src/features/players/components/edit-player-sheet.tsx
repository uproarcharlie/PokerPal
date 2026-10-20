import { useState } from "react";
import { useForm } from "react-hook-form";
import { Check } from "lucide-react";
import { updatePlayerSchema, type StaffPlayer } from "@shared/api/players";
import { ImageField } from "@/components/image/image-field";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { showServerFieldErrors, formResolver } from "@/lib/forms";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api/http";
import { useUpdatePlayer } from "../hooks";

/** A player as an edit starts from: their photo only when the list that opened it knows it. */
export type EditablePlayer = Pick<StaffPlayer, "id" | "name" | "email" | "phone"> & { imageUrl?: string | null };

interface PlayerFormValues {
  name: string;
  email: string;
  phone: string;
  /** Left out when the photo is not offered, so saving never touches it. */
  imageUrl?: string | null;
}

const FIELDS = ["name", "email", "phone", "imageUrl"] as const;

interface EditPlayerSheetProps {
  /** The player being edited; null when closed. */
  player: EditablePlayer | null;
  onClose: () => void;
}

/** Edit a player's photo, name, email and phone in a panel from the side. */
export function EditPlayerSheet({ player, onClose }: EditPlayerSheetProps) {
  return (
    <Sheet open={player !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-[540px]">
        <SheetHeader className="shrink-0">
          <SheetTitle>Edit Player</SheetTitle>
          <SheetDescription>Update player information and profile.</SheetDescription>
        </SheetHeader>
        {player ? <PlayerForm key={player.id} player={player} onDone={onClose} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function PlayerForm({ player, onDone }: { player: EditablePlayer; onDone: () => void }) {
  const { toast } = useToast();
  const save = useUpdatePlayer();
  const [uploading, setUploading] = useState(false);
  const withPhoto = player.imageUrl !== undefined;
  const form = useForm<PlayerFormValues>({
    resolver: formResolver(updatePlayerSchema),
    defaultValues: {
      name: player.name,
      email: player.email ?? "",
      phone: player.phone ?? "",
      ...(withPhoto ? { imageUrl: player.imageUrl } : {}),
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      // A cleared email, phone or photo goes as null, so it really is removed (CA-24, img-04).
      await save.mutateAsync({ id: player.id, input: updatePlayerSchema.parse(values) });
      toast({ title: "Player updated", description: `${values.name.trim()}'s details are saved.` });
      onDone();
    } catch (error) {
      if (showServerFieldErrors(form.setError, error, { fields: FIELDS, codes: { PHONE_TAKEN: "phone" } })) return;
      toast({ title: "Could not save the player", description: errorMessage(error), variant: "destructive" });
    }
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 space-y-4 overflow-y-auto px-1 py-4">
          {withPhoto ? (
            <FormField
              control={form.control}
              name="imageUrl"
              render={({ field }) => (
                <FormItem>
                  <ImageField
                    kind="player_avatar"
                    label="Player Photo"
                    value={field.value}
                    onChange={field.onChange}
                    onUploadingChange={setUploading}
                  />
                  <FormMessage />
                </FormItem>
              )}
            />
          ) : null}
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem required>
                <FormLabel>Player Name</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="e.g. Jane Smith" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email Address</FormLabel>
                <FormControl>
                  <Input {...field} type="email" placeholder="e.g. jane@example.com" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Phone Number</FormLabel>
                <FormControl>
                  <Input {...field} type="tel" placeholder="e.g. 021 123 4567" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <div className="flex shrink-0 flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={uploading} busy={save.isPending}>
            <Check className="mr-2 h-4 w-4" aria-hidden="true" />
            {uploading ? "Uploading image..." : save.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
