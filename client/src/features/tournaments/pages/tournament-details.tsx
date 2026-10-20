import { useRef, useState } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { LiveStatus } from "@/components/shared/live-status";
import { TabHost } from "@/components/shared/tab-host";
import { LoadingRows, PAGE_STATE_CLASS, QueryState } from "@/components/shared/query-state";
import { useToast } from "@/hooks/use-toast";
import { routes } from "@/app/routes";
import { usePageMeta } from "@/app/page-meta";
import { useClub } from "@/features/clubs/hooks";
import { useSeason } from "@/features/seasons/hooks";
import { errorMessage } from "@/lib/api/http";
import { clubTimeZone } from "@/lib/format";
import { liveRegistrationsInterval, liveTournamentInterval } from "@/lib/live-refresh";
import { tournamentMoney } from "@/lib/prize-pool";
import type { PublicRegistration } from "@shared/api/public";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { toCents } from "@shared/domain/money";
import { nextHighHandAward, rakeLabel } from "@shared/domain/prize-pool";
import { isClosedStatus } from "@shared/domain/tournaments";
import { ActivityFeed } from "../components/activity-feed";
import { EditTournamentDialog } from "../components/edit-tournament-dialog";
import { AwardHighHandDialog } from "../components/desk/award-high-hand-dialog";
import { DeskActions, type WaitingCount } from "../components/desk/desk-actions";
import { LockPoolDialog } from "../components/desk/lock-pool-dialog";
import { OverviewTab } from "../components/desk/overview-tab";
import { RegisterPlayerDialog } from "../components/desk/register-player-dialog";
import { StatsStrip } from "../components/desk/stats-strip";
import { TournamentActionsBar, type DeskDialog } from "../components/desk/tournament-actions-bar";
import { CorrectResultsDialog } from "../components/finalize/correct-results-dialog";
import { FinalizeDialog } from "../components/finalize/finalize-dialog";
import { StandingsTable } from "../components/standings/standings-table";
import { TournamentNotFound } from "../components/tournament-not-found";
import { finishersOf } from "../components/standings/standings-order";
import { useRegistrations, useTournament } from "../hooks";
import { potCheckOf, useDeleteTournament, useRefreshPot, useUpdateTournament, useWaitingRequests, type PotCheck } from "../staff-hooks";
import { qk } from "@/lib/api/query-keys";

/** The TD's screen on the night: the tournament, its players, its pool and everything done with them. */
export default function TournamentDetailsPage() {
  const { id = "" } = useParams<{ id: string }>();
  const tournament = useTournament(id, { live: true });
  // Asked for alongside the tournament, and polled while it runs, like the public page: QR sign-ups and
  // requests confirmed on another device change the pool, and what the TD reads out must be what the
  // server pays (P2REV1-MONEY-01); fetched again once it closes or its results are corrected.
  const registrations = useRegistrations(id, { follow: tournament.data });
  usePageMeta({ title: tournament.data?.name ?? "Tournament" });

  return (
    <QueryState
      query={tournament}
      loading={<LoadingRows rows={6} />}
      errorTitle="The tournament could not be loaded"
      notFound={<TournamentNotFound />}
      stateClassName={PAGE_STATE_CLASS}
    >
      {(data) => <TournamentDesk tournament={data} registrations={registrations} />}
    </QueryState>
  );
}

interface TournamentDeskProps {
  tournament: TournamentDetailDto;
  registrations: UseQueryResult<PublicRegistration[]>;
}

