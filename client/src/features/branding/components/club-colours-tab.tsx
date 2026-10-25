import { useId, useMemo, useReducer, useState } from "react";
import { Check, Palette, RotateCcw } from "lucide-react";
import type { ClubDto } from "@shared/api/public";
import { readTheme, THEME_PRESETS, type ThemeColorKey, type ThemePresetKey } from "@shared/domain/theme";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useUpdateClub } from "@/features/clubs/staff-hooks";
import { useToast } from "@/hooks/use-toast";
import { errorMessage, isApiError } from "@/lib/api/http";
import { cn } from "@/lib/utils";
import {
  coloursReducer,
  draftColours,
  draftProblems,
  FALLBACK_COLOUR,
  hasChanges,
  initialDraft,
  matchingPreset,
  readabilityNotes,
  savedValue,
  themeName,
} from "../colours-draft";
import { ColourField } from "./colour-field";
import { ThemePreview } from "./theme-preview";

const FIELDS: ReadonlyArray<{ key: ThemeColorKey; label: string; hint: string; placeholder?: string }> = [
  { key: "primary", label: "Main colour", hint: "Buttons, tabs, links and highlights." },
  { key: "accent", label: "Accent colour", hint: "Badges, 1st place, prize money and antes on the TV clock." },
];

const GRADIENT_FIELDS: ReadonlyArray<{ key: ThemeColorKey; label: string; hint: string; placeholder: string }> = [
  { key: "primaryGlow", label: "Glow", hint: "A brighter main colour for glows, and the main colour on the TV and dark screens.", placeholder: "Same as the main colour" },
  { key: "accentDeep", label: "Accent shade", hint: "A deeper accent for metallic gradients.", placeholder: "Same as the accent colour" },
];

/** The server's VALIDATION issues about the theme's colours ("theme.colors.primary"), by colour. */
function serverColourErrors(error: unknown): Partial<Record<ThemeColorKey, string>> {
  if (!isApiError(error) || error.code !== "VALIDATION" || !Array.isArray(error.details)) return {};
  const errors: Partial<Record<ThemeColorKey, string>> = {};
  for (const issue of error.details as unknown[]) {
    const { path, message } = (issue ?? {}) as { path?: unknown; message?: unknown };
    if (!Array.isArray(path) || path[0] !== "theme" || path[1] !== "colors" || typeof message !== "string") continue;
    const key = path[2] as ThemeColorKey;
    if ([...FIELDS, ...GRADIENT_FIELDS].some((field) => field.key === key)) errors[key] = message;
  }
  return errors;
}

/**
 * Club settings' Colours tab (round 5, item 13): the club's main and accent colours, which its public
 * pages, QR sign-up, seat finder, season leaderboard, TV clock and tournament screens wear. Start from
 * a preset or pick colours (picker or "#RRGGBB"); a live preview shows a public page and the TV in
 * them, and plain notes say where a colour is deepened or lightened so text stays readable. Saving the
 * LovePoker colours untouched, or Reset, gives the club the app's own look again (theme null).
 */
