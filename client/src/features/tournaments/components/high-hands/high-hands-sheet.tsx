import { useState } from "react";
import { useForm, type Control } from "react-hook-form";
import { Trophy } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { PhoneSheet, PhoneSheetBody, PhoneSheetFooter, PhoneSheetHeader } from "@/components/shared/phone-sheet";
import { useToast } from "@/hooks/use-toast";
import { errorMessage, hasErrorCode } from "@/lib/api/http";
import { formResolver, showServerFieldErrors } from "@/lib/forms";
import { cn } from "@/lib/utils";
import type { HighHandsUpdateInput } from "@shared/api/high-hands";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { isClosedStatus } from "@shared/domain/tournaments";
import { useUpdateHighHands } from "@/features/prize-pool/staff-hooks";
import { useRegistrations } from "../../hooks";
import {
  highHandEntrantsOf,
  highHandFormValues,
  highHandProblem,
  highHandsFormSchema,
  isHighHandField,
  repricingLines,
  sameHighHands,
  type HighHandFormValue,
  type HighHandsFormValues,
} from "../../high-hands-form";
import { HighHandsEditor } from "./high-hands-editor";
import { RepricingDescription } from "./high-hand-refusals";

interface SheetValues {
  highHands: HighHandFormValue[];
  reason: string;
}

const sheetSchema = z.object({ highHands: highHandsFormSchema, reason: z.string().trim().max(200) });

interface HighHandsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tournament: TournamentDetailDto;
  rakeLabel: string;
}

/**
 * The high hands changed mid-game (round 10), from the Money tab: their fees, prizes, AP and notes, a
 * new one, or one nobody is in taken off. Saved at once (PUT …/high-hands), in the staff's feed with
 * the reason given; a new fee for entries already in a high hand is asked about first.
 */
function HighHandsSheet({ open, onOpenChange, tournament, rakeLabel }: HighHandsSheetProps) {
  return (
    <PhoneSheet open={open} onOpenChange={onOpenChange} width="wide" testId="high-hands-sheet">
      <PhoneSheetHeader title="High hands" description="Each high hand is its own pot. A change shows at once on every screen." />
      {open ? <HighHandsForm tournament={tournament} rakeLabel={rakeLabel} onClose={() => onOpenChange(false)} /> : null}
    </PhoneSheet>
  );
}

function HighHandsForm({ tournament, rakeLabel, onClose }: { tournament: TournamentDetailDto; rakeLabel: string; onClose: () => void }) {
  const { toast } = useToast();
  const save = useUpdateHighHands(tournament.id);
  const registrations = useRegistrations(tournament.id);
  const entrants = registrations.data ? highHandEntrantsOf(tournament, registrations.data) : {};
  const [initial] = useState(() => highHandFormValues(tournament));
  const form = useForm<SheetValues>({ resolver: formResolver(sheetSchema), defaultValues: { highHands: initial, reason: "" } });
  // A new fee for entries already recorded, waiting for the TD to confirm what it re-prices.
  const [repricing, setRepricing] = useState<{ input: HighHandsUpdateInput; message: string; lines: string[] } | null>(null);

  const saved = () => {
    toast({ title: "High hands saved" });
    onClose();
  };

  const showRefusal = (error: unknown) => {
    const problem = highHandProblem(error, form.getValues("highHands"));
    if (problem) {
      form.setError(`highHands.${problem.index}`, { type: "server", message: problem.message });
      return;
    }
    if (showServerFieldErrors(form.setError, error, { fields: (name) => isHighHandField(name) || name === "reason" })) return;
    toast({ title: "Could not save the high hands", description: errorMessage(error), variant: "destructive" });
  };

  const submit = form.handleSubmit(async (values) => {
    const { highHands, reason } = sheetSchema.parse(values);
    if (sameHighHands(highHands, highHandsFormSchema.parse(initial))) {
      toast({ title: "Nothing to save", description: "No high hand was changed." });
      onClose();
      return;
    }
    const input: HighHandsUpdateInput = { highHands, repriceEntries: false, ...(reason ? { reason } : {}) };
    try {
      await save.mutateAsync(input);
    } catch (error) {
      if (hasErrorCode(error, "ENTRIES_REPRICED")) setRepricing({ input, message: errorMessage(error), lines: repricingLines(error) });
      else showRefusal(error);
      return;
    }
    saved();
  });

  return (
    <Form {...form}>
      <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col" data-testid="high-hands-form">
        <PhoneSheetBody atFoot={false} className="space-y-6">
          <fieldset disabled={isClosedStatus(tournament.status)} className="min-w-0 space-y-6">
            <legend className="sr-only">High hands</legend>
            {/* The form holds the list under `highHands`, as the editor's own type says; RHF's paths cannot see that through the extra box. */}
            <HighHandsEditor control={form.control as unknown as Control<HighHandsFormValues>} rakeLabel={rakeLabel} entrants={entrants} />
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reason (optional)</FormLabel>
                  <FormControl>
                    <Input {...field} maxLength={200} placeholder="Second high hand added at the break" className="h-11 sm:h-10" data-testid="high-hands-reason" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </fieldset>
        </PhoneSheetBody>
        <PhoneSheetFooter>
          <div className={cn("flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end")}>
            <Button type="button" variant="ghost" className="h-11 sm:h-10" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="h-11 sm:h-10" busy={save.isPending} data-testid="save-high-hands">
              {save.isPending ? "Saving…" : "Save high hands"}
            </Button>
          </div>
        </PhoneSheetFooter>
      </form>
      <ConfirmDialog
        open={repricing !== null}
        onOpenChange={(open) => {
          if (!open) setRepricing(null);
        }}
        title="Re-price recorded entries?"
        description={repricing ? <RepricingDescription message={repricing.message} lines={repricing.lines} /> : ""}
        confirmLabel="Re-price and save"
        pendingLabel="Saving…"
        contentTestId="confirm-reprice"
        onConfirm={async () => {
          if (repricing === null) return;
          await save.mutateAsync({ ...repricing.input, repriceEntries: true });
          saved();
        }}
      />
    </Form>
  );
}

/** "High hands" for the club's staff while the tournament is open: the editor of the Money tab and the Overview. */
export function EditHighHandsButton({ tournament, rakeLabel, className }: { tournament: TournamentDetailDto; rakeLabel: string; className?: string }) {
  const [open, setOpen] = useState(false);
  if (!tournament.viewer.canManage) return null;
  return (
    <>
      {!isClosedStatus(tournament.status) ? (
        <Button type="button" variant="outline" className={cn("h-11", className)} onClick={() => setOpen(true)} data-testid="edit-high-hands">
          <Trophy aria-hidden="true" />
          Edit high hands
        </Button>
      ) : null}
      {/* Mounted even once the tournament closes, so a sheet open when it closed keeps the server's reason on screen. */}
      <HighHandsSheet open={open} onOpenChange={setOpen} tournament={tournament} rakeLabel={rakeLabel} />
    </>
  );
}
