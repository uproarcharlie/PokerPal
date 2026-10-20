import type { ReactNode } from "react";
import { Calendar, Trophy } from "lucide-react";
import { usePageMeta } from "@/app/page-meta";
import { EmptyState, LoadingRows, QueryState } from "@/components/shared/query-state";
import { HomeClubCard } from "../components/home-club-card";
import { HomeTournamentCard } from "../components/home-tournament-card";
import { useTournaments } from "@/features/tournaments/hooks";
import { useClubs, useClubsByIds } from "../hooks";
import { PlatformFooter } from "@/components/shared/public-footer";

/** How many clubs the home page lists (oldest first), and how many upcoming tournaments (soonest first). */
const HOME_CLUBS = 24;
const HOME_TOURNAMENTS = 6;

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-6 flex items-center gap-2 text-2xl font-bold text-foreground">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

const grid = "grid gap-4 md:grid-cols-2 lg:grid-cols-3";

/** The club directory: upcoming tournaments across the clubs, and the clubs themselves. */
export default function PublicHomePage() {
  usePageMeta({ title: "Poker clubs and tournaments" });
  const clubs = useClubs({ limit: HOME_CLUBS });
  // Scheduled or open for registration, soonest start first: the server sorts and cuts the list.
  const upcoming = useTournaments({ upcoming: true, limit: HOME_TOURNAMENTS });
  const clubsById = new Map((clubs.data ?? []).map((club) => [club.id, club]));
  // The tournaments come from every club, the list only its first few: a tournament's club that is not
  // listed is asked for by id, so its card still names the club and shows its day in the club's zone
  // (P3REV3-CQ-04).
  const unlisted = clubs.data ? Array.from(new Set((upcoming.data ?? []).map((tournament) => tournament.clubId))).filter((id) => !clubsById.has(id)) : [];
  const unlistedClubs = useClubsByIds(unlisted);
  for (const club of unlistedClubs) if (club.data) clubsById.set(club.data.id, club.data);

  return (
    <div className="min-h-dvh bg-background text-foreground">
      {/* Purple to purple: the white words stay 4.5:1 or better across the whole band, which a gold end did not (P3REV-MA-HOME-HERO-CONTRAST). */}
      <header className="border-b border-border bg-gradient-to-br from-primary to-secondary text-primary-foreground">
        <div className="mx-auto max-w-6xl px-4 py-8 text-center md:px-8 md:py-12">
          <Trophy className="mx-auto mb-4 h-16 w-16" aria-hidden="true" />
          <h1 className="mb-4 text-3xl font-bold text-primary-foreground md:text-5xl">LovePoker.club</h1>
          <p className="text-xl md:text-2xl">Where Poker Communities Thrive</p>
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-12 px-4 py-8 md:px-8">
        <Section icon={<Calendar className="h-6 w-6 text-primary" aria-hidden="true" />} title="Upcoming Tournaments">
          <QueryState
            query={upcoming}
            loading={<LoadingRows rows={2} />}
            errorTitle="Upcoming tournaments could not be loaded"
            empty={<EmptyState icon={<Calendar className="h-12 w-12" />} title="No upcoming tournaments at the moment" />}
          >
            {(list) => (
              <ul role="list" className={grid}>
                {list.map((tournament) => (
                  <li key={tournament.id}>
                    <HomeTournamentCard tournament={tournament} club={clubsById.get(tournament.clubId)} />
                  </li>
                ))}
              </ul>
            )}
          </QueryState>
        </Section>

        <Section icon={<Trophy className="h-6 w-6 text-primary" aria-hidden="true" />} title="Poker Clubs">
          <QueryState
            query={clubs}
            loading={<LoadingRows rows={2} />}
            errorTitle="The clubs could not be loaded"
            empty={<EmptyState icon={<Trophy className="h-12 w-12" />} title="No clubs available yet" />}
          >
            {(list) => (
              <ul role="list" className={grid}>
                {list.map((club) => (
                  <li key={club.id}>
                    <HomeClubCard club={club} />
                  </li>
                ))}
              </ul>
            )}
          </QueryState>
        </Section>
      </div>

      <PlatformFooter />
    </div>
  );
}
