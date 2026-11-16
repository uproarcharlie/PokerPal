/**
 * The club hooks only the club's staff use: its staff list (owner and admins), its bank details
 * (round 8), and changes to the club and its staff with their invalidation. Apart from hooks.ts so the
 * public club pages never load them.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ClubStaffDto, CreateStaffInviteInput, UpdateClubInput, UpdateClubPaymentsInput } from "@shared/api/clubs";
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
  updateClubPayments,
} from "./staff-api";

/** Only the club's owner and admins may read it (`viewer.canOwn`); anyone else would get a 403. */
export const useClubStaff = (id: string, canOwn: boolean) => useQuery({ ...clubStaffQueries.staff(id), enabled: Boolean(id) && canOwn });

/**
 * The club's bank details (round 8): read by its owner, managers and admins (`canManage`; anyone else
 * would get a 403), for the Payments tab and the tournament form's "Show bank transfer details" switch.
 * `fresh`: asked again whenever it is shown or the page is come back to, never kept as fresh. The switch
 * sends the TD to add the details in another tab, whose save only that tab hears of (R8REV1-PHONE-05).
 */
export const useClubPayments = (id: string | undefined, canManage: boolean, { fresh = false }: { fresh?: boolean } = {}) =>
  useQuery({ ...clubStaffQueries.payments(id ?? ""), enabled: Boolean(id) && canManage, ...(fresh ? { staleTime: 0 } : {}) });

/**
 * Saves or removes the club's bank details. The answer is shown at once; the club's other reads
 * refresh, as its tournaments' sign-ups now show the new details (or, removed, none).
 */
export function useUpdateClubPayments(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateClubPaymentsInput) => updateClubPayments(id, input),
    onSuccess: (payments) => {
      queryClient.setQueryData(qk.clubs.payments(id), payments);
      void invalidateClub(queryClient);
    },
  });
}

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
