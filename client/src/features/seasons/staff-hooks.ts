/**
 * The season changes, made by the club's staff, with their invalidation. Apart from hooks.ts so the
 * public pages, which read seasons, never load them.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreatePointsSystemInput } from "@shared/api/points";
import type { UpdateSeasonInput } from "@shared/api/seasons";
import { invalidateSeason, invalidateTournamentLists } from "@/lib/api/invalidate";
import { qk } from "@/lib/api/query-keys";
import { createPointsSystem, createSeason, deletePointsSystem, deleteSeason, updateSeason } from "./staff-api";

export function useCreateSeason() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: createSeason, onSuccess: () => invalidateSeason(queryClient) });
}

export function useUpdateSeason(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateSeasonInput) => updateSeason(id, input),
    onSuccess: () => invalidateSeason(queryClient),
  });
}

/** Its tournaments stay but leave the season (the server unlinks them), so their lists refresh too. */
export function useDeleteSeason(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => deleteSeason(id),
    onSuccess: () => {
      // Dropped rather than refetched: the season is gone (a refetch would answer 404 on the page being
      // left), and the seasons list must not show it again while it reloads.
      queryClient.removeQueries({ queryKey: qk.seasons.detail(id) });
      queryClient.removeQueries({ queryKey: qk.seasons.lists() });
      return Promise.all([invalidateSeason(queryClient), invalidateTournamentLists(queryClient)]);
    },
  });
}

export function useCreatePointsSystem(seasonId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePointsSystemInput) => createPointsSystem(seasonId, input),
    onSuccess: () => invalidateSeason(queryClient),
  });
}

export function useDeletePointsSystem() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: deletePointsSystem, onSuccess: () => invalidateSeason(queryClient) });
}
