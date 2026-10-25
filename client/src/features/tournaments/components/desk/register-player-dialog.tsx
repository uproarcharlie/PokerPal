import { useId, useState, type RefObject } from "react";
import { useForm } from "react-hook-form";
import { Link } from "wouter";
import { z } from "zod";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { FormSlideout } from "@/components/ui/form-slideout";
import { Input } from "@/components/ui/input";
import { RequiredNote } from "@/components/shared/required-note";
import { MIN_SEARCH_LENGTH, PlayerSearch, type PlayerSearchWording } from "@/features/public-tournament/components/player-search";
import { waitingListPlaceOf } from "@/features/public-tournament/waiting-list";
import { returnSeatAction, returnSeatText, useReturnSeat } from "@/features/seating/waiting-seat";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api/http";
import { routes } from "@/app/routes";
import type { PublicPlayer } from "@shared/api/public";
import { staffRegistrationSchema, type RegistrationCreatedDto } from "@shared/api/registrations";
import { formResolver, showServerFieldErrors, typedNumber } from "@/lib/forms";
import { useRegisterPlayer } from "../../staff-hooks";
import { autoSeatText, needsTable } from "./auto-seat-text";

const FORM_ID = "register-player-form";

const shape = staffRegistrationSchema.shape;
/** The staff sign-up's player and opening counts, typed into text boxes. */
const registerSchema = z.object({
  playerId: shape.playerId,
  buyIns: typedNumber(shape.buyIns),
  rebuys: typedNumber(shape.rebuys),
  addons: typedNumber(shape.addons),
});

interface RegisterValues {
  playerId: string;
  buyIns: string;
  rebuys: string;
  addons: string;
}

const STAFF_WORDING: PlayerSearchWording = {
  placeholder: "Start typing the player's name",
  label: "Search for a player",
  tooShort: `Type at least ${MIN_SEARCH_LENGTH} letters of their name.`,
  noMatch: "Nobody who has played before has that name. A new player signs up on the registration page.",
};

interface RegisterPlayerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tournamentId: string;
  /** Opens the seating, for the toast of a player left waiting because every table is full ("open a table"). */
  onOpenSeating?: () => void;
  returnFocusTo?: RefObject<HTMLElement | null>;
}

/**
 * The TD's desk: find a player who has played before (at this club or any other) by name and register
 * them with their opening entries. New players sign up on the registration page. The toast says where
 * automatic seating put them (round 5), or that they wait: for a seat, or past a full field on the waiting list.
 */
export function RegisterPlayerDialog({ open, onOpenChange, tournamentId, onOpenSeating, returnFocusTo }: RegisterPlayerDialogProps) {
  return open ? (
    <RegisterPlayerSheet tournamentId={tournamentId} onOpenSeating={onOpenSeating} returnFocusTo={returnFocusTo} onClose={() => onOpenChange(false)} />
  ) : null;
}

interface RegisterPlayerSheetProps extends Pick<RegisterPlayerDialogProps, "tournamentId" | "onOpenSeating" | "returnFocusTo"> {
  onClose: () => void;
}

function RegisterPlayerSheet({ tournamentId, onOpenSeating, returnFocusTo, onClose }: RegisterPlayerSheetProps) {
  const { toast } = useToast();
  const register = useRegisterPlayer(tournamentId);
  const returnSeat = useReturnSeat(tournamentId);
  const [player, setPlayer] = useState<PublicPlayer | null>(null);
  const playerLabelId = useId();
  const form = useForm<RegisterValues>({
    resolver: formResolver(registerSchema),
    defaultValues: { playerId: "", buyIns: "1", rebuys: "0", addons: "0" },
  });

  const submit = form.handleSubmit(async (values) => {
    let registration: RegistrationCreatedDto;
    try {
      registration = await register.mutateAsync(registerSchema.parse(values));
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
    const seated = autoSeatText(registration.seating);
    if (seated) {
      const action = needsTable(registration.seating) && onOpenSeating ? { label: "Open seating", onClick: onOpenSeating } : undefined;
      toast({ title: "Player registered", description: `${name} is in. ${seated}`, action });
      return;
    }
    // Not seated by itself (seating is off) while the tables are in play: the toast offers a seat.
    const outcome = await returnSeat(registration.id, name, { returning: false });
    toast({ title: "Player registered", description: returnSeatText(`${name} is in`, outcome), action: returnSeatAction(outcome) });
  });

  const counts = [
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
      description="Find a player who has played before and add them to this tournament."
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" className="h-11 sm:h-10" onClick={onClose} data-testid="cancel-registration">
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} className="h-11 sm:h-10" disabled={!player} busy={register.isPending} data-testid="register-player-final">
            <Check className="mr-2 h-4 w-4" aria-hidden="true" />
            {register.isPending ? "Registering…" : "Register Player"}
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
                <PlayerSearch
                  tournamentId={tournamentId}
                  selected={player}
                  onSelect={(chosen) => {
                    setPlayer(chosen);
                    form.setValue("playerId", chosen.id, { shouldValidate: true });
                  }}
                  wording={STAFF_WORDING}
                  labelledBy={playerLabelId}
                />
                <p className="text-xs text-muted-foreground">
                  Someone new?{" "}
                  <Link href={routes.publicRegister(tournamentId)} className="inline-flex min-h-11 items-center underline">
                    Sign them up on the registration page
                  </Link>
                  .
                </p>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid grid-cols-3 gap-4">
            {counts.map(({ name, label, testId, required }) => (
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
        </form>
      </Form>
    </FormSlideout>
  );
}
