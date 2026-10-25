import type { UseFormReturn } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { BLIND_PRESETS, type PresetFormat } from "@shared/domain/blind-structures";
import type { TournamentFormValues } from "../../tournament-form";

/** The clock presets that come with a club's whole format (Central Stars' One Life Line). */
const FORMATS = BLIND_PRESETS.flatMap((preset) => (preset.format ? [{ key: preset.key, name: preset.name, format: preset.format }] : []));

/** A format as the form's boxes hold it: amounts as typed text; the re-buy and add-on parts only when it sells them. */
interface FormatValues {
  buyInAmount: TournamentFormValues["buyInAmount"];
  rebuys: Pick<TournamentFormValues, "rebuyAmount" | "maxRebuys" | "rebuyPeriodMinutes"> | null;
  addons: Pick<TournamentFormValues, "addonAmount"> | null;
}

function formatValues(format: PresetFormat): FormatValues {
  return {
    buyInAmount: format.buyInAmount,
    rebuys:
      format.rebuyAmount === null
        ? null
        : {
            rebuyAmount: format.rebuyAmount,
            maxRebuys: format.maxRebuys === null ? "" : String(format.maxRebuys),
            rebuyPeriodMinutes: format.rebuyPeriodMinutes === null ? "" : String(format.rebuyPeriodMinutes),
          },
    addons: format.addonAmount === null ? null : { addonAmount: format.addonAmount },
  };
}

/** Fills the boxes with a format, each field by name (so a misspelt or mistyped one does not compile), switching on what it sells. */
function fillFormat(form: UseFormReturn<TournamentFormValues>, format: PresetFormat): void {
  const { buyInAmount, rebuys, addons } = formatValues(format);
  const options = { shouldDirty: true, shouldValidate: form.formState.isSubmitted };
  form.setValue("buyInAmount", buyInAmount, options);
  if (rebuys) {
    form.setValue("enableRebuys", true, options);
    form.setValue("rebuyAmount", rebuys.rebuyAmount, options);
    form.setValue("maxRebuys", rebuys.maxRebuys, options);
    form.setValue("rebuyPeriodMinutes", rebuys.rebuyPeriodMinutes, options);
  }
  if (addons) {
    form.setValue("enableAddons", true, options);
    form.setValue("addonAmount", addons.addonAmount, options);
  }
}

/**
 * One tap fills the buy-in, re-buy and add-on boxes with a club's format; the clock comes from the
 * same preset on the Clock tab. Its house rules are said, not enforced (one re-buy OR one add-on).
 */
export function FormatPresets({ form }: { form: UseFormReturn<TournamentFormValues> }) {
  const { toast } = useToast();
  if (FORMATS.length === 0) return null;
  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3" data-testid="format-presets">
      {FORMATS.map(({ key, name, format }) => (
        <div key={key} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 text-sm">
            <p className="font-medium text-foreground">{name}</p>
            <p className="text-muted-foreground">{format.notes.join(" · ")}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            aria-label={`Use the ${name} format`}
            onClick={() => {
              fillFormat(form, format);
              toast({ title: `${name} format filled in`, description: "Set the clock up from the same preset on the tournament's Clock tab." });
            }}
          >
            Use this format
          </Button>
        </div>
      ))}
    </div>
  );
}
