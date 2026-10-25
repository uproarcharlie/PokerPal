import { useEffect, useId, useState } from "react";
import { Controller, useForm, useWatch, type Control } from "react-hook-form";
import type { ClockDto } from "@shared/api/clock";
import { ANTE_MODE_LABELS, CLOCK_LIMITS, formatBlinds, type DerivedClock } from "@shared/domain/clock";
import { GENERATOR_LIMITS } from "@shared/domain/blind-structures";
import { NumberStepper } from "@/components/shared/number-stepper";
import { PhoneSheet } from "@/components/shared/phone-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { errorMessage, hasErrorCode } from "@/lib/api/http";
import { cn } from "@/lib/utils";
import { baseLevelOf, FACTOR_CHOICES, MAX_REST_LEVELS, readRest, restChanged, restPreview, restValues, type RestField, type RestFormValues, type RestProblem } from "../rest-form";
import { useClockConfig } from "../staff-hooks";
import { ChoiceGroup } from "./choice-group";
import { periodName } from "./public/clock-face";

interface RestOfStructureSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tournamentId: string;
  clock: ClockDto;
  derived: DerivedClock;
}

/**
 * "Change the rest of the structure" (round 5, item 3), a full-screen sheet on a phone: every level
 * after the one the clock is on, at once: their length, the blinds regenerated from the current level
 * (a multiplier or a fixed step), where the antes start, and the breaks still to come (kept, none, or
 * every N levels). The preview lists each later level beside what it was; nothing changes until Save,
 * which goes through the structure editor's own save with the structure's hash, so the clock keeps its
 * level and an edit made meanwhile on another device is never overwritten.
 */
export function RestOfStructureSheet({ open, onOpenChange, ...props }: RestOfStructureSheetProps) {
  const formId = useId();
  const [saving, setSaving] = useState<{ busy: boolean; ready: boolean }>({ busy: false, ready: false });
  return (
    <PhoneSheet width="wide"
      open={open}
      onOpenChange={onOpenChange}
      title="Change the rest of the structure"
      description="Every level after the one the clock is on. Played levels, and this one, stay as they are."
      footer={
        <>
          <Button type="button" variant="outline" className="h-11 flex-1" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form={formId} className="h-11 flex-1" busy={saving.busy} disabled={!saving.ready}>
            Save the new levels
          </Button>
        </>
      }
    >
      {/* Mounted while open only: each opening starts from the structure as it is then. */}
      {open ? <RestForm {...props} formId={formId} onState={setSaving} onDone={() => onOpenChange(false)} /> : null}
    </PhoneSheet>
  );
}

const fieldId = (base: string, field: RestField) => `${base}-${field.replace(".", "-")}`;

/** What is wrong with `field`: every problem filed under it (the breaks as a whole can have more than one). */
function FieldProblem({ id, problems, field }: { id: string; problems: RestProblem[]; field: RestField }) {
  const messages = problems.filter((candidate) => candidate.field === field).map((problem) => problem.message);
  return messages.length > 0 ? (
    <p id={`${fieldId(id, field)}-problem`} className="text-sm font-medium text-destructive">
      {messages.join(" ")}
    </p>
  ) : null;
}

interface StepperFieldProps {
  id: string;
  control: Control<RestFormValues>;
  name: RestField & ("length.minutes" | "blinds.levelCount" | "antes.fromLevel" | "breaks.everyLevels" | "breaks.minutes");
  label: string;
  /** For the − / + buttons: "minutes per level". */
  what: string;
  unit?: string;
  min: number;
  max: number;
  problems: RestProblem[];
}

function StepperField({ id, control, name, label, what, unit, min, max, problems }: StepperFieldProps) {
  const invalid = problems.some((problem) => problem.field === name);
  return (
    <div className="space-y-2">
      <Label htmlFor={fieldId(id, name)}>{label}</Label>
      <Controller
        control={control}
        name={name}
        render={({ field }) => (
          <NumberStepper
            ref={field.ref}
            id={fieldId(id, name)}
            label={what}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            min={min}
            max={max}
            unit={unit}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? `${fieldId(id, name)}-problem` : undefined}
          />
        )}
      />
      <FieldProblem id={id} problems={problems} field={name} />
    </div>
  );
}

