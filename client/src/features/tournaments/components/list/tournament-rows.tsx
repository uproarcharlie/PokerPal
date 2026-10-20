import { useRef } from "react";
import { Link } from "wouter";
import { Edit, ExternalLink, Link as LinkIcon, MoreVertical, QrCode, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCopyLink } from "@/components/shared/copy-link-button";
import { MoneyText } from "@/components/shared/money-text";
import { ResponsiveTable, type ResponsiveColumn } from "@/components/shared/responsive-table";
import { absoluteUrl, routes } from "@/app/routes";
import type { ClubDto } from "@shared/api/public";
import type { TournamentListItemDto } from "@shared/api/tournaments";
import { clubColumn, ManageLink, playersColumn, startColumn, statusColumn } from "./tournament-columns";

interface TournamentRowsProps {
  tournaments: readonly TournamentListItemDto[];
  clubsById: ReadonlyMap<string, ClubDto>;
  /** Edit was chosen from the row's menu; `menu` is the menu's button, where focus goes back after. */
  onEdit: (tournament: TournamentListItemDto, menu: HTMLElement | null) => void;
}

function RowMenu({ tournament, canEdit, onEdit }: { tournament: TournamentListItemDto; canEdit: boolean; onEdit: (menu: HTMLElement | null) => void }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const copy = useCopyLink();

  return (
    // Not modal: Edit opens a dialog, which must get the focus and the pointer.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button ref={trigger} variant="ghost" size="icon" aria-label={`More for ${tournament.name}`}>
          <MoreVertical className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={routes.publicTournament(tournament.id)} data-testid={`public-view-${tournament.id}`}>
            <ExternalLink className="mr-2 h-4 w-4" aria-hidden="true" />
            Public View
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={routes.adminRegistrations(tournament.id)} data-testid={`registrations-${tournament.id}`}>
            <Users className="mr-2 h-4 w-4" aria-hidden="true" />
            Registrations
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => void copy(absoluteUrl(routes.publicRegister(tournament.id)), "Registration")}
          data-testid={`copy-registration-link-${tournament.id}`}
        >
          <LinkIcon className="mr-2 h-4 w-4" aria-hidden="true" />
          Copy Registration Link
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void copy(absoluteUrl(routes.tournamentQr(tournament.id)), "QR page")} data-testid={`copy-qr-link-${tournament.id}`}>
          <QrCode className="mr-2 h-4 w-4" aria-hidden="true" />
          Copy QR Link
        </DropdownMenuItem>
        {canEdit ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onEdit(trigger.current)} data-testid={`edit-tournament-${tournament.id}`}>
              <Edit className="mr-2 h-4 w-4" aria-hidden="true" />
              Edit
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Every tournament: a table from tablet width, a card each on a phone (ResponsiveTable: one copy of each row). */
export function TournamentRows({ tournaments, clubsById, onEdit }: TournamentRowsProps) {
  const clubOf = (tournament: TournamentListItemDto) => clubsById.get(tournament.clubId);

  const columns: ResponsiveColumn<TournamentListItemDto>[] = [
    { id: "name", header: "Tournament", phone: "title", className: "font-medium text-foreground", cell: (tournament) => tournament.name },
    clubColumn(clubOf),
    statusColumn,
    {
      id: "buy-in",
      header: "Buy-in",
      className: "text-sm font-semibold text-foreground",
      cell: (tournament) => <MoneyText amount={tournament.buyInAmount} forceCents />,
    },
    playersColumn,
    startColumn(clubOf),
    {
      id: "actions",
      header: "Actions",
      phone: "actions",
      className: "text-right",
      cell: (tournament) => (
        <div className="flex items-center justify-end gap-2">
          <ManageLink tournament={tournament} />
          <RowMenu
            tournament={tournament}
            canEdit={clubOf(tournament)?.viewer.canManage === true}
            onEdit={(menu) => onEdit(tournament, menu)}
          />
        </div>
      ),
    },
  ];

  return (
    <ResponsiveTable
      rows={tournaments}
      columns={columns}
      rowKey={(tournament) => tournament.id}
      rowProps={(tournament) => ({ "data-testid": `tournament-row-${tournament.id}` })}
      caption="Tournaments"
    />
  );
}
