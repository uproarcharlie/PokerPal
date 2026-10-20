import { useForm, useWatch } from "react-hook-form";
import { createPendingActionSchema } from "@shared/api/pending-actions";
import type { PublicPlayer, PublicRegistration } from "@shared/api/public";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { knockoutTargetsFor, requestersFor, requestRefusal, type PlayerActionType } from "@shared/domain/player-actions";
import { PlayerAvatar } from "@/components/image/player-avatar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRequestPlayerAction } from "../hooks";
import { requestProblem } from "../messages";
import { formResolver } from "@/lib/forms";

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

/** A player as the picker lists them: their counts, and whether the request could be confirmed for them now (PUB-14). */
function requesterOption(tournament: TournamentDetailDto, registration: PublicRegistration, actionType: PlayerActionType) {
  const name = registration.player?.name ?? "Unknown player";
  if (actionType === "addon") return { text: `${name} (${registration.addons ?? 0} add-ons)`, disabled: false };
  if (actionType === "knockout") return { text: name, disabled: false };
  const rebuys = registration.rebuys ?? 0;
  const count = tournament.maxRebuys != null ? `${rebuys} of ${tournament.maxRebuys} re-buys` : `${rebuys} re-buys`;
  if (requestRefusal(tournament, registration, "rebuy")?.code === "MAX_REBUYS_REACHED") return { text: `${name} (${count}: limit reached)`, disabled: true };
  return { text: registration.isEliminated ? `${name} (out: buy back in)` : `${name} (${count})`, disabled: false };
}

function PlayerOption({ registration, text, disabled = false }: { registration: PublicRegistration; text: string; disabled?: boolean }) {
  return (
    <SelectItem value={registration.playerId} disabled={disabled} className="py-3">
      <span className="flex items-center gap-2">
        <PlayerAvatar name={registration.player?.name ?? ""} imageUrl={registration.player?.imageUrl} size="xs" />
        <span>{text}</span>
      </span>
    </SelectItem>
  );
}

interface ActionRequestFormProps {
  tournament: TournamentDetailDto;
  actionType: PlayerActionType;
  registrations: readonly PublicRegistration[];
  /** The request is with the TD; `player` is who it is for. */
  onSubmitted: (player: PublicPlayer | null) => void;
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

  const onSubmit = form.handleSubmit((values) => {
    const player = registrations.find((registration) => registration.playerId === values.playerId)?.player ?? null;
    request.mutate(createPendingActionSchema.parse(values), { onSuccess: () => onSubmitted(player) });
  });

  return (
    <Form {...form}>
      <form onSubmit={(event) => void onSubmit(event)} className="space-y-4" noValidate>
        <FormField
          control={form.control}
          name="playerId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{knockout ? "Player Who Made Knockout" : "Select Player"}</FormLabel>
              <Select
                value={field.value}
                onValueChange={(value) => {
                  field.onChange(value);
                  if (form.getValues("targetPlayerId") === value) form.setValue("targetPlayerId", null);
                }}
              >
                <FormControl>
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder="Choose a player..." />
                  </SelectTrigger>
                </FormControl>
                <SelectContent className="max-w-[var(--radix-select-trigger-width)]">
                  {requestersFor(actionType, registrations, tournament).map((registration) => (
                    <PlayerOption key={registration.id} registration={registration} {...requesterOption(tournament, registration, actionType)} />
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {knockout ? (
          <FormField
            control={form.control}
            name="targetPlayerId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Player Who Was Knocked Out</FormLabel>
                <Select value={field.value ?? ""} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="h-11">
                      <SelectValue placeholder="Choose a player..." />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent className="max-w-[var(--radix-select-trigger-width)]">
                    {knockoutTargetsFor(registrations, playerId).map((registration) => (
                      <PlayerOption key={registration.id} registration={registration} text={registration.player?.name ?? "Unknown player"} />
                    ))}
                  </SelectContent>
                </Select>
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
