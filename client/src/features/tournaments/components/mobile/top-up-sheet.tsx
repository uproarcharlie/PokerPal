import { useRef, useState, type RefObject } from "react";
import { ArrowLeft, RefreshCw, ShoppingCart } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PhoneSheet, PhoneSheetBody, PhoneSheetHeader, useStepFocus } from "@/components/shared/phone-sheet";
import { PlayerAvatar } from "@/components/image/player-avatar";
import { returnSeatAction, returnSeatText, useReturnSeat } from "@/features/seating/waiting-seat";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api/http";
import { formatAmount, ordinal } from "@/lib/format";
import type { PublicRegistration } from "@shared/api/public";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { PRIZE_POOL_LOCKED_MESSAGE, requestersFor, requestRefusal } from "@shared/domain/player-actions";
import { playerName } from "../../player-name";
import { useAdjustCounts } from "../../staff-hooks";
import { DeskPlayerPicker, type PickerPlayer } from "./desk-player-picker";

/** What the desk sells: a re-buy or an add-on. */
export type TopUpKind = "rebuy" | "addon";

const WORDS: Readonly<Record<TopUpKind, { title: string; one: string; many: string; icon: typeof RefreshCw }>> = {
  rebuy: { title: "Re-buy", one: "re-buy", many: "re-buys", icon: RefreshCw },
  addon: { title: "Add-on", one: "add-on", many: "add-ons", icon: ShoppingCart },
};

type TopUpTournament = Pick<
  TournamentDetailDto,
  "id" | "rebuyAmount" | "addonAmount" | "maxRebuys" | "maxAddons" | "rebuyOrAddon" | "prizePoolLocked"
>;

const countOf = (registration: PublicRegistration, kind: TopUpKind) => (kind === "rebuy" ? (registration.rebuys ?? 0) : (registration.addons ?? 0));

/** "1 of 2 re-buys" (or "1 re-buy" with no limit), "Out: buys back in" for a re-entry. */
function countText(tournament: TopUpTournament, registration: PublicRegistration, kind: TopUpKind): string {
  if (kind === "rebuy" && registration.isEliminated) return "Out: buys back in";
  const count = countOf(registration, kind);
  const max = kind === "rebuy" ? tournament.maxRebuys : tournament.maxAddons;
  const { one, many } = WORDS[kind];
  return max != null ? `${count} of ${max} ${max === 1 ? one : many}` : `${count} ${count === 1 ? one : many}`;
}

/** Why the house rules allow this player no more ("Limit reached", "Took an add-on: not both"); null when they do. */
function unavailableText(tournament: TopUpTournament, registration: PublicRegistration, kind: TopUpKind): string | null {
  const refusal = requestRefusal(tournament, registration, kind)?.code;
  if (refusal === "MAX_REBUYS_REACHED" || refusal === "MAX_ADDONS_REACHED") return `${countText(tournament, registration, kind)}: limit reached`;
  if (refusal === "REBUY_OR_ADDON") return `Took ${kind === "rebuy" ? "an add-on" : "a re-buy"}: not both`;
  return null;
}

interface TopUpSheetProps {
  tournament: TopUpTournament;
  /** What is being sold; null closes the sheet. */
  kind: TopUpKind | null;
  registrations: readonly PublicRegistration[];
  onClose: () => void;
  returnFocusTo?: RefObject<HTMLElement | null>;
}

/**
 * A re-buy or an add-on sold at the desk, from the phone's quick actions: pick the player (their counts
 * beside them, greyed out with the reason when the house rules allow no more), check the price, and
 * record it. The server adds it under its lock and refuses what the rules or the pool lock do not allow;
 * a re-buy by a player who is out puts them back in, and their seat back while it is free.
 */
export function TopUpSheet({ tournament, kind, registrations, onClose, returnFocusTo }: TopUpSheetProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  return (
    <PhoneSheet side="bottom" open={kind !== null} onOpenChange={(open) => !open && onClose()} returnFocusTo={returnFocusTo} initialFocus={heading}>
      {kind !== null ? <TopUpSteps key={kind} tournament={tournament} kind={kind} registrations={registrations} heading={heading} onClose={onClose} /> : null}
    </PhoneSheet>
  );
}

