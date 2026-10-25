import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { FormSlideout } from "@/components/ui/form-slideout";
import { Input } from "@/components/ui/input";
import { LoadingRows, QueryState } from "@/components/shared/query-state";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api/http";
import { formatMoney } from "@/lib/format";
import { formResolver, showServerFieldErrors } from "@/lib/forms";
import { tournamentMoney } from "@/lib/prize-pool";
import { useRegistrations } from "@/features/tournaments/hooks";
import { RakeFields, type RakeRateValues } from "@/features/tournaments/components/tournament-form/rake-fields";
import { rakeTypeOf, rateAmountText } from "@/features/tournaments/tournament-form";
import { moneySchema, type RakeType } from "@shared/api/common";
import { rakeRatesSchema } from "@shared/api/prize-pool";
import type { PublicRegistration } from "@shared/api/public";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { isAmountSet, toCents } from "@shared/domain/money";
import { offersAddons, offersHighHand, offersRebuys } from "@shared/domain/player-actions";
import { mergeRakeRates, RAKE_COMPONENT_NAMES, RAKE_COMPONENTS, RAKE_RATE_KEYS } from "@shared/domain/rake-rates";
import { previewRates } from "../preview";
import { useChangeRakeRates } from "../staff-hooks";
import { PoolPreview } from "./pool-preview";

type Component = (typeof RAKE_COMPONENTS)[number];

type RatesFormValues = RakeRateValues & { keepOverride: boolean; reason: string };

/** The rates a tournament takes AP on: the buy-in always, the others when it sells them. */
function componentsOf(tournament: TournamentDetailDto): Component[] {
  return RAKE_COMPONENTS.filter(({ type }) => {
    if (type === "rebuyRakeType") return offersRebuys(tournament);
    if (type === "addonRakeType") return offersAddons(tournament);
    if (type === "highHandRakeType") return offersHighHand(tournament);
    return true;
  });
}

/** The high hand's rate is a separate pot's: it never touches the fixed AP total (MONEY-P2REV-01). */
const isAp = ({ type }: Component) => type !== "highHandRakeType";

const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Whether a rate as its boxes hold it is the stored one: the same type and, for a rate, the same amount ("10" is "10.00"). */
function sameAsStored(values: RakeRateValues, tournament: TournamentDetailDto, { type, amount }: Component): boolean {
  const storedType = rakeTypeOf(tournament[type]);
  if (values[type] !== storedType) return false;
  if (storedType === "none") return true;
  const typed = moneySchema.safeParse(values[amount]);
  return typed.success && isAmountSet(tournament[amount]) && toCents(typed.data) === toCents(tournament[amount]);
}

/** The shown rates the TD changed, and whether one of them is a buy-in, re-buy or add-on rate. */
function changedComponents(values: RakeRateValues, tournament: TournamentDetailDto): { changed: Component[]; apChanged: boolean } {
  const changed = componentsOf(tournament).filter((component) => !sameAsStored(values, tournament, component));
  return { changed, apChanged: changed.some(isAp) };
}

/**
 * The request: only the rates the TD changed (a type of "none" without its hidden amount), so a fixed
 * AP total is let go only for a buy-in, re-buy or add-on rate that really changed, and only when the TD
 * did not keep it. A high-hand rate alone, or a save that changed nothing, never wipes it (MONEY-AP-01).
 */
function ratesRequest(raw: unknown, tournament: TournamentDetailDto): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const values = raw as RatesFormValues;
  const { changed, apChanged } = changedComponents(values, tournament);
  const request: Record<string, unknown> = { reason: values.reason };
  for (const { type, amount } of changed) {
    request[type] = values[type];
    if (values[type] !== "none") request[amount] = values[amount];
  }
  // No buy-in, re-buy or add-on rate changed: the fixed AP total is kept whatever the box says (it is not shown then).
  request.keepOverride = apChanged ? values.keepOverride : true;
  return request;
}

/**
 * The shared request rule over the rates changed, then the rates merged over the stored ones exactly as
 * the server merges and checks them (mergeRakeRates), so a percentage over 100 is said on its box
 * before sending. "Nothing to update" is the form's own case (it says so and closes), not a refusal.
 */
function ratesFormSchema(tournament: TournamentDetailDto) {
  return z.preprocess((raw) => ratesRequest(raw, tournament), rakeRatesSchema.innerType()).superRefine((rates, ctx) => {
    const merged = mergeRakeRates(tournament, rates);
    if (!merged.ok) {
      const message = merged.code === "PERCENT_OVER_100" ? "A percentage cannot be over 100" : "Enter an amount for that rate";
      ctx.addIssue({ code: "custom", path: [merged.field], message });
    }
  });
}

/** Every rate's boxes as the tournament stands: what the sheet starts from. */
function startingValues(tournament: TournamentDetailDto): RatesFormValues {
  const values = { keepOverride: false, reason: "" } as RatesFormValues;
  for (const { type, amount } of RAKE_COMPONENTS) {
    const kind = rakeTypeOf(tournament[type]);
    values[type] = kind;
    values[amount] = rateAmountText(kind, tournament[amount]);
  }
  return values;
}

interface RakeRatesSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tournament: TournamentDetailDto;
  /** The club's name for its AP, e.g. "AP". */
  label: string;
}

/** Changes the AP rates after the tournament was set up (they apply to every entry, earlier ones included). */
export function RakeRatesSheet({ open, onOpenChange, tournament, label }: RakeRatesSheetProps) {
  return (
    <FormSlideout
      open={open}
      onOpenChange={onOpenChange}
      title={`Edit ${label} rates`}
      description={`How the ${label} is worked out from each entry. A change applies to every entry, earlier ones included.`}
    >
      {open ? <RatesBody tournament={tournament} label={label} onClose={() => onOpenChange(false)} /> : null}
    </FormSlideout>
  );
}

