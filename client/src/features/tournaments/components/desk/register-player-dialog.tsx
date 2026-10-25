import { useId, useState } from "react";
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
import { useWaitingSeat } from "@/features/seating/waiting-seat";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api/http";
import { routes } from "@/app/routes";
import type { PublicPlayer } from "@shared/api/public";
import { staffRegistrationSchema } from "@shared/api/registrations";
import { formResolver, showServerFieldErrors, typedNumber } from "@/lib/forms";
import { useRegisterPlayer } from "../../staff-hooks";

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
}

/**
 * The TD's desk: find a player who has played before (at this club or any other) by name and register
 * them with their opening entries. New players sign up on the registration page.
 */
export function RegisterPlayerDialog({ open, onOpenChange, tournamentId }: RegisterPlayerDialogProps) {
  return open ? <RegisterPlayerSheet tournamentId={tournamentId} onClose={() => onOpenChange(false)} /> : null;
}

function RegisterPlayerSheet({ tournamentId, onClose }: { tournamentId: string; onClose: () => void }) {
  const { toast } = useToast();
  const register = useRegisterPlayer(tournamentId);
  const waitingSeat = useWaitingSeat(tournamentId);
  const [player, setPlayer] = useState<PublicPlayer | null>(null);
  const playerLabelId = useId();
  const form = useForm<RegisterValues>({
    resolver: formResolver(registerSchema),
    defaultValues: { playerId: "", buyIns: "1", rebuys: "0", addons: "0" },
  });

  const submit = form.handleSubmit(async (values) => {
    try {
      const registration = await register.mutateAsync(registerSchema.parse(values));
      onClose();
      // A late walk-in while the tables are in play gets no seat by itself: the toast offers one.
      const name = registration.player?.name ?? "The player";
      const seatNow = await waitingSeat(registration.id, name);
      toast({ title: "Player registered", description: seatNow ? `${name} is in, waiting for a seat.` : `${name} is in.`, action: seatNow ?? undefined });
    } catch (error) {
      if (!showServerFieldErrors(form.setError, error, { fields: ["buyIns", "rebuys", "addons", "playerId"] })) {
        toast({ title: "Could not register the player", description: errorMessage(error), variant: "destructive" });
      }
    }
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
      title="Register Player"
      description="Find a player who has played before and add them to this tournament."
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={onClose} data-testid="cancel-registration">
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} disabled={!player} busy={register.isPending} data-testid="register-player-final">
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
                  <Link href={routes.publicRegister(tournamentId)} className="underline">
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
                      <Input inputMode="numeric" {...field} data-testid={testId} />
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
