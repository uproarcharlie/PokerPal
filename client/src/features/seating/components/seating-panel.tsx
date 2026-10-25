import { useRef, useState } from "react";
import { Link } from "wouter";
import { Armchair, Plus, Settings2 } from "lucide-react";
import type { PublicRegistration } from "@shared/api/public";
import type { SeatingDto, SeatingMutationDto, TableDto, TableSeatDto } from "@shared/api/seating";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { nextTableNumber } from "@shared/domain/table-advisor";
import { routes } from "@/app/routes";
import { LiveStatus } from "@/components/shared/live-status";
import { EmptyState, LoadingRows, QueryState } from "@/components/shared/query-state";
import { Button } from "@/components/ui/button";
import { EliminatePlayerDialog } from "@/features/tournaments/components/standings/eliminate-player-dialog";
import { useToast } from "@/hooks/use-toast";
import { qk } from "@/lib/api/query-keys";
import { plural } from "@/lib/format";
import { useSeatArrivals, type Arrival } from "../auto-seat-notices";
import { useDeviceChoice } from "../device-choice";
import { usePaidOnly } from "../paid-only";
import { seatingEntries, seatPress } from "../seat-selection";
import { changeOutcome, failedTitle, seatingRefusal, type AnnouncedMoves } from "../seating-text";
import { seatingInterval, useSeating, useSeatingBusy, useSeatingMutations, type SeatingChange } from "../staff-hooks";
import { AddTablesDialog } from "./add-tables-dialog";
import { ArchivedTables } from "./archived-tables";
import { ArrivalsBanner } from "./arrivals-banner";
import { SeatMovesDialog } from "./seat-moves-dialog";
import { SeatingAdvice } from "./seating-advice";
import { SeatingConfirmations, type ConfirmRequest } from "./seating-confirmations";
import { SeatingSettingsSheet } from "./seating-settings-sheet";
import { SeatingSetupDialog } from "./seating-setup-dialog";
import { SeatingToolbar, type SeatingView } from "./seating-toolbar";
import { SelectionBar } from "./selection-bar";
import { TableCard, type TableAction } from "./table-card";
import { TableList } from "./table-list";
import { TableSettingsDialog } from "./table-settings-dialog";
import { UnseatedList } from "./unseated-list";

interface SeatingPanelProps {
  tournament: TournamentDetailDto;
  /** The tournament's players (the page's list): a bust recorded from a seat names its eliminator from them. */
  registrations: readonly PublicRegistration[];
}

/**
 * The Tables & Seating tab (the phone's Seats tab): the tables put out for the tournament, drawn in
 * their real shape with each player at their seat (or listed seat by seat), followed every few seconds
 * while the tab is open. The table advisor's next step sits on top (open the next table, seat the
 * waiting, break a table, the final table, balance), with new arrivals auto-seat has sat down. The
 * club's staff set up the tables and draw seats in one tap, move and swap players by tapping them,
 * unseat, eliminate, balance, break tables and draw the final table. Shown, not changed, once the
 * tournament is over.
 */
export function SeatingPanel({ tournament, registrations }: SeatingPanelProps) {
  const canManage = tournament.viewer.canManage;
  const seating = useSeating(tournament.id, { poll: "panel", enabled: canManage });
  if (!canManage) {
    return (
      <EmptyState
        title="Only the club's staff see the seating plan"
        description="Players find their table and seat on the seat finder."
        action={
          <Button variant="outline" asChild>
            <Link href={routes.publicSeats(tournament.id)}>Open seat finder</Link>
          </Button>
        }
      />
    );
  }
  return (
    <QueryState query={seating} loading={<LoadingRows rows={4} />} errorTitle="The seating could not be loaded">
      {(data) => <SeatingDesk tournament={tournament} seating={data} registrations={registrations} />}
    </QueryState>
  );
}

/** Whether a change is "Seat N waiting" (everyone waiting, not one player's own Seat). */
const isSeatWaiting = (change: SeatingChange | undefined) => change?.kind === "draw" && change.input.scope === "unseated" && change.input.registrationIds === undefined;

type OpenDialog = { kind: "setup" } | { kind: "addTables" } | { kind: "settings"; tableId: string } | { kind: "seatingSettings" };

const VIEWS = ["tables", "list"] as const satisfies readonly SeatingView[];

interface SeatingDeskProps {
  tournament: TournamentDetailDto;
  seating: SeatingDto;
  registrations: readonly PublicRegistration[];
}

