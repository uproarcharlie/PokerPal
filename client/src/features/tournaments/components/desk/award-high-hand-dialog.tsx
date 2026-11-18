import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { ChevronLeft, ChevronRight, Trophy, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { AmountInput } from "@/components/shared/amount-input";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { RequiredNote } from "@/components/shared/required-note";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PlayerAvatar } from "@/components/image/player-avatar";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api/http";
import { formatMoney, plural } from "@/lib/format";
import { idSchema } from "@shared/api/common";
import type { PublicRegistration } from "@shared/api/public";
import { highHandIdsOf, highHandLabel, splitHighHandAward, type HighHandAward, type HighHandsInput, type HighHandStanding } from "@shared/domain/high-hands";
import { centsToDecimalString, type Cents } from "@shared/domain/money";
import { useHighHandAwards, type PotCheck } from "../../staff-hooks";
import { playerName } from "../../player-name";
import { formResolver } from "@/lib/forms";

/** The "split with" choice meaning: a new prize, not a tie. */
const NEXT_PRIZE = "next";

const awardSchema = z.object({
  registrationId: z.string().min(1, "Choose the winner").pipe(idSchema),
  splitWith: z.preprocess((value) => (value === NEXT_PRIZE || value === "" ? undefined : value), idSchema.optional()),
});

interface AwardHighHandDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tournament: HighHandsInput & { id: string };
  registrations: readonly PublicRegistration[];
  /** Each high hand's pot and awards (highHandStandings): the next award and what no award pays, worked out as the server will. */
  standings: readonly HighHandStanding[];
  /**
   * Whether the pots those amounts are worked out from have been fetched since the dialog opened: until
   * they have, the amount may be out of date, so it is not shown as current and Assign waits
   * (P3REV-PERF-HIGHHAND-STALE-AMOUNT).
   */
  potCheck: PotCheck;
  /** Fetches the pots again, after a check that failed. */
  onCheckPot: () => void;
}

/** "the high hand" for a game with one, "the First half high hand" for one of several. */
const potName = (standing: HighHandStanding, named: boolean) => (named ? `the ${highHandLabel(standing.pot.name)}` : "the high hand");

/**
 * Awards a high hand (round 10: one pot at a time, "Award First half high hand"): which one first, when
 * the game runs several, then its next prize or a tie that shares an earlier winner's prize. The amount
 * is the server's, shown here as it will work it out, never sent (TN2-04). Money paid into a pot after
 * every prize was awarded is added to a winner's prize here (R6REV0-MONEY-01), and a win given by
 * mistake is taken back.
 */
export function AwardHighHandDialog({ open, onOpenChange, ...props }: AwardHighHandDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-dvh overflow-y-auto sm:max-w-md">{open ? <AwardSteps {...props} onClose={() => onOpenChange(false)} /> : null}</DialogContent>
    </Dialog>
  );
}

type StepsProps = Omit<AwardHighHandDialogProps, "open" | "onOpenChange"> & { onClose: () => void };

function AwardSteps(props: StepsProps) {
  const { standings } = props;
  // A game with one high hand goes straight to it.
  const [chosenId, setChosenId] = useState<string | null>(standings.length === 1 ? standings[0].pot.highHandId : null);
  const chosen = standings.find((standing) => standing.pot.highHandId === chosenId);
  if (chosen) return <AwardForm {...props} standing={chosen} named={standings.length > 1} onBack={standings.length > 1 ? () => setChosenId(null) : undefined} />;
  return <ChooseHighHand standings={standings} potCheck={props.potCheck} onChoose={setChosenId} onClose={props.onClose} />;
}

