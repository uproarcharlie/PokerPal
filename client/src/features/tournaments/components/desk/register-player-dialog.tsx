import { useId, useState, type RefObject } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { FormSlideout } from "@/components/ui/form-slideout";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { RequiredNote } from "@/components/shared/required-note";
import { HighHandChoices } from "@/features/public-tournament/components/high-hand-choices";
import { MIN_SEARCH_LENGTH, PlayerSearch, type PlayerSearchWording } from "@/features/public-tournament/components/player-search";
import { waitingListPlaceOf } from "@/features/public-tournament/waiting-list";
import { returnSeatAction, returnSeatText, useReturnSeat } from "@/features/seating/waiting-seat";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api/http";
import type { PublicPlayer } from "@shared/api/public";
import { freeEntrySchema, staffRegistrationSchema, type RegistrationCreatedDto, type StaffRegistrationInput } from "@shared/api/registrations";
import type { HighHandSettings } from "@shared/domain/high-hands";
import { formatMoney, toCents, type Cents } from "@shared/domain/money";
import { formResolver, showServerFieldErrors, typedNumber } from "@/lib/forms";
import { useRegisterPlayer } from "../../staff-hooks";
import { freeEntryOf } from "../free-entry/free-entry-badge";
import { FreeEntryFields, NO_FREE_ENTRY_VALUES, type FreeEntryValues } from "../free-entry/free-entry-fields";
import { autoSeatText, needsTable } from "./auto-seat-text";
import { NewPlayerFields } from "./new-player-fields";

const FORM_ID = "register-player-form";

const shape = staffRegistrationSchema.shape;
/** The staff sign-up's player and opening counts, typed into text boxes. */
const counts = z.object({
  playerId: shape.playerId,
  buyIns: typedNumber(shape.buyIns),
  rebuys: typedNumber(shape.rebuys),
  addons: typedNumber(shape.addons),
  highHandIds: z.array(z.string()),
});
/** With "Free entry" on (round 7, item 6), also why, and whether the club pays the buy-in in. */
const registerSchema = z.discriminatedUnion("free", [counts.extend({ free: z.literal(false) }), counts.merge(freeEntrySchema).extend({ free: z.literal(true) })]);

/** The request body the boxes describe; the high hands ticked only in a game that runs any (`offersHighHands`). */
function registrationOf(values: z.output<typeof registerSchema>, offersHighHands: boolean): StaffRegistrationInput {
  const { playerId, buyIns, rebuys, addons, highHandIds } = values;
  return {
    playerId,
    buyIns,
    rebuys,
    addons,
    // Round 10: the high hands ticked, and the legacy flag for a server that does not read the list yet.
    ...(offersHighHands ? { enteringHighHands: highHandIds.length > 0, highHandIds } : {}),
    ...(values.free ? { freeEntry: { reason: values.reason, note: values.note, funded: values.funded } } : {}),
  };
}

interface RegisterValues extends FreeEntryValues {
  playerId: string;
  buyIns: string;
  rebuys: string;
  addons: string;
  /** The high hands they enter (round 10), paid at the door. */
  highHandIds: string[];
  /** Let in free (round 7): the free-entry boxes are shown and sent. */
  free: boolean;
}

const STAFF_WORDING: PlayerSearchWording = {
  placeholder: "Start typing the player's name",
  label: "Search for a player",
  tooShort: `Type at least ${MIN_SEARCH_LENGTH} letters of their name.`,
  noMatch: "Nobody who has played before has that name. Add them as a new player below.",
};

interface RegisterPlayerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tournamentId: string;
  /** The buy-in a free entry lets the player off (round 7); a game with no buy-in offers no free entry. */
  buyInCents: Cents;
  /** The club's name for its take ("AP"), for what a funded free entry leaves out. */
  rakeLabel: string;
  /** The tournament's high hands (highHandsOf), to tick the ones the player enters; none without one. */
  highHands: readonly HighHandSettings[];
  /** Opens the seating, for the toast of a player left waiting because every table is full ("open a table"). */
  onOpenSeating?: () => void;
  returnFocusTo?: RefObject<HTMLElement | null>;
}

