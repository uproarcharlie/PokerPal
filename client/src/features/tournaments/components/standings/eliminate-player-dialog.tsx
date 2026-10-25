import type { RefObject } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PlayerAvatar } from "@/components/image/player-avatar";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api/http";
import type { PublicRegistration } from "@shared/api/public";
import type { SeatingDto } from "@shared/api/seating";
import { updateRegistrationSchema } from "@shared/api/registrations";
import { useUpdateRegistration } from "../../staff-hooks";
import { playerName } from "../../player-name";
import { formResolver } from "@/lib/forms";
import { useUndoElimination, type UndoElimination } from "./undo-elimination";

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
  /** Who sits where (the seating plan's): the players at the same table are offered first. */
  seatOf?: SeatingDto["seatByRegistrationId"];
  /** Once the server has the elimination, before the dialog closes. */
  onEliminated?: (registrationId: string) => void;
  onClose: () => void;
  /** Where focus goes on close when the Eliminate that opened the dialog is gone (its row now offers Restore). */
  returnFocusTo?: RefObject<HTMLElement | null>;
}

/**
 * Marks a player out, optionally crediting the knockout. The server stamps the time and credits the
 * eliminator. Each player gets a fresh form, so a choice made for one player (then dismissed) is never
 * sent for the next (CA-08). The toast that confirms it can take it back (TDN3-BUST-NO-UNDO).
 */
export function EliminatePlayerDialog({ tournamentId, registration, registrations, seatOf, onEliminated, onClose, returnFocusTo }: EliminatePlayerDialogProps) {
  // Here, not in the form: the toast's Undo outlives the form, which leaves with the dialog.
  const undo = useUndoElimination(tournamentId);
  return (
    <Dialog open={registration !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md" returnFocusTo={returnFocusTo}>
        {registration ? (
          <EliminateForm
            key={registration.id}
            tournamentId={tournamentId}
            registration={registration}
            registrations={registrations}
            seatOf={seatOf}
            onEliminated={onEliminated}
            onClose={onClose}
            undo={undo}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Who can be credited with the knockout: the players still in other than the one going out, those at
 * the same table first (by seat: the knockout is almost always one of them), then everyone else.
 */
export function knockoutChoices(
  registration: PublicRegistration,
  registrations: readonly PublicRegistration[],
  seatOf: EliminatePlayerDialogProps["seatOf"],
): { table: { tableNumber: number; players: PublicRegistration[] } | null; others: PublicRegistration[] } {
  const stillIn = registrations.filter((other) => !other.isEliminated && other.playerId !== registration.playerId);
  const seat = seatOf?.[registration.id];
  if (!seat) return { table: null, others: stillIn };
  const seatAtTable = (other: PublicRegistration) => {
    const otherSeat = seatOf?.[other.id];
    return otherSeat?.tableNumber === seat.tableNumber ? otherSeat.seatNumber : null;
  };
  const players = stillIn.filter((other) => seatAtTable(other) !== null).sort((a, b) => (seatAtTable(a) ?? 0) - (seatAtTable(b) ?? 0));
  return { table: players.length > 0 ? { tableNumber: seat.tableNumber, players } : null, others: stillIn.filter((other) => seatAtTable(other) === null) };
}

function ChoiceItem({ registration }: { registration: PublicRegistration }) {
  return (
    <SelectItem value={registration.playerId} className="py-2">
      <span className="flex items-center gap-2">
        <PlayerAvatar name={registration.player?.name ?? ""} imageUrl={registration.player?.imageUrl} size="xs" />
        <span>{playerName(registration)}</span>
      </span>
    </SelectItem>
  );
}

function EliminateForm({
  tournamentId,
  registration,
  registrations,
  seatOf,
  onEliminated,
  onClose,
  undo,
}: Omit<EliminatePlayerDialogProps, "returnFocusTo"> & { registration: PublicRegistration; undo: UndoElimination }) {
  const { toast } = useToast();
  const eliminate = useUpdateRegistration(tournamentId);
  const form = useForm<{ eliminatedBy: string }>({ resolver: formResolver(eliminateSchema), defaultValues: { eliminatedBy: "" } });
  const choices = knockoutChoices(registration, registrations, seatOf);
  const stillIn = [...(choices.table?.players ?? []), ...choices.others];

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
    toast({ title: "Player eliminated successfully", action: undo(registration) });
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
                    {choices.table ? (
                      <>
                        <SelectSeparator />
                        <SelectGroup>
                          <SelectLabel>At Table {choices.table.tableNumber}</SelectLabel>
                          {choices.table.players.map((other) => (
                            <ChoiceItem key={other.playerId} registration={other} />
                          ))}
                        </SelectGroup>
                        {choices.others.length > 0 ? <SelectSeparator /> : null}
                      </>
                    ) : null}
                    <SelectGroup>
                      {choices.table && choices.others.length > 0 ? <SelectLabel>Everyone else</SelectLabel> : null}
                      {choices.others.map((other) => (
                        <ChoiceItem key={other.playerId} registration={other} />
                      ))}
                    </SelectGroup>
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