function SeatingDesk({ tournament, seating, registrations }: SeatingDeskProps) {
  const tournamentId = tournament.id;
  const { toast } = useToast();
  const change = useSeatingMutations(tournamentId);
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [announced, setAnnounced] = useState<AnnouncedMoves | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [paidOnly, setPaidOnly] = usePaidOnly(tournamentId);
  const [view, setView] = useDeviceChoice("view", VIEWS);
  const { arrivals, dismiss: dismissArrivals } = useSeatArrivals(seating);
  // The player going out from the selection bar (P4REV0-BUST-FROM-SEAT); focus then comes back to the panel, the bar having gone with them.
  const [eliminatingId, setEliminatingId] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  const readOnly = seating.readOnly;
  const { settings } = seating;
  // Any seating change, this panel's or a toast's Seat now: none is sent against a seating about to change.
  const busy = useSeatingBusy(tournamentId);
  const active = seating.tables.filter((table) => table.status === "active");
  const archived = seating.tables.filter((table) => table.status !== "active");
  const entries = seatingEntries(seating);
  // A player picked up who has since busted or been moved elsewhere is followed by id, from the latest seating.
  const selected = selectedId === null ? null : (entries.get(selectedId) ?? null);
  const settingsTable = dialog?.kind === "settings" ? (active.find((table) => table.id === dialog.tableId) ?? null) : null;
  const eliminating = eliminatingId === null ? null : (registrations.find((registration) => registration.id === eliminatingId) ?? null);
  const freshSeats = freshSeatsByTable(arrivals);
  const advisedSeating = seating.advisor.advice.some((advice) => advice.kind === "seat_waiting" || advice.kind === "open_table");

  /**
   * Saves a change and says what it did, a move made by hand with an Undo that puts it back (a tap on
   * the wrong seat is easy on a phone: TDN4-UNSEAT-NO-UNDO); a refusal is the caller's to show (the
   * forms put it on a field).
   */
  const perform = async (next: SeatingChange): Promise<SeatingMutationDto> => {
    const result = await change.mutateAsync(next);
    setSelectedId(null);
    setHint(null);
    const { announce, toast: told, undo } = changeOutcome(next, result);
    if (announce) setAnnounced(announce);
    if (told) toast({ ...told, action: undo ? { label: "Undo", onClick: () => void run(undo) } : undefined });
    return result;
  };
  /** Saves a change, and shows a refusal in a toast. One at a time: a tap while one is saving does nothing. */
  const run = async (next: SeatingChange): Promise<void> => {
    if (busy) return;
    try {
      await perform(next);
    } catch (error) {
      toast({ title: failedTitle(next), description: seatingRefusal(error, next), variant: "destructive" });
    }
  };
  const closeDialog = (kind: OpenDialog["kind"]) => setDialog((open) => (open?.kind === kind ? null : open));

  const pressSeat = (table: TableDto, seat: TableSeatDto) => {
    const occupant = seat.registrationId === null ? null : (entries.get(seat.registrationId) ?? null);
    const outcome = seatPress(selected, { tableId: table.id, tableName: table.displayName, seatNumber: seat.seatNumber, occupant });
    setHint(outcome.kind === "hint" ? outcome.text : null);
    if (outcome.kind === "select") setSelectedId(outcome.registrationId);
    else if (outcome.kind === "deselect") setSelectedId(null);
    else if (outcome.kind === "move") void run({ kind: "assign", input: { registrationId: outcome.mover.registrationId, tableId: outcome.to.tableId, seatNumber: outcome.to.seatNumber, swap: false } });
    else if (outcome.kind === "swap") setConfirm({ kind: "swap", mover: outcome.mover, occupant: outcome.occupant });
  };

  const tableActions = (table: TableDto): TableAction[] => {
    const actions: TableAction[] = ["settings"];
    // The server's rule: the final table seats the players at the tables (the waiting can be included when it has room).
    if (active.length > 1 && table.seatCount >= seating.stats.seated) actions.push("finalTable");
    if (active.length > 1 && table.occupied > 0) actions.push("break");
    if (table.occupied === 0) actions.push("remove");
    return actions;
  };
  const onTableAction = (table: TableDto, action: TableAction, menu: HTMLButtonElement | null) => {
    if (action === "settings") setDialog({ kind: "settings", tableId: table.id });
    else setConfirm({ kind: action, table, returnFocusTo: menu });
  };

  const drawWaiting = () => void run({ kind: "draw", input: { scope: "unseated", includeUnconfirmed: !paidOnly } });
  // "Once they've paid": the advisor counts only those who have, so seating the waiting seats only them.
  const seatAdvisedWaiting = () => void run({ kind: "draw", input: { scope: "unseated", includeUnconfirmed: !paidOnly && settings.autoSeat !== "once_paid" } });
  // The server plans the table from the seating this version names, exactly as the advice showed it.
  const openTable = () => void run({ kind: "openTable", input: { expectedVersion: seating.version } });
  const seatOne = (registrationId: string) => void run({ kind: "draw", input: { scope: "unseated", registrationIds: [registrationId], includeUnconfirmed: true } });
  const selectWaiting = (registrationId: string) => {
    setHint(null);
    setSelectedId((current) => (current === registrationId ? null : registrationId));
  };
  const showTable = (table: TableDto) => document.getElementById(`${view === "list" ? "seating-list" : "seating-table"}-${table.tableNumber}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  // Above the tables while they are in play: on a phone, below two or three drawings it sat 1,000 px down,
  // out of sight of the seats a waiting player is picked up for (R5REV-HOST-10).
  const waitingList = (
    <UnseatedList unseated={seating.unseated} selectedId={selected?.registrationId ?? null} readOnly={readOnly || active.length === 0} busy={busy} onSelect={selectWaiting} onSeat={seatOne} />
  );

  return (
    <div ref={panel} tabIndex={-1} className="focus:outline-none">
      <LiveStatus follows={[{ queryKey: qk.tournaments.seating(tournamentId), interval: seatingInterval(seating) }]} className="mb-5" />
      {/* The live status is sr-only until the seating stops updating: kept out of the spacing so the tab starts flush. */}
      <div className="space-y-5">
        {active.length === 0 ? (
          <EmptyState
            icon={<Armchair className="h-8 w-8" />}
            title={readOnly ? "No tables were put out" : "No tables yet"}
            description={readOnly ? undefined : setupDescription(seating)}
            action={
              readOnly ? undefined : (
                <div className="flex flex-col gap-2 sm:flex-row [&>button]:min-h-11">
                  <Button type="button" busy={busy} onClick={() => setDialog({ kind: "setup" })} data-testid="open-seating-setup">
                    Set up tables & draw seats
                  </Button>
                  <Button type="button" variant="outline" busy={busy} onClick={() => setDialog({ kind: "addTables" })}>
                    <Plus aria-hidden="true" />
                    Add tables only
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setDialog({ kind: "seatingSettings" })} data-testid="open-seating-settings">
                    <Settings2 aria-hidden="true" />
                    Seating settings
                  </Button>
                </div>
              )
            }
          />
        ) : (
          <>
            {readOnly ? (
              <p className="text-sm text-muted-foreground">The tournament is over: the seating is shown as it was left.</p>
            ) : (
              <>
                <SeatingAdvice
                  seating={seating}
                  busy={busy}
                  paidOnly={paidOnly}
                  onOpenTable={openTable}
                  onSeatWaiting={seatAdvisedWaiting}
                  onBalance={() => void run({ kind: "balance", input: { expectedVersion: seating.version } })}
                  onBreak={(table) => setConfirm({ kind: "break", table, returnFocusTo: null })}
                  onFinalTable={(table) => setConfirm({ kind: "finalTable", table, returnFocusTo: null })}
                />
                <ArrivalsBanner arrivals={arrivals} onDismiss={dismissArrivals} />
              </>
            )}
            <SeatingToolbar
              tournamentId={tournamentId}
              seating={seating}
              readOnly={readOnly}
              pending={change.isPending && isSeatWaiting(change.variables) ? "seatWaiting" : null}
              busy={busy}
              paidOnly={paidOnly}
              advisedSeating={advisedSeating}
              view={view}
              onViewChange={setView}
              onPaidOnlyChange={setPaidOnly}
              onSeatWaiting={drawWaiting}
              onAddTables={() => setDialog({ kind: "addTables" })}
              onRedraw={() => setConfirm({ kind: "redraw" })}
              onSettings={() => setDialog({ kind: "seatingSettings" })}
            />
            {waitingList}
            {active.length > 2 ? (
              <nav aria-label="Go to a table" className="flex flex-wrap gap-2">
                {active.map((table) => (
                  <Button key={table.id} type="button" size="sm" variant="outline" className="h-10 tabular-nums" onClick={() => showTable(table)}>
                    {table.displayName} · {table.occupied}/{table.seatCount}
                  </Button>
                ))}
              </nav>
            ) : null}
            <p role="status" aria-live="polite" className={hint ? "rounded-md bg-muted px-3 py-2 text-sm text-foreground" : "sr-only"}>
              {hint}
            </p>
            {view === "list" ? (
              <TableList
                tables={active}
                selected={selected?.seat ? { tableId: selected.seat.tableId, seatNumber: selected.seat.seatNumber } : null}
                moverName={selected?.name ?? null}
                freshSeats={freshSeats}
                readOnly={readOnly}
                busy={busy}
                actionsOf={tableActions}
                onSeatPress={pressSeat}
                onAction={onTableAction}
              />
            ) : (
              <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
                {active.map((table) => (
                  <TableCard
                    key={table.id}
                    table={table}
                    selectedSeat={selected?.seat?.tableId === table.id ? selected.seat.seatNumber : null}
                    moverName={selected?.name ?? null}
                    freshSeats={freshSeats.get(table.id)}
                    readOnly={readOnly}
                    busy={busy}
                    actions={tableActions(table)}
                    compact
                    onSeatPress={pressSeat}
                    onAction={onTableAction}
                  />
                ))}
              </div>
            )}
          </>
        )}
        {active.length === 0 ? waitingList : null}
        <ArchivedTables tables={archived} readOnly={readOnly} busy={busy} onReopen={(table) => void run({ kind: "updateTable", tableId: table.id, input: { status: "active" } })} />
        {selected && !readOnly ? (
          <SelectionBar
            selected={selected}
            busy={busy}
            onUnseat={() => void run({ kind: "unseat", input: { registrationId: selected.registrationId } })}
            onEliminate={registrations.some((registration) => registration.id === selected.registrationId) ? () => setEliminatingId(selected.registrationId) : undefined}
            onCancel={() => {
              setSelectedId(null);
              setHint(null);
            }}
          />
        ) : null}

        <SeatingSetupDialog open={dialog?.kind === "setup"} onOpenChange={(open) => !open && closeDialog("setup")} stats={seating.stats} settings={settings} stored={tournament} perform={perform} />
        <AddTablesDialog
          open={dialog?.kind === "addTables"}
          onOpenChange={(open) => !open && closeDialog("addTables")}
          nextNumber={nextTableNumber(seating.tables)}
          defaultSeats={settings.seatsPerTable}
          defaultShape={settings.tableShape}
          perform={perform}
        />
        <SeatingSettingsSheet open={dialog?.kind === "seatingSettings"} onOpenChange={(open) => !open && closeDialog("seatingSettings")} tournament={tournament} settings={settings} />
        <TableSettingsDialog table={settingsTable} onClose={() => closeDialog("settings")} perform={perform} />
        <SeatingConfirmations request={confirm} seating={seating} paidOnly={paidOnly} onClose={() => setConfirm(null)} run={run} />
        <SeatMovesDialog
          announced={announced}
          busy={busy}
          onUndo={(undoable) => {
            setAnnounced(null);
            void run({ kind: "undoChange", input: { activityId: undoable.activityId, expectedVersion: undoable.version } });
          }}
          onClose={() => setAnnounced(null)}
        />
        <EliminatePlayerDialog
          tournamentId={tournamentId}
          registration={eliminating}
          registrations={registrations}
          seatOf={seating.seatByRegistrationId}
          onEliminated={() => {
            setSelectedId(null);
            setHint(null);
          }}
          onClose={() => setEliminatingId(null)}
          returnFocusTo={panel}
        />
      </div>
    </div>
  );
}

/** The seats new arrivals sat down in, by table: marked on the plan and in the list. */
function freshSeatsByTable(arrivals: readonly Arrival[]): Map<string, Set<number>> {
  const byTable = new Map<string, Set<number>>();
  for (const { seat } of arrivals) {
    if (!seat) continue;
    const seats = byTable.get(seat.tableId) ?? new Set<number>();
    seats.add(seat.seatNumber);
    byTable.set(seat.tableId, seats);
  }
  return byTable;
}

/** "22 players still in. Start with 3 tables: 8 / 7 / 7." (and who would wait when the starting tables cannot take everyone). */
function setupDescription(seating: SeatingDto): string {
  const players = `${plural(seating.stats.activePlayers, "player")} still in.`;
  const setup = seating.suggestions.setup;
  if (!setup || seating.stats.activePlayers === 0) return players;
  const seated = setup.perTable.reduce((sum, count) => sum + count, 0);
  const left = seating.stats.activePlayers - seated;
  return `${players} Start with ${plural(setup.tableCount, "table")}: ${setup.perTable.join(" / ")}${left > 0 ? `; ${plural(left, "player waits", "players wait")} for the next table` : ""}.`;
}
