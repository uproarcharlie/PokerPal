/**
 * The seating hooks only the club's staff use: the TD's seating (polled while the Tables & Seating tab
 * is open) and every change to it. Apart from hooks.ts so the public pages never load them.
 *
 * Every change is one mutation, so the panel knows whether any change is being saved and holds every
 * seat and button meanwhile: a second tap is not sent against a seating about to change. Its answer is
 * the seating after it, shown at once; what else a seating change touches (the public seat finder, the
 * TV, the activity feed) is refreshed behind it. A refusal that means the screen was out of date
 * refreshes the seating.
 */
import { useEffect, useRef } from "react";
import { useIsMutating, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type {
  AssignSeatInput,
  BalanceInput,
  BreakTableInput,
  CreateTablesInput,
  DrawSeatsInput,
  FinalTableInput,
  OpenTableInput,
  SeatingDto,
  SeatingMutationDto,
  SeatingSetupInput,
  UndoSeatingInput,
  UnseatInput,
  UpdateTableInput,
} from "@shared/api/seating";
import { errorDetails, hasErrorCode, isApiError, isRecord } from "@/lib/api/http";
import { invalidateTournament } from "@/lib/api/invalidate";
import { qk } from "@/lib/api/query-keys";
import { unlessRefused } from "@/lib/live-refresh";
import {
  addTables,
  assignSeat,
  balanceTables,
  breakTable,
  drawFinalTable,
  drawSeats,
  openTable,
  removeTable,
  seatingQueries,
  setupSeating,
  undoSeatingChange,
  unseatPlayer,
  updateTable,
} from "./staff-api";

/** How often the TD's seating is asked again while the Tables & Seating tab is open (phase4-contracts §7). */
export const SEATING_REFRESH_MS = 10_000;

/**
 * How often the tab's badge asks while another tab is open and tables are in play: a seat change made
 * on another phone (a balance, a move) reaches the badge without the TD opening the tab
 * (TDN3-BADGE-STALE-OTHER-DEVICE).
 */
export const SEATING_BADGE_REFRESH_MS = 30_000;

/** Who follows the seating: the Tables & Seating panel, or the tab's badge while the panel is closed. */
export type SeatingFollower = "panel" | "badge";

/**
 * The seating's poll: the panel's every SEATING_REFRESH_MS while it can change; the badge's every
 * SEATING_BADGE_REFRESH_MS while tables are in play (with none it has nothing to say); never once the
 * tournament is over.
 */
export function seatingInterval(seating: Pick<SeatingDto, "readOnly" | "stats"> | undefined, follower: SeatingFollower = "panel"): number | false {
  if (seating === undefined || seating.readOnly) return false;
  if (follower === "panel") return SEATING_REFRESH_MS;
  return seating.stats.activeTables > 0 ? SEATING_BADGE_REFRESH_MS : false;
}

/**
 * The tournament's seating (staff only: 403 to anyone else). Followed by `poll` while its follower is
 * mounted (seatingInterval); without (the standings' Seat column) it is read once.
 */
export function useSeating(tournamentId: string, { poll, enabled = true }: { poll?: SeatingFollower; enabled?: boolean } = {}) {
  return useQuery({
    ...seatingQueries.detail(tournamentId),
    enabled: enabled && Boolean(tournamentId),
    refetchInterval: poll ? ({ state }) => unlessRefused(state.error, seatingInterval(state.data, poll)) : false,
    // Read once (the Seat column), it keeps the app's usual freshness; followed, every answer is checked again.
    ...(poll ? { staleTime: 0 } : {}),
  });
}

/** Who is still in, in one string: it changes with an entry, a bust, a restore or a removal. */
const stillIn = (registrations: ReadonlyArray<{ id: string; isEliminated: boolean | null }> | undefined) =>
  (registrations ?? [])
    .filter((registration) => !registration.isEliminated)
    .map((registration) => registration.id)
    .join(",");

/**
 * The seating as the TD's page follows it from any tab (the Seats tab's badge, the auto-seat notices):
 * polled as `poll` says, and asked again whenever the page's registrations show someone coming in or
 * going out (they follow the door and the floor on every device), alongside any refresh already
 * running rather than instead of it. One copy for both followers (R5REV3-CQ-11), which share the query.
 */
export function useFollowedSeating(
  tournamentId: string,
  { registrations, poll, enabled }: { registrations: ReadonlyArray<{ id: string; isEliminated: boolean | null }> | undefined; poll?: SeatingFollower; enabled: boolean },
) {
  const seating = useSeating(tournamentId, { poll, enabled });
  const { refetch } = seating;
  const players = stillIn(registrations);
  const seen = useRef(players);
  useEffect(() => {
    if (!enabled || seen.current === players) return;
    seen.current = players;
    void refetch({ cancelRefetch: false });
  }, [enabled, players, refetch]);
  return seating;
}

/** One change to the seating, as the panel asks for it; `undoing` marks a toast's Undo of a move made by hand. */
export type SeatingChange =
  | { kind: "setup"; input: SeatingSetupInput }
  | { kind: "addTables"; input: CreateTablesInput }
  | { kind: "updateTable"; tableId: string; input: UpdateTableInput }
  | { kind: "removeTable"; tableId: string }
  | { kind: "breakTable"; tableId: string; input: BreakTableInput }
  | { kind: "draw"; input: DrawSeatsInput }
  | { kind: "assign"; input: AssignSeatInput; undoing?: true }
  | { kind: "unseat"; input: UnseatInput; undoing?: true }
  | { kind: "balance"; input: BalanceInput }
  | { kind: "finalTable"; input: FinalTableInput }
  | { kind: "openTable"; input: OpenTableInput }
  | { kind: "undoChange"; input: UndoSeatingInput };

function send(tournamentId: string, change: SeatingChange): Promise<SeatingMutationDto> {
  switch (change.kind) {
    case "setup":
      return setupSeating(tournamentId, change.input);
    case "addTables":
      return addTables(tournamentId, change.input);
    case "updateTable":
      return updateTable(tournamentId, change.tableId, change.input);
    case "removeTable":
      return removeTable(tournamentId, change.tableId);
    case "breakTable":
      return breakTable(tournamentId, change.tableId, change.input);
    case "draw":
      return drawSeats(tournamentId, change.input);
    case "assign":
      return assignSeat(tournamentId, change.input);
    case "unseat":
      return unseatPlayer(tournamentId, change.input);
    case "balance":
      return balanceTables(tournamentId, change.input);
    case "finalTable":
      return drawFinalTable(tournamentId, change.input);
    case "openTable":
      return openTable(tournamentId, change.input);
    case "undoChange":
      return undoSeatingChange(tournamentId, change.input);
  }
}

/** The fresh seating a STALE_PLAN refusal carries (details.seating), if it carries one. */
export function staleSeating(error: unknown): SeatingDto | null {
  const seating = errorDetails(error, "STALE_PLAN")?.seating;
  if (!isRecord(seating)) return null;
  return typeof seating.version === "string" && Array.isArray(seating.tables) && Array.isArray(seating.unseated) ? (seating as unknown as SeatingDto) : null;
}

/** The seating as the server just sent it, on screen at once: a poll already on its way is cancelled first, so it cannot put the old seating back. */
async function showSeating(queryClient: QueryClient, tournamentId: string, seating: SeatingDto): Promise<void> {
  const key = qk.tournaments.seating(tournamentId);
  await queryClient.cancelQueries({ queryKey: key, exact: true });
  queryClient.setQueryData(key, seating);
}

/**
 * A seating write's answer on screen, then what else the write changed: the activity feed (every
 * change is logged), the public seat finder and the TV's seats layer, and the TV's table count when
 * the tables in play changed. Never the seating again, which the answer is, nor the registrations, the
 * pool or the clock, which a seat never touches (R2-CQ-05); everything, should the tournament's status
 * have changed meanwhile.
 */
async function showSeatingChange(queryClient: QueryClient, tournamentId: string, seating: SeatingDto): Promise<void> {
  const before = queryClient.getQueryData<SeatingDto>(qk.tournaments.seating(tournamentId));
  await showSeating(queryClient, tournamentId, seating);
  if (before !== undefined && before.tournamentStatus !== seating.tournamentStatus) {
    void invalidateTournament(queryClient, tournamentId);
    return;
  }
  void queryClient.invalidateQueries({ queryKey: qk.tournaments.activity(tournamentId) });
  void queryClient.invalidateQueries({ queryKey: qk.tournaments.publicSeating(tournamentId), exact: true });
  if (before === undefined || before.stats.activeTables !== seating.stats.activeTables) {
    void queryClient.invalidateQueries({ queryKey: qk.tournaments.display(tournamentId), exact: true });
  }
}

/** Every seating change of a tournament, wherever it is made from (the panel, a toast's Seat now). */
const seatingChangeKey = (tournamentId: string) => ["seating-change", tournamentId] as const;

/**
 * Every change to the tournament's seating (phase4-contracts S2–S11, Undo, R5-S13), the panel's and a toast's "Seat
 * now" alike (P4REV4-R3-CQ-08). On success the answer's seating replaces the one on screen and what it
 * touches is refreshed (showSeatingChange). On a refusal: a STALE_PLAN's fresh seating is shown at once;
 * a tournament that closed meanwhile is refreshed (the panel turns read-only); any other conflict or
 * missing table refreshes the seating, which was out of date.
 */
export function useSeatingMutations(tournamentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: seatingChangeKey(tournamentId),
    mutationFn: (change: SeatingChange) => send(tournamentId, change),
    onSuccess: (result) => showSeatingChange(queryClient, tournamentId, result.seating),
    onError: async (error) => {
      const fresh = staleSeating(error);
      if (fresh) await showSeating(queryClient, tournamentId, fresh);
      else if (hasErrorCode(error, "TOURNAMENT_CLOSED")) void invalidateTournament(queryClient, tournamentId);
      else if (isApiError(error) && (error.status === 404 || error.status === 409)) {
        void queryClient.invalidateQueries({ queryKey: qk.tournaments.seating(tournamentId), exact: true });
      }
    },
  });
}

/** Whether any change to the tournament's seating is being saved, from this screen or a toast: the panel holds its seats and buttons meanwhile. */
export function useSeatingBusy(tournamentId: string): boolean {
  return useIsMutating({ mutationKey: seatingChangeKey(tournamentId) }) > 0;
}
