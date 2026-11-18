import { useQuery } from "@tanstack/react-query";
import { EmptyState, LoadingRows, QueryState, type QueryLike } from "@/components/shared/query-state";
import { EditPlayerSheet } from "@/features/players/components/edit-player-sheet";
import type { StaffRegistrationDto } from "@shared/api/registrations";
import { tournamentDeskQueries } from "../../staff-api";
import { contactOf, type FixableEntry } from "./entry-fixes";

interface EntryPlayerSheetProps {
  tournamentId: string;
  /** The entry whose player is being edited; null when closed. */
  entry: FixableEntry | null;
  onClose: () => void;
}

/**
 * The staff's edit-player sheet from a Fix menu (round 9): a payment-desk row brings the player's
 * contact details with it; a standings row carries only their public fields, so their details are read
 * from the desk's list they are on (paid or not) before the form opens with them, never blank (a blank
 * mobile would be saved as removed). The edit names the tournament, whose staff feed says so.
 */
export function EntryPlayerSheet({ tournamentId, entry, onClose }: EntryPlayerSheetProps) {
  const contact = entry ? contactOf(entry) : null;
  const lookingUp = entry !== null && contact === null;
  const paid = entry?.paymentConfirmed === true;
  const confirmed = useQuery({ ...tournamentDeskQueries.confirmedRegistrations(tournamentId), enabled: lookingUp && paid });
  const pending = useQuery({ ...tournamentDeskQueries.pendingRegistrations(tournamentId), enabled: lookingUp && !paid });
  const desk: QueryLike<readonly StaffRegistrationDto[]> = paid ? confirmed : pending;
  const player = contact ?? desk.data?.find((row) => row.id === entry?.id)?.player ?? null;
  const editable = entry && player?.canEdit ? player : null;

  const placeholder =
    entry === null || editable ? undefined : player ? (
      <p className="py-4 text-sm text-muted-foreground" data-testid="edit-player-visiting">
        {player.name} is visiting from another club: their own club edits their details.
      </p>
    ) : (
      <div className="py-4">
        <QueryState query={desk} loading={<LoadingRows rows={3} />} errorTitle="The player's details could not be loaded">
          {() => <EmptyState title="Player not found" description="They are no longer on this tournament's desk: refresh the page." />}
        </QueryState>
      </div>
    );

  return <EditPlayerSheet player={editable} tournamentId={tournamentId} placeholder={placeholder} onClose={onClose} />;
}
