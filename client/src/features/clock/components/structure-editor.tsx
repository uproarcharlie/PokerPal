import { memo, useId, useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { ChevronDown, Plus } from "lucide-react";
import type { ClockDto } from "@shared/api/clock";
import type { BlindPresetKey } from "@shared/domain/blind-structures";
import { ANTE_MODE_LABELS, ANTE_MODES, type ClockStructure } from "@shared/domain/clock";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useToast } from "@/hooks/use-toast";
import { errorMessage, hasErrorCode } from "@/lib/api/http";
import { formResolver } from "@/lib/forms";
import { cn } from "@/lib/utils";
import { breakRow, rowsSummary, rowTitle, structureFormSchema, structureValues, suggestedRow, type StructureFormValues } from "../structure-form";
import { conflictDisplay, useClockConfig } from "../staff-hooks";
import { StructureChooser } from "./structure-chooser";
import { boxGrid, NAME_COLUMN, StructureRow } from "./structure-row";

const STACKS = [
  { name: "startingStack", label: "Starting stack", description: "Needed for the chips in play and the average stack" },
  { name: "rebuyStack", label: "Re-buy stack", description: "Blank: the starting stack" },
  { name: "addonStack", label: "Add-on stack", description: "Set it for an accurate average once anyone takes an add-on" },
  { name: "earlyBirdStack", label: "Early-bird bonus", description: "Extra chips for players who registered early" },
] as const;

interface StructureEditorProps {
  tournamentId: string;
  clubId: string;
  clock: ClockDto;
  /** The id of the level the clock is on. */
  currentLevelId: string | null;
  timeZone?: string;
}

/**
 * The blind structure, row by row: levels (small blind, big blind, ante, minutes) and breaks (minutes,
 * a note for the clock), inserted, moved and deleted freely; the ante mode and the stacks the chip
 * figures use. Saving sends the structure this edit started from (its hash): if someone else saved in
 * between, the save is refused and the latest is loaded. The clock keeps its place when rows change
 * around the level it is on. Folded away once the clock has started (rarely touched in play, and long),
 * unless it holds unsaved changes, until the TD opens or folds it (TDN2-TV-CARD-BURIED).
 */
