import { useId, useState } from "react";
import { BLIND_PRESETS, presetStructure, type BlindPresetKey } from "@shared/domain/blind-structures";
import type { ClockStructure } from "@shared/domain/clock";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { errorMessage } from "@/lib/api/http";
import { DEFAULT_TIME_ZONE, formatDay } from "@/lib/format";
import { structureSummary } from "../structure-form";
import { useBlindStructures } from "../staff-hooks";
import { StructureGenerator } from "./structure-generator";

/** Where a chosen structure came from: a preset's key, or null (generated or copied). */
export type StructureSource = BlindPresetKey | null;

export interface ChoiceLabels {
  preset: string;
  generator: string;
  copy: string;
}

interface StructureChooserProps {
  clubId: string;
  /** This tournament, left out of "copy from a previous game". */
  tournamentId: string;
  timeZone?: string;
  /** What each choice's button says: "Use this" / "Create the clock" / "Copy this structure" when setting up. */
  labels: ChoiceLabels;
  /** Which choice is being saved ("preset:<key>", "generator", "copy"), for its button's busy state. */
  pending: string | null;
  onChoose: (structure: ClockStructure, source: StructureSource, choice: string) => Promise<unknown> | void;
}

/**
 * The three ways to a structure: a preset (Central Stars' first), the generator, or a copy of one of
 * the club's earlier games.
 */
export function StructureChooser({ clubId, tournamentId, timeZone, labels, pending, onChoose }: StructureChooserProps) {
  const [generating, setGenerating] = useState(false);
  const id = useId();
  return (
    <div className="space-y-8">
      <section aria-labelledby={`${id}-presets`} className="space-y-3">
        <h3 id={`${id}-presets`} className="text-lg font-semibold text-foreground">
          Presets
        </h3>
        <ul role="list" className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {BLIND_PRESETS.map((preset) => (
            <li key={preset.key} className="flex flex-col gap-2 rounded-lg border border-border p-4" data-testid={`preset-${preset.key}`}>
              <p className="font-semibold text-foreground">{preset.name}</p>
              <p className="text-sm text-muted-foreground">{preset.description}</p>
              <p className="text-xs text-muted-foreground">{structureSummary(preset.structure.levels, { from: true })}</p>
              {preset.format ? (
                <ul role="list" className="list-inside list-disc text-xs text-muted-foreground">
                  {preset.format.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              ) : null}
              <Button
                className="mt-auto self-start"
                size="sm"
                busy={pending === `preset:${preset.key}`}
                aria-label={`${labels.preset}: ${preset.name}`}
                onClick={() => void onChoose(presetStructure(preset.key), preset.key, `preset:${preset.key}`)}
              >
                {labels.preset}
              </Button>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby={`${id}-generator`} className="space-y-3">
        <h3 id={`${id}-generator`} className="text-lg font-semibold text-foreground">
          Build your own
        </h3>
        {generating ? (
          <StructureGenerator actionLabel={labels.generator} busy={pending === "generator"} onUse={(structure) => onChoose(structure, null, "generator")} />
        ) : (
          <Button variant="outline" onClick={() => setGenerating(true)}>
            Open the structure generator
          </Button>
        )}
      </section>

      <CopyFromGame clubId={clubId} tournamentId={tournamentId} timeZone={timeZone} label={labels.copy} busy={pending === "copy"} onChoose={onChoose} />
    </div>
  );
}

interface CopyFromGameProps {
  clubId: string;
  tournamentId: string;
  timeZone?: string;
  label: string;
  busy: boolean;
  onChoose: StructureChooserProps["onChoose"];
}

/** "Copy from a previous game": the club's recent distinct structures (asked for when this opens). */
function CopyFromGame({ clubId, tournamentId, timeZone, label, busy, onChoose }: CopyFromGameProps) {
  const selectId = useId();
  const sources = useBlindStructures(clubId);
  const games = (sources.data ?? []).filter((source) => source.tournamentId !== tournamentId);
  const [chosen, setChosen] = useState("");
  const pick = games.find((game) => game.tournamentId === chosen) ?? games[0];

  return (
    <section aria-labelledby={`${selectId}-heading`} className="space-y-3">
      <h3 id={`${selectId}-heading`} className="text-lg font-semibold text-foreground">
        Copy from a previous game
      </h3>
      {sources.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading the club&apos;s recent structures…
        </p>
      ) : sources.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">
          {errorMessage(sources.error, "The club's structures could not be loaded")}
          <Button variant="outline" size="sm" onClick={() => void sources.refetch()} busy={sources.isRefetching}>
            Try again
          </Button>
        </div>
      ) : games.length === 0 || !pick ? (
        <p className="text-sm text-muted-foreground">No earlier game of this club has a clock yet.</p>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1 space-y-2">
            <Label htmlFor={selectId}>Game</Label>
            <NativeSelect id={selectId} value={pick.tournamentId} onChange={(event) => setChosen(event.target.value)}>
              {games.map((game) => (
                <option key={game.tournamentId} value={game.tournamentId}>
                  {game.tournamentName} · {formatDay(game.startDateTime, timeZone ?? DEFAULT_TIME_ZONE)} · {structureSummary(game.structure.levels, { from: true })}
                </option>
              ))}
            </NativeSelect>
          </div>
          <Button busy={busy} onClick={() => void onChoose(pick.structure, pick.presetKey, "copy")}>
            {label}
          </Button>
        </div>
      )}
    </section>
  );
}
