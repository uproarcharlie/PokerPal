import { useId, type ComponentProps } from "react";
import { useForm, useWatch } from "react-hook-form";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { AmountInput } from "@/components/shared/amount-input";
import { LoadingRows, QueryState } from "@/components/shared/query-state";
import { useToast } from "@/hooks/use-toast";
import { errorMessage, hasErrorCode } from "@/lib/api/http";
import { formatMoney } from "@/lib/format";
import { formResolver, showServerFieldErrors } from "@/lib/forms";
import { tournamentMoney, type TournamentMoney } from "@/lib/prize-pool";
import { useRegistrations } from "@/features/tournaments/hooks";
import { prizePoolAdjustmentSchema, type ApUpdateResponse, type PrizePoolAdjustmentInput } from "@shared/api/prize-pool";
import type { PublicRegistration } from "@shared/api/public";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { centsToDecimalString, toCents, type Cents } from "@shared/domain/money";
import { halfCents, previewAdjustment, roundDownCents, stepCents, typedCents, type AdjustmentMode } from "../preview";
import { useAdjustPrizePool } from "../staff-hooks";
import { PoolPreview } from "./pool-preview";

/** Why the TD changed it: one tap each, or typed. Shown in the public activity feed. */
const ADJUSTMENT_REASONS = ["Low turnout", "Promo / freeroll", "Correction"] as const;

const FIVE_DOLLARS: Cents = 500;

interface AdjustValues {
  mode: AdjustmentMode;
  amount: string;
  reason: string;
}

/** The shared request rule, plus what the server refuses with AP_EXCEEDS_GROSS, said before sending. */
function adjustmentFormSchema(label: string, grossCents: Cents) {
  return prizePoolAdjustmentSchema.superRefine((value, ctx) => {
    if (value.mode === "ap_override" && toCents(value.amount) > grossCents) {
      ctx.addIssue({ code: "custom", path: ["amount"], message: `The ${label} cannot be more than the ${formatMoney(grossCents)} taken in` });
    }
  });
}

/** The amount a mode starts from: what is fixed now, else what the rates give. */
function startAmount(mode: AdjustmentMode, { breakdown }: TournamentMoney): string {
  if (mode === "ap_override") return centsToDecimalString(breakdown.rake.override ?? breakdown.rake.calculated);
  if (mode === "manual_pool") return centsToDecimalString(breakdown.manualPrizePool ?? breakdown.net);
  return "";
}

function savedTitle(label: string, input: PrizePoolAdjustmentInput, { prizePool }: ApUpdateResponse): string {
  if (input.mode === "ap_override") return `${label} fixed at ${formatMoney(prizePool.breakdown.rake.applied)}`;
  if (input.mode === "manual_pool") return `Prize pool fixed at ${formatMoney(prizePool.breakdown.net)}`;
  return `${label} back to the calculated ${formatMoney(prizePool.breakdown.rake.calculated)}`;
}

interface ApAdjustDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tournament: TournamentDetailDto;
  /** The club's name for its AP, e.g. "AP". */
  label: string;
  /** The choice it opens on (default: what the pool uses now); the desk's prize pool Edit opens it on "Set prize pool". */
  startMode?: AdjustmentMode;
}

/**
 * The manual AP total for a low turnout (or a promo, or a correction), or a fixed prize pool, or back
 * to what the rates give, with the pool and places it would pay worked out as the TD types (D12-D16).
 */
