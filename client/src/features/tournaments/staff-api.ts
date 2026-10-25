/**
 * The tournament endpoints only the club's staff call: the payment and request desks, the finalize
 * preview, and every change to a tournament and its registrations. Apart from api.ts so the public
 * pages never load them (test/unit/public-bundle.test.ts).
 */
import { queryOptions } from "@tanstack/react-query";
import type {
  ConfirmPendingActionInput,
  ConfirmPendingActionResponse,
  PendingActionDto,
  RebuyBeforeEliminationDetails,
} from "@shared/api/pending-actions";
import type { FinalizeInput, FinalizePreviewDto, FinalizePreviewInput, FinalizeResultDto } from "@shared/api/finalize";
import type {
  ConfirmedRegistrationDto,
  ManagedRegistration,
  PendingRegistrationDto,
  StaffRegistrationInput,
  UpdateRegistrationInput,
} from "@shared/api/registrations";
import type { CreateTournamentInput, TournamentDetailDto, UpdateTournamentInput } from "@shared/api/tournaments";
import { apiGet, apiSend, errorDetails, isRecord, segment } from "@/lib/api/http";
import { qk } from "@/lib/api/query-keys";
import { tournamentPath } from "./api";

export const tournamentDeskQueries = {
  /**
   * The registrations as the club's staff get them (ManagedRegistration: with payment status): the same
   * read, and the same cache entry, as tournamentQueries.registrations, typed for what the server sends
   * a manager (R4-CQ-04).
   */
  managedRegistrations: (id: string) =>
    queryOptions({
      queryKey: qk.tournaments.registrations(id),
      queryFn: ({ signal }) => apiGet<ManagedRegistration[]>(`${tournamentPath(id)}/registrations`, { signal }),
    }),
  pendingActions: (id: string) =>
    queryOptions({
      queryKey: qk.tournaments.pendingActions(id),
      queryFn: ({ signal }) => apiGet<PendingActionDto[]>(`${tournamentPath(id)}/pending-actions`, { signal }),
    }),
  pendingRegistrations: (id: string) =>
    queryOptions({
      queryKey: qk.tournaments.pendingRegistrations(id),
      queryFn: ({ signal }) => apiGet<PendingRegistrationDto[]>(`${tournamentPath(id)}/pending-registrations`, { signal }),
    }),
  confirmedRegistrations: (id: string) =>
    queryOptions({
      queryKey: qk.tournaments.confirmedRegistrations(id),
      queryFn: ({ signal }) => apiGet<ConfirmedRegistrationDto[]>(`${tournamentPath(id)}/confirmed-registrations`, { signal }),
    }),
  /**
   * What finalize would write for `input`, read as a query so each finishing order is previewed once
   * and the answer for the order on screen is always the last one asked for.
   */
  finalizePreview: (id: string, input: FinalizePreviewInput) =>
    queryOptions({
      queryKey: qk.finalizePreview(id, input),
      queryFn: ({ signal }) => apiSend<FinalizePreviewDto>("POST", `${tournamentPath(id)}/finalize/preview`, input, { signal }),
      staleTime: 0,
      gcTime: 0,
    }),
};

export const createTournament = (input: CreateTournamentInput) => apiSend<TournamentDetailDto>("POST", "/api/tournaments", input);

export const updateTournament = (id: string, input: UpdateTournamentInput) =>
  apiSend<TournamentDetailDto>("PUT", tournamentPath(id), input);

export const deleteTournament = (id: string) => apiSend<{ success: true; message: string }>("DELETE", tournamentPath(id));

/** The TD's desk: a player who has played before, with their opening entries. */
export const registerPlayer = (tournamentId: string, input: StaffRegistrationInput) =>
  apiSend<ManagedRegistration>("POST", `${tournamentPath(tournamentId)}/registrations`, input);

export const updateRegistration = (id: string, input: UpdateRegistrationInput) =>
  apiSend<ManagedRegistration>("PUT", `/api/registrations/${segment(id)}`, input);

/** A mistaken sign-up taken out again (only while nothing has happened to the entry). */
export const removeRegistration = (id: string) => apiSend("DELETE", `/api/registrations/${segment(id)}`);

export const confirmPayment = (registrationId: string) =>
  apiSend<ManagedRegistration>("PATCH", `/api/registrations/${segment(registrationId)}/confirm-payment`);

/** Applies a player's request exactly once; `reenter` answers 409 REBUY_BEFORE_ELIMINATION. */
export const confirmPendingAction = (actionId: string, input: ConfirmPendingActionInput = {}) =>
  apiSend<ConfirmPendingActionResponse>(
    "POST",
    `/api/pending-actions/${segment(actionId)}/confirm`,
    input.reenter === undefined ? undefined : input,
  );

/** Takes a request off the list without applying it. */
export const dismissPendingAction = (actionId: string) =>
  apiSend<{ success: true }>("DELETE", `/api/pending-actions/${segment(actionId)}`);

export const finalizeTournament = (id: string, input: FinalizeInput) =>
  apiSend<FinalizeResultDto>("POST", `${tournamentPath(id)}/finalize`, input);

const isTextOrNull = (value: unknown) => value === null || typeof value === "string";

/** The new plan a 409 PLAN_CHANGED carries (`details.preview`), when it carries one. */
export function planChangedPreview(error: unknown): FinalizePreviewDto | undefined {
  const preview = errorDetails(error, "PLAN_CHANGED")?.preview;
  return isRecord(preview) && typeof preview.ok === "boolean" && Array.isArray(preview.rows) && Array.isArray(preview.activePlayers)
    ? (preview as unknown as FinalizePreviewDto)
    : undefined;
}

/** What a 409 REBUY_BEFORE_ELIMINATION says about the player, for the TD's question; undefined for anything else. */
export function rebuyBeforeEliminationDetails(error: unknown): RebuyBeforeEliminationDetails | undefined {
  const details = errorDetails(error, "REBUY_BEFORE_ELIMINATION");
  if (!details) return undefined;
  const { playerName, requestedAt, eliminatedAt } = details;
  return typeof playerName === "string" && isTextOrNull(requestedAt ?? null) && isTextOrNull(eliminatedAt ?? null)
    ? { playerName, requestedAt: (requestedAt as string | null | undefined) ?? null, eliminatedAt: (eliminatedAt as string | null | undefined) ?? null }
    : undefined;
}
