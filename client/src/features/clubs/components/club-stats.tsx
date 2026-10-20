import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { FigureValue, type QueryFigure } from "@/components/shared/query-figure";

interface ClubStatsProps {
  activeTournaments: QueryFigure;
  totalTournaments: QueryFigure;
  activeSeasons: QueryFigure;
  members: QueryFigure;
}

/** The club's figures at a glance, on its staff page. */
export function ClubStats({ activeTournaments, totalTournaments, activeSeasons, members }: ClubStatsProps) {
  const figures: Array<{ label: string; stat: QueryFigure; testId: string; className?: string }> = [
    { label: "Active Tournaments", stat: activeTournaments, testId: "active-tournaments", className: "text-status-live-foreground" },
    { label: "Total Tournaments", stat: totalTournaments, testId: "total-tournaments" },
    { label: "Active Seasons", stat: activeSeasons, testId: "active-seasons" },
    { label: "Members", stat: members, testId: "members-count" },
  ];
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-6">
      {figures.map(({ label, stat, testId, className }) => (
        <Card key={testId}>
          <CardHeader className="pb-3">
            <p className="text-sm font-medium text-muted-foreground">{label}</p>
          </CardHeader>
          <CardContent>
            <p className={cn("text-3xl font-bold text-foreground", className)} data-testid={testId}>
              <FigureValue figure={stat} loadingClassName="h-8 w-12" />
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
