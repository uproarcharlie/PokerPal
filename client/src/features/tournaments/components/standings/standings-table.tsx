import { useEffect, useRef, useState, type RefObject } from "react";
import { RotateCcw, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useFirstInPage } from "@/components/ui/return-focus";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/query-state";
import { MoneyText } from "@/components/shared/money-text";
import { PlayerAvatar } from "@/components/image/player-avatar";
import { ResponsiveTable, type ResponsiveColumn } from "@/components/shared/responsive-table";
import { useBusyRows } from "@/hooks/use-busy-rows";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api/http";
import { entriesOf } from "@/lib/entries";
import { formatNumber, plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PublicRegistration } from "@shared/api/public";
import { registrationRemovalProblem, standingsFor } from "@shared/domain/standings";
import { useSeating } from "@/features/seating/staff-hooks";
import type { SeatingDto } from "@shared/api/seating";
import { useRemoveRegistration, useUpdateRegistration } from "../../staff-hooks";
import { playerName } from "../../player-name";
import { EliminatePlayerDialog } from "./eliminate-player-dialog";
import { useAnnounceReturn } from "./undo-elimination";
import { PlaceBadge, StandingStatus } from "@/components/shared/podium";

interface StandingsTableProps {
  tournamentId: string;
  registrations: readonly PublicRegistration[];
  /** Eliminate, restore and remove are for the club's staff (viewer.canManage). */
  canManage: boolean;
  /** Completed or cancelled: the standings can no longer change here (a finished one is fixed with Correct Results). */
  closed: boolean;
  completed: boolean;
}

function PlayerCell({ registration }: { registration: PublicRegistration }) {
  const name = playerName(registration);
  const rebuys = registration.rebuys ?? 0;
  const addons = registration.addons ?? 0;
  return (
    <div className="flex items-center gap-3 text-left">
      <PlayerAvatar name={name} imageUrl={registration.player?.imageUrl} size="md" />
      <div className="min-w-0">
        <p className={cn("break-words font-medium", registration.isEliminated ? "text-muted-foreground line-through" : "text-foreground")}>{name}</p>
        <p className="text-xs font-normal text-muted-foreground">
          Buy-in: {registration.buyIns ?? 0}
          {rebuys > 0 ? ` + ${plural(rebuys, "Re-buy")}` : ""}
          {addons > 0 ? ` + ${plural(addons, "Add-on")}` : ""}
        </p>
      </div>
    </div>
  );
}

type SeatOf = SeatingDto["seatByRegistrationId"];

/** "T2 · S4", read out as "Table 2, seat 4"; "Waiting" for a player still in without one; a dash for a player who is out. */
function SeatCell({ seat }: { seat: SeatOf[string] | "waiting" | undefined }) {
  if (seat === "waiting") {
    return (
      <span className="font-medium text-accent-text" data-testid="standings-seat">
        Waiting<span className="sr-only"> for a seat</span>
      </span>
    );
  }
  if (!seat) {
    return (
      <span className="text-muted-foreground" data-testid="standings-seat">
        <span aria-hidden="true">–</span>
        <span className="sr-only">No seat</span>
      </span>
    );
  }
  return (
    <span className="whitespace-nowrap font-medium tabular-nums text-foreground" data-testid="standings-seat">
      <span aria-hidden="true">
        T{seat.tableNumber} · S{seat.seatNumber}
      </span>
      <span className="sr-only">
        Table {seat.tableNumber}, seat {seat.seatNumber}
      </span>
    </span>
  );
}

/** "2 entries", with the add-ons beside them: "2 entries · 1 add-on". */
function entryText(registration: PublicRegistration): string {
  const entries = plural(entriesOf(registration), "entry", "entries");
  const addons = registration.addons ?? 0;
  return addons > 0 ? `${entries} · ${plural(addons, "add-on")}` : entries;
}

