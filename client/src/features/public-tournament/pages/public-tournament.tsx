import { useParams } from "wouter";
import type { UseQueryResult } from "@tanstack/react-query";
import type { PublicPointsAllocation, PublicPointsSystem, PublicRegistration } from "@shared/api/public";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { isClosedStatus } from "@shared/domain/tournaments";
import { usePageMeta } from "@/app/page-meta";
import { ClubThemeScope } from "@/features/branding/components/public/club-theme-scope";
import { useClub } from "@/features/clubs/hooks";
import { usePointsAllocations, usePointsSystem, useSeason } from "@/features/seasons/hooks";
import { ActivityFeed } from "@/features/tournaments/components/activity-feed";
import { useRegistrations, useTournament } from "@/features/tournaments/hooks";
import { LiveStatus } from "@/components/shared/live-status";
import { LoadingRows, QueryState } from "@/components/shared/query-state";
import { PublicFooter } from "@/components/shared/public-footer";
import { TabHost } from "@/components/shared/tab-host";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { clubTimeZone } from "@/lib/format";
import { liveRegistrationsInterval, liveTournamentInterval } from "@/lib/live-refresh";
import { EntryDetails } from "../components/entry-details";
import { TournamentLiveLinks } from "../components/live-links";
import { TOURNAMENT_PAGE_STATES } from "../components/page-shell";
import { PrizeStructureCard, type PointsRulesFigure } from "../components/prize-structure-card";
import { StandingsPanel } from "../components/standings-panel";
import { TournamentHeader } from "../components/tournament-header";
import { TournamentStats } from "../components/tournament-stats";
import { qk } from "@/lib/api/query-keys";
import { publicTournamentQueries } from "../api";
import { usePublicPrizes } from "../hooks";
import { lineupOf } from "../waiting-list";

const PLAYERS_FAILED = "The players could not be loaded";
const PRIZES_FAILED = "The prize pool could not be loaded";

/**
 * The rules a place's points are worked out with, once both halves (the system and its allocations)
 * have loaded: until then "loading", and "failed" if either could not be loaded, so the table never
 * shows made-up points, 0 or participation points where an allocation is (P3REV3-CQ-01).
 */
function pointsRulesOf(
  tournament: TournamentDetailDto,
  system: UseQueryResult<PublicPointsSystem>,
  allocations: UseQueryResult<PublicPointsAllocation[]>,
): PointsRulesFigure {
  const trackPoints = tournament.trackPoints === true;
  if (!tournament.pointsSystemId) return { trackPoints, pointsSystem: null, allocations: [] };
  if (system.data && allocations.data) return { trackPoints, pointsSystem: system.data, allocations: allocations.data };
  return system.isError || allocations.isError ? "failed" : "loading";
}

interface TournamentViewProps {
  tournament: TournamentDetailDto;
  registrationsQuery: UseQueryResult<PublicRegistration[]>;
}

/** The tournament as players follow it at the venue: live while it runs, results once it is over. */
function TournamentView({ tournament, registrationsQuery }: TournamentViewProps) {
  const closed = isClosedStatus(tournament.status);
  const { data: club } = useClub(tournament.clubId);
  const { data: season } = useSeason(tournament.seasonId);
  const pointsSystem = usePointsSystem(tournament.pointsSystemId);
  const allocations = usePointsAllocations(tournament.pointsSystemId);

  // Worked out by the server from who has paid, as finalize pays (round 6): the page is never sent the
  // club's takings, so it shows the pool and the places as they are, never what the club keeps.
  const prizes = usePublicPrizes(tournament.id, { follow: tournament });
  const locked = tournament.prizePoolLocked === true;
  const pointsRules = pointsRulesOf(tournament, pointsSystem, allocations);
  // The high-hand pot is money too: shown when the pool is, while the game is on.
  const highHandPotCents = prizes.data && locked && !closed ? prizes.data.highHandPotCents : null;

  return (
    <div className="min-h-dvh bg-background">
      <TournamentHeader tournament={tournament} club={club} season={season} />

      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 md:py-8 lg:px-8">
        <LiveStatus
          follows={[
            { queryKey: qk.tournaments.detail(tournament.id), interval: liveTournamentInterval(tournament) },
            { queryKey: qk.tournaments.registrations(tournament.id), interval: liveRegistrationsInterval(tournament) },
            { queryKey: publicTournamentQueries.prizes(tournament.id).queryKey, interval: liveRegistrationsInterval(tournament) },
          ]}
          timeZone={clubTimeZone(club)}
          className="mb-4"
        />
        <TournamentLiveLinks tournament={tournament} />
        <TournamentStats tournament={tournament} registrations={registrationsQuery} timeZone={clubTimeZone(club)} />

        <TabHost
          tabs={[
            {
              value: "details",
              label: "Details",
              content: (
                <div className="space-y-6">
                  {tournament.description ? (
                    <Card>
                      <CardHeader className="border-b border-border">
                        <CardTitle className="text-lg sm:text-2xl">About This Tournament</CardTitle>
                      </CardHeader>
                      <CardContent className="p-4 sm:p-6">
                        <p className="whitespace-pre-line text-muted-foreground">{tournament.description}</p>
                      </CardContent>
                    </Card>
                  ) : null}
                  <EntryDetails tournament={tournament} highHandPotCents={highHandPotCents} />
                  <QueryState query={prizes} loading={<LoadingRows rows={4} />} errorTitle={PRIZES_FAILED}>
                    {(paid) => (
                      <QueryState query={registrationsQuery} loading={<LoadingRows rows={4} />} errorTitle={PLAYERS_FAILED}>
                        {(list) => (
                          <PrizeStructureCard
                            prizes={paid}
                            // Who finished where, of the field: the waiting list does not play (round 5, item 15).
                            registrations={lineupOf(list, tournament.maxPlayers).field}
                            trackPoints={tournament.trackPoints === true}
                            pointsRules={pointsRules}
                            onRetryPoints={() => {
                              if (pointsSystem.isError) void pointsSystem.refetch();
                              if (allocations.isError) void allocations.refetch();
                            }}
                          />
                        )}
                      </QueryState>
                    )}
                  </QueryState>
                </div>
              ),
            },
            {
              value: "standings",
              label: "Standings",
              content: (
                <QueryState query={registrationsQuery} loading={<LoadingRows rows={4} />} errorTitle={PLAYERS_FAILED}>
                  {(list) => <StandingsPanel tournament={tournament} registrations={list} season={season} />}
                </QueryState>
              ),
            },
            { value: "activity", label: "Activity", content: <ActivityFeed tournamentId={tournament.id} live={!closed} /> },
          ]}
        />
      </div>

      <PublicFooter club={club} />
    </div>
  );
}

export default function PublicTournamentPage() {
  const { id = "" } = useParams<{ id: string }>();
  // Polled like the registrations: the pool, the lock and the status change during the night (MONEY-P2REV-02).
  const tournament = useTournament(id, { live: true });
  // Asked for alongside the tournament; followed while it runs, and fetched again once it closes or its
  // results are corrected, so the places and prizes always appear (P3REV0-PARITY-01).
  const registrations = useRegistrations(id, { follow: tournament.data });
  usePageMeta({ title: tournament.data?.name ?? "Tournament", noindex: true });

  // In the club's own colours (round 5, item 13), around every state so the page is never remounted.
  return (
    <ClubThemeScope clubId={tournament.data?.clubId} scheme="light">
      <QueryState query={tournament} {...TOURNAMENT_PAGE_STATES}>
        {(loaded) => <TournamentView tournament={loaded} registrationsQuery={registrations} />}
      </QueryState>
    </ClubThemeScope>
  );
}