interface RestFormProps {
  tournamentId: string;
  clock: ClockDto;
  derived: DerivedClock;
  formId: string;
  /** Whether Save (in the sheet's footer) is busy, and whether there is a change to save. */
  onState: (state: { busy: boolean; ready: boolean }) => void;
  onDone: () => void;
}

function RestForm({ tournamentId, clock, derived, formId, onState, onDone }: RestFormProps) {
  const { toast } = useToast();
  const { save } = useClockConfig(tournamentId);
  const id = useId();
  const { structure } = clock;
  const fromIndex = derived.levelIndex;
  // The structure as it was when the sheet opened: a change from another device meanwhile is said, not hidden.
  const [openedHash] = useState(clock.structureHash);
  const form = useForm<RestFormValues>({ defaultValues: restValues(structure, fromIndex) });
  const { control, register } = form;
  const values = useWatch({ control }) as RestFormValues;
  const read = readRest(structure, fromIndex, values);
  const problems = read.ok ? [] : read.problems;
  const changed = read.ok && restChanged(structure, read.structure);
  const preview = read.ok ? restPreview(structure, read.structure, fromIndex) : null;
  const base = baseLevelOf(structure, fromIndex);
  const here = periodName(derived);
  const nextNumber = (base?.number ?? 0) + 1;
  const general = problems.filter((problem) => problem.field === null);
  const ready = changed && derived.status !== "finished";
  useEffect(() => onState({ busy: save.isPending, ready }), [onState, save.isPending, ready]);

  const submit = form.handleSubmit(async () => {
    if (!read.ok || !ready) return;
    try {
      await save.mutateAsync({ structure: read.structure, presetKey: clock.presetKey, baseHash: clock.structureHash });
      toast({ title: "Rest of the structure changed", description: `${here} and the levels before it are as they were.` });
      onDone();
    } catch (error) {
      if (hasErrorCode(error, "STRUCTURE_CHANGED")) {
        toast({ title: "Someone else edited the structure — reloaded", description: "The preview now starts from the structure as it is: check it and save again.", variant: "destructive" });
        return;
      }
      if (hasErrorCode(error, "CURRENT_LEVEL_REMOVED") || hasErrorCode(error, "LEVEL_CHANGED")) {
        toast({ title: "The clock moved on — check the preview", description: "The levels after the one it is on now are shown: save again to apply them.", variant: "destructive" });
        return;
      }
      toast({ title: "Could not change the structure", description: errorMessage(error), variant: "destructive" });
    }
  });

  return (
    <form id={formId} onSubmit={submit} noValidate className="space-y-6" aria-label="Change the rest of the structure">
      <p className="rounded-md bg-muted p-3 text-sm text-foreground" data-testid="rest-from">
        The clock is on <strong>{here}</strong>. Changes start with Level {nextNumber}.
      </p>
      {clock.structureHash !== openedHash ? (
        <p role="status" className="rounded-md border border-border p-3 text-sm text-foreground">
          The structure was changed on another device: the preview shows it as it is now.
        </p>
      ) : null}

      <section className="space-y-3" aria-labelledby={`${id}-length`}>
        <div className="flex min-h-11 items-center justify-between gap-4">
          <Label id={`${id}-length`} htmlFor={`${id}-length-change`} className="text-base font-semibold">
            Same length for every later level
          </Label>
          <Controller
            control={control}
            name="length.change"
            render={({ field }) => <Switch id={`${id}-length-change`} ref={field.ref} checked={field.value} onCheckedChange={field.onChange} />}
          />
        </div>
        {values.length.change ? (
          <StepperField id={id} control={control} name="length.minutes" label="Minutes per level" what="minutes per level" unit="min" min={CLOCK_LIMITS.minMinutes} max={CLOCK_LIMITS.maxMinutes} problems={problems} />
        ) : null}
      </section>

      <section className="space-y-4">
        <Controller
          control={control}
          name="blinds.mode"
          render={({ field }) => (
            <ChoiceGroup
              legend="Blinds"
              value={field.value}
              onChange={field.onChange}
              choices={[
                { value: "keep", label: "Keep the blinds as they are" },
                {
                  value: "regenerate",
                  label: "Work out new blinds",
                  description: base ? `Rising from ${formatBlinds(base.level)} (Level ${String(base.number)})` : "No level has been played yet",
                },
              ]}
            />
          )}
        />
        {values.blinds.mode === "regenerate" ? (
          <div className="space-y-4 rounded-md border border-border p-3">
            <Controller
              control={control}
              name="blinds.growth"
              render={({ field }) => (
                <ChoiceGroup
                  legend="Each level"
                  value={field.value}
                  onChange={field.onChange}
                  choices={[
                    { value: "multiplier", label: "Multiplies the blinds" },
                    { value: "step", label: "Adds the same to the big blind" },
                  ]}
                />
              )}
            />
            {values.blinds.growth === "multiplier" ? <FactorField id={id} control={control} problems={problems} /> : null}
            {values.blinds.growth === "step" ? (
              <div className="space-y-2">
                <Label htmlFor={fieldId(id, "blinds.bigBlindStep")}>Add to the big blind</Label>
                <Input
                  id={fieldId(id, "blinds.bigBlindStep")}
                  inputMode="numeric"
                  autoComplete="off"
                  className="h-11 max-w-40 text-base tabular-nums"
                  aria-invalid={problems.some((problem) => problem.field === "blinds.bigBlindStep") || undefined}
                  {...register("blinds.bigBlindStep")}
                />
                <FieldProblem id={id} problems={problems} field="blinds.bigBlindStep" />
              </div>
            ) : null}
            <StepperField id={id} control={control} name="blinds.levelCount" label="Levels after this one" what="levels" unit="levels" min={GENERATOR_LIMITS.minLevels} max={MAX_REST_LEVELS} problems={problems} />
            <div className="space-y-2">
              <Label htmlFor={fieldId(id, "blinds.smallestChip")}>Smallest chip</Label>
              <Input
                id={fieldId(id, "blinds.smallestChip")}
                inputMode="numeric"
                autoComplete="off"
                className="h-11 max-w-40 text-base tabular-nums"
                aria-invalid={problems.some((problem) => problem.field === "blinds.smallestChip") || undefined}
                {...register("blinds.smallestChip")}
              />
              <p className="text-sm text-muted-foreground">The blinds are rounded to it. Blank: worked out from the first level.</p>
              <FieldProblem id={id} problems={problems} field="blinds.smallestChip" />
            </div>
          </div>
        ) : null}
      </section>

      {structure.anteMode !== "none" ? (
        <section className="space-y-4">
          <Controller
            control={control}
            name="antes.mode"
            render={({ field }) => (
              <ChoiceGroup
                legend={`Antes (${ANTE_MODE_LABELS[structure.anteMode]})`}
                value={field.value}
                onChange={field.onChange}
                choices={[
                  { value: "keep", label: "Keep the antes as they are" },
                  { value: "from", label: "Antes from a level on", description: "None before it; every level from it has one" },
                ]}
              />
            )}
          />
          {values.antes.mode === "from" ? (
            <StepperField id={id} control={control} name="antes.fromLevel" label="Antes start at level" what="levels" min={1} max={CLOCK_LIMITS.maxLevels} problems={problems} />
          ) : null}
        </section>
      ) : null}

      <section className="space-y-4">
        <Controller
          control={control}
          name="breaks.mode"
          render={({ field }) => (
            <ChoiceGroup
              legend="Breaks still to come"
              value={field.value}
              onChange={field.onChange}
              choices={[
                { value: "keep", label: "Keep them where they are" },
                { value: "none", label: "No more breaks" },
                { value: "every", label: "A break every few levels" },
              ]}
            />
          )}
        />
        {values.breaks.mode === "every" ? (
          <div className="space-y-4 rounded-md border border-border p-3">
            <StepperField id={id} control={control} name="breaks.everyLevels" label="A break after every" what="levels between breaks" unit="levels" min={1} max={GENERATOR_LIMITS.maxBreakEvery} problems={problems} />
            <StepperField id={id} control={control} name="breaks.minutes" label="Each break lasts" what="minutes per break" unit="min" min={1} max={GENERATOR_LIMITS.maxBreakMinutes} problems={problems} />
            <div className="space-y-2">
              <Label htmlFor={fieldId(id, "breaks.notes")}>Notes on the clock</Label>
              <Textarea id={fieldId(id, "breaks.notes")} rows={3} placeholder={"Colour up\nDinner"} className="text-base" {...register("breaks.notes")} />
              <p className="text-sm text-muted-foreground">One line per break, in order. Leave a line blank for no note.</p>
              <FieldProblem id={id} problems={problems} field="breaks.notes" />
            </div>
            <FieldProblem id={id} problems={problems} field="breaks" />
          </div>
        ) : null}
      </section>

      <section aria-labelledby={`${id}-preview`} className="space-y-2">
        <h3 id={`${id}-preview`} className="text-base font-semibold text-foreground">
          Preview
        </h3>
        {general.map((problem) => (
          <p key={problem.message} role="alert" className="text-sm font-medium text-destructive">
            {problem.message}
          </p>
        ))}
        {preview ? (
          <>
            <p className="text-sm text-muted-foreground" data-testid="rest-summary">
              {preview.summary}
            </p>
            <ol role="list" aria-label="The levels after this one" className="divide-y divide-border rounded-md border border-border" data-testid="rest-preview">
              {preview.rows.map((row) => (
                <li key={row.key} className={cn("flex flex-wrap items-baseline justify-between gap-x-3 px-3 py-2 text-sm", row.name === "Break" && "bg-muted/60")}>
                  <span className="font-semibold text-foreground">{row.name}</span>
                  <span className="tabular-nums text-foreground">{row.now}</span>
                  {row.was ? (
                    <span className="w-full text-xs text-muted-foreground">{row.was === "new" ? "New" : `Was ${row.was}`}</span>
                  ) : null}
                </li>
              ))}
            </ol>
            {preview.removed.length > 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="rest-removed">
                No longer played: {preview.removed.join(", ")}
              </p>
            ) : null}
          </>
        ) : general.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">Fix the settings above to see the new levels.</p>
        ) : null}
      </section>

    </form>
  );
}