function TournamentDesk({ tournament, registrations }: TournamentDeskProps) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [dialog, setDialog] = useState<DeskDialog | null>(null);
  // Edit and Delete are chosen from the header's More menu below the one-row width: focus goes back to it after.
  const moreMenu = useRef<HTMLButtonElement>(null);
  const closed = isClosedStatus(tournament.status);
  const canManage = tournament.viewer.canManage;
  const club = useClub(tournament.clubId);
  const season = useSeason(tournament.seasonId);
  // Player requests still waiting (staff only): ending the tournament discards them, so the page says how many.
  const followsRequests = canManage && !closed;
  const waiting = useWaitingRequests(tournament.id, { enabled: followsRequests });
  // Not a 0 before the count is in, nor after it failed (P3REV3-CQ-05); nothing waits on a closed tournament.
  const waitingCount: WaitingCount = !followsRequests ? 0 : waiting.data ? waiting.data.length : waiting.isError ? "failed" : "loading";
  const update = useUpdateTournament(tournament.id);
  const remove = useDeleteTournament(tournament.id, { leave: () => navigate(routes.tournaments()) });
  const refreshPot = useRefreshPot(tournament.id);
  // Undefined until the players are in: the header's Start and Correct Results wait for them (P3REV3-CQ-05).
  const players = registrations.data;

  const changeStatus = (status: "in_progress" | "registration") =>
    update.mutate(
      { status },
      {
        onSuccess: () => toast({ title: "Tournament status updated successfully" }),
        onError: (error) =>
          toast({ title: "Could not change the status", description: errorMessage(error, "Failed to update tournament"), variant: "destructive" }),
      },
    );

  const deleteTournament = async () => {
    await remove.mutateAsync();
    toast({ title: "Tournament deleted successfully" });
  };

  const openDialog = (next: DeskDialog) => {
    // The award is worked out from the pot as it is now: the dialog says it is checking until the pot is in.
    if (next === "highHand") refreshPot.mutate();
    setDialog(next);
  };
  const dialogProps = (which: DeskDialog) => ({ open: dialog === which, onOpenChange: (open: boolean) => setDialog(open ? which : null) });

  return (
    <>
      <PageHeader
        title={tournament.name}
        back={{ href: routes.tournaments(), label: "Tournaments" }}
        description={
          <>
            {/* Beside the title, not among the actions: they keep to one row on a laptop (lead's visual review, item 3). */}
            <StatusBadge status={tournament.status} className="mr-2 align-middle" />
            <span>{club.data?.name ?? ""}</span>
            {season.data ? <span className="hidden sm:inline"> • Season: {season.data.name}</span> : null}
          </>
        }
        actions={
          <TournamentActionsBar
            tournament={tournament}
            totalPlayers={players?.length}
            waitingRequests={waitingCount}
            hasFinishers={players ? finishersOf(players).length > 0 : undefined}
            statusChanging={update.isPending}
            onStatusChange={changeStatus}
            onOpen={openDialog}
            moreMenuRef={moreMenu}
          />
        }
      />

      <div className="px-4 py-6 sm:px-6 lg:px-8">
        <LiveStatus
          follows={[
            { queryKey: qk.tournaments.detail(tournament.id), interval: liveTournamentInterval(tournament) },
            { queryKey: qk.tournaments.registrations(tournament.id), interval: liveRegistrationsInterval(tournament) },
          ]}
          timeZone={clubTimeZone(club.data)}
          className="mb-4"
        />
        <QueryState query={registrations} loading={<LoadingRows rows={4} />} errorTitle="The players could not be loaded">
          {(list) => (
            <DeskBody
              tournament={tournament}
              registrations={list}
              rakeLabel={rakeLabel(club.data)}
              timeZone={clubTimeZone(club.data)}
              waitingRequests={waitingCount}
              potCheck={potCheckOf(refreshPot)}
              onCheckPot={() => refreshPot.mutate()}
              dialog={dialog}
              onOpen={openDialog}
              onClose={() => setDialog(null)}
            />
          )}
        </QueryState>
      </div>

      <RegisterPlayerDialog tournamentId={tournament.id} {...dialogProps("register")} />
      <EditTournamentDialog tournament={tournament} club={club.data} returnFocusTo={moreMenu} {...dialogProps("edit")} />
      <FinalizeDialog tournamentId={tournament.id} {...dialogProps("finalize")} />
      <LockPoolDialog tournamentId={tournament.id} locked={tournament.prizePoolLocked === true} {...dialogProps("lock")} />
      <ConfirmDialog
        {...dialogProps("delete")}
        title="Delete Tournament"
        description={`Are you sure you want to delete ${tournament.name}? This action cannot be undone and will remove all associated registrations and data.`}
        confirmLabel="Delete tournament"
        pendingLabel="Deleting…"
        destructive
        returnFocusTo={moreMenu}
        onConfirm={deleteTournament}
      />
    </>
  );
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
  dialog: DeskDialog | null;
  onOpen: (dialog: DeskDialog) => void;
  onClose: () => void;
}

/** Everything worked out from the players: the figures, the tabs, and the dialogs that need the players. */
function DeskBody({ tournament, registrations, rakeLabel: label, timeZone, waitingRequests, potCheck, onCheckPot, dialog, onOpen, onClose }: DeskBodyProps) {
  const closed = isClosedStatus(tournament.status);
  const canManage = tournament.viewer.canManage;
  // The same shared functions finalize pays with: what the TD sees here is what is paid.
  const money = tournamentMoney(tournament, registrations);
  // What the next high-hand winner is awarded, or null once every prize is: the server works it out the same way (MONEY-36).
  const highHandAwards = registrations.filter((registration) => registration.highHandWinner).map((registration) => toCents(registration.highHandAmount));
  const dialogProps = (which: DeskDialog) => ({ open: dialog === which, onOpenChange: (open: boolean) => (open ? onOpen(which) : onClose()) });

  return (
    <div className="space-y-6">
      <StatsStrip
        tournament={tournament}
        money={money}
        totalPlayers={registrations.length}
        rakeLabel={label}
        canEditPlayers={canManage && !closed}
        canEditPool={canManage && !closed && tournament.prizePoolLocked !== true}
      />
      <TabHost
        tabs={[
          {
            value: "overview",
            label: "Overview",
            content: (
              <OverviewTab
                tournament={tournament}
                money={money}
                entrants={registrations.length}
                rakeLabel={label}
                highHandAwardsCents={highHandAwards}
                timeZone={timeZone}
              />
            ),
          },
          {
            value: "standings",
            label: "Standings",
            content: (
              <StandingsTable
                tournamentId={tournament.id}
                registrations={registrations}
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
            content: (
              <DeskActions
                tournament={tournament}
                waitingRequests={waitingRequests}
                onAwardHighHand={() => onOpen("highHand")}
                onLockPool={() => onOpen("lock")}
              />
            ),
          },
        ]}
      />

      <AwardHighHandDialog
        tournamentId={tournament.id}
        registrations={registrations}
        nextAwardCents={nextHighHandAward(money.breakdown.highHand, highHandAwards)}
        potCheck={potCheck}
        onCheckPot={onCheckPot}
        {...dialogProps("highHand")}
      />
      <CorrectResultsDialog tournamentId={tournament.id} finishers={finishersOf(registrations)} {...dialogProps("correct")} />
    </div>
  );
}
