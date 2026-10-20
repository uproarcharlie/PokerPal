import type { ReactNode } from "react";
import { DollarSign, PlayCircle, Users, UsersRound, type LucideIcon } from "lucide-react";
import type { DashboardStatsDto } from "@shared/api/dashboard";
import { MoneyText } from "@/components/shared/money-text";
import { QueryState } from "@/components/shared/query-state";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { useDashboardStats } from "../hooks";

interface StatTileProps {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  testId: string;
  /** The tile's colour, from the theme's chart palette. */
  tone: string;
}

function StatTile({ icon: Icon, label, value, testId, tone }: StatTileProps) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4 md:p-6">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg md:h-14 md:w-14 ${tone}`}>
          <Icon className="h-5 w-5 md:h-7 md:w-7" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-xl font-bold text-foreground md:text-3xl" data-testid={testId}>
            {value}
          </p>
          <p className="text-xs font-medium text-muted-foreground md:text-sm">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

const GRID = "grid grid-cols-2 gap-3 md:gap-6 lg:grid-cols-4";

function StatTiles({ stats }: { stats: DashboardStatsDto }) {
  return (
    <div className={GRID}>
      <StatTile icon={PlayCircle} label="Active" value={stats.activeTournaments} testId="active-tournaments-count" tone="bg-chart-1/15 text-chart-1" />
      <StatTile icon={UsersRound} label="Players" value={stats.totalPlayers} testId="total-players-count" tone="bg-chart-3/15 text-chart-3" />
      <StatTile
        icon={DollarSign}
        label="Prize Pool"
        value={<MoneyText amount={stats.totalPrizePool} />}
        testId="total-prize-pool"
        tone="bg-chart-4/15 text-chart-4"
      />
      <StatTile icon={Users} label="Clubs" value={stats.activeClubs} testId="active-clubs-count" tone="bg-chart-2/15 text-chart-2" />
    </div>
  );
}

/** The four totals for the clubs the viewer runs, as the server works them out. */
export function StatCards({ query }: { query: ReturnType<typeof useDashboardStats> }) {
  return (
    <section aria-label="Totals">
      <QueryState
        query={query}
        errorTitle="The totals could not be loaded"
        loading={
          <div role="status" className={GRID}>
            <span className="sr-only">Loading</span>
            {[0, 1, 2, 3].map((tile) => (
              <Skeleton key={tile} className="h-20 md:h-28" />
            ))}
          </div>
        }
      >
        {(stats) => <StatTiles stats={stats} />}
      </QueryState>
    </section>
  );
}
