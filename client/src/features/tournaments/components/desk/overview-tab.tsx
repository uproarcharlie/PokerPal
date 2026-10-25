import type { TournamentDetailDto } from "@shared/api/tournaments";
import type { Cents } from "@shared/domain/money";
import type { TournamentMoney } from "@/lib/prize-pool";
import { ApPanel } from "@/features/prize-pool/components/ap-panel";
import { PaidPlayersNote } from "@/features/prize-pool/components/paid-players-note";
import { usePrizePool } from "@/features/prize-pool/hooks";
import { isClosedStatus } from "@shared/domain/tournaments";
import { PrizePoolCalculator } from "../prize-pool/prize-pool-calculator";
import { PrizeStructureCard } from "../prize-pool/prize-structure-card";
import { TournamentInfoCard } from "./tournament-info-card";
import { offersHighHand } from "@shared/domain/player-actions";

interface OverviewTabProps {
  tournament: TournamentDetailDto;
  money: TournamentMoney;
  /** The players in the field (the waiting list behind a full one is not). */
  entrants: number;
  rakeLabel: string;
  highHandAwardsCents: readonly Cents[];
  timeZone: string;
  /** Its details card at the end (the default); the phone's Money tab leaves it to the More tab. */
  withDetails?: boolean;
  /** The phone desk's Take payment sheet, for the paid-players note (else it leads to the payment desk). */
  onTakePayments?: () => void;
}

/**
 * Whose money is in the pool (only paid players', round 6), what the tournament pays, how the pool is
 * worked out and the AP taken from it, then its details. How it is worked out and the AP are the club
 * staff's: anyone else is shown what it pays (round 6, the owner's rule: the AP is staff-only).
 */
export function OverviewTab({ tournament, money, entrants, rakeLabel, highHandAwardsCents, timeZone, withDetails = true, onTakePayments }: OverviewTabProps) {
  const canManage = tournament.viewer.canManage;
  // The season money carried over goes to, by name ("Carried over to Winter League"), as the server words it.
  const carryTarget = usePrizePool(tournament.id, { follow: tournament, enabled: canManage }).data?.carryTarget;
  return (
    <div className="space-y-6">
      {canManage && !isClosedStatus(tournament.status) ? (
        <PaidPlayersNote tournamentId={tournament.id} paid={money.breakdown.counts.registrations} entrants={entrants} onTakePayments={onTakePayments} />
      ) : null}
      <PrizeStructureCard
        display={money.display}
        entrants={entrants}
        highHandAmount={offersHighHand(tournament) ? tournament.highHandAmount : null}
        tournament={tournament}
      />
      {/* Side by side on a wide screen: how the pool is worked out, and the AP the club takes (and adjusts) from it. */}
      {canManage ? (
        <div className="grid items-start gap-6 xl:grid-cols-2">
          <PrizePoolCalculator
            tournament={tournament}
            breakdown={money.breakdown}
            display={money.display}
            rakeLabel={rakeLabel}
            highHandAwardsCents={highHandAwardsCents}
            carryTarget={carryTarget}
          />
          <ApPanel tournament={tournament} />
        </div>
      ) : null}
      {withDetails ? <TournamentInfoCard tournament={tournament} timeZone={timeZone} /> : null}
    </div>
  );
}
