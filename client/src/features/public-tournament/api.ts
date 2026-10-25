/**
 * What only the player-facing tournament pages read and send: the club-scoped "find yourself" search,
 * the prize pool as the players see it, and the three public writes (sign-up, registration, a player's
 * request). The tournament, its club, season and points rules come from their own features' queries.
 * Types come only from shared/api.
 */
import { queryOptions } from "@tanstack/react-query";
import type { CreatePendingActionInput, PendingActionDto } from "@shared/api/pending-actions";
import type { CreatePlayerInput, CreatePlayerResponse } from "@shared/api/players";
import type { PublicPrizesDto } from "@shared/api/live-display";
import type { PublicPlayer } from "@shared/api/public";
import type { PublicRegistrationInput, RegistrationCreatedDto } from "@shared/api/registrations";
import { apiGet, apiSend, segment, withQuery } from "@/lib/api/http";
import { qk } from "@/lib/api/query-keys";

export const publicTournamentQueries = {
  /** Players known at the tournament's club whose name contains `q` (everyone, for its staff). */
  playerSearch: (tournamentId: string, q: string) =>
    queryOptions({
      queryKey: qk.tournaments.playerSearch(tournamentId, q),
      queryFn: ({ signal }) =>
        apiGet<PublicPlayer[]>(withQuery(`/api/public/tournaments/${segment(tournamentId)}/players`, { q }), { signal }),
    }),
  /**
   * The prize pool, the places and the money carried in, worked out by the server (round 6: the public
   * are never sent the club's takings to work them out from). Under the prize pool's key, so every
   * change to the tournament's money or results refreshes it with the staff's.
   */
  prizes: (tournamentId: string) =>
    queryOptions({
      queryKey: [...qk.tournaments.prizePool(tournamentId), "public"] as const,
      queryFn: ({ signal }) => apiGet<PublicPrizesDto>(`/api/public/tournaments/${segment(tournamentId)}/prizes`, { signal }),
    }),
};

/** POST /api/players: a new player, or the stored one with the same name and phone (`existing: true`). */
export const createPlayer = (input: CreatePlayerInput) => apiSend<CreatePlayerResponse>("POST", "/api/players", input);

/** POST /api/tournaments/:id/registrations: signs a player up for the tournament, and says where auto-seat put them. */
export const registerForTournament = (tournamentId: string, input: PublicRegistrationInput) =>
  apiSend<RegistrationCreatedDto>("POST", `/api/tournaments/${segment(tournamentId)}/registrations`, input);

/** POST /api/tournaments/:id/pending-actions: a re-buy, add-on or knockout for the TD to confirm. */
export const requestPlayerAction = (tournamentId: string, input: CreatePendingActionInput) =>
  apiSend<PendingActionDto>("POST", `/api/tournaments/${segment(tournamentId)}/pending-actions`, input);