export function ClubColoursTab({ club }: { club: ClubDto }) {
  const { toast } = useToast();
  const update = useUpdateClub(club.id);
  const saved = useMemo(() => readTheme(club.theme), [club.theme]);
  const [draft, dispatch] = useReducer(coloursReducer, saved, initialDraft);
  const [confirmReset, setConfirmReset] = useState(false);
  const id = useId();

  const colours = draftColours(draft);
  const preset = matchingPreset(draft.shown);
  const notes = useMemo(() => readabilityNotes(draft.shown), [draft.shown]);
  const changed = hasChanges(colours, saved);

  const save = async () => {
    const problems = draftProblems(draft);
    if (colours === null || Object.keys(problems).length > 0) {
      dispatch({ type: "errors", errors: problems });
      return;
    }
    try {
      const next = await update.mutateAsync({ theme: savedValue(colours) });
      dispatch({ type: "load", theme: readTheme(next.theme) });
      toast({ title: "Club colours saved", description: `${club.name} now wears ${themeName(readTheme(next.theme))}.` });
    } catch (error) {
      const fieldErrors = serverColourErrors(error);
      if (Object.keys(fieldErrors).length > 0) dispatch({ type: "errors", errors: fieldErrors });
      else toast({ title: "Could not save the colours", description: errorMessage(error), variant: "destructive" });
    }
  };

  const reset = async () => {
    await update.mutateAsync({ theme: null });
    dispatch({ type: "load", theme: null });
    toast({ title: "Colours reset", description: `${club.name} wears the LovePoker purple again.` });
  };

  const field = ({ key, label, hint, placeholder }: { key: ThemeColorKey; label: string; hint: string; placeholder?: string }) => {
    const fallback = FALLBACK_COLOUR[key];
    return (
      <ColourField
        key={key}
        label={label}
        hint={hint}
        placeholder={placeholder}
        text={draft.text[key]}
        swatch={draft.shown[key] ?? draft.shown[fallback ?? key] ?? draft.shown.primary}
        error={draft.errors[key]}
        onClear={fallback ? () => dispatch({ type: "change", key, text: "" }) : undefined}
        onChange={(text) => dispatch({ type: "change", key, text })}
        onBlur={() => dispatch({ type: "check", key })}
      />
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <Palette className="h-5 w-5" aria-hidden="true" />
          Club colours
        </CardTitle>
        <CardDescription>
          The colours {club.name}'s public pages, QR sign-up, seat finder, season leaderboard, TV clock and tournament screens wear. Words on them are
          adjusted automatically so they stay readable.
        </CardDescription>
        <p className="text-sm text-foreground" data-testid="colours-now">
          Now: <span className="font-semibold">{themeName(saved)}</span>
        </p>
      </CardHeader>
      <CardContent className="space-y-8">
        <section aria-labelledby={`${id}-presets`} className="space-y-3">
          <h3 id={`${id}-presets`} className="text-base font-semibold text-foreground">
            Start from a preset
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {THEME_PRESETS.map((option) => (
              <PresetButton
                key={option.key}
                presetKey={option.key}
                name={option.name}
                description={option.description}
                swatches={[option.theme.colors.primary, option.theme.colors.primaryGlow, option.theme.colors.accent, option.theme.colors.accentDeep]}
                selected={preset?.key === option.key}
                onSelect={() => dispatch({ type: "preset", key: option.key })}
              />
            ))}
          </div>
        </section>

        <section aria-labelledby={`${id}-own`} className="space-y-4">
          <h3 id={`${id}-own`} className="text-base font-semibold text-foreground">
            {preset ? `Colours (${preset.name})` : "Your own colours"}
          </h3>
          {FIELDS.map(field)}
          <details className="group rounded-md border border-border">
            <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-medium text-foreground">Glow and shade (optional)</summary>
            <div className="space-y-4 border-t border-border p-3">{GRADIENT_FIELDS.map(field)}</div>
          </details>
        </section>

        {notes.length > 0 ? (
          <section aria-labelledby={`${id}-readable`} className="space-y-2">
            <h3 id={`${id}-readable`} className="text-base font-semibold text-foreground">
              Adjusted for readability
            </h3>
            <ul role="list" className="space-y-2" data-testid="readability-notes">
              {notes.map((note) => (
                <li key={note.message} className="flex items-start gap-2 text-sm text-foreground">
                  <span className="mt-0.5 flex shrink-0 overflow-hidden rounded border border-border" aria-hidden="true">
                    <span className="h-4 w-4" style={{ backgroundColor: note.picked }} />
                    <span className="h-4 w-4" style={{ backgroundColor: note.used }} />
                  </span>
                  <span>{note.message}.</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-labelledby={`${id}-preview`} className="space-y-3">
          <h3 id={`${id}-preview`} className="text-base font-semibold text-foreground">
            Preview
          </h3>
          <ThemePreview colours={draft.shown} clubName={club.name} />
        </section>

        <div className="sticky bottom-0 -mx-6 -mb-6 flex flex-col gap-2 rounded-b-lg border-t border-border bg-card px-6 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:static sm:mx-0 sm:mb-0 sm:flex-row-reverse sm:flex-wrap sm:items-center sm:border-0 sm:bg-transparent sm:p-0">
          <Button type="button" size="lg" className="w-full sm:w-auto" busy={update.isPending} disabled={!changed} onClick={() => void save()}>
            <Check aria-hidden="true" />
            {update.isPending ? "Saving..." : "Save colours"}
          </Button>
          {saved !== null ? (
            <Button type="button" size="lg" variant="outline" className="w-full sm:w-auto" onClick={() => setConfirmReset(true)}>
              <RotateCcw aria-hidden="true" />
              Reset to LovePoker purple
            </Button>
          ) : null}
          <p className="text-center text-sm text-muted-foreground sm:mr-auto sm:text-left" role="status">
            {changed ? "Unsaved changes" : "Saved"}
          </p>
        </div>
      </CardContent>
      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Reset to LovePoker purple?"
        description={`${club.name}'s pages, TV clock and tournament screens go back to the app's own purple and gold. Its own colours are not kept.`}
        confirmLabel="Reset colours"
        pendingLabel="Resetting…"
        onConfirm={reset}
      />
    </Card>
  );
}

function PresetButton({
  presetKey,
  name,
  description,
  swatches,
  selected,
  onSelect,
}: {
  presetKey: ThemePresetKey;
  name: string;
  description: string;
  swatches: ReadonlyArray<string | undefined>;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      data-testid={`preset-${presetKey}`}
      onClick={onSelect}
      className={cn(
        "flex min-h-11 w-full items-start gap-3 rounded-lg border bg-card p-3 text-left text-card-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        selected ? "border-primary ring-1 ring-primary" : "border-control hover:bg-muted",
      )}
    >
      <span className="flex shrink-0 overflow-hidden rounded-md border border-border" aria-hidden="true">
        {swatches.filter((colour): colour is string => colour !== undefined).map((colour) => (
          <span key={colour} className="h-10 w-5" style={{ backgroundColor: colour }} />
        ))}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 font-semibold">
          {name}
          {selected ? <Check className="h-4 w-4 text-primary" aria-hidden="true" /> : null}
        </span>
        <span className="block text-sm text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}
