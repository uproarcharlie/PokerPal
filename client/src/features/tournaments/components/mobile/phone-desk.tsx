import type { ReactNode, RefObject } from "react";
import { Armchair, Banknote, Menu, Timer, Users } from "lucide-react";
import { TabHost } from "@/components/shared/tab-host";
import { ClockPanel } from "@/features/clock/components/clock-panel";
import type { ClockOpenRequest } from "@/features/clock/components/clock-status-chip";
import { SeatingPanel } from "@/features/seating/components/seating-panel";
import { useSeating } from "@/features/seating/staff-hooks";
import { plural } from "@/lib/format";
import type { TournamentMoney } from "@/lib/prize-pool";
import type { PublicRegistration } from "@shared/api/public";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import type { Cents } from "@shared/domain/money";
import { isClosedStatus } from "@shared/domain/tournaments";
import { acceptRefusal } from "@shared/domain/waiting-list";
import { lineupOf, type Lineup } from "@/features/public-tournament/waiting-list";
import type { WaitingCount } from "../desk/desk-actions";
import type { DeskDialogs } from "../desk/desk-dialogs";
import { StandingsTable } from "../standings/standings-table";
import { BustSheet } from "./bust-sheet";
import { MoneyTab } from "./money-tab";
import { MoreTab } from "./more-tab";
import { PaymentsSheet } from "./payments-sheet";
import { isPhoneTab, type PhoneTab } from "./phone-tabs";
import { QuickActions } from "./quick-actions";
import { SeatsTabLabel } from "./seats-tab-label";
import { TopUpSheet } from "./top-up-sheet";

interface PhoneDeskProps {
  tournament: TournamentDetailDto;
  registrations: readonly PublicRegistration[];
  money: TournamentMoney;
  rakeLabel: string;
  timeZone: string;
  highHandAwardsCents: readonly Cents[];
  waitingRequests: WaitingCount;
  tab: PhoneTab;
  onTabChange: (tab: PhoneTab) => void;
  /** The header clock's last tap: the Clock tab then brings Start / Pause into view. */
  clockOpenRequest: ClockOpenRequest | null;
  /** The More tab's status and settings buttons. */
  controls: ReactNode;
  clubName: string;
  seasonName: string | null;
  dialogs: DeskDialogs;
  /** The quick-action button: the sheets opened from its menu (here and the page's) give focus back to it. */
  quickActionsRef: RefObject<HTMLButtonElement>;
}

/**
 * "18 players · 12 still in · max 18 · 2 on the waiting list": the field at a glance, above the
 * standings. The waiting list behind a full field is not in the field (round 5, item 15).
 */
function fieldText(tournament: TournamentDetailDto, lineup: Lineup<PublicRegistration>): string {
  const stillIn = lineup.field.filter((registration) => !registration.isEliminated).length;
  return [
    plural(lineup.field.length, "player"),
    `${stillIn} still in`,
    ...(tournament.maxPlayers ? [`max ${tournament.maxPlayers}`] : []),
    ...(lineup.waiting.length > 0 ? [`${lineup.waiting.length} on the waiting list`] : []),
  ].join(" · ");
}

/**
 * The TD's tournament page on a phone (round5-contracts §8.1): five tabs in a bottom bar (Players,
 * Seats, Clock, Money, More), each one the wide screen's tools for that part of the night, and the
 * quick-action button above the bar for the taps made most (register, bust, re-buy, add-on, take a
 * payment, requests), each opening a full-screen sheet. Hidden tabs leave the page, except the clock (a half-typed
 * structure edit survives a look at the players).
 */
export function PhoneDesk({
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
  controls,
  clubName,
  seasonName,
  dialogs,
  quickActionsRef,
}: PhoneDeskProps) {
  const closed = isClosedStatus(tournament.status);
  const canManage = tournament.viewer.canManage;
  const desk = canManage && !closed;
  // Busts and re-buys are for the field: a waiting-list player is not playing yet.
  const lineup = lineupOf(registrations, tournament.maxPlayers);
  // Who sits where, for the bust sheet: their seat under their name, their table's players first.
  const seating = useSeating(tournament.id, { enabled: desk });
  const seatOf = desk ? seating.data?.seatByRegistrationId : undefined;
  // "Once they've paid": confirming the payment is what seats a late arrival, so the menu says how many wait for it.
  const awaitingPayment = desk && seating.data?.settings.autoSeat === "once_paid" ? seating.data.advisor.notArrived : 0;

  return (
    <>
      <TabHost
        variant="bottom-bar"
        label="Tournament sections"
        value={tab}
        onValueChange={(value) => {
          if (!isPhoneTab(value)) return;
          onTabChange(value);
          // Each tab opens at its top, not part-way down where the last one was left.
          const page = document.getElementById("main");
          if (page) page.scrollTop = 0;
        }}
        tabs={[
          {
            value: "players",
            label: "Players",
            icon: Users,
            content: (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground" data-testid="field-summary">
                  {fieldText(tournament, lineup)}
                </p>
                <StandingsTable
                  tournamentId={tournament.id}
                  registrations={registrations}
                  maxPlayers={tournament.maxPlayers}
                  canManage={canManage}
                  closed={closed}
                  completed={tournament.status === "completed"}
                />
              </div>
            ),
          },
          {
            value: "seating",
            label: <SeatsTabLabel tournament={tournament} registrations={registrations} panelOpen={tab === "seating"} />,
            icon: Armchair,
            content: <SeatingPanel tournament={tournament} registrations={registrations} />,
          },
          { value: "clock", label: "Clock", icon: Timer, content: <ClockPanel tournament={tournament} openRequest={clockOpenRequest} />, keepMounted: true },
          {
            value: "money",
            label: "Money",
            icon: Banknote,
            content: (
              <MoneyTab
                tournament={tournament}
                registrations={registrations}
                money={money}
                rakeLabel={rakeLabel}
                timeZone={timeZone}
                highHandAwardsCents={highHandAwardsCents}
              />
            ),
          },
          {
            value: "more",
            label: "More",
            icon: Menu,
            content: (
              <MoreTab
                tournament={tournament}
                controls={controls}
                clubName={clubName}
                seasonName={seasonName}
                timeZone={timeZone}
                waitingRequests={waitingRequests}
                onAwardHighHand={() => dialogs.show("highHand")}
                onLockPool={() => dialogs.show("lock")}
              />
            ),
          },
        ]}
      />

      {desk ? (
        <>
          <QuickActions tournament={tournament} waitingRequests={waitingRequests} awaitingPayment={awaitingPayment} onOpen={dialogs.show} triggerRef={quickActionsRef} />
          <BustSheet tournamentId={tournament.id} registrations={lineup.field} seatOf={seatOf} returnFocusTo={quickActionsRef} {...dialogs.propsFor("bust")} />
          <TopUpSheet
            tournament={tournament}
            kind={dialogs.current === "rebuy" || dialogs.current === "addon" ? dialogs.current : null}
            registrations={lineup.field}
            onClose={dialogs.close}
            returnFocusTo={quickActionsRef}
          />
          <PaymentsSheet
            tournamentId={tournament.id}
            timeZone={timeZone}
            full={acceptRefusal(registrations, tournament.maxPlayers)}
            returnFocusTo={quickActionsRef}
            {...dialogs.propsFor("payments")}
          />
        </>
      ) : null}
    </>
  );
}
