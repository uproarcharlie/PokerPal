import type { TournamentDetailDto } from "@shared/api/tournaments";
import type { Cents } from "@shared/domain/money";
import type { TournamentMoney } from "@/lib/prize-pool";
import { ApPanel } from "@/features/prize-pool/components/ap-panel";
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

/** What the tournament pays, how the pool is worked out and the AP taken from it, then its details. */
export function OverviewTab({ tournament, money, entrants, rakeLabel, highHandAwardsCents, timeZone }: OverviewTabProps) {
  return (
    <div className="space-y-6">
      <PrizeStructureCard
        display={money.display}
        entrants={entrants}
        highHandAmount={offersHighHand(tournament) ? tournament.highHandAmount : null}
      />
      {/* Side by side on a wide screen: how the pool is worked out, and the AP the club takes (and adjusts) from it. */}
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <PrizePoolCalculator
          tournament={tournament}
          breakdown={money.breakdown}
          display={money.display}
          rakeLabel={rakeLabel}
          highHandAwardsCents={highHandAwardsCents}
        />
        <ApPanel tournament={tournament} />
      </div>
      <TournamentInfoCard tournament={tournament} timeZone={timeZone} />
    </div>
  );
}
