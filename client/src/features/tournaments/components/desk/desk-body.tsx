import type { ReactNode, RefObject } from "react";
import type { ClockOpenRequest } from "@/features/clock/components/clock-status-chip";
import { tournamentMoney } from "@/lib/prize-pool";
import type { PublicRegistration } from "@shared/api/public";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { toCents } from "@shared/domain/money";
import { nextHighHandAward } from "@shared/domain/prize-pool";
import { isClosedStatus } from "@shared/domain/tournaments";
import { lineupOf } from "@/features/public-tournament/waiting-list";
import { CorrectResultsDialog } from "../finalize/correct-results-dialog";
import { PhoneDesk } from "../mobile/phone-desk";
import type { PhoneTab } from "../mobile/phone-tabs";
import { finishersOf } from "../standings/standings-order";
import type { PotCheck } from "../../staff-hooks";
import { AwardHighHandDialog } from "./award-high-hand-dialog";
import type { WaitingCount } from "./desk-actions";
import type { DeskDialogs } from "./desk-dialogs";
import { DeskTabs, type DeskTab } from "./desk-tabs";
import { StatsStrip } from "./stats-strip";

/** On a phone: its tab, the More tab's status and settings buttons, and the quick-action button's ref. */
export interface PhoneLayout {
  tab: PhoneTab;
  controls: ReactNode;
  clubName: string;
  seasonName: string | null;
  quickActionsRef: RefObject<HTMLButtonElement>;
}

interface DeskBodyProps {
  tournament: TournamentDetailDto;
  registrations: readonly PublicRegistration[];
  rakeLabel: string;
  timeZone: string;
  waitingRequests: WaitingCount;
  /** Whether the pot the high-hand dialog shows has been fetched since it opened. */
  potCheck: PotCheck;
  onCheckPot: () => void;
  dialogs: DeskDialogs;
  tab: DeskTab;
  onTabChange: (tab: DeskTab | PhoneTab) => void;
  clockOpenRequest: ClockOpenRequest | null;
  /** The phone's layout (round5-contracts §8.1), or null for the wide one. */
  phone: PhoneLayout | null;
}

/**
 * The TD's page once the players are in: everything worked out from them (the figures, what the next
 * high hand is awarded), the phone's tabs or the wide screen's, and the dialogs that need the players.
 */
export function DeskBody({ tournament, registrations, rakeLabel, timeZone, waitingRequests, potCheck, onCheckPot, dialogs, tab, onTabChange, clockOpenRequest, phone }: DeskBodyProps) {
  const closed = isClosedStatus(tournament.status);
  const canManage = tournament.viewer.canManage;
  // The same shared functions finalize pays with: what the TD sees here is what is paid.
  const money = tournamentMoney(tournament, registrations);
  // The field, and the waiting list behind a full one (round 5, item 15): counted apart.
  const lineup = lineupOf(registrations, tournament.maxPlayers);
  // What the next high-hand winner is awarded, or null once every prize is: the server works it out the same way (MONEY-36).
  const highHandAwards = registrations.filter((registration) => registration.highHandWinner).map((registration) => toCents(registration.highHandAmount));
  const figures = { tournament, registrations, money, rakeLabel, timeZone, highHandAwardsCents: highHandAwards, waitingRequests, clockOpenRequest };

  return (
    <div className="space-y-6">
      {phone ? (
        <PhoneDesk {...figures} {...phone} onTabChange={onTabChange} dialogs={dialogs} />
      ) : (
        <>
          <StatsStrip
            tournament={tournament}
            money={money}
            totalPlayers={lineup.field.length}
            waitingList={lineup.waiting.length}
            rakeLabel={rakeLabel}
            canEditPlayers={canManage && !closed}
            canEditPool={canManage && !closed && tournament.prizePoolLocked !== true}
          />
          <DeskTabs {...figures} tab={tab} onTabChange={onTabChange} onAwardHighHand={() => dialogs.show("highHand")} onLockPool={() => dialogs.show("lock")} />
        </>
      )}

      <AwardHighHandDialog
        tournamentId={tournament.id}
        registrations={registrations}
        nextAwardCents={nextHighHandAward(money.breakdown.highHand, highHandAwards)}
        potCheck={potCheck}
        onCheckPot={onCheckPot}
        {...dialogs.propsFor("highHand")}
      />
      <CorrectResultsDialog tournamentId={tournament.id} finishers={finishersOf(registrations)} {...dialogs.propsFor("correct")} />
    </div>
  );
}
