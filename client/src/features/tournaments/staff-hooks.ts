/**
 * The tournament hooks only the club's staff use: the payment and request desks (polled every
 * DESK_REFRESH_MS), the requests still waiting, finalize, and every change with its invalidation.
 * Apart from hooks.ts so the public pages never load them.
 *
 * A desk action refreshes what it changed without waiting for it (P3REV4-PERF-02): the server has
 * already applied the change when it answers, so the button is free again at once, and a refetch that
 * is slow or retried on the venue's Wi-Fi never holds the desk up. What the answer itself settles (a
 * confirmed payment, a handled request) leaves its list straight away.
 */
import { useMutation, useQuery, useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import type { FinalizeInput, FinalizePreviewInput } from "@shared/api/finalize";
import type { ConfirmPendingActionInput, PendingActionDto } from "@shared/api/pending-actions";
import type { PendingRegistrationDto, StaffRegistrationInput, UpdateRegistrationInput } from "@shared/api/registrations";
import type { PublicRegistration } from "@shared/api/public";
import type { UpdateTournamentInput } from "@shared/api/tournaments";
import { hasErrorCode } from "@/lib/api/http";
import { invalidateResults, invalidateTournament, invalidateTournamentLists } from "@/lib/api/invalidate";
import { qk } from "@/lib/api/query-keys";
import { unlessRefused } from "@/lib/live-refresh";
import {
  confirmPayment,
  confirmPendingAction,
  createTournament,
  deleteTournament,
  dismissPendingAction,
  finalizeTournament,
  planChangedPreview,
  registerPlayer,
  removeRegistration,
  tournamentDeskQueries,
  updateRegistration,
  updateTournament,
} from "./staff-api";

/** The payment desk and the request desk: what players do on their phones shows up within seconds. */
export const DESK_REFRESH_MS = 3000;
/** The count of player requests still waiting, beside End Tournament (ending discards them). */
const WAITING_REQUESTS_REFRESH_MS = 15_000;

/** Player requests still waiting, for the club's staff while the tournament is open. */
export function useWaitingRequests(id: string, { enabled }: { enabled: boolean }) {
  return useQuery({
    ...tournamentDeskQueries.pendingActions(id),
    enabled,
    refetchInterval: ({ state }) => unlessRefused(state.error, WAITING_REQUESTS_REFRESH_MS),
    staleTime: 0,
  });
}

/** A desk list's poll: every DESK_REFRESH_MS, until the server refuses it for good (gone, or no longer staff). */
const deskInterval = ({ state }: { state: { error: unknown } }) => unlessRefused(state.error, DESK_REFRESH_MS);

/** The payment desk's lists (staff only: the server answers 403 to anyone else). */
export function usePaymentDesk(id: string) {
  const pending = useQuery({ ...tournamentDeskQueries.pendingRegistrations(id), refetchInterval: deskInterval });
  const confirmed = useQuery({ ...tournamentDeskQueries.confirmedRegistrations(id), refetchInterval: deskInterval });
  return { pending, confirmed };
}

/** The registrations with their payment status, for a staff screen that needs it (staff only; read once, like useRegistrations without `follow`). */
export function useManagedRegistrations(id: string) {
  return useQuery({ ...tournamentDeskQueries.managedRegistrations(id), enabled: Boolean(id) });
}

/** The request desk's list (staff only). */
export function usePendingActions(id: string) {
  return useQuery({ ...tournamentDeskQueries.pendingActions(id), refetchInterval: deskInterval });
}

export function useCreateTournament() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createTournament,
    onSuccess: () => invalidateTournamentLists(queryClient),
  });
}

/** Any change to a tournament: status, lock, max players, manual pool, or its settings. */
export function useUpdateTournament(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateTournamentInput) => updateTournament(id, input),
    onSuccess: (tournament) => {
      queryClient.setQueryData(qk.tournaments.detail(id), tournament);
      void invalidateTournament(queryClient, id);
    },
  });
}

/**
 * Deletes it and refreshes the lists. `leave` is called once the server has deleted it (the page
 * navigates away there); only then are the deleted tournament's queries dropped, so nothing on the page
 * still being left asks for it again and gets a 404 (its polls would rebuild a query removed earlier).
 */
export function useDeleteTournament(id: string, { leave }: { leave: () => void }) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => deleteTournament(id),
    onSuccess: () => {
      leave();
      queryClient.removeQueries({ queryKey: qk.tournaments.detail(id) });
      void invalidateTournamentLists(queryClient, { deleted: true });
    },
  });
}

/**
 * Fetches the pot as it is now, for the high-hand dialog: the next award is worked out from the
 * tournament and its registrations, so until both are back (`isPending`), or when either could not be
 * fetched (`isError`), the amount on screen may be out of date and the dialog says so
 * (P3REV-PERF-HIGHHAND-STALE-AMOUNT). `mutate()` asks again.
 */
