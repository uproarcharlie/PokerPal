/**
 * What the public tournament pages send: a QR sign-up's new player, their registration, and a
 * player's request. The tournament, club and season reads come from those features' hooks.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreatePendingActionInput } from "@shared/api/pending-actions";
import type { CreatePlayerInput } from "@shared/api/players";
import type { PublicRegistrationInput } from "@shared/api/registrations";
import { invalidatePlayers, invalidateTournament } from "@/lib/api/invalidate";
import { createPlayer, registerForTournament, requestPlayerAction } from "./api";

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