/** Which high hand was won, with each pot and its next prize. */
function ChooseHighHand({ standings, potCheck, onChoose, onClose }: { standings: readonly HighHandStanding[]; potCheck: PotCheck; onChoose: (id: string) => void; onClose: () => void }) {
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Trophy className="h-5 w-5 text-accent" aria-hidden="true" />
          Award a high hand
        </DialogTitle>
        <DialogDescription>Which high hand was won? Each is its own pot.</DialogDescription>
      </DialogHeader>
      <ul role="list" className="space-y-2 py-4">
        {standings.map((standing) => {
          const label = highHandLabel(standing.pot.name);
          const next = standing.nextAwardCents === null ? "every prize awarded" : `next prize ${potCheck === "checking" ? "…" : formatMoney(standing.nextAwardCents)}`;
          return (
            <li key={standing.pot.highHandId}>
              <Button
                type="button"
                variant="outline"
                className="h-auto min-h-14 w-full justify-between gap-3 px-4 py-3 text-left"
                onClick={() => onChoose(standing.pot.highHandId)}
                aria-label={`Award ${label}`}
                data-testid={`choose-high-hand-${standing.pot.highHandId}`}
              >
                <span className="min-w-0">
                  <span className="block font-semibold text-foreground">Award {label}</span>
                  <span className="block text-xs font-normal text-muted-foreground">
                    Pot {formatMoney(Math.max(0, standing.pot.net))} · {plural(standing.awards.length, "winner")} so far · {next}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
              </Button>
            </li>
          );
        })}
      </ul>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
      </DialogFooter>
    </>
  );
}

interface AwardFormProps extends StepsProps {
  standing: HighHandStanding;
  /** The game runs several high hands: the dialog names this one. */
  named: boolean;
  /** Back to the choice of high hand, when there is one. */
  onBack?: () => void;
}

