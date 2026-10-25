import { useRef, useState } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { useLocation, useParams, useSearch } from "wouter";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { LiveStatus } from "@/components/shared/live-status";
import { LoadingRows, PAGE_STATE_CLASS, QueryState } from "@/components/shared/query-state";
import { PHONE_QUERY, useMediaQuery } from "@/components/shared/use-media-query";
import { useToast } from "@/hooks/use-toast";
import { routes } from "@/app/routes";
import { usePageMeta } from "@/app/page-meta";
import { ClubThemeScope } from "@/features/branding/components/public/club-theme-scope";
import { useClub } from "@/features/clubs/hooks";
import { useSeason } from "@/features/seasons/hooks";
import { ClockStatusChip, type ClockOpenRequest } from "@/features/clock/components/clock-status-chip";
import { useAutoSeatNotices } from "@/features/seating/auto-seat-notices";
import { errorMessage } from "@/lib/api/http";
import { clubTimeZone } from "@/lib/format";
import { liveRegistrationsInterval, liveTournamentInterval } from "@/lib/live-refresh";
import { cn } from "@/lib/utils";
import type { PublicRegistration } from "@shared/api/public";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { rakeLabel } from "@shared/domain/prize-pool";
import { isClosedStatus } from "@shared/domain/tournaments";
import { EditTournamentDialog } from "../components/edit-tournament-dialog";
import type { WaitingCount } from "../components/desk/desk-actions";
import { DeskBody } from "../components/desk/desk-body";
import { useDeskDialogs } from "../components/desk/desk-dialogs";
import { deskTabOf, type DeskTab } from "../components/desk/desk-tabs";
import { LockPoolDialog } from "../components/desk/lock-pool-dialog";
import { RegisterPlayerDialog } from "../components/desk/register-player-dialog";
import { TournamentActionsBar } from "../components/desk/tournament-actions-bar";
import { FinalizeDialog } from "../components/finalize/finalize-dialog";
import { MobileHeader } from "../components/mobile/mobile-header";
import { FIRST_PHONE_TAB, phoneTabOf, type PhoneTab } from "../components/mobile/phone-tabs";
import { RequestsSheet } from "../components/mobile/requests-sheet";
import { TournamentNotFound } from "../components/tournament-not-found";
import { finishersOf } from "../components/standings/standings-order";
import { useRegistrations, useTournament } from "../hooks";
import { potCheckOf, useDeleteTournament, useRefreshPot, useUpdateTournament, useWaitingRequests } from "../staff-hooks";
import { qk } from "@/lib/api/query-keys";

/** How far up from the screen's bottom a phone's content stays: the tab bar, the quick-action button and a gap. */
const PHONE_CLEARANCE = "[--desk-bottom-clearance:calc(9rem+env(safe-area-inset-bottom))]";

/** The TD's screen on the night: the tournament, its players, its pool and everything done with them. */
export default function TournamentDetailsPage() {
  const { id = "" } = useParams<{ id: string }>();
  const tournament = useTournament(id, { live: true });
  // Asked for alongside the tournament, and polled while it runs, like the public page: QR sign-ups and
  // requests confirmed on another device change the pool, and what the TD reads out must be what the
  // server pays (P2REV1-MONEY-01); fetched again once it closes or its results are corrected.
  const registrations = useRegistrations(id, { follow: tournament.data });
  usePageMeta({ title: tournament.data?.name ?? "Tournament" });

  // The club's own colours (round 5, item 13) on its tournament pages, in the light or dark the TD chose.
  return (
    <ClubThemeScope clubId={tournament.data?.clubId} scheme="preference">
      <QueryState
        query={tournament}
        loading={<LoadingRows rows={6} />}
        errorTitle="The tournament could not be loaded"
        notFound={<TournamentNotFound />}
        stateClassName={PAGE_STATE_CLASS}
      >
        {(data) => <TournamentDesk tournament={data} registrations={registrations} />}
      </QueryState>
    </ClubThemeScope>
  );
}

interface TournamentDeskProps {
  tournament: TournamentDetailDto;
  registrations: UseQueryResult<PublicRegistration[]>;
}

