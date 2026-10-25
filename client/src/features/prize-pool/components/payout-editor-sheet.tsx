import { useEffect, useId, useRef, useState, type ComponentProps } from "react";
import { useFieldArray, useForm, useWatch, type FieldErrors, type UseFormRegister } from "react-hook-form";
import { AlertCircle, AlertTriangle, Plus, Trash2, Trophy } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { AmountInput } from "@/components/shared/amount-input";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { PhoneSheet, PhoneSheetBody, PhoneSheetFooter, PhoneSheetHeader } from "@/components/shared/phone-sheet";
import { LoadingRows, QueryState } from "@/components/shared/query-state";
import { useToast } from "@/hooks/use-toast";
import { errorMessage, hasErrorCode } from "@/lib/api/http";
import { formatMoney } from "@/lib/format";
import { formResolver, showServerFieldErrors } from "@/lib/forms";
import { cn } from "@/lib/utils";
import { toPayoutPlaces, type PayoutsUpdateInput, type PrizePoolDto } from "@shared/api/prize-pool";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import type { Cents } from "@shared/domain/money";
import {
  describePayoutPlaces,
  PAYOUT_PLACE_LIMITS,
  PAYOUT_STRUCTURE_KEYS,
  PAYOUT_STRUCTURE_LABELS,
  PAYOUT_STRUCTURES,
  placeName,
  previewPayoutPlaces,
  previewShares,
  type PayoutPlace,
  type PayoutPlacesPreview,
  type PayoutStructureKey,
  type StandardPayoutKey,
} from "@shared/domain/payouts";
import { differenceNote, type PrizeDifference } from "@shared/domain/prize-difference";
import { isClosedStatus } from "@shared/domain/tournaments";
import { usePrizePool } from "../hooks";
import {
  addedRow,
  editorMoney,
  PAYOUT_REASONS,
  payoutsFormSchema,
  payoutsSaveCheck,
  placesOfRows,
  placesProblem,
  roughSumLine,
  rowsOfStructure,
  sameAsStored,
  startingValues,
  structureName,
  structureSplit,
  sumLine,
  switchedRow,
  unpaidPlacesNote,
  type PayoutEditorValues,
  type PayoutRowValues,
  type PayoutsSaveCheck,
  type PayoutSumLine,
} from "../payout-editor";
import { useChangePayouts } from "../staff-hooks";
import { AddedByClubNote, DifferenceChoice } from "./difference-choice";

interface PayoutEditorSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tournament: TournamentDetailDto;
}

/**
 * The payout editor (round 5, items 1 and 16): how the pool is split, changed mid-game too. A standard
 * structure, or custom places each set as a percentage of the pool or a fixed amount (the exact prize
 * for each place), with what each pays now and the live sum check against the money available: where
 * any money left over goes (the TD's choice, the club keeping it by default) or what the club adds when
 * the prizes are more. Full screen on a phone.
 */
export function PayoutEditorSheet({ open, onOpenChange, tournament }: PayoutEditorSheetProps) {
  return (
    <PhoneSheet open={open} onOpenChange={onOpenChange} width="wide">
      <PhoneSheetHeader
        title="Edit payouts"
        description="How the prize pool is split between the places. A change shows at once on every screen and in the activity feed."
      />
      {open ? <EditorBody tournament={tournament} onClose={() => onOpenChange(false)} /> : null}
    </PhoneSheet>
  );
}

/** "Edit payouts" for the club's staff while the tournament is open, with its editor. */
export function EditPayoutsButton({ tournament, className }: { tournament: TournamentDetailDto; className?: string }) {
  const [open, setOpen] = useState(false);
  if (!tournament.viewer.canManage) return null;
  return (
    <>
      {!isClosedStatus(tournament.status) ? (
        <Button type="button" variant="outline" className={cn("h-11", className)} onClick={() => setOpen(true)} data-testid="edit-payouts">
          <Trophy aria-hidden="true" />
          Edit payouts
        </Button>
      ) : null}
      {/* Mounted even once the tournament closes, so an editor open when it closed keeps the server's reason on screen. */}
      <PayoutEditorSheet open={open} onOpenChange={setOpen} tournament={tournament} />
    </>
  );
}

