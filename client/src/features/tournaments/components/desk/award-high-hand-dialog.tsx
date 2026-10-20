import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { AmountInput } from "@/components/shared/amount-input";
import { RequiredNote } from "@/components/shared/required-note";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PlayerAvatar } from "@/components/image/player-avatar";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api/http";
import { formatAmount, formatMoney, plural } from "@/lib/format";
import { idSchema } from "@shared/api/common";
import type { PublicRegistration } from "@shared/api/public";
import { updateRegistrationSchema } from "@shared/api/registrations";
import { centsToDecimalString, toCents, type Cents } from "@shared/domain/money";
import { splitHighHandAward } from "@shared/domain/prize-pool";
import { useUpdateRegistration, type PotCheck } from "../../staff-hooks";
import { playerName } from "../../player-name";
import { formResolver } from "@/lib/forms";

/** The "split with" choice meaning: a new prize, not a tie. */
const NEXT_PRIZE = "next";

const awardSchema = z.object({
  registrationId: z.string().min(1, "Choose the winner").pipe(idSchema),
  highHandSplitWith: z.preprocess(
    (value) => (value === NEXT_PRIZE || value === "" ? undefined : value),
    updateRegistrationSchema.innerType().shape.highHandSplitWith,
  ),
});

interface AwardHighHandDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tournamentId: string;
  registrations: readonly PublicRegistration[];
  /** What the next winner is awarded (nextHighHandAward), or null once every prize is awarded. */
  nextAwardCents: Cents | null;
  /**
   * Whether the pot that amount is worked out from has been fetched since the dialog opened: until it
   * has, the amount may be out of date, so it is not shown as current and Assign waits
   * (P3REV-PERF-HIGHHAND-STALE-AMOUNT).
   */
  potCheck: PotCheck;
  /** Fetches the pot again, after a check that failed. */
  onCheckPot: () => void;
}

/**
 * Awards the next high-hand prize, or a tie that shares an earlier winner's prize. The amount is the
 * server's: shown here as the server will work it out, never sent (TN2-04).
 */
export function AwardHighHandDialog({ open, onOpenChange, ...props }: AwardHighHandDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">{open ? <AwardForm {...props} onClose={() => onOpenChange(false)} /> : null}</DialogContent>
    </Dialog>
  );
}

