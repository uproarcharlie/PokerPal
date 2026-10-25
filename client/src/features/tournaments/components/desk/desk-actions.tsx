import type { ReactNode } from "react";
import { Link } from "wouter";
import { Armchair, CheckCircle2, Copy, ExternalLink, FolderSync, Lock, MonitorPlay, Trophy, Unlock, UserPlus, type LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useCopyLink } from "@/components/shared/copy-link-button";
import { absoluteUrl, routes, VENUE_SCREEN } from "@/app/routes";
import { cn } from "@/lib/utils";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { isClosedStatus } from "@shared/domain/tournaments";
import { offersHighHand } from "@shared/domain/player-actions";
import { plural } from "@/lib/format";

/** The whole card is the control: the link or button inside its heading is stretched over it. */
const STRETCHED = "after:absolute after:inset-0 after:content-[''] focus-visible:outline-none";

function ActionCard({ icon: Icon, title, description }: { icon: LucideIcon; title: ReactNode; description: ReactNode }) {
  return (
    <Card className="relative h-full transition-colors focus-within:ring-2 focus-within:ring-ring hover:bg-muted/50">
      <CardContent className="flex items-center gap-3 p-4 md:p-6">
        <Icon className="h-6 w-6 shrink-0 text-primary md:h-8 md:w-8" aria-hidden="true" />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground md:text-base">{title}</h3>
          <div className="text-xs text-muted-foreground md:text-sm">{description}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function CardLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={STRETCHED}>
      {children}
    </Link>
  );
}

/** Opens in a new tab: a screen for the venue's TV or the players, not the next step of the desk. */
function CardNewTab({ href, children, testId }: { href: string; children: ReactNode; testId?: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={STRETCHED} data-testid={testId}>
      {children}
    </a>
  );
}

function CardButton({ onClick, children, testId }: { onClick: () => void; children: ReactNode; testId?: string }) {
  return (
    <button type="button" onClick={onClick} className={cn("text-left", STRETCHED)} data-testid={testId}>
      {children}
    </button>
  );
}

/** How many player requests wait, once known: "loading" until the count is in, "failed" if it could not be had. */
export type WaitingCount = number | "loading" | "failed";

interface DeskActionsProps {
  tournament: TournamentDetailDto;
  waitingRequests: WaitingCount;
  onAwardHighHand: () => void;
  onLockPool: () => void;
}

/** The TD's other screens and tools: requests, payments, high hands, the pool lock, the TV clock, links to share. */
export function DeskActions({ tournament, waitingRequests, onAwardHighHand, onLockPool }: DeskActionsProps) {
  const copyLink = useCopyLink();
  const canManage = tournament.viewer.canManage;
  const closed = isClosedStatus(tournament.status);
  const locked = tournament.prizePoolLocked === true;
  const playerLink = absoluteUrl(routes.playerActions(tournament.id));

  const copyPlayerLink = () => copyLink(playerLink, "Player actions");
  const copySeatFinderLink = () => copyLink(absoluteUrl(routes.publicSeats(tournament.id)), "Seat finder");

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:gap-4 lg:grid-cols-3">
      <ActionCard
        icon={FolderSync}
        title={<CardLink href={routes.playerActions(tournament.id)}>Player Actions</CardLink>}
        description="Rebuy, addon, knockout registration"
      />
      <ActionCard
        icon={CheckCircle2}
        title={<CardLink href={routes.adminActions(tournament.id)}>Confirm Actions</CardLink>}
        description={
          <span className={cn(typeof waitingRequests === "number" && waitingRequests > 0 && "font-semibold text-destructive")} data-testid="waiting-requests">
            {waitingRequests === "failed"
              ? "Could not check for waiting requests"
              : typeof waitingRequests === "number" && waitingRequests > 0
                ? `${plural(waitingRequests, "player request")} waiting`
                : "Review and approve pending actions"}
          </span>
        }
      />
      {canManage && offersHighHand(tournament) ? (
        <ActionCard
          icon={Trophy}
          title={<CardButton onClick={onAwardHighHand} testId="award-high-hand-card">Award High Hand</CardButton>}
          description="Assign high hand winner"
        />
      ) : null}
      {/* A finished tournament's pool settings are frozen, so the lock is offered only while it is open. */}
      {canManage && !closed ? (
        <ActionCard
          icon={locked ? Lock : Unlock}
          title={
            <CardButton onClick={onLockPool} testId="prize-pool-lock-card">
              {locked ? "Prize Pool Locked" : "Lock Prize Pool"}
            </CardButton>
          }
          description={locked ? "Tap to unlock" : "Finalize registrations"}
        />
      ) : null}
      <ActionCard
        icon={UserPlus}
        title={<CardLink href={routes.adminRegistrations(tournament.id)}>Manage Registrations</CardLink>}
        description="View and edit player registrations"
      />
      <ActionCard
        icon={ExternalLink}
        title={<CardLink href={routes.publicTournament(tournament.id)}>Public View</CardLink>}
        description="See the public tournament page"
      />
      <ActionCard
        icon={Copy}
        title={<CardButton onClick={() => void copyPlayerLink()} testId="copy-player-link">Copy Player Link</CardButton>}
        description="Share actions page with players"
      />
      <ActionCard
        icon={MonitorPlay}
        title={
          <CardNewTab href={routes.clockDisplay(tournament.id, VENUE_SCREEN)} testId="tv-clock-card">
            TV Clock
          </CardNewTab>
        }
        description="The clock for the venue's screen"
      />
      <ActionCard
        icon={Armchair}
        title={<CardButton onClick={() => void copySeatFinderLink()} testId="copy-seat-finder-link">Copy Seat Finder Link</CardButton>}
        description="Players look up their table and seat"
      />
      {tournament.seasonId ? (
        <ActionCard
          icon={Trophy}
          title={
            <CardNewTab href={routes.publicSeason(tournament.seasonId)} testId="season-leaderboard-card">
              Season Leaderboard
            </CardNewTab>
          }
          description="The public standings the TV's QR code opens"
        />
      ) : null}
    </div>
  );
}
