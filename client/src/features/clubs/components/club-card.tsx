import { useId, useMemo, useState } from "react";
import { Link } from "wouter";
import { ChevronDown, ChevronUp, Eye, Settings as SettingsIcon } from "lucide-react";
import type { ClubDto } from "@shared/api/public";
import { routes } from "@/app/routes";
import { ClubLogo } from "@/components/image/club-logo";
import { SafeHtml } from "@/components/shared/safe-html";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { clubTimeZone, formatDate } from "@/lib/format";
import { richTextToPlain } from "@/lib/rich-text";
import { cn } from "@/lib/utils";
import { FigureValue, type QueryFigure } from "@/components/shared/query-figure";

export interface ClubCardStats {
  members: QueryFigure;
  activeTournaments: QueryFigure;
  totalTournaments: QueryFigure;
  activeSeason: QueryFigure;
}

/** Descriptions longer than this are cut to two lines until "Show more". */
const SHORT_DESCRIPTION = 100;

/** One club on the Club Management page: its logo, description, figures, and links to it. */
export function ClubCard({ club, stats }: { club: ClubDto; stats: ClubCardStats }) {
  const descriptionId = useId();
  const [expanded, setExpanded] = useState(false);
  const long = useMemo(() => richTextToPlain(club.description ?? "").length > SHORT_DESCRIPTION, [club.description]);
  const established = formatDate(club.createdAt, clubTimeZone(club));
  const rows: Array<[string, QueryFigure]> = [
    ["Members", stats.members],
    ["Active Tournaments", stats.activeTournaments],
    ["Total Tournaments", stats.totalTournaments],
    ["Active Season", stats.activeSeason],
  ];

  return (
    <Card className="flex flex-col transition-shadow hover:shadow-md" data-testid={`club-card-${club.id}`}>
      <CardHeader>
        <div className="flex items-start gap-4">
          <ClubLogo name={club.name} imageUrl={club.imageUrl} size="lg" />
          <div className="min-w-0 flex-1">
            <CardTitle className="break-words text-lg">{club.name}</CardTitle>
            {established ? <p className="text-sm text-muted-foreground">Est. {established}</p> : null}
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col">
        {club.description ? (
          <div className="mb-4">
            <SafeHtml
              id={descriptionId}
              html={club.description}
              className={cn("prose prose-sm max-w-none text-sm text-muted-foreground", long && !expanded && "line-clamp-2")}
            />
            {long ? (
              <button
                type="button"
                onClick={() => setExpanded((open) => !open)}
                aria-expanded={expanded}
                aria-controls={descriptionId}
                className="mt-1 flex items-center gap-1 rounded-sm text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {expanded ? "Show less" : "Show more"}
                {expanded ? <ChevronUp className="h-3 w-3" aria-hidden="true" /> : <ChevronDown className="h-3 w-3" aria-hidden="true" />}
              </button>
            ) : null}
          </div>
        ) : null}

        <dl className="mb-4 space-y-3 text-sm">
          {rows.map(([label, stat]) => (
            <div key={label} className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-right font-semibold text-foreground">
                <FigureValue figure={stat} />
              </dd>
            </div>
          ))}
        </dl>

        <div className="mt-auto flex gap-2 border-t border-border pt-4">
          <Button asChild variant="outline" className={club.viewer.canManage ? "flex-1" : "w-full"}>
            <Link href={routes.clubDetails(club.id)} data-testid={`view-club-${club.id}`}>
              <Eye className="mr-1 h-4 w-4" aria-hidden="true" />
              View
            </Link>
          </Button>
          {club.viewer.canManage ? (
            <Button asChild variant="outline" className="flex-1">
              <Link href={routes.clubSettings(club.id)} data-testid={`settings-club-${club.id}`}>
                <SettingsIcon className="mr-1 h-4 w-4" aria-hidden="true" />
                Settings
              </Link>
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
