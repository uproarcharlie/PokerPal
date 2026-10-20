import type { ReactNode } from "react";
import { Calendar } from "lucide-react";
import type { UseQueryResult } from "@tanstack/react-query";
import type { TournamentListItemDto } from "@shared/api/tournaments";
import { EmptyState, QueryState } from "@/components/shared/query-state";
import { groupForPublicPage } from "../tournament-lists";
import { PublicTournamentCard } from "./public-tournament-card";

function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-4 flex items-center gap-2 text-2xl font-bold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function TournamentList({ tournaments, timeZone, showTime }: { tournaments: TournamentListItemDto[]; timeZone: string; showTime?: boolean }) {
  return (
    <ul role="list" className="grid gap-4">
      {tournaments.map((tournament) => (
        <li key={tournament.id}>
          <PublicTournamentCard tournament={tournament} timeZone={timeZone} showTime={showTime} />
        </li>
      ))}
    </ul>
  );
}

/** The club's live, upcoming and past tournaments, on its public page. */
export function ClubTournamentsTab({ tournaments, timeZone }: { tournaments: UseQueryResult<TournamentListItemDto[]>; timeZone: string }) {
  return (
    <QueryState query={tournaments} errorTitle="The club's tournaments could not be loaded">
      {(list) => {
        const { live, upcoming, past } = groupForPublicPage(list);
        return (
          <div className="space-y-6">
            {live.length > 0 ? (
              <Section
                title={
                  <>
                    <span className="h-2 w-2 animate-pulse rounded-full bg-status-live-foreground motion-reduce:animate-none" aria-hidden="true" />
                    Live Tournaments
                  </>
                }
              >
                <TournamentList tournaments={live} timeZone={timeZone} showTime={false} />
              </Section>
            ) : null}

            <Section title="Upcoming Tournaments">
              {upcoming.length === 0 ? (
                <EmptyState icon={<Calendar className="h-12 w-12" />} title="No upcoming tournaments scheduled" />
              ) : (
                <TournamentList tournaments={upcoming} timeZone={timeZone} />
              )}
            </Section>

            {past.length > 0 ? (
              <Section title="Past Tournaments">
                <TournamentList tournaments={past} timeZone={timeZone} />
              </Section>
            ) : null}
          </div>
        );
      }}
    </QueryState>
  );
}