export function ApAdjustDialog({ open, onOpenChange, tournament, label, startMode }: ApAdjustDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {open ? <AdjustBody tournament={tournament} label={label} startMode={startMode} onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function AdjustBody({ tournament, label, startMode, onClose }: Pick<ApAdjustDialogProps, "tournament" | "label" | "startMode"> & { onClose: () => void }) {
  const registrations = useRegistrations(tournament.id, { follow: tournament });
  return (
    <>
      <DialogHeader>
        <DialogTitle>Adjust {label}</DialogTitle>
        <DialogDescription>For a low turnout, a promo or a correction. The {label} rates stay as they are.</DialogDescription>
      </DialogHeader>
      <QueryState query={registrations} loading={<LoadingRows rows={4} />} errorTitle="The players could not be loaded">
        {(list) => <AdjustForm tournament={tournament} registrations={list} label={label} startMode={startMode} onClose={onClose} />}
      </QueryState>
    </>
  );
}

interface AdjustFormProps {
  tournament: TournamentDetailDto;
  registrations: readonly PublicRegistration[];
  label: string;
  startMode?: AdjustmentMode;
  onClose: () => void;
}

function AdjustForm({ tournament, registrations, label, startMode, onClose }: AdjustFormProps) {
  const { toast } = useToast();
  const ids = useId();
  const adjust = useAdjustPrizePool(tournament.id);
  const before = tournamentMoney(tournament, registrations);
  const { breakdown } = before;
  const schema = adjustmentFormSchema(label, breakdown.gross.total);
  const form = useForm<AdjustValues>({
    resolver: formResolver(schema),
    defaultValues: { mode: startMode ?? breakdown.netSource, amount: startAmount(startMode ?? breakdown.netSource, before), reason: "" },
  });
  const [mode, amount, reason] = useWatch({ control: form.control, name: ["mode", "amount", "reason"] });
  const typed = typedCents(amount);
  const after = previewAdjustment(tournament, registrations, mode, mode === "calculated" ? null : typed);

  const setAmount = (cents: Cents) => form.setValue("amount", centsToDecimalString(cents), { shouldValidate: form.formState.isSubmitted });
  const chooseMode = (next: AdjustmentMode) => {
    form.setValue("mode", next, { shouldDirty: true });
    form.setValue("amount", startAmount(next, before));
    form.clearErrors();
  };

  const submit = form.handleSubmit(async (values) => {
    const input = schema.parse(values);
    let response: ApUpdateResponse;
    try {
      response = await adjust.mutateAsync(input);
    } catch (error) {
      if (hasErrorCode(error, "TOURNAMENT_CLOSED")) {
        form.setError("root", { type: "server", message: errorMessage(error) });
      } else if (!showServerFieldErrors(form.setError, error, { fields: ["amount", "reason"], codes: { AP_EXCEEDS_GROSS: "amount" } })) {
        toast({ title: `Could not change the ${label}`, description: errorMessage(error), variant: "destructive" });
      }
      return;
    }
    toast({ title: savedTitle(label, input, response), description: input.reason ? `Reason: ${input.reason}` : undefined });
    onClose();
  });

  const rootError = form.formState.errors.root?.message;
  return (
    <Form {...form}>
      <form onSubmit={submit} noValidate className="space-y-5">
        {rootError ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
            <AlertDescription>{rootError}</AlertDescription>
          </Alert>
        ) : null}

        <div className="space-y-2">
          <p id={`${ids}-mode`} className="text-sm font-medium text-foreground">
            What should the pool use?
          </p>
          <RadioGroup aria-labelledby={`${ids}-mode`} value={mode} onValueChange={(value) => chooseMode(value as AdjustmentMode)} className="gap-3">
            <ModeOption id={`${ids}-calculated`} value="calculated" title={`Calculated (${label} ${formatMoney(breakdown.rake.calculated)})`} help="What the rates give, growing with every entry." />
            <ModeOption id={`${ids}-ap`} value="ap_override" title={`Set ${label} total`} help="A fixed amount: it does not grow with later entries." />
            <ModeOption
              id={`${ids}-pool`}
              value="manual_pool"
              title="Set prize pool"
              help={
                breakdown.rake.override !== null
                  ? `A fixed pool, e.g. a guarantee: it replaces the fixed ${label} total (${formatMoney(breakdown.rake.override)}).`
                  : "A fixed pool, e.g. a guarantee: it may be more than was taken in."
              }
            />
          </RadioGroup>
        </div>

        {mode !== "calculated" ? (
          <FormField
            control={form.control}
            name="amount"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{mode === "ap_override" ? `${label} total` : "Prize pool"}</FormLabel>
                <FormControl>
                  <AmountInput unit="$" {...field} data-testid="adjust-amount" />
                </FormControl>
                <div role="group" aria-label="Quick amounts" className="flex flex-wrap gap-2">
                  {mode === "ap_override" ? (
                    <>
                      <QuickAmount onClick={() => setAmount(0)}>Waive ($0)</QuickAmount>
                      <QuickAmount onClick={() => setAmount(halfCents(breakdown.rake.calculated))}>Half</QuickAmount>
                      <QuickAmount onClick={() => setAmount(stepCents(typed, breakdown.rake.applied, -FIVE_DOLLARS))}>
                        −$5
                      </QuickAmount>
                      <QuickAmount onClick={() => setAmount(stepCents(typed, breakdown.rake.applied, FIVE_DOLLARS))}>
                        +$5
                      </QuickAmount>
                    </>
                  ) : (
                    <QuickAmount onClick={() => setAmount(roundDownCents(typed ?? breakdown.net))}>Round down to $10</QuickAmount>
                  )}
                </div>
                <FormDescription>
                  {mode === "ap_override"
                    ? `Taken in so far: ${formatMoney(breakdown.gross.total)}. The ${label} on the high hand is separate and stays as it is.`
                    : `Taken in so far: ${formatMoney(breakdown.gross.total)}. Anything above it is added by the club.`}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : null}

        <FormField
          control={form.control}
          name="reason"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Reason (optional)</FormLabel>
              <div role="group" aria-label="Common reasons" className="flex flex-wrap gap-2">
                {ADJUSTMENT_REASONS.map((choice) => (
                  <QuickAmount key={choice} aria-pressed={reason.trim() === choice} onClick={() => field.onChange(reason.trim() === choice ? "" : choice)}>
                    {choice}
                  </QuickAmount>
                ))}
              </div>
              <FormControl>
                <Input {...field} maxLength={200} placeholder="Or type a reason" />
              </FormControl>
              <FormDescription>Shown in the public activity feed.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <PoolPreview
          after={after}
          before={before}
          label={label}
          entrants={registrations.length}
          locked={tournament.prizePoolLocked === true}
        />

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" busy={adjust.isPending} data-testid="save-adjustment">
            Save
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

function ModeOption({ id, value, title, help }: { id: string; value: AdjustmentMode; title: string; help: string }) {
  return (
    <div className="flex items-start gap-3">
      <RadioGroupItem value={value} id={id} aria-describedby={`${id}-help`} className="mt-0.5" />
      <div className="space-y-0.5">
        <Label htmlFor={id} className="font-medium">
          {title}
        </Label>
        <p id={`${id}-help`} className="text-xs text-muted-foreground">
          {help}
        </p>
      </div>
    </div>
  );
}

function QuickAmount({ children, ...props }: Omit<ComponentProps<typeof Button>, "type" | "variant">) {
  return (
    <Button type="button" variant="outline" className="px-3" {...props}>
      {children}
    </Button>
  );
}