function AwardForm({ tournament, registrations, standing, named, potCheck, onCheckPot, onBack, onClose }: AwardFormProps) {
  const { toast } = useToast();
  const { award } = useHighHandAwards(tournament.id);
  const form = useForm<{ registrationId: string; splitWith: string }>({
    resolver: formResolver(awardSchema),
    defaultValues: { registrationId: "", splitWith: NEXT_PRIZE },
  });
  const [registrationId, splitWith] = useWatch({ control: form.control, name: ["registrationId", "splitWith"] });
  const highHandId = standing.pot.highHandId;
  const label = named ? highHandLabel(standing.pot.name) : "High Hand";
  const byId = new Map(registrations.map((registration) => [registration.id, registration]));
  const nameOf = (award: HighHandAward) => playerName(byId.get(award.registrationId) ?? {});

  // Only players who entered this high hand and have not won it yet can win it.
  const won = new Set(standing.awards.map((award) => award.registrationId));
  const eligible = registrations.filter((registration) => highHandIdsOf(tournament, registration).includes(highHandId) && !won.has(registration.id));
  const previousWinners = standing.awards;
  // Once every prize is awarded the only award left is a tie, which shares a winner's prize (TN2-04).
  const allAwarded = standing.nextAwardCents === null;
  const splitTarget = previousWinners.find((winner) => winner.registrationId === splitWith);
  const awardCents = splitTarget ? splitHighHandAward(splitTarget.amountCents).shareCents : (standing.nextAwardCents ?? 0);

  const submit = form.handleSubmit(async (values) => {
    const input = awardSchema.parse(values);
    try {
      const result = await award.mutateAsync({ highHandId, input: { registrationId: input.registrationId, ...(input.splitWith ? { splitWith: input.splitWith } : {}) } });
      // The amount the server recorded, which is what is paid (it works the award out from the pot as it is now).
      const amount = formatMoney(result.award.amountCents);
      const winner = result.award.playerName || "The winner";
      toast({
        title: input.splitWith ? `${named ? highHandLabel(standing.pot.name) : "High hand"} split: ${winner} gets ${amount}` : `${winner} wins ${potName(standing, named)}: ${amount}`,
      });
      onClose();
    } catch (error) {
      toast({ title: "Could not award the high hand", description: errorMessage(error, "Failed to assign high hand winner"), variant: "destructive" });
    }
  });

  return (
    <Form {...form}>
      <form onSubmit={submit} noValidate>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-accent" aria-hidden="true" />
            {named ? `Award ${label}` : "Assign High Hand Winner"}
          </DialogTitle>
          <DialogDescription>
            {named ? `Select the next player who won the ${label}` : "Select the next player who won the high hand bonus"}
            {previousWinners.length > 0 ? (
              <span className="mt-1 block font-medium text-foreground">{plural(previousWinners.length, "winner")} already assigned</span>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {onBack ? (
            <Button type="button" variant="link" className="h-auto p-0" onClick={onBack} data-testid="other-high-hand">
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              Another high hand
            </Button>
          ) : null}
          {allAwarded && standing.unawardedCents > 0 && previousWinners.length > 0 ? (
            <TopUpWinner tournamentId={tournament.id} standing={standing} named={named} nameOf={nameOf} potCheck={potCheck} onDone={onClose} />
          ) : null}
          <RequiredNote />
          {previousWinners.length > 0 ? (
            <PreviousWinners tournamentId={tournament.id} standing={standing} named={named} nameOf={nameOf} />
          ) : null}

          <FormField
            control={form.control}
            name="registrationId"
            render={({ field }) => (
              <FormItem required>
                <FormLabel>Player</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select player" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {eligible.length === 0 ? (
                      <p className="p-4 text-center text-sm text-muted-foreground">
                        {previousWinners.length > 0 ? "All eligible players have been assigned" : named ? `No players entered the ${label}` : "No players entered high hands"}
                      </p>
                    ) : (
                      eligible.map((registration) => (
                        <SelectItem key={registration.id} value={registration.id} className="py-2">
                          <span className="flex items-center gap-2">
                            <PlayerAvatar name={registration.player?.name ?? ""} imageUrl={registration.player?.imageUrl} size="xs" />
                            <span>{playerName(registration)}</span>
                          </span>
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                <FormDescription className="text-xs">
                  {named ? `Only players who entered the ${label} and haven't won it yet are shown` : "Only players who entered high hands and haven't won yet are shown"}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          {previousWinners.length > 0 ? (
            <FormField
              control={form.control}
              name="splitWith"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tied hand?</FormLabel>
                  <Select value={allAwarded && !splitTarget ? "" : field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger data-testid="split-with">
                        <SelectValue placeholder="Split with a winner" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {!allAwarded ? <SelectItem value={NEXT_PRIZE}>No: the next high-hand prize</SelectItem> : null}
                      {previousWinners.map((winner) => (
                        <SelectItem key={winner.registrationId} value={winner.registrationId}>
                          Split with {nameOf(winner)} ({formatMoney(winner.amountCents)})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription className="text-xs">
                    {allAwarded
                      ? "Every high-hand prize has been awarded: a tie shares a winner's prize, half each."
                      : "A tie shares that winner's prize, half each; otherwise this is the next prize."}
                  </FormDescription>
                </FormItem>
              )}
            />
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="high-hand-award">High Hand Amount</Label>
            <AmountInput
              unit="$"
              id="high-hand-award"
              className="bg-muted"
              value={potCheck === "checking" ? "" : centsToDecimalString(awardCents)}
              placeholder="Checking…"
              disabled
              readOnly
              aria-describedby="high-hand-award-note high-hand-pot-check"
              data-testid="high-hand-amount"
            />
            <p id="high-hand-award-note" className="text-xs text-muted-foreground">
              {splitTarget
                ? "Half of that winner's prize; they keep the other half"
                : `What is left of ${named ? `the ${label} pot` : "the high-hand pot"}, shared among the winners still to come`}
            </p>
            <PotCheckNote potCheck={potCheck} onCheckPot={onCheckPot} />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!registrationId || (allAwarded && !splitTarget)}
            busy={award.isPending || potCheck === "checking"}
            data-testid="assign-high-hand"
          >
            {award.isPending ? "Assigning…" : named ? `Award ${label}` : "Assign High Hand"}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

interface WinnersProps {
  tournamentId: string;
  standing: HighHandStanding;
  named: boolean;
  nameOf: (award: HighHandAward) => string;
}

/** The pot's winners so far, each with Take back for a win given by mistake (asked first). */
function PreviousWinners({ tournamentId, standing, named, nameOf }: WinnersProps) {
  const { toast } = useToast();
  const { takeBack } = useHighHandAwards(tournamentId);
  const [takingBack, setTakingBack] = useState<HighHandAward | null>(null);
  const which = potName(standing, named);
  const name = takingBack ? nameOf(takingBack) : "";
  return (
    <div className="space-y-2 rounded-lg border bg-muted/50 p-3">
      <p className="text-xs font-semibold">Previous Winners</p>
      <ul role="list" className="space-y-1">
        {standing.awards.map((winner) => (
          <li key={winner.registrationId} className="flex items-center gap-2 text-sm">
            <Trophy className="h-3 w-3 shrink-0 text-accent" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">
              {nameOf(winner)} <span className="text-muted-foreground">({formatMoney(winner.amountCents)})</span>
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-11 shrink-0 px-2 sm:h-9"
              onClick={() => setTakingBack(winner)}
              aria-label={`Take back ${nameOf(winner)}'s ${named ? highHandLabel(standing.pot.name) : "high hand"} win`}
              data-testid={`take-back-high-hand-${winner.registrationId}`}
            >
              <Undo2 className="h-4 w-4" aria-hidden="true" />
              Take back
            </Button>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={takingBack !== null}
        onOpenChange={(open) => {
          if (!open) setTakingBack(null);
        }}
        title={`Take back ${name}'s win?`}
        description={`${name}'s ${takingBack ? formatMoney(takingBack.amountCents) : ""} goes back into ${which} pot. Anyone they tied with keeps their prize.`}
        confirmLabel="Take back"
        pendingLabel="Taking back…"
        destructive
        contentTestId="take-back-high-hand-dialog"
        onConfirm={async () => {
          if (!takingBack) return;
          await takeBack.mutateAsync({ highHandId: standing.pot.highHandId, registrationId: takingBack.registrationId });
          toast({ title: `${name}'s ${named ? highHandLabel(standing.pot.name) : "high hand"} win was taken back` });
        }}
      />
    </div>
  );
}

interface TopUpWinnerProps extends WinnersProps {
  potCheck: PotCheck;
  onDone: () => void;
}

/**
 * The pot grew after every prize was awarded (a payment confirmed late: only paid entries are in it,
 * round 6): what nobody is due yet, and a button per winner that adds it to their prize, which the
 * server holds to the pot like any amount set by hand.
 */
function TopUpWinner({ tournamentId, standing, named, nameOf, potCheck, onDone }: TopUpWinnerProps) {
  const { toast } = useToast();
  const { correct } = useHighHandAwards(tournamentId);
  const [savingId, setSavingId] = useState<string | null>(null);
  const unawardedCents: Cents = standing.unawardedCents;
  const extra = formatMoney(unawardedCents);

  const add = async (winner: HighHandAward) => {
    setSavingId(winner.registrationId);
    try {
      const saved = await correct.mutateAsync({
        highHandId: standing.pot.highHandId,
        registrationId: winner.registrationId,
        input: { amount: centsToDecimalString(winner.amountCents + unawardedCents) },
      });
      const now = formatMoney(saved.award.amountCents);
      toast({
        title: named ? `${nameOf(winner)}'s ${highHandLabel(standing.pot.name)} prize is now ${now}` : `${nameOf(winner)}'s high hand is now ${now}`,
        description: `Pay them the ${extra} more.`,
      });
      onDone();
    } catch (error) {
      toast({ title: "Could not add it to the prize", description: errorMessage(error), variant: "destructive" });
    } finally {
      setSavingId(null);
    }
  };

  return (
    <section aria-labelledby="high-hand-top-up-title" className="space-y-2 rounded-lg border border-accent/60 bg-accent/10 p-3" data-testid="high-hand-top-up">
      <h3 id="high-hand-top-up-title" className="text-sm font-semibold text-foreground">
        {extra} not awarded yet
      </h3>
      <p className="text-xs text-muted-foreground">Paid into the pot after the last award. Add it to a winner&apos;s prize, then pay them the difference.</p>
      {standing.awards.map((winner) => (
        <Button
          key={winner.registrationId}
          type="button"
          variant="outline"
          className="h-11 w-full"
          disabled={savingId !== null && savingId !== winner.registrationId}
          busy={savingId === winner.registrationId || potCheck === "checking"}
          onClick={() => void add(winner)}
        >
          Add {extra} to {nameOf(winner)}&apos;s prize
        </Button>
      ))}
    </section>
  );
}

/** Says the amount is being checked, or that it could not be, and what is paid either way. */
function PotCheckNote({ potCheck, onCheckPot }: { potCheck: PotCheck; onCheckPot: () => void }) {
  return (
    <div id="high-hand-pot-check" role="status" className="text-xs">
      {potCheck === "checking" ? <p className="text-muted-foreground">Checking the pot as it is now…</p> : null}
      {potCheck === "failed" ? (
        <p className="flex flex-wrap items-center gap-x-2 text-destructive">
          The pot could not be checked, so this amount may be out of date. The server works out what is paid when you assign it.
          <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={onCheckPot}>
            Check again
          </Button>
        </p>
      ) : null}
    </div>
  );
}
