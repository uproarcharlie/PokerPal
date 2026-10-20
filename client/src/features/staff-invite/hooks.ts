import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AcceptStaffInviteInput } from "@shared/api/clubs";
import { invalidateClub } from "@/lib/api/invalidate";
import { acceptStaffInvite } from "./api";

/** Accepting changes which clubs this account runs (its club list and their staff controls). */
export function useAcceptStaffInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AcceptStaffInviteInput) => acceptStaffInvite(input),
    onSuccess: () => void invalidateClub(queryClient),
  });
}
