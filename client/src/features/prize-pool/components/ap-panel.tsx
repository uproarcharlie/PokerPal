import { useState } from "react";
import { Pencil, Percent, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingRows, QueryState } from "@/components/shared/query-state";
import { clubTimeZone } from "@/lib/format";
import { useClub } from "@/features/clubs/hooks";
import type { PrizePoolDto } from "@shared/api/prize-pool";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { rakeLabel } from "@shared/domain/prize-pool";
import { isClosedStatus } from "@shared/domain/tournaments";
import { usePrizePool } from "../hooks";
import { ApAdjustDialog } from "./ap-adjust-dialog";
import { FrozenBreakdown, LiveBreakdown } from "./ap-breakdown";
import { RakeLabelDialog } from "./rake-label-dialog";
import { RakeRatesSheet } from "./rake-rates-sheet";

type Editor = "adjust" | "rates" | "rename";

function description(tournament: TournamentDetailDto, prizePool: PrizePoolDto | undefined): string {
  if (tournament.status === "completed") return "Finalized — showing what was paid.";
  if (tournament.status === "cancelled") return "Cancelled: no prizes are paid.";
  if (prizePool && !prizePool.estimated) return "What the club keeps from the entries. The prize pool is locked.";
  return "What the club keeps from the entries, worked out as players enter.";
}

/**
 * The tournament's AP (the club's name for its rake): the AP each rule takes, the manual AP total for a
 * low turnout, and what the club keeps (or adds to a pool fixed by hand), as the server works them out;
 * the prize pool card beside it shows what came in and the pool. The club's staff adjust it, change the
 * rates and rename it while the tournament is open; once it is completed the panel shows what finalize
 * froze.
 */
export function ApPanel({ tournament }: { tournament: TournamentDetailDto }) {
  const prizePool = usePrizePool(tournament.id, { follow: tournament });
  const club = useClub(tournament.clubId);
  const [editor, setEditor] = useState<Editor | null>(null);
  const label = prizePool.data?.rakeLabel ?? rakeLabel(club.data);
  const canEdit = tournament.viewer.canManage && !isClosedStatus(tournament.status);
  const editorProps = (which: Editor) => ({ open: editor === which, onOpenChange: (open: boolean) => setEditor(open ? which : null) });

  return (
    <Card data-testid="ap-panel">
      <CardHeader className="space-y-3 border-b border-border">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Percent className="h-5 w-5" aria-hidden="true" />
            {label}
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{description(tournament, prizePool.data)}</p>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setEditor("adjust")} data-testid="adjust-ap">
              <SlidersHorizontal aria-hidden="true" />
              Adjust {label}
            </Button>
            <Button variant="outline" onClick={() => setEditor("rates")} data-testid="edit-ap-rates">
              Edit {label} rates
            </Button>
            {club.data ? (
              <Button variant="outline" onClick={() => setEditor("rename")} data-testid="rename-ap">
                <Pencil aria-hidden="true" />
                Rename {label}
              </Button>
            ) : null}
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="p-4 sm:p-6">
        <QueryState query={prizePool} loading={<LoadingRows rows={5} />} errorTitle={`The ${label} could not be loaded`}>
          {(pool) => <PanelBody tournament={tournament} prizePool={pool} label={label} timeZone={clubTimeZone(club.data)} />}
        </QueryState>
      </CardContent>

      {/* Mounted for staff even once the tournament closes, so a dialog open when it closed keeps the server's reason on screen. */}
      {tournament.viewer.canManage ? (
        <>
          <ApAdjustDialog tournament={tournament} label={label} {...editorProps("adjust")} />
          <RakeRatesSheet tournament={tournament} label={label} {...editorProps("rates")} />
          {club.data ? <RakeLabelDialog club={club.data} {...editorProps("rename")} /> : null}
        </>
      ) : null}
    </Card>
  );
}

interface PanelBodyProps {
  tournament: TournamentDetailDto;
  prizePool: PrizePoolDto;
  label: string;
  timeZone: string;
}

function PanelBody({ tournament, prizePool, label, timeZone }: PanelBodyProps) {
  const { display } = prizePool;
  if (display.source === "cancelled") {
    return (
      <p className="text-center text-sm text-muted-foreground" data-testid="ap-cancelled">
        This tournament was cancelled, so no prizes are paid.
      </p>
    );
  }
  const snapshot = display.source === "snapshot" ? tournament.prizePoolSnapshot : null;
  if (snapshot) return <FrozenBreakdown tournament={tournament} pool={snapshot.pool} highHand={prizePool.breakdown.highHand} label={label} />;
  return (
    <div className="space-y-4">
      {display.source === "stored" || display.source === "unrecorded" ? (
        <p className="text-sm text-muted-foreground" data-testid="ap-recalculated">
          Finalized before the {label} was recorded: the figures below are worked out again from today&apos;s settings.
        </p>
      ) : null}
      <LiveBreakdown tournament={tournament} prizePool={prizePool} label={label} timeZone={timeZone} />
    </div>
  );
}
