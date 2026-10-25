import { useRef, useState, type RefObject } from "react";
import { ArrowLeft, CircleSlash, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PhoneSheet, PhoneSheetBody, PhoneSheetHeader, useStepFocus } from "@/components/shared/phone-sheet";
import { PlayerAvatar } from "@/components/image/player-avatar";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api/http";
import type { PublicRegistration } from "@shared/api/public";
import type { SeatingDto } from "@shared/api/seating";
import { playerName } from "../../player-name";
import { useUpdateRegistration } from "../../staff-hooks";
import { knockoutChoices } from "../standings/eliminate-player-dialog";
import { useUndoElimination, type UndoElimination } from "../standings/undo-elimination";
import { DeskPlayerPicker, type PickerGroup } from "./desk-player-picker";

type SeatOf = SeatingDto["seatByRegistrationId"];

interface BustSheetProps {
  tournamentId: string;
  registrations: readonly PublicRegistration[];
  /** Who sits where: a player's seat is shown under their name, and their table's players are offered first. */
  seatOf?: SeatOf;
  open: boolean;
  /** The player going out, when already chosen (their row's Eliminate): the sheet opens at "Knocked out by". */
  player?: PublicRegistration | null;
  onOpenChange: (open: boolean) => void;
  /** Once the server has the elimination, before the sheet closes. */
  onEliminated?: (registrationId: string) => void;
  /** Where focus goes on close when what opened the sheet has gone (a menu item, or a row's Eliminate now Restore). */
  returnFocusTo?: RefObject<HTMLElement | null>;
}

/** "Table 2 · Seat 4" under a player's name, or nothing for a player with no seat. */
function seatLine(seatOf: SeatOf | undefined, registrationId: string): string | null {
  const seat = seatOf?.[registrationId];
  return seat ? `Table ${seat.tableNumber} · Seat ${seat.seatNumber}` : null;
}

/** Newest sign-ups first: the late arrivals a TD looks for are at the top (round5-contracts §8.1). */
const newestFirst = (a: PublicRegistration, b: PublicRegistration) =>
  (b.registrationTime ?? "").localeCompare(a.registrationTime ?? "") || playerName(a).localeCompare(playerName(b));

/**
 * A bust on a phone in three taps (round5-contracts §8.1): who is out (photos, newest first, search),
 * who knocked them out (their table first, photos, search, or "Not recorded"), and it is done, with an
 * Undo in the toast. Opened from a player's row it starts at the second step. The rules are the
 * eliminate dialog's: only players still in go out, the knockout goes to another player still in, and
 * the server refuses a player someone else has just put out.
 */
export function BustSheet({ tournamentId, registrations, seatOf, open, player = null, onOpenChange, onEliminated, returnFocusTo }: BustSheetProps) {
  // Here, not in the steps: the toast's Undo outlives the sheet.
  const undo = useUndoElimination(tournamentId);
  const heading = useRef<HTMLHeadingElement>(null);
  return (
    <PhoneSheet side="bottom" open={open} onOpenChange={onOpenChange} returnFocusTo={returnFocusTo} initialFocus={heading}>
      {open ? (
        <BustSteps
          key={player?.id ?? "pick"}
          tournamentId={tournamentId}
          registrations={registrations}
          seatOf={seatOf}
          preset={player}
          heading={heading}
          undo={undo}
          onEliminated={onEliminated}
          onClose={() => onOpenChange(false)}
        />
      ) : null}
    </PhoneSheet>
  );
}

interface BustStepsProps {
  tournamentId: string;
  registrations: readonly PublicRegistration[];
  seatOf?: SeatOf;
  preset: PublicRegistration | null;
  heading: RefObject<HTMLHeadingElement>;
  undo: UndoElimination;
  onEliminated?: (registrationId: string) => void;
  onClose: () => void;
}

/** What "Not recorded" is busy as while it is saved (no registration has this id). */
const NOT_RECORDED = "not-recorded";

