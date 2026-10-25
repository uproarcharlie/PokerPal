import { Link } from "wouter";
import { ArrowLeft, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ClockOpenRequest } from "@/features/clock/components/clock-status-chip";
import { routes } from "@/app/routes";
import { plural } from "@/lib/format";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { isClosedStatus } from "@shared/domain/tournaments";
import type { WaitingCount } from "../desk/desk-actions";
import { MobileClockStrip } from "./mobile-clock";

/** "3 player requests waiting", or what is known of them while the count is out. */
function requestsLabel(waiting: WaitingCount): string {
  if (waiting === "failed") return "Player requests: could not check for waiting ones";
  if (waiting === "loading" || waiting === 0) return "Player requests";
  return `${plural(waiting, "player request")} waiting`;
}

interface MobileHeaderProps {
  tournament: TournamentDetailDto;
  waitingRequests: WaitingCount;
  onOpenClock: (request: ClockOpenRequest) => void;
  onOpenRequests: () => void;
}

/**
 * The top of the TD's page on a phone (round5-contracts §8.1), kept in view under the app bar: the
 * tournament's name, the requests waiting (a tap opens the request desk), and the live clock with its
 * Pause / Resume, so the TD never scrolls for either. The status and the settings are in the More tab.
 */
export function MobileHeader({ tournament, waitingRequests, onOpenClock, onOpenRequests }: MobileHeaderProps) {
  const followsRequests = tournament.viewer.canManage && !isClosedStatus(tournament.status);
  const count = typeof waitingRequests === "number" ? waitingRequests : 0;
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-card" data-testid="mobile-header">
      <div className="flex items-center gap-1 px-1 py-1">
        <Button asChild variant="ghost" size="icon" className="h-11 w-11 shrink-0">
          <Link href={routes.tournaments()} aria-label="Back to Tournaments">
            <ArrowLeft aria-hidden="true" />
          </Link>
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-foreground">{tournament.name}</h1>
        {followsRequests ? (
          <Button
            variant="ghost"
            size="icon"
            className="relative h-11 w-11 shrink-0"
            aria-label={requestsLabel(waitingRequests)}
            onClick={onOpenRequests}
            data-testid="mobile-requests"
          >
            <Inbox aria-hidden="true" />
            {count > 0 ? (
              <span
                aria-hidden="true"
                className="absolute right-0.5 top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-xs font-semibold leading-none text-destructive-foreground"
                data-testid="mobile-requests-count"
              >
                {count > 99 ? "99+" : count}
              </span>
            ) : null}
          </Button>
        ) : null}
      </div>
      <MobileClockStrip tournamentId={tournament.id} onOpen={onOpenClock} />
    </header>
  );
}
