import type { PublicRegistration } from "@shared/api/public";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import type { Cents } from "@shared/domain/money";
import { isClosedStatus } from "@shared/domain/tournaments";
import { lineupOf } from "@/features/public-tournament/waiting-list";
import type { TournamentMoney } from "@/lib/prize-pool";
import { OverviewTab } from "../desk/overview-tab";
import { StatsStrip } from "../desk/stats-strip";
import { PaymentDeskCards } from "../payment-desk/payment-desk-cards";

interface MoneyTabProps {
  tournament: TournamentDetailDto;
  registrations: readonly PublicRegistration[];
  money: TournamentMoney;
  rakeLabel: string;
  timeZone: string;
  highHandAwardsCents: readonly Cents[];
}

/**
 * The phone's Money tab (round5-contracts §8.1): the figures the TD reads out, what the pool pays, the
 * AP and its adjustments, then the payment desk (staff only; followed only while the tab is open).
 */
export function MoneyTab({ tournament, registrations, money, rakeLabel, timeZone, highHandAwardsCents }: MoneyTabProps) {
  const closed = isClosedStatus(tournament.status);
  const canManage = tournament.viewer.canManage;
  // The waiting list behind a full field is not in it (round 5, item 15).
  const lineup = lineupOf(registrations, tournament.maxPlayers);
  return (
    <div className="space-y-6">
      <StatsStrip
        tournament={tournament}
        money={money}
        totalPlayers={lineup.field.length}
        waitingList={lineup.waiting.length}
        rakeLabel={rakeLabel}
        canEditPlayers={canManage && !closed}
        canEditPool={canManage && !closed && tournament.prizePoolLocked !== true}
      />
      <OverviewTab
        tournament={tournament}
        money={money}
        entrants={lineup.field.length}
        rakeLabel={rakeLabel}
        highHandAwardsCents={highHandAwardsCents}
        timeZone={timeZone}
        withDetails={false}
      />
      {canManage ? (
        <section aria-label="Payments" className="space-y-4">
          <PaymentDeskCards tournament={tournament} timeZone={timeZone} />
        </section>
      ) : null}
    </div>
  );
}
