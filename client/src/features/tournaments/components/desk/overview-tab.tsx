import type { TournamentDetailDto } from "@shared/api/tournaments";
import type { Cents } from "@shared/domain/money";
import type { TournamentMoney } from "@/lib/prize-pool";
import { PrizePoolCalculator } from "../prize-pool/prize-pool-calculator";
import { PrizeStructureCard } from "../prize-pool/prize-structure-card";
import { TournamentInfoCard } from "./tournament-info-card";
import { offersHighHand } from "@shared/domain/player-actions";

interface OverviewTabProps {
  tournament: TournamentDetailDto;
  money: TournamentMoney;
  entrants: number;
  rakeLabel: string;
  highHandAwardsCents: readonly Cents[];
  timeZone: string;
}

/** What the tournament pays and how the pool is worked out, then its details. */
export function OverviewTab({ tournament, money, entrants, rakeLabel, highHandAwardsCents, timeZone }: OverviewTabProps) {
  return (
    <div className="space-y-6">
      <PrizeStructureCard
        display={money.display}
        entrants={entrants}
        highHandAmount={offersHighHand(tournament) ? tournament.highHandAmount : null}
      />
      <PrizePoolCalculator
        tournament={tournament}
        breakdown={money.breakdown}
        display={money.display}
        rakeLabel={rakeLabel}
        highHandAwardsCents={highHandAwardsCents}
      />
      <TournamentInfoCard tournament={tournament} timeZone={timeZone} />
    </div>
  );
}
