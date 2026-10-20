import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import { invalidateUsers } from "@/lib/api/invalidate";
import { changePassword, updateProfile } from "./api";

/** Saves the profile and shows the saved name and email everywhere at once (no reload). */
export function useUpdateProfile() {
  const queryClient = useQueryClient();
  const { updateSessionUser } = useAuth();
  return useMutation({
    mutationFn: updateProfile,
    onSuccess: ({ user }) => {
      updateSessionUser(user);
      // An admin's own row in the user list.
      void invalidateUsers(queryClient);
    },
  });
}

export const useChangePassword = () => useMutation({ mutationFn: changePassword });
