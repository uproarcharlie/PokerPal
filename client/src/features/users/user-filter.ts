import { USER_ROLES, type AdminUserRow } from "@shared/api/admin";
import { roleLabel } from "./roles";

export const TYPE_OPTIONS = [
  { value: "all", label: "All Types" },
  { value: "user", label: "Users" },
  { value: "player", label: "Club Members" },
] as const;

/** Each role an admin can give an account, named as the users table names it: one list for every menu (P3REV6-CQ-08). */
export const ROLE_CHOICES = USER_ROLES.map((role) => ({ value: role, label: roleLabel(role) }));

export const ROLE_OPTIONS = [{ value: "all", label: "All Roles" } as const, ...ROLE_CHOICES];

export interface UserFilter {
  search: string;
  type: (typeof TYPE_OPTIONS)[number]["value"];
  role: (typeof ROLE_OPTIONS)[number]["value"];
}

export const NO_FILTER: UserFilter = { search: "", type: "all", role: "all" };

/** The option `value` names, if it is one of `options` (a Select hands back plain strings). */
export function optionOf<T extends { value: string }>(options: readonly T[], value: string): T["value"] | undefined {
  return options.find((option) => option.value === value)?.value;
}

/** The rows `filter` keeps: the search in the name or email, and the chosen type and role. */
export function filterUsers(rows: readonly AdminUserRow[], filter: UserFilter): AdminUserRow[] {
  const search = filter.search.trim().toLowerCase();
  return rows.filter(
    (row) =>
      (row.name.toLowerCase().includes(search) || (row.email ?? "").toLowerCase().includes(search)) &&
      (filter.type === "all" || row.type === filter.type) &&
      (filter.role === "all" || row.role === filter.role),
  );
}
