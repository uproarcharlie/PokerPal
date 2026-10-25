import type { ReactNode } from "react";
import { useForm, type ControllerRenderProps } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { AmountInput } from "@/components/shared/amount-input";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api/http";
import { updateTournamentSchema, type UpdateTournamentInput } from "@shared/api/tournaments";
import { centsToDecimalString, type Cents } from "@shared/domain/money";
import { formResolver, showServerFieldErrors, typedNumber } from "@/lib/forms";
import { useUpdateTournament } from "../../staff-hooks";

const update = updateTournamentSchema.innerType().shape;
const maxPlayersSchema = z.object({ maxPlayers: typedNumber(update.maxPlayers.unwrap()) });
const manualPoolSchema = z.object({ manualPrizePool: update.manualPrizePool.unwrap() });

type EditedField = "maxPlayers" | "manualPrizePool";

interface InlineFieldEditorProps {
  tournamentId: string;
  /** The tournament setting changed, and the rule its box is checked with. */
  name: EditedField;
  schema: z.ZodType<UpdateTournamentInput, z.ZodTypeDef, unknown>;
  /** Names the box for screen readers (the tile's own label shows it). */
  label: string;
  initial: string;
  input: (field: ControllerRenderProps<Record<EditedField, string>, EditedField>) => ReactNode;
  saved: string;
  failed: string;
  saveTestId: string;
  onDone: () => void;
}

/**
 * One of the desk's figures changed in place (P3REV5-CQ-11): the box, Save, the server's refusal on
 * the box (or a toast), and back to the figure once saved.
 */
function InlineFieldEditor({ tournamentId, name, schema, label, initial, input, saved, failed, saveTestId, onDone }: InlineFieldEditorProps) {
  const { toast } = useToast();
  const save = useUpdateTournament(tournamentId);
  const form = useForm<Record<EditedField, string>>({
    resolver: formResolver(schema),
    defaultValues: { [name]: initial } as Record<EditedField, string>,
  });
  const submit = form.handleSubmit(async (values) => {
    try {
      await save.mutateAsync(schema.parse(values));
    } catch (error) {
      if (!showServerFieldErrors(form.setError, error, { fields: [name] })) {
        toast({ title: failed, description: errorMessage(error), variant: "destructive" });
      }
      return;
    }
    toast({ title: saved });
    onDone();
  });

  return (
    <Form {...form}>
      <form onSubmit={submit} noValidate className="flex items-start gap-2">
        <FormField
          control={form.control}
          name={name}
          render={({ field }) => (
            <FormItem className="min-w-0 flex-1 space-y-1">
              <FormLabel className="sr-only">{label}</FormLabel>
              <FormControl>{input(field)}</FormControl>
              <FormMessage className="text-xs" />
            </FormItem>
          )}
        />
        <Button type="submit" className="h-11 md:h-10" busy={save.isPending} data-testid={saveTestId}>
          Save
        </Button>
      </form>
    </Form>
  );
}

interface EditorProps {
  tournamentId: string;
  onDone: () => void;
}

/**
 * Raises (or lowers) the most players: staff are not held to it, QR sign-ups are, so raising it lets
 * more players sign themselves up (TN2-03).
 */
export function MaxPlayersEditor({ tournamentId, current, onDone }: EditorProps & { current: number }) {
  return (
    <InlineFieldEditor
      tournamentId={tournamentId}
      name="maxPlayers"
      schema={maxPlayersSchema}
      label="Max players"
      initial={String(current)}
      input={(field) => <Input inputMode="numeric" className="h-11 md:h-10" {...field} data-testid="max-players-input" />}
      saved="Max players updated"
      failed="Could not change the max players"
      saveTestId="save-max-players"
      onDone={onDone}
    />
  );
}

/**
 * Sets the prize pool by hand (a guarantee, a freeroll, a club top-up); blank goes back to the
 * calculated pool. The server logs it, and a manual pool clears any manual AP total.
 */
export function ManualPoolEditor({ tournamentId, current, calculatedCents, onDone }: EditorProps & { current: string | null; calculatedCents: Cents }) {
  return (
    <InlineFieldEditor
      tournamentId={tournamentId}
      name="manualPrizePool"
      schema={manualPoolSchema}
      label="Prize pool (blank for the calculated pool)"
      initial={current ?? ""}
      input={(field) => (
        <AmountInput unit="$" className="h-11 md:h-10" placeholder={centsToDecimalString(calculatedCents)} {...field} data-testid="manual-pool-input" />
      )}
      saved="Prize pool updated successfully"
      failed="Could not change the prize pool"
      saveTestId="save-manual-pool"
      onDone={onDone}
    />
  );
}