function EditorBody({ tournament, onClose }: { tournament: TournamentDetailDto; onClose: () => void }) {
  const prizePool = usePrizePool(tournament.id, { follow: tournament });
  return (
    <QueryState query={prizePool} loading={<LoadingRows rows={5} />} errorTitle="The prize pool could not be loaded" stateClassName="px-4 py-4">
      {(pool) => <PayoutsForm tournament={tournament} prizePool={pool} onClose={onClose} />}
    </QueryState>
  );
}

/** The message under a custom place's box. */
const placeError = (errors: FieldErrors<PayoutEditorValues>, index: number) => errors.places?.[index]?.value?.message;

/** The server names a custom place's problem by its index ("places.2"); the form, by its box. */
const placeBox = (name: string) => (/^places\.\d+$/.test(name) ? `${name}.value` : name);
const isEditorField = (name: string) => /^places\.\d+\.value$/.test(name) || name === "reason";

function savedText(input: PayoutsUpdateInput, prizePool: PrizePoolDto): string {
  const structure = input.payoutStructure === "custom" && input.places ? `Custom: ${describePayoutPlaces(toPayoutPlaces(input.places))}` : PAYOUT_STRUCTURE_LABELS[input.payoutStructure];
  const note = differenceNote(prizePool.breakdown.difference, prizePool.carryTarget);
  return note ? `${structure}; ${note}` : structure;
}


interface PayoutsFormProps {
  tournament: TournamentDetailDto;
  prizePool: PrizePoolDto;
  onClose: () => void;
}

