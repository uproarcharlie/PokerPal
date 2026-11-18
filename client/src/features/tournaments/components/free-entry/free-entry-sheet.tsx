import { useRef, useState, type RefObject } from "react";
import { useForm } from "react-hook-form";
import { ArrowLeft, Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { PhoneSheet, PhoneSheetBody, PhoneSheetFooter, PhoneSheetHeader, useStepFocus } from "@/components/shared/phone-sheet";
import { RequiredNote } from "@/components/shared/required-note";
import { useToast } from "@/hooks/use-toast";
import { errorMessage, hasErrorCode } from "@/lib/api/http";
import { formResolver } from "@/lib/forms";
import type { PublicRegistration } from "@shared/api/public";
import { freeEntrySchema } from "@shared/api/registrations";
import type { Cents } from "@shared/domain/money";
import { autoSeatText } from "../desk/auto-seat-text";
import { highHandLeftText } from "../desk/high-hand-left";
import { DeskPlayerPicker, type PickerGroup } from "../mobile/desk-player-picker";
import { useChangeFreeEntry } from "../../staff-hooks";
import { playerName } from "../../player-name";
import { FreeEntryFields, freeEntryInputOf, NO_FREE_ENTRY_VALUES, type FreeEntryValues } from "./free-entry-fields";

const FORM_ID = "free-entry-form";

/** Who a free entry is for: a sign-up (a row of the standings or of the payment desk). */
export type FreeEntryPlayer = Pick<PublicRegistration, "id" | "player">;

interface FreeEntrySheetProps {
  tournamentId: string;
  buyInCents: Cents;
  rakeLabel: string;
  /** The player it is for; null: the sheet asks who first, from `candidates` (the phone's quick action). */
  player: FreeEntryPlayer | null;
  /** Who the quick action offers: the sign-ups not paid yet, those in the field first. */
  candidates?: readonly PickerGroup[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusTo?: RefObject<HTMLElement | null>;
}

/**
 * Gives a player a free entry (round 7, item 6): why (Season prize, Promo, Staff or Other, with a
 * note), and whether the club pays their buy-in into the pool. From the payment desk it is for the
 * sign-up tapped; from the phone's quick actions it first lists the sign-ups not paid yet. Giving one
 * accepts the player like a payment: the server refuses it past Max players, and seats them as a
 * payment would.
 */
export function FreeEntrySheet({ tournamentId, buyInCents, rakeLabel, player, candidates = [], open, onOpenChange, returnFocusTo }: FreeEntrySheetProps) {
  return (
    <PhoneSheet side="bottom" open={open} onOpenChange={onOpenChange} returnFocusTo={returnFocusTo} testId="free-entry-sheet">
      {open ? (
        <FreeEntrySteps
          tournamentId={tournamentId}
          buyInCents={buyInCents}
          rakeLabel={rakeLabel}
          player={player}
          candidates={candidates}
          onDone={() => onOpenChange(false)}
        />
      ) : null}
    </PhoneSheet>
  );
}

interface FreeEntryStepsProps extends Pick<FreeEntrySheetProps, "tournamentId" | "buyInCents" | "rakeLabel" | "player"> {
  candidates: readonly PickerGroup[];
  onDone: () => void;
}

function FreeEntrySteps({ tournamentId, buyInCents, rakeLabel, player, candidates, onDone }: FreeEntryStepsProps) {
  const [chosen, setChosen] = useState<FreeEntryPlayer | null>(player);
  const heading = useRef<HTMLHeadingElement>(null);
  // The tapped row goes with its step: focus moves to the next step's heading (MA-P3REV1-03).
  useStepFocus(heading, chosen?.id ?? "pick");
  const icon = <Ticket className="h-5 w-5 text-primary" aria-hidden="true" />;

  if (chosen === null) {
    return (
      <>
        <PhoneSheetHeader titleRef={heading} icon={icon} title="Free entry" description="Who gets in free? Choose a player who has not paid." />
        <PhoneSheetBody>
          <DeskPlayerPicker
            groups={candidates}
            onPick={(registration) => setChosen(registration)}
            empty="Everyone signed up has paid or has a free entry. To let someone new in free, register them and turn on Free entry."
            testId="free-entry-pick"
          />
        </PhoneSheetBody>
      </>
    );
  }

  const name = playerName(chosen);
  return (
    <>
      <PhoneSheetHeader titleRef={heading} icon={icon} title={`Free entry for ${name}`} description="Accepted without paying the buy-in." />
      <FreeEntryForm
        tournamentId={tournamentId}
        registrationId={chosen.id}
        name={name}
        buyInCents={buyInCents}
        rakeLabel={rakeLabel}
        onDone={onDone}
        onBack={player === null ? () => setChosen(null) : undefined}
      />
    </>
  );
}

interface FreeEntryFormProps {
  tournamentId: string;
  registrationId: string;
  name: string;
  buyInCents: Cents;
  rakeLabel: string;
  onDone: () => void;
  /** Back to the list of players (the quick action's first step); none when the sheet is for one player. */
  onBack?: () => void;
}

/** The free entry's reason and funding, and the footer that gives it. */
function FreeEntryForm({ tournamentId, registrationId, name, buyInCents, rakeLabel, onDone, onBack }: FreeEntryFormProps) {
  const { toast } = useToast();
  const change = useChangeFreeEntry(tournamentId);
  const form = useForm<FreeEntryValues>({ resolver: formResolver(freeEntrySchema), defaultValues: NO_FREE_ENTRY_VALUES });

  const submit = form.handleSubmit(async (values) => {
    try {
      const given = await change.mutateAsync({ registrationId, input: { action: "give", ...freeEntryInputOf(values) } });
      onDone();
      const seat = autoSeatText(given.seating);
      const left = highHandLeftText(given);
      toast({ title: "Free entry given", description: [`${name} is in with a free entry.`, seat, left].filter(Boolean).join(" ") });
    } catch (error) {
      // Max players are accepted (round 5, item 15): no override, the server's sentence says how to make room.
      toast({
        title: hasErrorCode(error, "TOURNAMENT_FULL") ? "Tournament full" : "Could not give the free entry",
        description: errorMessage(error),
        variant: "destructive",
      });
    }
  });

  return (
    <>
      <PhoneSheetBody atFoot={false}>
        {onBack ? (
          <Button type="button" variant="ghost" className="-ml-2 mb-2 h-11" onClick={onBack}>
            <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />
            Choose someone else
          </Button>
        ) : null}
        <Form {...form}>
          <form id={FORM_ID} onSubmit={submit} noValidate className="space-y-4">
            <RequiredNote />
            <FreeEntryFields buyInCents={buyInCents} rakeLabel={rakeLabel} />
          </form>
        </Form>
      </PhoneSheetBody>
      <PhoneSheetFooter>
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" className="h-11" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} className="h-11" busy={change.isPending} data-testid="give-free-entry">
            <Ticket className="mr-2 h-4 w-4" aria-hidden="true" />
            {change.isPending ? "Saving…" : "Give free entry"}
          </Button>
        </div>
      </PhoneSheetFooter>
    </>
  );
}