function BustSteps({ tournamentId, registrations, seatOf, preset, heading, undo, onEliminated, onClose }: BustStepsProps) {
  const { toast } = useToast();
  const eliminate = useUpdateRegistration(tournamentId);
  const [out, setOut] = useState<PublicRegistration | null>(preset);
  const [busyId, setBusyId] = useState<string | null>(null);
  const stillIn = registrations.filter((registration) => !registration.isEliminated);
  useStepFocus(heading, out?.id ?? "pick");

  const knockOut = async (going: PublicRegistration, by: PublicRegistration | null) => {
    setBusyId(by?.id ?? NOT_RECORDED);
    try {
      await eliminate.mutateAsync({ registrationId: going.id, input: { isEliminated: true, eliminatedBy: by?.playerId ?? null } });
    } catch (error) {
      setBusyId(null);
      toast({ title: "Could not eliminate the player", description: errorMessage(error, "Failed to eliminate player"), variant: "destructive" });
      return;
    }
    const name = playerName(going);
    toast({
      title: "Player eliminated successfully",
      description: by ? `${name}, knocked out by ${playerName(by)}.` : `${name} is out.`,
      action: undo(going),
    });
    onEliminated?.(going.id);
    onClose();
  };

  if (out === null) {
    const groups: PickerGroup[] = [
      { label: null, players: [...stillIn].sort(newestFirst).map((registration) => ({ registration, detail: seatLine(seatOf, registration.id) })) },
    ];
    return (
      <>
        <PhoneSheetHeader titleRef={heading} icon={<UserX className="h-5 w-5 text-destructive" aria-hidden="true" />} title="Bust a player" description="Who is out? Tap the player." />
        <PhoneSheetBody>
          <DeskPlayerPicker groups={groups} onPick={setOut} empty="Nobody is still in." testId="bust-pick" />
        </PhoneSheetBody>
      </>
    );
  }

  const choices = knockoutChoices(out, registrations, seatOf);
  const groups: PickerGroup[] = [
    ...(choices.table
      ? [
          {
            label: `At Table ${choices.table.tableNumber}`,
            players: choices.table.players.map((registration) => ({ registration, detail: seatLine(seatOf, registration.id) })),
          },
        ]
      : []),
    {
      label: choices.table && choices.others.length > 0 ? "Everyone else" : null,
      players: choices.others.map((registration) => ({ registration, detail: seatLine(seatOf, registration.id) })),
    },
  ];
  const name = playerName(out);
  return (
    <>
      <PhoneSheetHeader titleRef={heading} title="Knocked out by" description={`Who knocked ${name} out? Tap them, or “Not recorded”.`}>
        <div className="flex items-center gap-3 rounded-lg bg-muted/50 p-2" data-testid="bust-going-out">
          <PlayerAvatar name={name} imageUrl={out.player?.imageUrl} size="md" />
          <p className="min-w-0 flex-1 break-words font-medium text-foreground">
            {name}
            <span className="block text-xs font-normal text-muted-foreground">Going out{seatLine(seatOf, out.id) ? ` · ${seatLine(seatOf, out.id)}` : ""}</span>
          </p>
          {preset === null ? (
            <Button
              variant="ghost"
              className="h-11 shrink-0"
              aria-disabled={busyId !== null || undefined}
              onClick={() => {
                if (busyId === null) setOut(null);
              }}
            >
              <ArrowLeft aria-hidden="true" />
              Change
            </Button>
          ) : null}
        </div>
      </PhoneSheetHeader>
      <PhoneSheetBody>
        <DeskPlayerPicker
          groups={groups}
          // "Not recorded" being saved holds every row too: no registration has its id, so none spins.
          busyId={busyId}
          onPick={(by) => void knockOut(out, by)}
          before={
            <Button
              variant="outline"
              className="h-14 w-full justify-start gap-3 bg-card px-3 text-base [&_svg]:size-5"
              busy={busyId !== null}
              onClick={() => void knockOut(out, null)}
              data-testid="bust-not-recorded"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-muted" aria-hidden="true">
                <CircleSlash />
              </span>
              Not recorded
            </Button>
          }
          empty="Nobody else is still in."
          testId="bust-by"
        />
      </PhoneSheetBody>
    </>
  );
}
