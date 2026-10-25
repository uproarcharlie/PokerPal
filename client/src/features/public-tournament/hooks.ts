/**
 * What the public tournament pages read of their own (the prize pool as the players see it) and send:
 * a QR sign-up's new player, their registration, and a player's request. The tournament, club and
 * season reads come from those features' hooks.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreatePendingActionInput } from "@shared/api/pending-actions";
import type { CreatePlayerInput } from "@shared/api/players";
import type { PublicRegistrationInput } from "@shared/api/registrations";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { invalidatePlayers, invalidateTournament } from "@/lib/api/invalidate";
import { liveRegistrationsInterval, unlessRefused } from "@/lib/live-refresh";
import { createPlayer, publicTournamentQueries, registerForTournament, requestPlayerAction } from "./api";

/**
 * The prize pool as the players see it. Followed like the registrations it is worked out from: asked
 * again every LIVE_REFRESH_MS while the tournament is open (a payment confirmed at the desk or a manual
 * pool changes it), and once more whenever its results are written (the page's useRegistrations
 * refreshes the prize pool's key then).
 */
export function usePublicPrizes(
  tournamentId: string,
  { follow, enabled = true }: { follow?: Pick<TournamentDetailDto, "status" | "finalizedAt">; enabled?: boolean } = {},
) {
  return useQuery({
    ...publicTournamentQueries.prizes(tournamentId),
    enabled: enabled && Boolean(tournamentId),
    refetchInterval: ({ state }) => unlessRefused(state.error, liveRegistrationsInterval(follow)),
  });
}

/** The QR sign-up's new player (or the stored one with the same name and phone). */
export function useCreatePlayer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePlayerInput) => createPlayer(input),
    // Not awaited: the next step needs nothing fresh, and a slow refetch must not hold the player up.
    onSuccess: () => void invalidatePlayers(queryClient),
  });
}

export function useRegisterForTournament(tournamentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PublicRegistrationInput) => registerForTournament(tournamentId, input),
    onSuccess: () => void invalidateTournament(queryClient, tournamentId),
  });
}

export function useRequestPlayerAction(tournamentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePendingActionInput) => requestPlayerAction(tournamentId, input),
    onSuccess: () => void invalidateTournament(queryClient, tournamentId),
  });
}
