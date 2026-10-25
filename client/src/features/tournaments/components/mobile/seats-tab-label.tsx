import { useSeatingTabAlert } from "@/features/seating/components/seating-tab-label";
import type { PublicRegistration } from "@shared/api/public";
import type { TournamentDetailDto } from "@shared/api/tournaments";

interface SeatsTabLabelProps {
  tournament: TournamentDetailDto;
  registrations: readonly PublicRegistration[];
  /** The Seats tab is the one shown: its panel follows the seating itself. */
  panelOpen: boolean;
}

/**
 * "Seats" in the phone's tab bar, with a dot when the seating needs the TD (seatingAlert: a table to
 * open, the final table, a table to break, players waiting, uneven tables), said in words to a screen
 * reader. Like the wide screen's tab name it follows the seating while another tab is open (useSeatingTabAlert).
 */
export function SeatsTabLabel(props: SeatsTabLabelProps) {
  const alert = useSeatingTabAlert(props);
  return (
    <span>
      Seats
      {alert ? (
        <>
          <span aria-hidden="true" className="ml-1 inline-block h-2 w-2 rounded-full bg-destructive align-middle" data-testid="seats-tab-alert" />
          <span className="sr-only">, {alert}</span>
        </>
      ) : null}
    </span>
  );
}
