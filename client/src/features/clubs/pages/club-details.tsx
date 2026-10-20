import { Link, useParams } from "wouter";
import { Calendar, Settings as SettingsIcon, Trophy } from "lucide-react";
import type { ClubDto } from "@shared/api/public";
import { usePageMeta } from "@/app/page-meta";
import { routes } from "@/app/routes";
import { PageHeader } from "@/components/shared/page-header";
import { PageSpinner } from "@/components/shared/page-spinner";
import { PAGE_STATE_CLASS, QueryState } from "@/components/shared/query-state";
import { SafeHtml } from "@/components/shared/safe-html";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { clubTimeZone, formatDate } from "@/lib/format";
import { ClubNotFound } from "../components/club-not-found";
import { ClubPublicLinkCard } from "../components/club-public-link-card";
import { ClubSeasonsCard } from "../components/club-seasons-card";
import { ClubStats } from "../components/club-stats";
import { RecentTournamentsCard } from "../components/recent-tournaments-card";
import { figureOf } from "@/components/shared/query-figure";
import { useSeasons } from "@/features/seasons/hooks";
import { useTournaments } from "@/features/tournaments/hooks";
import { isActiveStatus } from "@shared/domain/tournaments";
import { useClub, useClubMembersCount } from "../hooks";

function ClubOverview({ club }: { club: ClubDto }) {
  const tournaments = useTournaments({ clubId: club.id });
  const seasons = useSeasons({ clubId: club.id });
  const members = useClubMembersCount(club.id);
  const timeZone = clubTimeZone(club);
  const canManage = club.viewer.canManage;
  const established = formatDate(club.createdAt, timeZone);

  const actions = canManage ? (
    <>
      <Button asChild variant="outline">
        <Link href={routes.tournaments(club.id)}>
          <Trophy className="mr-2 h-4 w-4" aria-hidden="true" />
          Create Tournament
        </Link>
      </Button>
      <Button asChild variant="outline">
        <Link href={routes.seasons(club.id)}>
          <Calendar className="mr-2 h-4 w-4" aria-hidden="true" />
          Create Season
        </Link>
      </Button>
      <Button asChild variant="outline">
        <Link href={routes.clubSettings(club.id)}>
          <SettingsIcon className="mr-2 h-4 w-4" aria-hidden="true" />
          Settings
        </Link>
      </Button>
    </>
  ) : undefined;

  return (
    <>
      <PageHeader
        title={<span data-testid="club-name">{club.name}</span>}
        description={established ? `Est. ${established}` : undefined}
        back={{ href: routes.clubs(), label: "Clubs" }}
        actions={actions}
      />
      <div className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <ClubPublicLinkCard slug={club.slug} />

        {club.description ? (
          <Card>
            <CardContent className="pt-6">
              <SafeHtml className="prose prose-sm max-w-none text-muted-foreground" data-testid="club-description" html={club.description} />
            </CardContent>
          </Card>
        ) : null}

        <ClubStats
          activeTournaments={figureOf(tournaments, (list) => list.filter((tournament) => isActiveStatus(tournament.status)).length)}
          totalTournaments={figureOf(tournaments, (list) => list.length)}
          activeSeasons={figureOf(seasons, (list) => list.filter((season) => season.isActive).length)}
          members={figureOf(members, (response) => response.count)}
        />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <RecentTournamentsCard tournaments={tournaments} timeZone={timeZone} createHref={canManage ? routes.tournaments(club.id) : undefined} />
          <ClubSeasonsCard seasons={seasons} createHref={canManage ? routes.seasons(club.id) : undefined} />
        </div>
      </div>
    </>
  );
}

/** A club's staff page: its public link, description, figures, latest tournaments and seasons. */
export default function ClubDetailsPage() {
  const { id = "" } = useParams<{ id: string }>();
  const club = useClub(id);
  usePageMeta({ title: club.data?.name ?? "Club" });

  return (
    <QueryState
      query={club}
      loading={<PageSpinner label="Loading the club" />}
      notFound={<ClubNotFound />}
      errorTitle="This club could not be loaded"
      stateClassName={PAGE_STATE_CLASS}
    >
      {(loaded) => <ClubOverview club={loaded} />}
    </QueryState>
  );
}
