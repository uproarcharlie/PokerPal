import { useParams } from "wouter";
import type { ClubDto } from "@shared/api/public";
import { usePageMeta } from "@/app/page-meta";
import { ClubLogo } from "@/components/image/club-logo";
import { PageSpinner } from "@/components/shared/page-spinner";
import { EmptyState, QueryState } from "@/components/shared/query-state";
import { PublicFooter } from "@/components/shared/public-footer";
import { TabHost } from "@/components/shared/tab-host";
import { clubTimeZone } from "@/lib/format";
import { ClubAboutTab } from "../components/club-about-tab";
import { ClubTournamentsTab } from "../components/club-tournaments-tab";
import { SeasonStandings } from "../components/season-standings";
import { SocialLinks } from "../components/social-links";
import { ClubThemeScope } from "@/features/branding/components/public/club-theme-scope";
import { useSeasons } from "@/features/seasons/hooks";
import { useTournaments } from "@/features/tournaments/hooks";
import { useClubBySlug } from "../hooks";

function PublicClub({ club }: { club: ClubDto }) {
  const tournaments = useTournaments({ clubId: club.id });
  const seasons = useSeasons({ clubId: club.id });
  const timeZone = clubTimeZone(club);

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="border-b border-border bg-gradient-to-br from-card via-card to-primary/5">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-6 md:gap-6 md:px-8 md:py-8">
          <ClubLogo name={club.name} imageUrl={club.imageUrl} size="xl" className="border-2 border-primary/20" />
          <div className="min-w-0 flex-1">
            <h1 className="break-words text-2xl font-bold text-primary md:text-3xl">{club.name}</h1>
            <SocialLinks club={club} />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">
        <TabHost
          tabs={[
            { value: "details", label: "Details", content: <ClubAboutTab club={club} seasons={seasons} /> },
            { value: "tournaments", label: "Tournaments", content: <ClubTournamentsTab tournaments={tournaments} timeZone={timeZone} /> },
            { value: "standings", label: "Standings", content: <SeasonStandings seasons={seasons} /> },
          ]}
        />
      </div>

      <PublicFooter club={club} />
    </div>
  );
}

/** A club's public page: who it is, its tournaments and its season standings. */
export default function PublicClubPage() {
  const { slug = "" } = useParams<{ slug: string }>();
  const club = useClubBySlug(slug);
  usePageMeta({ title: club.data?.name });

  // The club's own colours (round 5, item 13), around the page's every state so it is never remounted.
  return (
    <ClubThemeScope theme={club.data?.theme ?? null} scheme="light">
      <QueryState
        query={club}
        loading={<PageSpinner label="Loading the club" />}
        notFound={<EmptyState title="Club not found" description="This club's page has moved or no longer exists." />}
        errorTitle="This club could not be loaded"
        stateClassName="mx-auto min-h-dvh max-w-md bg-background px-4 py-12"
      >
        {(loaded) => <PublicClub club={loaded} />}
      </QueryState>
    </ClubThemeScope>
  );
}
