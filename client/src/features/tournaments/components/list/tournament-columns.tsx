import { Link } from "wouter";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ClubLogo } from "@/components/image/club-logo";
import type { ResponsiveColumn } from "@/components/shared/responsive-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { routes } from "@/app/routes";
import { clubTimeZone, formatDateTime } from "@/lib/format";
import type { ClubDto } from "@shared/api/public";
import type { TournamentListItemDto } from "@shared/api/tournaments";

/**
 * The columns every list of tournaments shares (the tournaments page, the dashboard's active ones), so
 * the club, status, player count, start time and the way in read the same on both (P3REV5-CQ-06).
 */
type Column = ResponsiveColumn<TournamentListItemDto>;
type ClubOf = (tournament: TournamentListItemDto) => ClubDto | undefined;

/**
 * Paid entries for the club's staff, else the field, out of the most allowed, and the waiting list
 * behind a full field ("18/18 · 1 waiting": round 5, item 15), as the server counts it.
 */
export function playersText({ registeredCount, waitingListCount, confirmedPlayerCount, maxPlayers }: TournamentListItemDto): string {
  return `${confirmedPlayerCount ?? registeredCount - waitingListCount}/${maxPlayers}${waitingListCount > 0 ? ` · ${waitingListCount} waiting` : ""}`;
}

export function clubColumn(clubOf: ClubOf): Column {
  return {
    id: "club",
    header: "Club",
    cell: (tournament) => {
      const name = clubOf(tournament)?.name ?? "Unknown Club";
      return (
        <span className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
          <ClubLogo name={name} imageUrl={clubOf(tournament)?.imageUrl} size="sm" />
          {name}
        </span>
      );
    },
  };
}

export const statusColumn: Column = { id: "status", header: "Status", phone: "title", cell: (tournament) => <StatusBadge status={tournament.status} /> };

export const playersColumn: Column = { id: "players", header: "Players", className: "text-sm font-medium text-foreground", cell: playersText };

/** When it starts, in its club's time zone. */
export function startColumn(clubOf: ClubOf): Column {
  return {
    id: "start",
    header: "Start Time",
    className: "text-sm text-muted-foreground",
    cell: (tournament) => formatDateTime(tournament.startDateTime, clubTimeZone(clubOf(tournament))),
  };
}

/** The TD's way into a tournament, named with it so a screen reader's list of links tells them apart (MA-P3REV1-07). */
export function ManageLink({ tournament }: { tournament: TournamentListItemDto }) {
  return (
    <Button asChild variant="ghost">
      <Link href={routes.tournamentAdmin(tournament.id)} data-testid={`view-tournament-${tournament.id}`} aria-label={`Manage ${tournament.name}`}>
        <Settings2 className="mr-1 h-4 w-4" aria-hidden="true" />
        Manage
      </Link>
    </Button>
  );
}