function RatesBody({ tournament, label, onClose }: { tournament: TournamentDetailDto; label: string; onClose: () => void }) {
  const registrations = useRegistrations(tournament.id, { follow: tournament });
  return (
    <QueryState query={registrations} loading={<LoadingRows rows={4} />} errorTitle="The players could not be loaded">
      {(list) => <RatesForm tournament={tournament} registrations={list} label={label} onClose={onClose} />}
    </QueryState>
  );
}

interface RatesFormProps {
  tournament: TournamentDetailDto;
  registrations: readonly PublicRegistration[];
  label: string;
  onClose: () => void;
}

function RatesForm({ tournament, registrations, label, onClose }: RatesFormProps) {
  const { toast } = useToast();
  const change = useChangeRakeRates(tournament.id);
  const components = componentsOf(tournament);
  const schema = ratesFormSchema(tournament);
  const form = useForm<RatesFormValues>({ resolver: formResolver(schema), defaultValues: startingValues(tournament) });
  const values = useWatch({ control: form.control }) as RatesFormValues;

  const override = isAmountSet(tournament.rakeOverride) ? toCents(tournament.rakeOverride) : null;
  const manualPool = isAmountSet(tournament.manualPrizePool) ? toCents(tournament.manualPrizePool) : null;
  const { apChanged } = changedComponents(values, tournament);
  const before = tournamentMoney(tournament, registrations);
  const parsed = schema.safeParse(values);
  const merged = parsed.success ? mergeRakeRates(tournament, parsed.data) : null;
  const after = merged?.ok ? previewRates(tournament, registrations, merged.rates, !apChanged || values.keepOverride) : null;

  // A new type starts with an empty box, so 10% never silently becomes $10 per entry; back to the stored type, its amount again.
  const chooseType = ({ type, amount }: Component, next: RakeType) => {
    form.setValue(type, next, { shouldDirty: true });
    form.setValue(amount, next === rakeTypeOf(tournament[type]) ? rateAmountText(next, tournament[amount]) : "");
  };

  const submit = form.handleSubmit(async (formValues) => {
    const request = schema.parse(formValues);
    if (!RAKE_RATE_KEYS.some((key) => request[key] !== undefined)) {
      toast({ title: `The ${label} rates are unchanged` });
      onClose();
      return;
    }
    try {
      await change.mutateAsync(request);
    } catch (error) {
      const fields = components.flatMap(({ type, amount }) => [type, amount]);
      if (!showServerFieldErrors(form.setError, error, { fields: [...fields, "reason"] })) {
        toast({ title: `Could not change the ${label} rates`, description: errorMessage(error), variant: "destructive" });
      }
      return;
    }
    toast({ title: `${label} rates saved` });
    onClose();
  });

  return (
    <Form {...form}>
      <form onSubmit={submit} noValidate className="space-y-6">
        {components.map((component) => {
          const name = capitalised(RAKE_COMPONENT_NAMES[component.type]);
          return (
            <fieldset key={component.type} className="space-y-3 rounded-lg border border-border p-3">
              <legend className="px-1 text-sm font-semibold text-foreground">{name}</legend>
              {isAp(component) ? null : <p className="text-xs text-muted-foreground">A separate pot: never part of the fixed {label} total.</p>}
              <RakeFields
                control={form.control}
                component={component.type}
                label={label}
                part={name}
                testId={`rates-${component.type}`}
                flat={!isAp(component)}
                onTypeChange={(next) => chooseType(component, next)}
              />
            </fieldset>
          );
        })}

        {override !== null && apChanged ? (
          <FormField
            control={form.control}
            name="keepOverride"
            render={({ field }) => (
              <FormItem className="flex items-start gap-3 space-y-0 rounded-lg border border-border p-3">
                <FormControl>
                  <Checkbox checked={field.value} onCheckedChange={(checked) => field.onChange(checked === true)} className="mt-0.5" />
                </FormControl>
                <div className="space-y-1">
                  <FormLabel>
                    Keep the fixed {label} total ({formatMoney(override)})
                  </FormLabel>
                  <FormDescription>Otherwise the new rates replace it with the calculated {label}.</FormDescription>
                </div>
              </FormItem>
            )}
          />
        ) : null}
        {override !== null && !apChanged ? (
          <p className="text-sm text-muted-foreground" data-testid="override-stays">
            The {label} total stays fixed at {formatMoney(override)} unless a buy-in, re-buy or add-on rate changes.
          </p>
        ) : null}
        {manualPool !== null ? (
          // A pool fixed by hand is the pool, and what the club keeps is what came in less it: the rates change neither (P4REV2-MONEY-04).
          <p className="text-sm text-muted-foreground" data-testid="pool-stays">
            The prize pool is fixed at {formatMoney(manualPool)}: the rates change neither the pool nor what the club keeps until the pool goes back to
            the calculated amount.
          </p>
        ) : null}

        <FormField
          control={form.control}
          name="reason"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Reason (optional)</FormLabel>
              <FormControl>
                <Input {...field} maxLength={200} placeholder="e.g. Correction" />
              </FormControl>
              <FormDescription>Kept in the staff activity log; players do not see it.</FormDescription>
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
          waiting="Fix the rates above to see the prize pool."
        />

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" busy={change.isPending} data-testid="save-rates">
            Save rates
          </Button>
        </div>
      </form>
    </Form>
  );
}
