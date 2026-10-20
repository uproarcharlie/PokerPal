import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { routes } from "@/app/routes";
import { useAuth } from "@/contexts/auth-context";
import { invalidateUsers } from "@/lib/api/invalidate";
import { pageNavigation } from "@/lib/page-navigation";
import { impersonateUser, updateUser, userQueries } from "./api";

export const useAdminUsers = () => useQuery(userQueries.list());

/** Saves an account; an admin's edit of their own row shows at once in the sidebar too. */
export function useUpdateUser() {
  const queryClient = useQueryClient();
  const { updateSessionUser } = useAuth();
  return useMutation({
    mutationFn: updateUser,
    onSuccess: ({ user }) => {
      updateSessionUser(user);
      return invalidateUsers(queryClient);
    },
  });
}

/**
 * Starts viewing the app as another account. The whole app is loaded afresh on the staff home page,
 * so nothing fetched as the admin is shown as theirs, and a person who is not an admin does not land
 * on the admin-only user list (which would send them to the public directory).
 */
export function useImpersonateUser() {
  return useMutation({
    mutationFn: impersonateUser,
    onSuccess: () => pageNavigation.assign(routes.staffHome()),
  });
}