function AwardForm({
  tournamentId,
  registrations,
  nextAwardCents,
  potCheck,
  onCheckPot,
  onClose,
}: Omit<AwardHighHandDialogProps, "open" | "onOpenChange"> & { onClose: () => void }) {
  const { toast } = useToast();
  const award = useUpdateRegistration(tournamentId);
  const form = useForm<{ registrationId: string; highHandSplitWith: string }>({
    resolver: formResolver(awardSchema),
    defaultValues: { registrationId: "", highHandSplitWith: NEXT_PRIZE },
  });
  const [registrationId, splitWith] = useWatch({ control: form.control, name: ["registrationId", "highHandSplitWith"] });

  // Only players who entered the high hand and have not won it yet can win it.
  const eligible = registrations.filter((registration) => registration.enteringHighHands && !registration.highHandWinner);
  const previousWinners = registrations.filter((registration) => registration.highHandWinner);
  // Once every prize is awarded the only award left is a tie, which shares a winner's prize (TN2-04).
  const allAwarded = nextAwardCents === null;
  const splitTarget = previousWinners.find((winner) => winner.id === splitWith);
  const awardCents = splitTarget ? splitHighHandAward(toCents(splitTarget.highHandAmount)).shareCents : (nextAwardCents ?? 0);

  const submit = form.handleSubmit(async (values) => {
    const { registrationId: winnerId, highHandSplitWith } = awardSchema.parse(values);
    try {
      const awarded = await award.mutateAsync({
        registrationId: winnerId,
        input: { highHandWinner: true, ...(highHandSplitWith ? { highHandSplitWith } : {}) },
      });
      // The amount the server recorded, which is what is paid (it works the award out from the pot as it is now).
      const amount = formatAmount(awarded.highHandAmount);
      const winner = awarded.player?.name ?? "The winner";
      toast({ title: highHandSplitWith ? `High hand split: ${winner} gets ${amount}` : `${winner} wins the high hand: ${amount}` });
      onClose();
    } catch (error) {
      toast({ title: "Could not award the high hand", description: errorMessage(error, "Failed to assign high hand winner"), variant: "destructive" });
    }
  });

  return (
    <Form {...form}>
      <form onSubmit={submit} noValidate>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-accent" aria-hidden="true" />
            Assign High Hand Winner
          </DialogTitle>
          <DialogDescription>
            Select the next player who won the high hand bonus
            {previousWinners.length > 0 ? (
              <span className="mt-1 block font-medium text-foreground">
                {plural(previousWinners.length, "winner")} already assigned
              </span>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <RequiredNote />
          {previousWinners.length > 0 ? (
            <div className="space-y-2 rounded-lg border bg-muted/50 p-3">
              <p className="text-xs font-semibold">Previous Winners</p>
              <ul role="list" className="space-y-1">
                {previousWinners.map((winner) => (
                  <li key={winner.id} className="flex items-center gap-2 text-sm">
                    <Trophy className="h-3 w-3 text-accent" aria-hidden="true" />
                    {playerName(winner)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <FormField
            control={form.control}
            name="registrationId"
            render={({ field }) => (
              <FormItem required>
                <FormLabel>Player</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select player" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {eligible.length === 0 ? (
                      <p className="p-4 text-center text-sm text-muted-foreground">
                        {previousWinners.length > 0 ? "All eligible players have been assigned" : "No players entered high hands"}
                      </p>
                    ) : (
                      eligible.map((registration) => (
                        <SelectItem key={registration.id} value={registration.id} className="py-2">
                          <span className="flex items-center gap-2">
                            <PlayerAvatar name={registration.player?.name ?? ""} imageUrl={registration.player?.imageUrl} size="xs" />
                            <span>{playerName(registration)}</span>
                          </span>
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                <FormDescription className="text-xs">Only players who entered high hands and haven&apos;t won yet are shown</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          {previousWinners.length > 0 ? (
            <FormField
              control={form.control}
              name="highHandSplitWith"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tied hand?</FormLabel>
                  <Select value={allAwarded && !splitTarget ? "" : field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger data-testid="split-with">
                        <SelectValue placeholder="Split with a winner" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {!allAwarded ? <SelectItem value={NEXT_PRIZE}>No: the next high-hand prize</SelectItem> : null}
                      {previousWinners.map((winner) => (
                        <SelectItem key={winner.id} value={winner.id}>
                          Split with {playerName(winner)} ({formatMoney(toCents(winner.highHandAmount))})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription className="text-xs">
                    {allAwarded
                      ? "Every high-hand prize has been awarded: a tie shares a winner's prize, half each."
                      : "A tie shares that winner's prize, half each; otherwise this is the next prize."}
                  </FormDescription>
                </FormItem>
              )}
            />
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="high-hand-award">High Hand Amount</Label>
            <AmountInput
              unit="$"
              id="high-hand-award"
              className="bg-muted"
              value={potCheck === "checking" ? "" : centsToDecimalString(awardCents)}
              placeholder="Checking…"
              disabled
              readOnly
              aria-describedby="high-hand-award-note high-hand-pot-check"
              data-testid="high-hand-amount"
            />
            <p id="high-hand-award-note" className="text-xs text-muted-foreground">
              {splitTarget
                ? "Half of that winner's prize; they keep the other half"
                : "What is left of the high-hand pot, shared among the winners still to come"}
            </p>
            <PotCheckNote potCheck={potCheck} onCheckPot={onCheckPot} />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!registrationId || (allAwarded && !splitTarget)}
            busy={award.isPending || potCheck === "checking"}
            data-testid="assign-high-hand"
          >
            {award.isPending ? "Assigning…" : "Assign High Hand"}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

/** Says the amount is being checked, or that it could not be, and what is paid either way. */
function PotCheckNote({ potCheck, onCheckPot }: { potCheck: PotCheck; onCheckPot: () => void }) {
  return (
    <div id="high-hand-pot-check" role="status" className="text-xs">
      {potCheck === "checking" ? <p className="text-muted-foreground">Checking the pot as it is now…</p> : null}
      {potCheck === "failed" ? (
        <p className="flex flex-wrap items-center gap-x-2 text-destructive">
          The pot could not be checked, so this amount may be out of date. The server works out what is paid when you assign it.
          <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={onCheckPot}>
            Check again
          </Button>
        </p>
      ) : null}
    </div>
  );
}