export const StructureEditor = memo(function StructureEditor({ tournamentId, clubId, clock, currentLevelId, timeZone }: StructureEditorProps) {
  const { toast } = useToast();
  const { save } = useClockConfig(tournamentId);
  const [base, setBase] = useState(() => ({ hash: clock.structureHash, presetKey: clock.presetKey }));
  const [replacing, setReplacing] = useState(false);
  // Null until the TD opens or folds it: open while the clock has not started, or while an edit is unsaved.
  const [unfolded, setUnfolded] = useState<boolean | null>(null);
  const contentId = useId();
  const form = useForm<StructureFormValues>({ resolver: formResolver(structureFormSchema), defaultValues: structureValues(clock.structure) });
  const { control, register, formState } = form;
  const open = unfolded ?? (clock.status === "idle" || formState.isDirty);
  const rows = useFieldArray({ control, name: "levels" });
  const [levels = [], anteMode = clock.structure.anteMode] = useWatch({ control, name: ["levels", "anteMode"] });
  const holdsLevel = clock.status === "running" || clock.status === "paused";
  const listProblem = formState.errors.levels?.root?.message ?? formState.errors.levels?.message;

  const load = (from: Pick<ClockDto, "structure" | "structureHash" | "presetKey">) => {
    form.reset(structureValues(from.structure));
    setBase({ hash: from.structureHash, presetKey: from.presetKey });
  };

  const replaceWith = (structure: ClockStructure, presetKey: BlindPresetKey | null) => {
    form.reset(structureValues(structure), { keepDefaultValues: true });
    setBase((current) => ({ ...current, presetKey }));
    setReplacing(false);
  };

  const submit = form.handleSubmit(async (values) => {
    try {
      const display = await save.mutateAsync({ structure: structureFormSchema.parse(values), presetKey: base.presetKey, baseHash: base.hash });
      if (display.clock) load(display.clock);
      toast({ title: "Blind structure saved", description: "The clock stays on the level it is on." });
    } catch (error) {
      const latest = conflictDisplay(error)?.clock;
      if (hasErrorCode(error, "STRUCTURE_CHANGED") && latest) {
        load(latest);
        toast({ title: "Someone else edited the structure — reloaded", description: "Make your change again on the structure as it is now.", variant: "destructive" });
        return;
      }
      toast({ title: "Could not save the structure", description: errorMessage(error), variant: "destructive" });
    }
  });

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1.5">
          <CardTitle>Blind structure</CardTitle>
          <CardDescription>
            {rowsSummary(levels)}
          </CardDescription>
        </div>
        <Button type="button" variant="outline" size="sm" aria-expanded={open} aria-controls={contentId} onClick={() => setUnfolded(!open)}>
          <ChevronDown aria-hidden="true" className={cn("transition-transform", open && "rotate-180")} />
          {open ? "Hide" : "Show and edit"}
          <span className="sr-only"> the blind structure</span>
        </Button>
      </CardHeader>
      <CardContent id={contentId} hidden={!open} className="px-3 sm:px-6">
        <Form {...form}>
          <form onSubmit={submit} noValidate className="space-y-6" aria-label="Blind structure">
            {clock.structureHash !== base.hash ? (
              <div role="status" className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted p-3 text-sm text-foreground">
                The structure was changed on another device.
                <Button type="button" size="sm" variant="outline" onClick={() => load(clock)}>
                  Load the latest (drops your changes)
                </Button>
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <FormField
                control={control}
                name="anteMode"
                render={({ field }) => (
                  <FormItem className="lg:col-span-1">
                    <FormLabel>Antes</FormLabel>
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
              {STACKS.map((stack) => (
                <FormField
                  key={stack.name}
                  control={control}
                  name={stack.name}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{stack.label}</FormLabel>
                      <FormControl>
                        <Input inputMode="numeric" {...field} />
                      </FormControl>
                      <FormDescription>{stack.description}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}
            </div>

            <div>
              <div className="flex gap-2 px-1" aria-hidden="true">
                <span className={cn("hidden sm:block", NAME_COLUMN)} />
                <div className={boxGrid(anteMode)}>
                  {["Small blind", "Big blind", ...(anteMode === "none" ? [] : [anteMode === "bb_ante" ? "BB ante" : "Ante"]), "Minutes"].map((heading) => (
                    <span key={heading} className="text-xs font-semibold text-muted-foreground">
                      {heading}
                    </span>
                  ))}
                </div>
              </div>
              <ol role="list" aria-label="Levels and breaks" className="mt-1 space-y-1">
                {rows.fields.map((row, index) => {
                  const current = row.levelId === currentLevelId;
                  return (
                    <StructureRow
                      key={row.id}
                      index={index}
                      kind={row.kind}
                      title={rowTitle(rows.fields, index)}
                      anteMode={anteMode}
                      register={register}
                      errors={formState.errors.levels}
                      current={current}
                      actions={{
                        insertLevel: () => rows.insert(index + 1, suggestedRow(levels, anteMode, index)),
                        insertBreak: () => rows.insert(index + 1, breakRow(levels)),
                        moveUp: index > 0 ? () => rows.move(index, index - 1) : undefined,
                        moveDown: index < rows.fields.length - 1 ? () => rows.move(index, index + 1) : undefined,
                        remove: current && holdsLevel ? undefined : () => rows.remove(index),
                        keptBecause: "The clock is on this level",
                      }}
                    />
                  );
                })}
              </ol>
              {listProblem ? (
                <p role="alert" className="mt-2 text-sm font-medium text-destructive">
                  {listProblem}
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => rows.append(suggestedRow(levels, anteMode))}>
                <Plus aria-hidden="true" />
                Add level
              </Button>
              <Button type="button" variant="outline" onClick={() => rows.append(breakRow(levels))}>
                <Plus aria-hidden="true" />
                Add break
              </Button>
              <Button type="button" variant="ghost" onClick={() => setReplacing(true)}>
                Replace structure…
              </Button>
              <div className="flex w-full flex-wrap gap-2 sm:ml-auto sm:w-auto">
                <Button type="button" variant="outline" disabled={!formState.isDirty} onClick={() => load(clock)}>
                  Discard changes
                </Button>
                <Button type="submit" busy={save.isPending} disabled={!formState.isDirty}>
                  Save structure
                </Button>
              </div>
            </div>
          </form>
        </Form>

        <Dialog open={replacing} onOpenChange={setReplacing}>
          <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>Replace the structure</DialogTitle>
              <DialogDescription>The levels below are replaced with your choice; nothing changes on the clock until you save.</DialogDescription>
            </DialogHeader>
            <StructureChooser
              clubId={clubId}
              tournamentId={tournamentId}
              timeZone={timeZone}
              labels={{ preset: "Load", generator: "Load these levels", copy: "Load this structure" }}
              pending={null}
              onChoose={(structure, source) => replaceWith(structure, source)}
            />
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
});