/**
 * The TD's desk: find a player who has played before (at this club or any other) by name, or add a
 * new one (round 7, item 9: their mobile number optional), and register them with their opening
 * entries, or with a free entry (round 7: accepted without paying the buy-in). The toast says where
 * automatic seating put them (round 5), or that they wait: for a seat, or past a full field on the
 * waiting list.
 */
export function RegisterPlayerDialog({ open, onOpenChange, ...props }: RegisterPlayerDialogProps) {
  return open ? <RegisterPlayerSheet {...props} onClose={() => onOpenChange(false)} /> : null;
}

interface RegisterPlayerSheetProps extends Omit<RegisterPlayerDialogProps, "open" | "onOpenChange"> {
  onClose: () => void;
}

function RegisterPlayerSheet({ tournamentId, buyInCents, rakeLabel, highHands, onOpenSeating, returnFocusTo, onClose }: RegisterPlayerSheetProps) {
  const { toast } = useToast();
  const register = useRegisterPlayer(tournamentId);
  const returnSeat = useReturnSeat(tournamentId);
  const [player, setPlayer] = useState<PublicPlayer | null>(null);
  // Adding someone who has not played before, instead of searching (round 7, item 9).
  const [addingNew, setAddingNew] = useState(false);
  const playerLabelId = useId();
  const highHandsLabelId = useId();
  const form = useForm<RegisterValues>({
    resolver: formResolver(registerSchema),
    defaultValues: { playerId: "", buyIns: "1", rebuys: "0", addons: "0", highHandIds: [], free: false, ...NO_FREE_ENTRY_VALUES },
  });
  const free = useWatch({ control: form.control, name: "free" });
  const choosePlayer = (chosen: PublicPlayer | null) => {
    setPlayer(chosen);
    form.setValue("playerId", chosen?.id ?? "", { shouldValidate: chosen !== null });
  };
  const searchOrAdd = (adding: boolean) => {
    choosePlayer(null);
    setAddingNew(adding);
  };

  const submit = form.handleSubmit(async (values) => {
    let registration: RegistrationCreatedDto;
    try {
      registration = await register.mutateAsync(registrationOf(registerSchema.parse(values), highHands.length > 0));
    } catch (error) {
      if (!showServerFieldErrors(form.setError, error, { fields: ["buyIns", "rebuys", "addons", "playerId"] })) {
        toast({ title: "Could not register the player", description: errorMessage(error), variant: "destructive" });
      }
      return;
    }
    onClose();
    const name = registration.player?.name ?? "The player";
    // Past a full field the player waits for a place, not a seat (round 5, item 15): never "seated once they've paid".
    const waitingListPlace = waitingListPlaceOf(registration);
    if (waitingListPlace !== null) {
      toast({ title: "Player registered", description: `${name} is #${waitingListPlace} on the waiting list: the field is full.` });
      return;
    }
    const isIn = freeEntryOf(registration) ? `${name} is in with a free entry` : `${name} is in`;
    const seated = autoSeatText(registration.seating);
    if (seated) {
      const action = needsTable(registration.seating) && onOpenSeating ? { label: "Open seating", onClick: onOpenSeating } : undefined;
      toast({ title: "Player registered", description: `${isIn}. ${seated}`, action });
      return;
    }
    // Not seated by itself (seating is off) while the tables are in play: the toast offers a seat.
    const outcome = await returnSeat(registration.id, name, { returning: false });
    toast({ title: "Player registered", description: returnSeatText(isIn, outcome), action: returnSeatAction(outcome) });
  });

  const countFields = [
    { name: "buyIns", label: "Buy-ins", testId: "buyins-input", required: true },
    { name: "rebuys", label: "Re-buys", testId: "rebuys-input", required: false },
    { name: "addons", label: "Add-ons", testId: "addons-input", required: false },
  ] as const;

  return (
    <FormSlideout
      open
      onOpenChange={(next) => !next && onClose()}
      returnFocusTo={returnFocusTo}
      title="Register Player"
      description="Find a player who has played before, or add someone new, and register them for this tournament."
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" className="h-11 sm:h-10" onClick={onClose} data-testid="cancel-registration">
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} className="h-11 sm:h-10" disabled={!player} busy={register.isPending} data-testid="register-player-final">
            <Check className="mr-2 h-4 w-4" aria-hidden="true" />
            {register.isPending ? "Registering…" : free ? "Register with free entry" : "Register Player"}
          </Button>
        </div>
      }
    >
      <Form {...form}>
        <form id={FORM_ID} onSubmit={submit} noValidate className="space-y-4">
          <RequiredNote />
          <FormField
            control={form.control}
            name="playerId"
            render={() => (
              <FormItem>
                {/* The visible words name the search box (WCAG 2.5.3); the star is not read out (P3REV-MA-REQUIRED-STAR). */}
                <p id={playerLabelId} className="text-sm font-medium">
                  Player<span aria-hidden="true">*</span>
                </p>
                {addingNew ? (
                  <NewPlayerFields tournamentId={tournamentId} labelledBy={playerLabelId} onChoose={choosePlayer} onSearch={() => searchOrAdd(false)} />
                ) : (
                  <>
                    <PlayerSearch tournamentId={tournamentId} selected={player} onSelect={choosePlayer} wording={STAFF_WORDING} labelledBy={playerLabelId} />
                    <p className="text-xs text-muted-foreground">
                      Someone new?{" "}
                      <button
                        type="button"
                        onClick={() => searchOrAdd(true)}
                        className="inline-flex min-h-11 items-center underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        data-testid="add-new-player"
                      >
                        Add a new player
                      </button>
                    </p>
                  </>
                )}
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid grid-cols-3 gap-4">
            {countFields.map(({ name, label, testId, required }) => (
              <FormField
                key={name}
                control={form.control}
                name={name}
                render={({ field }) => (
                  <FormItem required={required}>
                    <FormLabel>{label}</FormLabel>
                    <FormControl>
                      <Input inputMode="numeric" className="h-11 sm:h-10" {...field} data-testid={testId} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ))}
          </div>

          {highHands.length > 0 ? (
            <FormField
              control={form.control}
              name="highHandIds"
              render={({ field }) =>
                highHands.length === 1 ? (
                  <FormItem className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
                    <div className="space-y-1">
                      <FormLabel className="text-sm font-medium">High hand</FormLabel>
                      <p className="text-xs text-muted-foreground">{formatMoney(toCents(highHands[0].entryFee), { forceCents: true })}, paid at the door</p>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value.includes(highHands[0].id)}
                        onCheckedChange={(checked) => field.onChange(checked ? [highHands[0].id] : [])}
                        className="mt-1"
                        data-testid="register-high-hand"
                      />
                    </FormControl>
                  </FormItem>
                ) : (
                  <FormItem>
                    <p id={highHandsLabelId} className="text-sm font-medium">
                      High hands <span className="font-normal text-muted-foreground">(paid at the door)</span>
                    </p>
                    <HighHandChoices highHands={highHands} value={field.value} onChange={field.onChange} labelledBy={highHandsLabelId} compact />
                  </FormItem>
                )
              }
            />
          ) : null}

          {/* Round 7: nothing to let them off in a game with no buy-in. */}
          {buyInCents > 0 ? (
            <div className="space-y-4">
              <FormField
                control={form.control}
                name="free"
                render={({ field }) => (
                  <FormItem className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
                    <div className="space-y-1">
                      <FormLabel className="text-sm font-medium">Free entry</FormLabel>
                      <p className="text-xs text-muted-foreground">Accepted without paying the buy-in: a season prize, a promo, staff.</p>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} className="mt-1" data-testid="register-free-entry" />
                    </FormControl>
                  </FormItem>
                )}
              />
              {free ? <FreeEntryFields buyInCents={buyInCents} rakeLabel={rakeLabel} /> : null}
            </div>
          ) : null}
        </form>
      </Form>
    </FormSlideout>
  );
}
