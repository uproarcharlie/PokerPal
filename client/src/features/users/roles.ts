import type { AdminUserRow } from "@shared/api/admin";

const ROLE_LABELS: Readonly<Record<AdminUserRow["role"], string>> = {
  admin: "Admin",
  full_member: "Full Member",
  club_member: "Club Member",
};

/** An account's or player's role as people read it; an unknown one (legacy data) shows as stored. */
export function roleLabel(role: string): string {
  return role in ROLE_LABELS ? ROLE_LABELS[role as AdminUserRow["role"]] : role.replace(/_/g, " ");
}