interface TopUpStepsProps {
  tournament: TopUpTournament;
  kind: TopUpKind;
  registrations: readonly PublicRegistration[];
  heading: RefObject<HTMLHeadingElement>;
  onClose: () => void;
}

function TopUpSteps({ tournament, kind, registrations, heading, onClose }: TopUpStepsProps) {
  const { toast } = useToast();
  const adjust = useAdjustCounts(tournament.id);
  const returnSeat = useReturnSeat(tournament.id);
  const [player, setPlayer] = useState<PublicRegistration | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const { title, one, icon: Icon } = WORDS[kind];
  const price = formatAmount(kind === "rebuy" ? tournament.rebuyAmount : tournament.addonAmount);
  const locked = tournament.prizePoolLocked === true;
  useStepFocus(heading, player?.id ?? "pick");

  const record = async (registration: PublicRegistration) => {
    setRefusal(null);
    let answer: PublicRegistration;
    try {
      answer = await adjust.mutateAsync({ registrationId: registration.id, input: kind === "rebuy" ? { rebuys: 1 } : { addons: 1 } });
    } catch (error) {
      setRefusal(errorMessage(error, `The ${one} could not be recorded`));
      return;
    }
    onClose();
    const name = playerName(registration);
    const reentered = registration.isEliminated === true && answer.isEliminated !== true;
    // A re-entry gets their old seat back while it is free, else another one or a wait: the toast says which (R5REV-HOST-04).
    const outcome = reentered ? await returnSeat(registration.id, name) : null;
    toast({
      title: `${title} recorded`,
      description: reentered ? returnSeatText(`${name} is back in with the re-buy`, outcome) : `${name}: ${ordinal(countOf(answer, kind))} ${one} (${price}).`,
      action: returnSeatAction(outcome),
    });
  };

  if (player === null) {
    const offered: PickerPlayer[] = requestersFor(kind, registrations, tournament).map((registration) => ({
      registration,
      detail: countText(tournament, registration, kind),
      unavailable: locked ? "Prize pool locked" : unavailableText(tournament, registration, kind),
    }));
    return (
      <>
        <PhoneSheetHeader titleRef={heading} icon={<Icon className="h-5 w-5 text-primary" aria-hidden="true" />} title={`${title} · ${price}`} description="Who is it for? Tap the player." />
        <PhoneSheetBody>
          {locked ? (
            <Alert variant="destructive" className="mb-3">
              <AlertDescription>{PRIZE_POOL_LOCKED_MESSAGE}</AlertDescription>
            </Alert>
          ) : null}
          <DeskPlayerPicker groups={[{ label: null, players: offered }]} onPick={setPlayer} empty="Nobody can take one now." testId={`${kind}-pick`} />
        </PhoneSheetBody>
      </>
    );
  }

  const name = playerName(player);
  const reentry = kind === "rebuy" && player.isEliminated === true;
  return (
    <>
      <PhoneSheetHeader titleRef={heading} icon={<Icon className="h-5 w-5 text-primary" aria-hidden="true" />} title={`${title} for ${name}`} description={`Take ${price}, then record it.`} />
      <PhoneSheetBody>
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-3" data-testid="top-up-player">
            <PlayerAvatar name={name} imageUrl={player.player?.imageUrl} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="break-words text-lg font-semibold text-foreground">{name}</p>
              <p className="text-sm text-muted-foreground">{countText(tournament, player, kind)}</p>
              {reentry ? <p className="text-sm font-medium text-foreground">This re-buy puts them back in.</p> : null}
            </div>
          </div>
          {refusal ? (
            <Alert variant="destructive">
              <AlertDescription role="alert" data-testid="top-up-refusal">
                {refusal}
              </AlertDescription>
            </Alert>
          ) : null}
          <Button size="lg" className="h-14 w-full text-base" busy={adjust.isPending} onClick={() => void record(player)} data-testid="confirm-top-up">
            {adjust.isPending ? "Recording…" : `Record ${one} (${price})`}
          </Button>
          <Button
            variant="ghost"
            className="h-11 w-full"
            aria-disabled={adjust.isPending || undefined}
            onClick={() => {
              if (adjust.isPending) return;
              setRefusal(null);
              setPlayer(null);
            }}
          >
            <ArrowLeft aria-hidden="true" />
            Someone else
          </Button>
        </div>
      </PhoneSheetBody>
    </>
  );
}
