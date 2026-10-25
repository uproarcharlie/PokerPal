import { useForm, useWatch, type Control, type FieldPath } from "react-hook-form";
import { GENERATOR_LIMITS, generateStructure } from "@shared/domain/blind-structures";
import { ANTE_MODE_LABELS, ANTE_MODES, type ClockStructure } from "@shared/domain/clock";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formResolver } from "@/lib/forms";
import { AFTER_FIRST_BREAK, DEFAULT_GENERATOR_VALUES, GENERATOR_STARTS, generatorFormSchema, generatorValues, type GeneratorFormValues } from "../generator-form";
import { StructureTable } from "./structure-table";

type Values = GeneratorFormValues;

interface BoxProps {
  control: Control<Values>;
  name: FieldPath<Values>;
  label: string;
  description?: string;
  required?: boolean;
  decimal?: boolean;
}

/** A number typed into a text box (phase3-conventions §13). */
function NumberBox({ control, name, label, description, required, decimal }: BoxProps) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem required={required}>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input inputMode={decimal ? "decimal" : "numeric"} {...field} value={String(field.value)} />
          </FormControl>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/** A part of the generator that can be switched on (later level lengths, breaks). */
function PartSwitch({ control, name, label }: { control: Control<Values>; name: "laterLevels.enabled" | "breaks.enabled"; label: string }) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className="flex flex-row items-center justify-between gap-4 space-y-0">
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Switch ref={field.ref} checked={field.value} onCheckedChange={field.onChange} onBlur={field.onBlur} />
          </FormControl>
        </FormItem>
      )}
    />
  );
}

interface PartError {
  message?: string;
  root?: { message?: string };
}

/**
 * A problem with a whole part (e.g. "The blinds would pass 100,000,000"), from the shared rules. The
 * resolver files a part's own problem under `root` (the part has boxes of its own).
 */
function PartMessage({ error }: { error: PartError | undefined }) {
  const message = error?.root?.message ?? error?.message;
  return message ? (
    <p role="alert" className="text-sm font-medium text-destructive">
      {message}
    </p>
  ) : null;
}

/** The generated levels for the values as typed, or null while they cannot make a structure. */
function previewOf(values: Values): ClockStructure | null {
  const parsed = generatorFormSchema.safeParse(values);
  return parsed.success ? generateStructure(parsed.data) : null;
}

interface StructureGeneratorProps {
  /** What using the levels does: "Create the clock", "Use these levels". */
  actionLabel: string;
  busy?: boolean;
  onUse: (structure: ClockStructure) => Promise<unknown> | void;
}

/**
 * Builds a structure from a few settings (shared/domain/blind-structures generateStructure): the stack
 * and first blinds, how fast they rise, level lengths (with a different length later on), breaks
 * and antes. The levels it makes are shown as they are typed; they can be edited row by row after.
 */