/** The increase per level: one tap for the usual ones, or typed (Custom). */
function FactorField({ id, control, problems }: { id: string; control: Control<RestFormValues>; problems: RestProblem[] }) {
  const factor = useWatch({ control, name: "blinds.factor" });
  const [custom, setCustom] = useState(() => !(FACTOR_CHOICES as readonly string[]).includes(factor));
  const invalid = problems.some((problem) => problem.field === "blinds.factor");
  return (
    <Controller
      control={control}
      name="blinds.factor"
      render={({ field }) => (
        <div className="space-y-2">
          <p id={`${id}-factor-label`} className="text-sm font-medium text-foreground">
            Multiply by
          </p>
          <div role="group" aria-labelledby={`${id}-factor-label`} className="flex flex-wrap gap-2">
            {FACTOR_CHOICES.map((choice) => (
              <Button
                key={choice}
                type="button"
                variant={!custom && field.value === choice ? "default" : "outline"}
                aria-pressed={!custom && field.value === choice}
                className="h-11 min-w-16 tabular-nums"
                onClick={() => {
                  setCustom(false);
                  field.onChange(choice);
                }}
              >
                ×{choice}
              </Button>
            ))}
            <Button type="button" variant={custom ? "default" : "outline"} aria-pressed={custom} className="h-11" onClick={() => setCustom(true)}>
              Custom
            </Button>
          </div>
          {custom ? (
            <div className="space-y-2">
              <Label htmlFor={fieldId(id, "blinds.factor")}>Custom increase</Label>
              <Input
                ref={field.ref}
                id={fieldId(id, "blinds.factor")}
                inputMode="decimal"
                autoComplete="off"
                className="h-11 max-w-32 text-base tabular-nums"
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                aria-invalid={invalid || undefined}
              />
            </div>
          ) : null}
          <FieldProblem id={id} problems={problems} field="blinds.factor" />
        </div>
      )}
    />
  );
}