function PayoutsForm({ tournament, prizePool, onClose }: PayoutsFormProps) {
  const { toast } = useToast();
  const ids = useId();
  const change = useChangePayouts(tournament.id);
  // Prizes that need more than the money available are saved only once the TD has read what the club adds.
  const [pending, setPending] = useState<{ input: PayoutsUpdateInput; check: PayoutsSaveCheck } | null>(null);
  const form = useForm<PayoutEditorValues>({ resolver: formResolver(payoutsFormSchema), defaultValues: startingValues(tournament), mode: "onTouched" });
  const { fields, append, remove, replace } = useFieldArray({ control: form.control, name: "places" });
  const [structure, rows, prizeDifference, reason] = useWatch({ control: form.control, name: ["payoutStructure", "places", "prizeDifference", "reason"] });
  const values: PayoutEditorValues = { payoutStructure: structure, places: rows, prizeDifference, reason };
  // A percentage is of the pool (a manual one, else what is available); the prizes are measured against what is available.
  const money = editorMoney(prizePool.breakdown);
  const pool = money.poolCents;
  const entrants = prizePool.breakdown.counts.registrations;
  const unchanged = sameAsStored(values, tournament);

  // A place's Remove takes its own button away: focus goes to the place now in its spot, the one above, or Add a place.
  const removeButtons = useRef(new Map<string, HTMLButtonElement>());
  const addButton = useRef<HTMLButtonElement>(null);
  const removedAt = useRef<number | null>(null);
  useEffect(() => {
    const index = removedAt.current;
    if (index === null) return;
    removedAt.current = null;
    const neighbour = fields[index] ?? fields[index - 1];
    (neighbour ? removeButtons.current.get(neighbour.id) : addButton.current)?.focus();
  }, [fields]);

  const revalidate = () => form.formState.isSubmitted || Object.keys(form.formState.touchedFields).length > 0;
  const chooseStructure = (key: PayoutStructureKey) => {
    form.setValue("payoutStructure", key, { shouldDirty: true });
    form.clearErrors("places");
  };
  const customise = (key: StandardPayoutKey) => {
    replace(rowsOfStructure(key));
    chooseStructure("custom");
  };
  const setKind = (index: number, kind: PayoutPlace["kind"]) => {
    const next = switchedRow(rows, index, kind, pool);
    form.setValue(`places.${index}.kind`, next.kind, { shouldDirty: true });
    form.setValue(`places.${index}.value`, next.value, { shouldDirty: true, shouldValidate: revalidate() });
  };
  const removePlace = (index: number) => {
    removedAt.current = index;
    remove(index);
  };
  const setRemoveButton = (fieldId: string, button: HTMLButtonElement | null) => {
    if (button) removeButtons.current.set(fieldId, button);
    else removeButtons.current.delete(fieldId);
  };

  const save = async (input: PayoutsUpdateInput) => {
    let response;
    try {
      response = await change.mutateAsync(input);
    } catch (error) {
      if (hasErrorCode(error, "TOURNAMENT_CLOSED")) {
        form.setError("root", { type: "server", message: errorMessage(error) });
      } else if (!showServerFieldErrors(form.setError, error, { fields: isEditorField, rename: placeBox })) {
        toast({ title: "Could not change the payouts", description: errorMessage(error), variant: "destructive" });
      }
      return;
    }
    toast({ title: "Payouts saved", description: response.prizePool.breakdown.structure.error ?? savedText(input, response.prizePool) });
    onClose();
  };
  const settleWith = { availableCents: money.availableCents, choice: prizeDifference };
  const preview = previewPayoutPlaces(pool, placesOfRows(rows), settleWith);
  const shares = structure === "custom" ? null : previewShares(pool, PAYOUT_STRUCTURES[structure], settleWith);
  const difference: PrizeDifference | null = shares ? shares.difference : preview.difference;
  const firstAsSet = shares ? shares.amounts[0] : (preview.rows[0]?.setCents ?? undefined);
  const submit = form.handleSubmit(async (raw) => {
    const input = payoutsFormSchema.parse(raw);
    const check = payoutsSaveCheck(difference);
    if (check) setPending({ input, check });
    else await save(input);
  });

  const rootError = form.formState.errors.root?.message;
  // Worked out from the boxes as they are: a refusal of the places together goes once they add up.
  const wholeError = form.formState.isSubmitted && structure === "custom" ? placesProblem(values) : undefined;
  const unpaidNote = unpaidPlacesNote(structure === "custom" ? rows.length : PAYOUT_STRUCTURES[structure].length, entrants);
  return (
    <Form {...form}>
      <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col" data-testid="payout-editor">
        <PhoneSheetBody atFoot={false} className="space-y-6">
          {rootError ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              <AlertDescription>{rootError}</AlertDescription>
            </Alert>
          ) : null}
          {tournament.prizePoolLocked && !unchanged ? (
            <Alert>
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              <AlertDescription data-testid="payouts-locked-warning">Prize pool is locked — published payouts will change.</AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-2">
            <p id={`${ids}-structure`} className="text-sm font-medium text-foreground">
              Payout structure
            </p>
            <RadioGroup
              aria-labelledby={`${ids}-structure`}
              value={structure}
              onValueChange={(key) => chooseStructure(key as PayoutStructureKey)}
              className="grid grid-cols-2 gap-2 sm:grid-cols-3"
            >
              {PAYOUT_STRUCTURE_KEYS.map((key) => (
                <Label
                  key={key}
                  htmlFor={`${ids}-${key}`}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border p-3 font-normal",
                    key === structure ? "border-primary bg-primary/5" : "border-border",
                  )}
                >
                  <RadioGroupItem value={key} id={`${ids}-${key}`} />
                  <span className="min-w-0">
                    <span className="block font-medium text-foreground">{structureName(key)}</span>
                    <span className="block text-xs text-muted-foreground">{key === "custom" ? "Set each place" : structureSplit(key)}</span>
                  </span>
                </Label>
              ))}
            </RadioGroup>
          </div>

          <section aria-labelledby={`${ids}-places`} className="space-y-3">
            <div className="flex items-baseline justify-between gap-2">
              <h3 id={`${ids}-places`} className="text-sm font-semibold text-foreground">
                Places paid
              </h3>
              <span className="text-right text-sm text-muted-foreground" data-testid="payout-pool">
                {prizePool.breakdown.manualPrizePool !== null
                  ? `Prize pool set at ${formatMoney(pool)} · ${formatMoney(money.availableCents)} available`
                  : `Available for prizes ${formatMoney(money.availableCents)}`}
              </span>
            </div>

            {structure === "custom" ? (
              <CustomPlaces
                ids={ids}
                rows={rows}
                fieldIds={fields.map((field) => field.id)}
                preview={preview}
                line={difference ? sumLine(difference, prizePool.carryTarget) : roughSumLine(preview.placedCents, money.availableCents)}
                errors={form.formState.errors}
                register={form.register}
                onKind={setKind}
                onRemove={removePlace}
                onRemoveButton={setRemoveButton}
              />
            ) : (
              <StandardPlaces structure={structure} amounts={shares?.amounts ?? []} poolCents={pool} onCustomise={() => customise(structure)} />
            )}
            {wholeError ? (
              <p className="text-sm font-medium text-destructive" data-testid="payout-places-error">
                {wholeError}
              </p>
            ) : null}
            {structure === "custom" ? (
              <Button
                ref={addButton}
                type="button"
                variant="outline"
                className="h-11 w-full sm:w-auto"
                onClick={() => append(addedRow(rows))}
                disabled={rows.length >= PAYOUT_PLACE_LIMITS.maxPlaces}
                data-testid="add-payout-place"
              >
                <Plus aria-hidden="true" />
                Add a place
              </Button>
            ) : null}
            {unpaidNote ? <p className="text-sm text-muted-foreground">{unpaidNote}</p> : null}
          </section>

          {difference ? (
            <>
              <DifferenceChoice
                difference={difference}
                value={prizeDifference}
                onChange={(choice) => form.setValue("prizeDifference", choice, { shouldDirty: true })}
                carryTarget={prizePool.carryTarget}
                firstCents={firstAsSet}
                rakeLabel={prizePool.rakeLabel}
              />
              <AddedByClubNote difference={difference} carryTarget={prizePool.carryTarget} />
            </>
          ) : null}

          <FormField
            control={form.control}
            name="reason"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Reason (optional)</FormLabel>
                <div role="group" aria-label="Common reasons" className="flex flex-wrap gap-2">
                  {PAYOUT_REASONS.map((choice) => (
                    <Chip key={choice} aria-pressed={reason.trim() === choice} onClick={() => field.onChange(reason.trim() === choice ? "" : choice)}>
                      {choice}
                    </Chip>
                  ))}
                </div>
                <FormControl>
                  <Input {...field} maxLength={200} className="h-11" placeholder="Or type a reason" />
                </FormControl>
                <FormDescription>Shown in the public activity feed.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

        </PhoneSheetBody>
        <PhoneSheetFooter>
          <Button type="button" variant="outline" className="h-11 flex-1 sm:flex-none" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" className="h-11 flex-1 sm:flex-none" busy={change.isPending} disabled={unchanged} data-testid="save-payouts">
            {unchanged ? "No changes to save" : "Save payouts"}
          </Button>
        </PhoneSheetFooter>
      </form>
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title={pending?.check.title ?? ""}
        description={pending?.check.description ?? ""}
        confirmLabel={pending?.check.confirmLabel ?? "Save payouts"}
        pendingLabel="Saving…"
        cancelLabel="Change the prizes"
        contentTestId="confirm-payouts"
        onConfirm={() => (pending ? save(pending.input) : undefined)}
      />
    </Form>
  );
}

