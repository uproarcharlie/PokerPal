import type { PublicRegistration } from "@shared/api/public";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import type { Cents } from "@shared/domain/money";
import { isClosedStatus } from "@shared/domain/tournaments";
import { lineupOf } from "@/features/public-tournament/waiting-list";
import { TabHost } from "@/components/shared/tab-host";
import { ClockPanel } from "@/features/clock/components/clock-panel";
import type { ClockOpenRequest } from "@/features/clock/components/clock-status-chip";
import { SeatingPanel } from "@/features/seating/components/seating-panel";
import { SeatingTabLabel } from "@/features/seating/components/seating-tab-label";
import type { TournamentMoney } from "@/lib/prize-pool";
import { ActivityFeed } from "../activity-feed";
import { StandingsTable } from "../standings/standings-table";
import { DeskActions, type WaitingCount } from "./desk-actions";
import { OverviewTab } from "./overview-tab";

const DESK_TABS = ["overview", "seating", "clock", "standings", "activity", "actions"] as const;

/** The tab the page shows first, and the one the header's clock chip opens. */
export type DeskTab = (typeof DESK_TABS)[number];

const isDeskTab = (value: string | null): value is DeskTab => (DESK_TABS as readonly (string | null)[]).includes(value);

/** A phone's tab (mobile/phone-tabs) opened here: the tab that holds the same things, so one address works on both. */
const FROM_PHONE: ReadonlyMap<string, DeskTab> = new Map([
  ["players", "standings"],
  ["money", "overview"],
  ["more", "actions"],
]);

/** The tab an address names (`?tab=`), a phone tab's counterpart, or the Overview for none or one the page does not have. */
export const deskTabOf = (value: string | null): DeskTab => (isDeskTab(value) ? value : ((value === null ? undefined : FROM_PHONE.get(value)) ?? "overview"));

interface DeskTabsProps {
  tournament: TournamentDetailDto;
  registrations: readonly PublicRegistration[];
  money: TournamentMoney;
  rakeLabel: string;
  timeZone: string;
  highHandAwardsCents: readonly Cents[];
  waitingRequests: WaitingCount;
  tab: DeskTab;
  onTabChange: (tab: DeskTab) => void;
  /** The header chip's last tap: the Clock tab then brings Start / Pause into view. */
  clockOpenRequest?: ClockOpenRequest | null;
  onAwardHighHand: () => void;
  onLockPool: () => void;
}

/**
 * The TD's tabs, in the order of the night: the money, the tables, the clock, the standings, what
 * happened, and the other tools. Hidden tabs leave the page (a hidden seating plan stops asking the
 * server), except the clock, kept so a half-typed structure edit survives a look at the standings.
 */
export function DeskTabs({
  tournament,
  registrations,
  money,
  rakeLabel,
  timeZone,
  highHandAwardsCents,
  waitingRequests,
  tab,
  onTabChange,
  clockOpenRequest,
  onAwardHighHand,
  onLockPool,
}: DeskTabsProps) {
  const closed = isClosedStatus(tournament.status);
  const canManage = tournament.viewer.canManage;
  return (
    <TabHost
      value={tab}
      onValueChange={(value) => {
        if (isDeskTab(value)) onTabChange(value);
      }}
      tabs={[
        {
          value: "overview",
          label: "Overview",
          content: (
            <OverviewTab
              tournament={tournament}
              money={money}
              entrants={lineupOf(registrations, tournament.maxPlayers).field.length}
              rakeLabel={rakeLabel}
              highHandAwardsCents={highHandAwardsCents}
              timeZone={timeZone}
            />
          ),
        },
        {
          value: "seating",
          label: <SeatingTabLabel tournament={tournament} registrations={registrations} panelOpen={tab === "seating"} />,
          content: <SeatingPanel tournament={tournament} registrations={registrations} />,
        },
        { value: "clock", label: "Clock", content: <ClockPanel tournament={tournament} openRequest={clockOpenRequest} />, keepMounted: true },
        {
          value: "standings",
          label: "Standings",
          content: (
            <StandingsTable
              tournamentId={tournament.id}
              registrations={registrations}
              maxPlayers={tournament.maxPlayers}
              canManage={canManage}
              closed={closed}
              completed={tournament.status === "completed"}
            />
          ),
        },
        { value: "activity", label: "Activity", content: <ActivityFeed tournamentId={tournament.id} live={!closed} /> },
        {
          value: "actions",
          label: "Actions",
          content: <DeskActions tournament={tournament} waitingRequests={waitingRequests} onAwardHighHand={onAwardHighHand} onLockPool={onLockPool} />,
        },
      ]}
    />
  );
}
