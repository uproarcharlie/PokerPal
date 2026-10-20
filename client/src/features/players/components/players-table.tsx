import { Edit, Mail, Phone } from "lucide-react";
import type { ClubPlayer } from "@shared/api/players";
import { PlayerAvatar } from "@/components/image/player-avatar";
import { ResponsiveTable, type ResponsiveColumn } from "@/components/shared/responsive-table";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";

interface PlayersTableProps {
  players: readonly ClubPlayer[];
  /** The zone "Joined" dates are shown in (the club's). */
  timeZone: string;
  onEdit: (player: ClubPlayer) => void;
}

function ContactDetails({ player }: { player: ClubPlayer }) {
  if (!player.canEdit) return <span className="text-sm text-muted-foreground">Visiting from another club</span>;
  if (!player.email && !player.phone) return <span className="text-sm text-muted-foreground">No contact info</span>;
  return (
    <div className="space-y-1 text-sm text-foreground">
      {player.email ? (
        <div className="flex items-center justify-end gap-2 break-all md:justify-start">
          <Mail className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>
            <span className="sr-only">Email: </span>
            {player.email}
          </span>
        </div>
      ) : null}
      {player.phone ? (
        <div className="flex items-center justify-end gap-2 md:justify-start">
          <Phone className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>
            <span className="sr-only">Phone: </span>
            {player.phone}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** A club's players: a table on a laptop, a card each on a phone. Contact details only for the club's own players. */
export function PlayersTable({ players, timeZone, onEdit }: PlayersTableProps) {
  const columns: ResponsiveColumn<ClubPlayer>[] = [
    {
      id: "player",
      header: "Player",
      phone: "title",
      cell: (player) => (
        <div className="flex items-center gap-3">
          <PlayerAvatar name={player.name} imageUrl={player.imageUrl} size="md" />
          <div className="min-w-0 text-left">
            <p className="font-medium text-foreground">{player.name}</p>
            <p className="text-xs text-muted-foreground">ID: {player.id.substring(0, 8)}…</p>
          </div>
        </div>
      ),
    },
    { id: "contact", header: "Contact", cell: (player) => <ContactDetails player={player} /> },
    {
      id: "joined",
      header: "Join Date",
      cell: (player) => <span className="text-sm text-muted-foreground">{formatDate(player.createdAt, timeZone)}</span>,
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      className: "text-right",
      phone: "actions",
      cell: (player) =>
        player.canEdit ? (
          <Button variant="ghost" size="sm" onClick={() => onEdit(player)} aria-label={`Edit ${player.name}`} data-testid={`edit-player-${player.id}`}>
            <Edit className="mr-1 h-4 w-4" aria-hidden="true" />
            Edit
          </Button>
        ) : null,
    },
  ];

  return <ResponsiveTable rows={players} columns={columns} rowKey={(player) => player.id} caption="Players" />;
}
