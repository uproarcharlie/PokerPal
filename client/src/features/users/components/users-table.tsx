import { Edit, Shield, UserCog } from "lucide-react";
import type { AdminUserRow } from "@shared/api/admin";
import { ResponsiveTable, type ResponsiveColumn } from "@/components/shared/responsive-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { roleLabel } from "../roles";

interface UsersTableProps {
  rows: readonly AdminUserRow[];
  /** The signed-in admin, who cannot view the app as themselves. */
  currentUserId: string | undefined;
  onEdit: (row: AdminUserRow) => void;
  onImpersonate: (row: AdminUserRow) => void;
  impersonating: boolean;
}

/** Whether the server would let an admin view the app as `row` (not a player, themselves, another admin or a disabled account). */
function canImpersonate(row: AdminUserRow, currentUserId: string | undefined): boolean {
  return row.type === "user" && row.id !== currentUserId && row.role !== "admin" && row.isActive === true;
}

/** Every account and player: a table on a laptop, a card each on a phone. */
export function UsersTable({ rows, currentUserId, onEdit, onImpersonate, impersonating }: UsersTableProps) {
  const columns: ResponsiveColumn<AdminUserRow>[] = [
    { id: "name", header: "Name", phone: "title", cell: (row) => <span className="font-medium text-foreground">{row.name}</span> },
    { id: "email", header: "Email", cell: (row) => <span className="break-all">{row.email || "-"}</span> },
    { id: "phone", header: "Phone", cell: (row) => row.phone || "-" },
    {
      id: "type",
      header: "Type",
      cell: (row) => <Badge variant={row.type === "user" ? "default" : "outline"}>{row.type === "user" ? "User" : "Club Member"}</Badge>,
    },
    {
      id: "role",
      header: "Role",
      cell: (row) => (
        <Badge variant={row.role === "admin" ? "default" : "secondary"}>
          {row.role === "admin" ? <Shield className="mr-1 h-3 w-3" aria-hidden="true" /> : null}
          {roleLabel(row.role)}
        </Badge>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => <Badge variant={row.isActive ? "default" : "destructive"}>{row.isActive ? "Active" : "Disabled"}</Badge>,
    },
    {
      id: "last-login",
      header: "Last Login",
      cell: (row) => (row.lastLoginAt ? formatDate(row.lastLoginAt) : row.type === "player" ? "N/A" : "Never"),
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      className: "text-right",
      phone: "actions",
      cell: (row) => (
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="icon" onClick={() => onEdit(row)} aria-label={`Edit ${row.name}`}>
            <Edit className="h-4 w-4" aria-hidden="true" />
          </Button>
          {canImpersonate(row, currentUserId) ? (
            <Button variant="outline" size="icon" onClick={() => onImpersonate(row)} busy={impersonating} aria-label={`View as ${row.name}`}>
              <UserCog className="h-4 w-4" aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return <ResponsiveTable rows={rows} columns={columns} rowKey={(row) => `${row.type}-${row.id}`} caption="Users and club members" />;
}
