import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PlayersQuery } from "@shared/api/players";
import { invalidatePlayers } from "@/lib/api/invalidate";
import { playerQueries, updatePlayer } from "./api";

export const usePlayers = (query: PlayersQuery, { enabled = true }: { enabled?: boolean } = {}) =>
  useQuery({ ...playerQueries.list(query), enabled });

/** Saves a player and refreshes every list that shows them by name or photo. */
export function useUpdatePlayer() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: updatePlayer, onSuccess: () => invalidatePlayers(queryClient) });
}