interface StandardPlacesProps {
  structure: StandardPayoutKey;
  /** What each place pays now (previewShares: the leftover of a manual pool settled as chosen). */
  amounts: readonly Cents[];
  poolCents: Cents;
  onCustomise: () => void;
}

/** A standard structure's places and what each pays now, with a way to start custom places from them. */
function StandardPlaces({ structure, amounts, poolCents, onCustomise }: StandardPlacesProps) {
  const shares = PAYOUT_STRUCTURES[structure];
  return (
    <>
      <ol role="list" className="divide-y divide-border rounded-lg border border-border" aria-label="Places paid">
        {shares.map((bp, index) => (
          <li key={index} className="flex min-h-11 items-center justify-between gap-3 px-3 py-2" data-testid={`payout-place-${index + 1}`}>
            <span className="font-medium text-foreground">
              {placeName(index + 1)} <span className="font-normal text-muted-foreground">{bp / 100}%</span>
            </span>
            <span className="font-semibold tabular-nums text-foreground">{poolCents > 0 && amounts[index] !== undefined ? formatMoney(amounts[index]) : "–"}</span>
          </li>
        ))}
      </ol>
      <Button type="button" variant="outline" className="h-11 w-full sm:w-auto" onClick={onCustomise} data-testid="customise-payouts">
        Change these places
      </Button>
    </>
  );
}