export function useRefreshPot(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.tournaments.registrations(id), exact: true }, { throwOnError: true }),
        queryClient.invalidateQueries({ queryKey: qk.tournaments.detail(id), exact: true }, { throwOnError: true }),
      ]);
    },
  });
}

/** Where the pot the high-hand dialog shows stands: being fetched, fetched, or not fetched (it may be out of date). */
export type PotCheck = "checking" | "current" | "failed";

export const potCheckOf = (refresh: { isPending: boolean; isError: boolean }): PotCheck =>
  refresh.isPending ? "checking" : refresh.isError ? "failed" : "current";

export function useRegisterPlayer(tournamentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: StaffRegistrationInput) => registerPlayer(tournamentId, input),
    onSuccess: () => void invalidateTournament(queryClient, tournamentId),
  });
}

/** Drops one row (by id) from a cached desk list, as the server's answer says it has left it. */
function dropFromList<T extends { id: string }>(queryClient: QueryClient, queryKey: QueryKey, id: string) {
  queryClient.setQueryData<T[]>(queryKey, (rows) => rows?.filter((row) => row.id !== id));
}

/**
 * Eliminate, restore or award a high hand: one PUT, the server applies the rules under its lock. Its
 * answer is the registration as it now stands, which replaces that player's row at once: the standings
 * never show the old state (an Eliminate still offered to a player just knocked out) while the refresh
 * for what else it changed (the eliminator's knockouts, places, the pot) is on its way over slow venue
 * Wi-Fi (P3REV-PERF-STANDINGS-STALE-AFTER-ACTION).
 */
export function useUpdateRegistration(tournamentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ registrationId, input }: { registrationId: string; input: UpdateRegistrationInput }) =>
      updateRegistration(registrationId, input),
    onSuccess: (registration) => {
      queryClient.setQueryData<PublicRegistration[]>(qk.tournaments.registrations(tournamentId), (rows) =>
        rows?.map((row) => (row.id === registration.id ? registration : row)),
      );
      void invalidateTournament(queryClient, tournamentId);
    },
  });
}

/** Takes a sign-up out: its row leaves the standings at once, then the tournament refreshes. */
export function useRemoveRegistration(tournamentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: removeRegistration,
    onSuccess: (_answer, registrationId) => {
      dropFromList<PublicRegistration>(queryClient, qk.tournaments.registrations(tournamentId), registrationId);
      void invalidateTournament(queryClient, tournamentId);
    },
  });
}

/** Confirms one registration's payment: it leaves the pending list at once, then both lists refresh. */
export function useConfirmPayment(tournamentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: confirmPayment,
    onSuccess: (_registration, registrationId) => {
      dropFromList<PendingRegistrationDto>(queryClient, qk.tournaments.pendingRegistrations(tournamentId), registrationId);
      void invalidateTournament(queryClient, tournamentId);
    },
  });
}

export function useConfirmPendingAction(tournamentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ actionId, ...input }: { actionId: string } & ConfirmPendingActionInput) => confirmPendingAction(actionId, input),
    onSuccess: (_result, { actionId }) => {
      dropFromList<PendingActionDto>(queryClient, qk.tournaments.pendingActions(tournamentId), actionId);
      void invalidateTournament(queryClient, tournamentId);
    },
    // A refused request stays on the list; one another device already handled leaves it.
    onError: () => void queryClient.invalidateQueries({ queryKey: qk.tournaments.pendingActions(tournamentId) }),
  });
}

export function useDismissPendingAction(tournamentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: dismissPendingAction,
    onSuccess: (_result, actionId) => dropFromList<PendingActionDto>(queryClient, qk.tournaments.pendingActions(tournamentId), actionId),
    // Refreshed after a refusal too: a request another device already handled is gone.
    onSettled: () => void invalidateTournament(queryClient, tournamentId),
  });
}

/**
 * Finalize, or (with `force`) Correct Results. `preview` is the preview the dialog shows: a 409
 * PLAN_CHANGED carries the server's new plan, which replaces it, so the TD confirms what will really be
 * paid (CQ-10: one PLAN_CHANGED branch for both dialogs). The results refresh without holding the
 * dialog, which closes on the server's answer.
 */
export function useFinalizeTournament(tournamentId: string, preview: FinalizePreviewInput) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: FinalizeInput) => finalizeTournament(tournamentId, input),
    onSuccess: () => void invalidateResults(queryClient, tournamentId),
    onError: (error) => {
      if (!hasErrorCode(error, "PLAN_CHANGED")) return;
      const { queryKey } = tournamentDeskQueries.finalizePreview(tournamentId, preview);
      const fresh = planChangedPreview(error);
      if (fresh) queryClient.setQueryData(queryKey, fresh);
      else void queryClient.invalidateQueries({ queryKey });
    },
  });
}
