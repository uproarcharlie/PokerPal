import { useId, type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { isClosedStatus } from "@shared/domain/tournaments";
import { ActivityFeed } from "../activity-feed";
import { DeskActions, type WaitingCount } from "../desk/desk-actions";
import { TournamentInfoCard } from "../desk/tournament-info-card";

interface MoreTabProps {
  tournament: TournamentDetailDto;
  /** The status and settings buttons: the actions bar, stacked. */
  controls: ReactNode;
  clubName: string;
  seasonName: string | null;
  timeZone: string;
  waitingRequests: WaitingCount;
  onAwardHighHand: () => void;
  onLockPool: () => void;
}

/**
 * The phone's More tab (round5-contracts §8.1): the tournament's status with Start, Reopen
 * registration, End Tournament, Edit and Delete; the TD's other tools and screens (requests, payments,
 * the pool lock, the TV clock, links to share); its details; and what has happened.
 */
export function MoreTab({ tournament, controls, clubName, seasonName, timeZone, waitingRequests, onAwardHighHand, onLockPool }: MoreTabProps) {
  const toolsId = useId();
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-2 p-4">
          <CardTitle className="text-xl">Tournament</CardTitle>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <StatusBadge status={tournament.status} />
            <span>{clubName}</span>
            {seasonName ? <span>· Season: {seasonName}</span> : null}
          </p>
        </CardHeader>
        <CardContent className="p-4 pt-0 empty:hidden">{controls}</CardContent>
      </Card>
      <section aria-labelledby={toolsId} className="space-y-3">
        <h2 id={toolsId} className="text-xl font-semibold text-foreground">
          Tools
        </h2>
        <DeskActions tournament={tournament} waitingRequests={waitingRequests} onAwardHighHand={onAwardHighHand} onLockPool={onLockPool} />
      </section>
      <TournamentInfoCard tournament={tournament} timeZone={timeZone} />
      <ActivityFeed tournamentId={tournament.id} live={!isClosedStatus(tournament.status)} />
    </div>
  );
}
