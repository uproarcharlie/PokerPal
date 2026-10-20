import { useState } from "react";
import type { AdminUserRow } from "@shared/api/admin";
import { usePageMeta } from "@/app/page-meta";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, QueryState } from "@/components/shared/query-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/auth-context";
import { EditPlayerSheet } from "@/features/players/components/edit-player-sheet";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api/http";
import { EditUserDialog } from "../components/edit-user-dialog";
import { UserFilters } from "../components/user-filters";
import { UsersTable } from "../components/users-table";
import { useAdminUsers, useImpersonateUser } from "../hooks";
import { filterUsers, NO_FILTER } from "../user-filter";

type Row<T extends AdminUserRow["type"]> = Extract<AdminUserRow, { type: T }>;

/** Platform admins only (the router keeps everyone else out): every account and player, with edits and "view as". */
export default function UserManagementPage() {
  usePageMeta({ title: "User Management" });
  const { user: currentUser } = useAuth();
  const { toast } = useToast();
  const users = useAdminUsers();
  const impersonate = useImpersonateUser();
  const [filter, setFilter] = useState(NO_FILTER);
  const [editingUser, setEditingUser] = useState<Row<"user"> | null>(null);
  const [editingPlayer, setEditingPlayer] = useState<Row<"player"> | null>(null);

  // A club member is a player, not an account: their edit goes to the player (CA-23).
  const edit = (row: AdminUserRow) => (row.type === "user" ? setEditingUser(row) : setEditingPlayer(row));

  const viewAs = (row: AdminUserRow) =>
    impersonate.mutate(row.id, {
      onError: (error) => toast({ title: "Impersonation failed", description: errorMessage(error), variant: "destructive" }),
    });

  return (
    <>
      <PageHeader title="User Management" description="Manage all users, club members, and permissions" />
      <div className="px-4 py-6 sm:px-6 lg:px-8">
        <Card>
          <CardHeader className="space-y-4">
            <div>
              <CardTitle className="text-xl">All Users &amp; Club Members</CardTitle>
              <CardDescription>View and manage all registered users and club members</CardDescription>
            </div>
            <UserFilters value={filter} onChange={setFilter} />
          </CardHeader>
          <CardContent>
            <QueryState
              query={users}
              errorTitle="Users could not be loaded"
              empty={<EmptyState title="No users yet" />}
            >
              {(rows) => {
                const shown = filterUsers(rows, filter);
                return shown.length === 0 ? (
                  <EmptyState title="No users found" description="No one matches this search and these filters." />
                ) : (
                  <UsersTable
                    rows={shown}
                    currentUserId={currentUser?.id}
                    onEdit={edit}
                    onImpersonate={viewAs}
                    impersonating={impersonate.isPending}
                  />
                );
              }}
            </QueryState>
          </CardContent>
        </Card>
      </div>

      <EditUserDialog user={editingUser} currentUserId={currentUser?.id} onClose={() => setEditingUser(null)} />
      <EditPlayerSheet player={editingPlayer} onClose={() => setEditingPlayer(null)} />
    </>
  );
}