function TournamentDesk({ tournament, registrations }: TournamentDeskProps) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  // A phone gets its own layout (round5-contracts §8.1): a sticky header with the clock, a bottom tab
  // bar and the quick actions. From tablet width the page is as it was.
  const phone = useMediaQuery(PHONE_QUERY);
  // The tab lives in the address (?tab=clock), so a reload, or a phone bringing a dropped page back,
  // reopens the Clock or the seating, not the Overview (P4REV0-TAB-RESET). Each layout reads the other's names.
  const tabParam = new URLSearchParams(useSearch()).get("tab");
  const deskTab = deskTabOf(tabParam);
  const phoneTab = phoneTabOf(tabParam);
  const setTab = (next: DeskTab | PhoneTab) => {
    const first = phone ? FIRST_PHONE_TAB : "overview";
    navigate(routes.tournamentAdmin(tournament.id, next === first ? undefined : next), { replace: true });
  };
  // The last tap on the header's clock chip (a new one each tap): the Clock tab brings Start / Pause into view.
  const [clockOpen, setClockOpen] = useState<ClockOpenRequest | null>(null);
  const openClock = (request: ClockOpenRequest) => {
    setTab("clock");
    setClockOpen(request);
  };
  // Edit and Delete are chosen from the header's More menu below the one-row width: focus goes back to it after.
  const moreMenu = useRef<HTMLButtonElement>(null);
  // On a phone the sheets chosen from the quick-action button's menu give focus back to it.
  const quickActions = useRef<HTMLButtonElement>(null);
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
  // The award is worked out from the pot as it is now: the dialog says it is checking until the pot is in.
  const dialogs = useDeskDialogs({
    onShow: (dialog) => {
      if (dialog === "highHand") refreshPot.mutate();
    },
  });
  // Undefined until the players are in: the header's Start and Correct Results wait for them (P3REV3-CQ-05).
  const players = registrations.data;
  // "Test Player 16 seated at Table 2, Seat 7" as QR sign-ups are seated by themselves (round 5, item 9).
  useAutoSeatNotices(tournament.id, { enabled: canManage && !closed });

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

  const actions = (layout: "bar" | "stack") => (
    <TournamentActionsBar
      tournament={tournament}
      totalPlayers={players?.length}
      waitingRequests={waitingCount}
      hasFinishers={players ? finishersOf(players).length > 0 : undefined}
      statusChanging={update.isPending}
      onStatusChange={changeStatus}
      onOpen={dialogs.show}
      moreMenuRef={moreMenu}
      layout={layout}
    />
  );

  return (
    <>
      {phone ? (
        <MobileHeader tournament={tournament} waitingRequests={waitingCount} onOpenClock={openClock} onOpenRequests={() => dialogs.show("requests")} />
      ) : (
        <PageHeader
          title={tournament.name}
          back={{ href: routes.tournaments(), label: "Tournaments" }}
          description={
            <>
              {/* Beside the title, not among the actions: they keep to one row on a laptop (lead's visual review, item 3). */}
              <StatusBadge status={tournament.status} className="mr-2 align-middle" />
              {/* The clock at a glance (nothing until it is set up): tapping it opens the Clock tab. */}
              <span className="mr-2 inline-flex align-middle empty:hidden">
                <ClockStatusChip tournamentId={tournament.id} onOpen={openClock} />
              </span>
              <span>{club.data?.name ?? ""}</span>
              {season.data ? <span className="hidden sm:inline"> • Season: {season.data.name}</span> : null}
            </>
          }
          actions={actions("bar")}
        />
      )}

      {/*
        On a phone the page ends clear of the tab bar and the quick-action button over it; what sticks to
        the bottom inside a tab (the seating's selection bar) keeps clear of them with --desk-bottom-clearance.
      */}
      <div className={cn("px-4 sm:px-6 lg:px-8", phone ? `${PHONE_CLEARANCE} pb-[var(--desk-bottom-clearance)] pt-4` : "py-6")}>
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
              dialogs={dialogs}
              tab={deskTab}
              onTabChange={setTab}
              clockOpenRequest={clockOpen}
              phone={
                phone
                  ? {
                      tab: phoneTab,
                      controls: actions("stack"),
                      clubName: club.data?.name ?? "",
                      seasonName: season.data?.name ?? null,
                      quickActionsRef: quickActions,
                    }
                  : null
              }
            />
          )}
        </QueryState>
      </div>

      <RegisterPlayerDialog
        tournamentId={tournament.id}
        onOpenSeating={() => setTab("seating")}
        returnFocusTo={phone ? quickActions : undefined}
        {...dialogs.propsFor("register")}
      />
      {followsRequests ? (
        <RequestsSheet tournament={tournament} timeZone={clubTimeZone(club.data)} returnFocusTo={quickActions} {...dialogs.propsFor("requests")} />
      ) : null}
      <EditTournamentDialog tournament={tournament} club={club.data} returnFocusTo={moreMenu} {...dialogs.propsFor("edit")} />
      <FinalizeDialog tournamentId={tournament.id} {...dialogs.propsFor("finalize")} />
      <LockPoolDialog tournamentId={tournament.id} locked={tournament.prizePoolLocked === true} {...dialogs.propsFor("lock")} />
      <ConfirmDialog
        {...dialogs.propsFor("delete")}
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
