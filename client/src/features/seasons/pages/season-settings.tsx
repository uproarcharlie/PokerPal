import { Link, useParams } from "wouter";
import type { ClubDto, PublicSeason } from "@shared/api/public";
import { usePageMeta } from "@/app/page-meta";
import { routes } from "@/app/routes";
import { AccessDenied } from "@/components/auth/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, LoadingRows, QueryState } from "@/components/shared/query-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { TabHost } from "@/components/shared/tab-host";
import { DeleteSeasonButton } from "../components/delete-season-button";
import { PointsSystemForm } from "../components/points-system-form";
import { PointsSystemList } from "../components/points-system-list";
import { SeasonProfileForm } from "../components/season-profile-form";
import { useClub } from "@/features/clubs/hooks";
import { useSeason } from "../hooks";

// Both tabs stay mounted (hidden when not shown), so a half-filled form survives a look at the other tab.
function SettingsTabs({ season, club }: { season: PublicSeason; club: ClubDto }) {
  return (
    <TabHost
      tabs={[
        {
          value: "profile",
          label: "Profile",
          keepMounted: true,
          content: (
            <Card>
              <CardContent className="pt-6">
                <SeasonProfileForm key={season.id} season={season} club={club} />
              </CardContent>
            </Card>
          ),
        },
        {
          value: "points",
          label: "Points Systems",
          keepMounted: true,
          content: (
            <div className="space-y-6">
              <PointsSystemList seasonId={season.id} />
              <Card>
                <CardContent className="pt-6">
                  <h2 className="mb-4 text-lg font-semibold text-foreground">Create New Points System</h2>
                  <PointsSystemForm key={season.id} seasonId={season.id} />
                </CardContent>
              </Card>
            </div>
          ),
        },
      ]}
    />
  );
}

/** A season's profile and points systems, for its club's staff; Delete for the club's owner or an admin. */
export default function SeasonSettingsPage() {
  const { id = "" } = useParams<{ id: string }>();
  const season = useSeason(id);
  // The season's club says who may see this page and who may delete the season.
  const club = useClub(season.data?.clubId);
  const title = season.data ? `${season.data.name} Settings` : "Season Settings";
  usePageMeta({ title });

  if (club.data && !club.data.viewer.canManage) {
    return (
      <AccessDenied
        message="Only this club's owner, its managers and admins can change its seasons."
        backHref={routes.seasons()}
        backLabel="Back to Seasons"
      />
    );
  }

  return (
    <>
      <PageHeader
        title={title}
        description="Manage season settings and points systems"
        back={{ href: routes.seasons(), label: "Seasons" }}
        actions={season.data && club.data?.viewer.canOwn ? <DeleteSeasonButton season={season.data} /> : undefined}
      />
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
        <QueryState
          query={season}
          loading={<LoadingRows rows={4} />}
          errorTitle="The season could not be loaded"
          notFound={
            <EmptyState
              title="Season Not Found"
              description="The season you're looking for doesn't exist."
              action={
                <Button asChild>
                  <Link href={routes.seasons()}>Back to Seasons</Link>
                </Button>
              }
            />
          }
        >
          {(loadedSeason) => (
            <QueryState query={club} loading={<LoadingRows rows={4} />} errorTitle="The season's club could not be loaded">
              {(loadedClub) => <SettingsTabs season={loadedSeason} club={loadedClub} />}
            </QueryState>
          )}
        </QueryState>
      </div>
    </>
  );
}
