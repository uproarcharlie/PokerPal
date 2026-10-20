/** /api/admin/users*: the platform admin's account list, edits and impersonation (phase2-contracts §2.3). */
import { queryOptions } from "@tanstack/react-query";
import type { AdminUpdateUserInput, AdminUpdateUserResponse, AdminUserRow, ImpersonationResponse } from "@shared/api/admin";
import { apiGet, apiSend, segment } from "@/lib/api/http";
import { qk } from "@/lib/api/query-keys";

const userPath = (id: string) => `/api/admin/users/${segment(id)}`;

export const userQueries = {
  /** Accounts and players in one list, newest first. */
  list: () => queryOptions({ queryKey: qk.admin.users(), queryFn: ({ signal }) => apiGet<AdminUserRow[]>("/api/admin/users", { signal }) }),
};

export const updateUser = ({ id, input }: { id: string; input: AdminUpdateUserInput }) =>
  apiSend<AdminUpdateUserResponse>("PUT", userPath(id), input);

export const impersonateUser = (id: string) => apiSend<ImpersonationResponse>("POST", `${userPath(id)}/impersonate`);
