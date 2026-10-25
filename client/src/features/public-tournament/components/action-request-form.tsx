import { useForm, useWatch } from "react-hook-form";
import { createPendingActionSchema } from "@shared/api/pending-actions";
import type { PublicPlayer, PublicRegistration } from "@shared/api/public";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { knockoutTargetsFor, requestersFor, requestRefusal, type PlayerActionType } from "@shared/domain/player-actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Form, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { useRequestPlayerAction } from "../hooks";
import { requestProblem } from "../messages";
import { formResolver } from "@/lib/forms";
import { PlayerPicker, type PlayerChoice } from "./player-picker";

interface ActionValues {
  playerId: string;
  actionType: PlayerActionType;
  targetPlayerId: string | null;
}

const SUBMIT_LABELS: Readonly<Record<PlayerActionType, string>> = {
  rebuy: "Submit Re-buy",
  addon: "Submit Add-on",
  knockout: "Submit Knockout",
};

const WHO_FOR: Readonly<Record<PlayerActionType, string>> = {
  rebuy: "Who is the re-buy for?",
  addon: "Who is the add-on for?",
  knockout: "Who made the knockout?",
};

/** "1 of 2 add-ons", or "1 add-ons" with no limit. */
const countText = (count: number, max: number | null | undefined, what: string) => (max != null ? `${count} of ${max} ${what}` : `${count} ${what}`);

/**
 * A player as the picker lists them: their counts, and whether the request could be confirmed for them
 * now (PUB-14): greyed out with the reason when the house rules allow no more (a limit reached, or the
 * other kind already taken under "re-buys OR add-ons": TDN4-HOUSE-RULES-UNSET).
 */
function requesterChoice(tournament: TournamentDetailDto, registration: PublicRegistration, actionType: PlayerActionType): PlayerChoice {
  if (actionType === "knockout") return { registration };
  const count =
    actionType === "addon" ? countText(registration.addons ?? 0, tournament.maxAddons, "add-ons") : countText(registration.rebuys ?? 0, tournament.maxRebuys, "re-buys");
  const refusal = requestRefusal(tournament, registration, actionType)?.code;
  if (refusal === "MAX_REBUYS_REACHED" || refusal === "MAX_ADDONS_REACHED") return { registration, detail: `${count}: limit reached`, disabled: true };
  if (refusal === "REBUY_OR_ADDON") return { registration, detail: `Took ${actionType === "addon" ? "a re-buy" : "an add-on"}: not both`, disabled: true };
  return { registration, detail: actionType === "rebuy" && registration.isEliminated ? "Out: buy back in" : count };
}

/** Who a request was for, and for a knockout who went out: what the confirmation shows. */
export interface SubmittedRequest {
  player: PublicPlayer | null;
  target: PublicPlayer | null;
}

interface ActionRequestFormProps {
  tournament: TournamentDetailDto;
  actionType: PlayerActionType;
  registrations: readonly PublicRegistration[];
  /** The request is with the TD. */
  onSubmitted: (request: SubmittedRequest) => void;
}

/** Who the request is for (and, for a knockout, who went out), sent to the TD to confirm at the desk. */
export function ActionRequestForm({ tournament, actionType, registrations, onSubmitted }: ActionRequestFormProps) {
  const request = useRequestPlayerAction(tournament.id);
  const form = useForm<ActionValues>({
    resolver: formResolver(createPendingActionSchema),
    defaultValues: { playerId: "", actionType, targetPlayerId: null },
  });
  const playerId = useWatch({ control: form.control, name: "playerId" });
  const targetPlayerId = useWatch({ control: form.control, name: "targetPlayerId" });
  const knockout = actionType === "knockout";
  const playerOf = (id: string | null) => registrations.find((registration) => registration.playerId === id)?.player ?? null;

  const onSubmit = form.handleSubmit((values) => {
    const submitted = { player: playerOf(values.playerId), target: playerOf(values.targetPlayerId) };
    request.mutate(createPendingActionSchema.parse(values), { onSuccess: () => onSubmitted(submitted) });
  });

  return (
    <Form {...form}>
      <form onSubmit={(event) => void onSubmit(event)} className="space-y-5" noValidate>
        <FormField
          control={form.control}
          name="playerId"
          render={({ field }) => (
            <FormItem>
              <PlayerPicker
                label={WHO_FOR[actionType]}
                choices={requestersFor(actionType, registrations, tournament).map((registration) => requesterChoice(tournament, registration, actionType))}
                value={field.value}
                onChange={(value) => {
                  field.onChange(value);
                  if (form.getValues("targetPlayerId") === value) form.setValue("targetPlayerId", null);
                }}
                empty="Nobody is playing yet."
                data-testid="requester-picker"
              />
              <FormMessage />
            </FormItem>
          )}
        />

        {knockout && playerId ? (
          <FormField
            control={form.control}
            name="targetPlayerId"
            render={({ field }) => (
              <FormItem>
                <PlayerPicker
                  label="Who was knocked out?"
                  choices={knockoutTargetsFor(registrations, playerId).map((registration) => ({ registration }))}
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  empty="Nobody else is left in to knock out."
                  data-testid="target-picker"
                />
                <FormMessage />
              </FormItem>
            )}
          />
        ) : null}

        {request.isError ? (
          <Alert variant="destructive" data-testid="request-problem">
            <AlertDescription>{requestProblem(request.error)}</AlertDescription>
          </Alert>
        ) : null}

        <Button
          type="submit"
          className="w-full"
          size="lg"
          variant={knockout ? "destructive" : "default"}
          disabled={!playerId || (knockout && !targetPlayerId)}
          busy={request.isPending}
        >
          {SUBMIT_LABELS[actionType]}
        </Button>
      </form>
    </Form>
  );
}
