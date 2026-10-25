/**
 * The club hooks only the club's owner and admins use: its staff list, and changes to the club and
 * its staff with their invalidation. Apart from hooks.ts so the public club pages never load them.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ClubStaffDto, CreateStaffInviteInput, UpdateClubInput } from "@shared/api/clubs";
import type { ClubDto } from "@shared/api/public";
import { invalidateClub } from "@/lib/api/invalidate";
import { qk } from "@/lib/api/query-keys";
import {
  clubStaffQueries,
  createClub,
  createStaffInvite,
  deleteClub,
  removeClubManager,
  revokeStaffInvite,
  updateClub,
} from "./staff-api";

/** Only the club's owner and admins may read it (`viewer.canOwn`); anyone else would get a 403. */
export const useClubStaff = (id: string, canOwn: boolean) => useQuery({ ...clubStaffQueries.staff(id), enabled: Boolean(id) && canOwn });

export function useCreateClub() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: createClub, onSuccess: () => invalidateClub(queryClient) });
}

/**
 * Saves the club's settings, from club settings or the AP panel's rename alike. When the save changed
 * its name for the rake, every one of its tournaments' prize pools and live displays shows the new one.
 */
export function useUpdateClub(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateClubInput) => updateClub(id, input),
    onSuccess: (club, input) => {
      const before = queryClient.getQueryData<ClubDto>(qk.clubs.detail(id));
      queryClient.setQueryData(qk.clubs.detail(id), club);
      return invalidateClub(queryClient, { rakeRenamed: input.rakeLabel !== undefined && before?.rakeLabel !== club.rakeLabel });
    },
  });
}

/** Deleting a club also deletes its seasons and tournaments, so those lists refresh too. */
export function useDeleteClub(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => deleteClub(id),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: qk.clubs.detail(id) });
      void invalidateClub(queryClient, { deleted: true });
    },
  });
}

/** Staff changes answer with the club's staff as it now is: shown at once, while everything about the club refreshes. */
function useStaffChange<TInput, TResult>(clubId: string, mutationFn: (input: TInput) => Promise<TResult>, staffOf: (result: TResult) => ClubStaffDto) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (result) => {
      queryClient.setQueryData(qk.clubs.staff(clubId), staffOf(result));
      void invalidateClub(queryClient);
    },
  });
}

export const useInviteStaff = (clubId: string) =>
  useStaffChange(clubId, (input: CreateStaffInviteInput) => createStaffInvite(clubId, input), (response) => response.staff);

export const useRevokeInvite = (clubId: string) =>
  useStaffChange(clubId, (inviteId: string) => revokeStaffInvite(clubId, inviteId), (staff) => staff);

export const useRemoveManager = (clubId: string) =>
  useStaffChange(clubId, (userId: string) => removeClubManager(clubId, userId), (staff) => staff);
