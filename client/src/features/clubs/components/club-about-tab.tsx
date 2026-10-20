import { Info, TrendingUp } from "lucide-react";
import type { UseQueryResult } from "@tanstack/react-query";
import type { ClubDto, PublicSeason } from "@shared/api/public";
import { QueryState } from "@/components/shared/query-state";
import { SafeHtml } from "@/components/shared/safe-html";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatSeasonDate, seasonEndDate } from "@/lib/season-dates";
import { ActiveSeasonBadge } from "@/features/seasons/components/active-season-badge";

interface ClubAboutTabProps {
  club: ClubDto;
  seasons: UseQueryResult<PublicSeason[]>;
}

/** The club's description and the seasons running now, on its public page. */
export function ClubAboutTab({ club, seasons }: ClubAboutTabProps) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="border-b border-border">
          <CardTitle className="flex items-center gap-2 text-xl">
            <Info className="h-5 w-5 text-primary" aria-hidden="true" />
            About {club.name}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 sm:p-6">
          {club.description ? (
            <SafeHtml className="prose prose-sm max-w-none text-muted-foreground" html={club.description} />
          ) : (
            <p className="italic text-muted-foreground">No description available</p>
          )}
        </CardContent>
      </Card>

      <QueryState query={seasons} errorTitle="The club's seasons could not be loaded">
        {(list) => {
          const active = list.filter((season) => season.isActive);
          if (active.length === 0) return null;
          return (
            <section>
              <h2 className="mb-4 text-2xl font-bold text-foreground">Active Seasons</h2>
              <ul role="list" className="grid gap-4 md:grid-cols-2">
                {active.map((season) => {
                  const end = seasonEndDate(season);
                  return (
                    <li key={season.id}>
                      <Card>
                        <CardHeader>
                          <CardTitle as="h3" className="flex items-center gap-2 text-lg">
                            <TrendingUp className="h-5 w-5 text-primary" aria-hidden="true" />
                            {season.name}
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <dl className="space-y-2 text-sm">
                            <div className="flex justify-between gap-3">
                              <dt className="text-muted-foreground">Start Date:</dt>
                              <dd className="font-semibold text-foreground">{formatSeasonDate(season.startDate)}</dd>
                            </div>
                            {end ? (
                              <div className="flex justify-between gap-3">
                                <dt className="text-muted-foreground">End Date:</dt>
                                <dd className="font-semibold text-foreground">{formatSeasonDate(end)}</dd>
                              </div>
                            ) : null}
                          </dl>
                          <ActiveSeasonBadge label="Active" className="mt-3" />
                        </CardContent>
                      </Card>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        }}
      </QueryState>
    </div>
  );
}