export function StructureGenerator({ actionLabel, busy = false, onUse }: StructureGeneratorProps) {
  const form = useForm<Values>({ resolver: formResolver(generatorFormSchema), defaultValues: DEFAULT_GENERATOR_VALUES });
  const { control, formState } = form;
  const values = useWatch({ control }) as Values;
  const preview = previewOf(values);
  const levelCount = Number(values.levelCount);
  const afterOptions = Number.isInteger(levelCount) && levelCount > 1 ? Array.from({ length: Math.min(levelCount, GENERATOR_LIMITS.maxLevels) - 1 }, (_, i) => i + 1) : [];

  const submit = form.handleSubmit(async (raw) => {
    await onUse(generateStructure(generatorFormSchema.parse(raw)));
  });

  return (
    <Form {...form}>
      <form onSubmit={submit} noValidate className="space-y-6" aria-label="Structure generator">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Start from:</span>
          {GENERATOR_STARTS.map((start) => (
            <Button key={start.key} type="button" variant="outline" size="sm" onClick={() => form.reset(generatorValues(start.input))}>
              {start.name}
            </Button>
          ))}
        </div>

        <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-base font-semibold text-foreground">Stack and first blinds</legend>
          <NumberBox control={control} name="startingStack" label="Starting stack" required />
          <NumberBox control={control} name="smallestChip" label="Smallest chip" description="Blank: worked out from the first blinds" />
          <NumberBox control={control} name="smallBlind" label="Level 1 small blind" required />
          <NumberBox control={control} name="bigBlind" label="Level 1 big blind" required />
        </fieldset>

        <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-base font-semibold text-foreground">How the blinds rise</legend>
          <FormField
            control={control}
            name="growth.kind"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Each level</FormLabel>
                <FormControl>
                  <NativeSelect {...field}>
                    <option value="multiplier">Multiplies the blinds</option>
                    <option value="step">Adds the same to the big blind</option>
                  </NativeSelect>
                </FormControl>
              </FormItem>
            )}
          />
          {values.growth.kind === "multiplier" ? (
            <NumberBox key="factor" control={control} name="growth.factor" label="Multiply by" description="1.25 to 1.5 is usual" decimal required />
          ) : (
            <NumberBox key="step" control={control} name="growth.bigBlindStep" label="Add to the big blind" required />
          )}
          <PartMessage error={formState.errors.growth} />
        </fieldset>

        <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-base font-semibold text-foreground">Levels</legend>
          <NumberBox control={control} name="levelCount" label="Number of levels" required />
          <NumberBox control={control} name="levelMinutes" label="Minutes per level" required />
          <div className="space-y-4 sm:col-span-2">
            <PartSwitch control={control} name="laterLevels.enabled" label="Later levels are a different length" />
            {values.laterLevels.enabled ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <NumberBox control={control} name="laterLevels.minutes" label="Minutes per later level" required />
                <FormField
                  control={control}
                  name="laterLevels.startsAfter"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Starting</FormLabel>
                      <FormControl>
                        <NativeSelect {...field}>
                          <option value={AFTER_FIRST_BREAK}>After the first break</option>
                          {afterOptions.map((level) => (
                            <option key={level} value={String(level)}>
                              After level {level}
                            </option>
                          ))}
                        </NativeSelect>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            ) : null}
            <PartMessage error={formState.errors.laterLevels} />
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="mb-2 text-base font-semibold text-foreground">Breaks</legend>
          <PartSwitch control={control} name="breaks.enabled" label="Take breaks" />
          {values.breaks.enabled ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <NumberBox control={control} name="breaks.everyLevels" label="A break after every … levels" required />
              <NumberBox control={control} name="breaks.minutes" label="Minutes per break" required />
              <FormField
                control={control}
                name="breaks.notes"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>Notes on the clock</FormLabel>
                    <FormControl>
                      <Textarea rows={3} placeholder={"Last re-buys / add-ons\nColour up"} {...field} />
                    </FormControl>
                    <FormDescription>One line per break, in order. Leave a line blank for no note.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          ) : null}
          <PartMessage error={formState.errors.breaks} />
        </fieldset>

        <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-base font-semibold text-foreground">Antes</legend>
          <FormField
            control={control}
            name="ante.mode"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Ante</FormLabel>
                <FormControl>
                  <NativeSelect {...field}>
                    {ANTE_MODES.map((mode) => (
                      <option key={mode} value={mode}>
                        {ANTE_MODE_LABELS[mode]}
                      </option>
                    ))}
                  </NativeSelect>
                </FormControl>
              </FormItem>
            )}
          />
          {values.ante.mode !== "none" ? <NumberBox control={control} name="ante.fromLevel" label="From level" required /> : null}
          <PartMessage error={formState.errors.ante} />
        </fieldset>

        <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <legend className="mb-2 text-base font-semibold text-foreground">Other stacks (for the chip count)</legend>
          <NumberBox control={control} name="rebuyStack" label="Re-buy stack" description="Blank: the starting stack" />
          <NumberBox control={control} name="addonStack" label="Add-on stack" />
          <NumberBox control={control} name="earlyBirdStack" label="Early-bird bonus" />
        </fieldset>

        <section aria-label="Preview" className="space-y-2">
          <h4 className="text-base font-semibold text-foreground">Preview</h4>
          {preview ? (
            <StructureTable structure={preview} caption="Generated levels" />
          ) : (
            <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">Fix the settings above to see the levels.</p>
          )}
        </section>

        <Button type="submit" busy={busy}>
          {actionLabel}
        </Button>
      </form>
    </Form>
  );
}