interface CustomPlacesProps {
  ids: string;
  rows: readonly PayoutRowValues[];
  /** useFieldArray's key for each row. */
  fieldIds: readonly string[];
  preview: PayoutPlacesPreview;
  /** The live sum check (sumLine). */
  line: PayoutSumLine;
  errors: FieldErrors<PayoutEditorValues>;
  register: UseFormRegister<PayoutEditorValues>;
  onKind: (index: number, kind: PayoutPlace["kind"]) => void;
  onRemove: (index: number) => void;
  /** Each Remove button as it mounts (null as it goes), so focus can move after a removal. */
  onRemoveButton: (fieldId: string, button: HTMLButtonElement | null) => void;
}

/** What a custom place pays now: "= $180", "$300 (fixed)", with its part of a leftover added to it ("incl. $44 left over"). */
function paysText(row: PayoutRowValues, index: number, preview: PayoutPlacesPreview): string {
  const { amountCents: amount = null, setCents = null } = preview.rows[index] ?? {};
  if (amount === null) return "";
  const added = setCents !== null && amount > setCents ? ` (incl. ${formatMoney(amount - setCents)} left over)` : "";
  return row.kind === "amount" && !added ? `${formatMoney(amount)} (fixed)` : `= ${formatMoney(amount)}${added}`;
}

/** Each custom place: its percentage or amount, how it is set, what it pays, and Remove; then the live sum check. */
function CustomPlaces({ ids, rows, fieldIds, preview, line, errors, register, onKind, onRemove, onRemoveButton }: CustomPlacesProps) {
  return (
    <>
      <ol role="list" className="space-y-3" aria-label="Places paid">
        {fieldIds.map((fieldId, index) => {
          const row = rows[index];
          if (!row) return null;
          const name = placeName(index + 1);
          const inputId = `${ids}-place-${index}`;
          const error = placeError(errors, index);
          const pays = paysText(row, index, preview);
          return (
            <li key={fieldId} className="rounded-lg border border-border p-3" data-testid={`payout-place-${index + 1}`}>
              <Label htmlFor={inputId} className="mb-1.5 block">
                {name} place
              </Label>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <AmountInput
                    id={inputId}
                    unit={row.kind === "percent" ? "%" : "$"}
                    className="h-11 text-base"
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? `${inputId}-error` : pays ? `${inputId}-pays` : undefined}
                    {...register(`places.${index}.value`)}
                  />
                </div>
                <div role="group" aria-label={`How ${name} place is set`} className="flex shrink-0 overflow-hidden rounded-md border border-input">
                  <KindButton pressed={row.kind === "percent"} label="Percentage of the pool" onClick={() => onKind(index, "percent")}>
                    %
                  </KindButton>
                  <KindButton pressed={row.kind === "amount"} label="Fixed amount" onClick={() => onKind(index, "amount")}>
                    $
                  </KindButton>
                </div>
                {rows.length > 1 ? (
                  <Button
                    ref={(button) => onRemoveButton(fieldId, button)}
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11 shrink-0"
                    onClick={() => onRemove(index)}
                    aria-label={`Remove ${name} place`}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                ) : null}
              </div>
              {pays ? (
                <p id={`${inputId}-pays`} className="mt-1.5 text-sm tabular-nums text-muted-foreground" data-testid={`payout-pays-${index + 1}`}>
                  {pays}
                </p>
              ) : null}
              {error ? (
                <p id={`${inputId}-error`} className="mt-1.5 text-sm font-medium text-destructive">
                  {error}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
      <p
        aria-live="polite"
        className={cn("rounded-lg border p-3 text-sm font-medium", line.tone === "over" ? "border-amber-500/60 text-foreground" : "border-border text-foreground")}
        data-testid="payout-sum"
      >
        {line.text}
      </p>
    </>
  );
}

function KindButton({ pressed, label, onClick, children }: { pressed: boolean; label: string; onClick: () => void; children: string }) {
  return (
    <Button
      type="button"
      variant={pressed ? "default" : "ghost"}
      className="h-11 w-11 rounded-none text-base"
      aria-pressed={pressed}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function Chip({ children, ...props }: Omit<ComponentProps<typeof Button>, "type" | "variant">) {
  return (
    <Button type="button" variant="outline" className="h-11 px-3" {...props}>
      {children}
    </Button>
  );
}
