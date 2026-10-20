import type { RefObject } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PlayerAvatar } from "@/components/image/player-avatar";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api/http";
import type { PublicRegistration } from "@shared/api/public";
import { updateRegistrationSchema } from "@shared/api/registrations";
import { useUpdateRegistration } from "../../staff-hooks";
import { playerName } from "../../player-name";
import { formResolver } from "@/lib/forms";

/** The menu's "nobody" choice (a menu item cannot have an empty value). */
const NOBODY = "none";

const eliminateSchema = z.object({
  eliminatedBy: z.preprocess((value) => (value === NOBODY || value === "" ? null : value), updateRegistrationSchema.innerType().shape.eliminatedBy),
});

interface EliminatePlayerDialogProps {
  tournamentId: string;
  /** Who is going out; null closes the dialog. */
  registration: PublicRegistration | null;
  registrations: readonly PublicRegistration[];
  /** Once the server has the elimination, before the dialog closes. */
  onEliminated?: (registrationId: string) => void;
  onClose: () => void;
  /** Where focus goes on close when the Eliminate that opened the dialog is gone (its row now offers Restore). */
  returnFocusTo?: RefObject<HTMLElement | null>;
}

/**
 * Marks a player out, optionally crediting the knockout. The server stamps the time and credits the
 * eliminator. Each player gets a fresh form, so a choice made for one player (then dismissed) is never
 * sent for the next (CA-08).
 */
export function EliminatePlayerDialog({ tournamentId, registration, registrations, onEliminated, onClose, returnFocusTo }: EliminatePlayerDialogProps) {
  return (
    <Dialog open={registration !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md" returnFocusTo={returnFocusTo}>
        {registration ? (
          <EliminateForm
            key={registration.id}
            tournamentId={tournamentId}
            registration={registration}
            registrations={registrations}
            onEliminated={onEliminated}
            onClose={onClose}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function EliminateForm({
  tournamentId,
  registration,
  registrations,
  onEliminated,
  onClose,
}: Omit<EliminatePlayerDialogProps, "returnFocusTo"> & { registration: PublicRegistration }) {
  const { toast } = useToast();
  const eliminate = useUpdateRegistration(tournamentId);
  const form = useForm<{ eliminatedBy: string }>({ resolver: formResolver(eliminateSchema), defaultValues: { eliminatedBy: "" } });
  // Who can be credited: the players still in, other than the one going out.
  const stillIn = registrations.filter((other) => !other.isEliminated && other.playerId !== registration.playerId);

  const submit = form.handleSubmit(async (values) => {
    const { eliminatedBy } = eliminateSchema.parse(values);
    try {
      await eliminate.mutateAsync({
        registrationId: registration.id,
        input: { isEliminated: true, eliminatedBy: stillIn.some((other) => other.playerId === eliminatedBy) ? eliminatedBy : null },
      });
    } catch (error) {
      toast({ title: "Could not eliminate the player", description: errorMessage(error, "Failed to eliminate player"), variant: "destructive" });
      return;
    }
    toast({ title: "Player eliminated successfully" });
    onEliminated?.(registration.id);
    onClose();
  });

  return (
    <Form {...form}>
      <form onSubmit={submit} noValidate>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserX className="h-5 w-5 text-destructive" aria-hidden="true" />
            Eliminate Player
          </DialogTitle>
          <DialogDescription>
            Eliminate {registration.player?.name ?? "this player"} from the tournament. Optionally assign the knockout to another player.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <FormField
            control={form.control}
            name="eliminatedBy"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Knocked out by (optional)</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select player (optional)" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value={NOBODY}>None</SelectItem>
                    {stillIn.map((other) => (
                      <SelectItem key={other.playerId} value={other.playerId} className="py-2">
                        <span className="flex items-center gap-2">
                          <PlayerAvatar name={other.player?.name ?? ""} imageUrl={other.player?.imageUrl} size="xs" />
                          <span>{playerName(other)}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormDescription className="text-xs">Select the player who knocked them out to track knockout statistics</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="destructive" busy={eliminate.isPending}>
            {eliminate.isPending ? "Eliminating…" : "Eliminate Player"}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