/** The players, best first, with the TD's eliminate, restore and remove controls while the game is open. */
export function StandingsTable({ tournamentId, registrations, canManage, closed, completed }: StandingsTableProps) {
  const { toast } = useToast();
  const [eliminating, setEliminating] = useState<PublicRegistration | null>(null);
  const [removing, setRemoving] = useState<PublicRegistration | null>(null);
  const restore = useUpdateRegistration(tournamentId);
  const remove = useRemoveRegistration(tournamentId);
  const announceReturn = useAnnounceReturn(tournamentId);
  // Each Restore waits for its own answer, and each answer is told for its own player (P3REV0-PARITY-03).
  const restoring = useBusyRows();
  const standings = standingsFor(registrations, completed);
  const rows = standings.map((standing) => standing.registration);
  const placeOf = new Map(standings.map((standing) => [standing.registration.id, standing.place]));
  const list = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  // The player whose Eliminate or Restore the TD just used, and the state the server's answer brings: the
  // row moves when it does, and a focused button that moves loses focus (MA-P3REV1-04).
  const keepFocus = useRef<{ registrationId: string; eliminated: boolean } | null>(null);
  // Where focus goes when the eliminate dialog closes: that player's control as it is then. The answer
  // replaces the row at once (P3REV-PERF-STANDINGS-STALE-AFTER-ACTION), so by then its Eliminate, which
  // opened the dialog, may already be a Restore.
  const eliminatedId = useRef<string | null>(null);
  const [eliminatedControl] = useState<RefObject<HTMLElement | null>>(() => ({
    get current() {
      const id = eliminatedId.current;
      return id === null ? null : (list.current?.querySelector<HTMLElement>(`[data-standing-control="${id}"]`) ?? null);
    },
  }));
  const afterEliminate = useFirstInPage(eliminatedControl, heading);

  useEffect(() => {
    const wanted = keepFocus.current;
    if (wanted === null) return;
    const row = registrations.find((registration) => registration.id === wanted.registrationId);
    if (row && Boolean(row.isEliminated) !== wanted.eliminated) return;
    keepFocus.current = null;
    // Only when focus was lost with the move: never taken from where the TD has gone since.
    if (document.activeElement !== null && document.activeElement !== document.body) return;
    const control = row ? list.current?.querySelector<HTMLElement>(`[data-standing-control="${row.id}"]`) : null;
    (control ?? heading.current)?.focus();
  }, [registrations]);

  // The server clears the elimination time and takes the knockout back off the eliminator.
  const restorePlayer = async (registration: PublicRegistration) => {
    // Wanted from the start: the answer may redraw the row before this function hears it.
    keepFocus.current = { registrationId: registration.id, eliminated: false };
    try {
      await restoring.run(registration.id, () => restore.mutateAsync({ registrationId: registration.id, input: { isEliminated: false } }));
    } catch (error) {
      keepFocus.current = null;
      toast({ title: "Could not restore the player", description: errorMessage(error, "Failed to restore player"), variant: "destructive" });
      return;
    }
    // Their old seat comes back only while it is free: otherwise they wait, and the toast offers a seat.
    await announceReturn(registration, "Player restored successfully");
  };

  const controls = canManage && !closed;
  // Where each player sits, read once (the Tables & Seating tab follows it): a column only once anyone is seated.
  const seating = useSeating(tournamentId, { enabled: controls });
  const seatOf = controls ? seating.data?.seatByRegistrationId : undefined;
  // Still in, with tables in play and no seat: not the dash of a player who is out (TDN2-WAITING-NOT-FLAGGED).
  const waiting = new Set(controls && seating.data && seating.data.stats.activeTables > 0 ? seating.data.unseated.map((entry) => entry.registrationId) : []);
  const seatCell = (registration: PublicRegistration) => (waiting.has(registration.id) ? "waiting" : seatOf?.[registration.id]);

  // On a phone each player is a card with their controls on it (MA-02): Eliminate, the TD's most used
  // action on the night, is never off the side of a table that scrolls sideways.
  const columns: ResponsiveColumn<PublicRegistration>[] = [
    {
      id: "place",
      header: "Place",
      phone: "title",
      cell: (registration) => <PlaceBadge place={placeOf.get(registration.id) ?? null} finished={completed} />,
    },
    { id: "player", header: "Player", phone: "title", cell: (registration) => <PlayerCell registration={registration} /> },
    ...(seatOf && Object.keys(seatOf).length > 0
      ? [{ id: "seat", header: "Seat", className: "text-sm", cell: (registration: PublicRegistration) => <SeatCell seat={seatCell(registration)} /> }]
      : []),
    {
      id: "status",
      header: "Status",
      cell: (registration) => (
        <StandingStatus place={placeOf.get(registration.id) ?? null} eliminated={registration.isEliminated === true} completed={completed} />
      ),
    },
    {
      id: "entry",
      header: "Entry",
      className: "text-sm text-muted-foreground",
      cell: entryText,
    },
    { id: "points", header: "Points", className: "text-sm font-semibold text-foreground", cell: (registration) => formatNumber(registration.pointsAwarded ?? 0) },
    {
      id: "prize",
      header: "Prize",
      className: "text-sm font-semibold",
      cell: (registration) =>
        registration.prizeAmount ? <MoneyText amount={registration.prizeAmount} className="text-accent-text" /> : <span className="text-muted-foreground">-</span>,
    },
  ];
  if (controls) {
    columns.push({
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      phone: "actions",
      className: "text-right",
      cell: (registration) => {
        const name = playerName(registration);
        return (
          <div className="flex items-center justify-end gap-2">
            {/* Named with the player, so a screen reader's list of buttons tells them apart (MA-P3REV1-07). */}
            {registration.isEliminated ? (
              <Button
                variant="outline"
                onClick={() => void restorePlayer(registration)}
                busy={restoring.busy.has(registration.id)}
                aria-label={`Restore ${name}`}
                data-standing-control={registration.id}
                data-testid={`restore-player-${registration.id}`}
              >
                <RotateCcw className="mr-1 h-4 w-4" aria-hidden="true" />
                Restore
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={() => {
                  eliminatedId.current = registration.id;
                  setEliminating(registration);
                }}
                className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                aria-label={`Eliminate ${name}`}
                data-standing-control={registration.id}
                data-testid={`eliminate-player-${registration.id}`}
              >
                Eliminate
              </Button>
            )}
            {/* An entry nothing has happened to yet: the server's own rule (CQ-P2-03). */}
            {registrationRemovalProblem(registration, registrations) === null ? (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setRemoving(registration)}
                aria-label={`Remove ${name}'s entry`}
                data-testid={`remove-registration-${registration.id}`}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        );
      },
    });
  }

  return (
    <Card>
      <CardHeader className="border-b border-border">
        <CardTitle ref={heading} tabIndex={-1} className="focus:outline-none">
          {closed ? "Final Standings" : "Current Standings"}
        </CardTitle>
        <p className="mt-1 text-sm text-muted-foreground" data-testid="standings-note">
          {completed && canManage
            ? "This tournament is finalized: to change who finished where, use Correct Results."
            : closed
              ? "This tournament is closed."
              : "Live player rankings and eliminations"}
        </p>
      </CardHeader>
      <CardContent ref={list} className="p-0">
        {rows.length === 0 ? (
          <EmptyState
            className="m-4 border-0"
            icon={<Users className="h-8 w-8" />}
            title="No Players Registered"
            description="Players will appear here once they register for the tournament."
          />
        ) : (
          <ResponsiveTable
            rows={rows}
            columns={columns}
            rowKey={(registration) => registration.id}
            rowProps={(registration) => ({ "data-testid": `player-row-${registration.id}` })}
            caption="Standings"
          />
        )}
      </CardContent>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        // A removed entry's row (and its button) is gone: focus goes to the standings' heading.
        returnFocusTo={heading}
        title="Remove this entry?"
        description={`${removing?.player?.name ?? "This player"}: use this for a sign-up that should not be here, such as the wrong player or someone who is not playing. Their requests waiting for confirmation are removed too.`}
        confirmLabel="Remove entry"
        pendingLabel="Removing…"
        destructive
        onConfirm={async () => {
          if (!removing) return;
          await remove.mutateAsync(removing.id);
          toast({ title: "Entry removed", description: "The player is no longer registered for this tournament" });
        }}
      />

      <EliminatePlayerDialog
        tournamentId={tournamentId}
        registration={eliminating}
        registrations={registrations}
        seatOf={seatOf}
        onEliminated={(registrationId) => {
          keepFocus.current = { registrationId, eliminated: true };
        }}
        onClose={() => setEliminating(null)}
        returnFocusTo={afterEliminate}
      />
    </Card>
  );
}
