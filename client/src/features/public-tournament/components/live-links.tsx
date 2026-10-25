import { Link } from "wouter";
import { Armchair, Timer, Trophy } from "lucide-react";
import type { LiveDisplayDto } from "@shared/api/live-display";
import type { PublicSeatingDto } from "@shared/api/seating";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { isClosedStatus } from "@shared/domain/tournaments";
import { routes } from "@/app/routes";
import { Button } from "@/components/ui/button";
import { useLiveDisplay } from "@/features/clock/hooks";
import { usePublicSeating } from "@/features/seating/hooks";

/**
 * How often an open tournament's page checks whether seats have been drawn or the clock set up: the
 * links only appear, so once a minute is soon enough, and the seat finder and the clock poll for
 * themselves once opened.
 */
export const LIVE_LINKS_REFRESH_MS = 60_000;

/**
 * Whether the page checks for a screen again: once a minute while the game is on (registration open or
 * in play) and the screen is not there yet; never once it is (seats drawn, a clock set up, stay), nor
 * while the game is only scheduled (a refocus still checks). Each check is one of the server's heavier
 * live reads, made by every phone at the venue on the venue's shared budget (P4REV3-LOAD-03).
 */
export function linkCheckInterval(status: TournamentDetailDto["status"], found: boolean): number | false {
  return !found && (status === "registration" || status === "in_progress") ? LIVE_LINKS_REFRESH_MS : false;
}

const anyoneSeated = (seating: PublicSeatingDto | undefined) => (seating?.players.length ?? 0) > 0;
const clockSetUp = (display: LiveDisplayDto | undefined) => display?.clock != null;

/**
 * The night's other screens for players, once they exist: "Find your seat" when anyone is seated,
 * the live clock when the TD has set one up, and the season's leaderboard. Nothing until then.
 */
export function TournamentLiveLinks({ tournament }: { tournament: Pick<TournamentDetailDto, "id" | "status" | "seasonId"> }) {
  // Over, the links have nothing left to show: neither is asked for.
  const open = !isClosedStatus(tournament.status);
  const seating = usePublicSeating(tournament.id, { refetchMs: (data) => linkCheckInterval(tournament.status, anyoneSeated(data)), enabled: open });
  const display = useLiveDisplay(tournament.id, { refetchMs: (data) => linkCheckInterval(tournament.status, clockSetUp(data)), enabled: open });
  const seated = anyoneSeated(seating.data);
  const clock = clockSetUp(display.data);
  if (!seated && !clock && !tournament.seasonId) return null;

  return (
    <nav aria-label="Tournament screens" className="mb-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap" data-testid="tournament-live-links">
      {seated ? (
        <Button asChild size="lg" className="w-full sm:w-auto">
          <Link href={routes.publicSeats(tournament.id)} data-testid="find-your-seat">
            <Armchair className="mr-2 h-4 w-4" aria-hidden="true" />
            Find your seat
          </Link>
        </Button>
      ) : null}
      {clock ? (
        <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
          <Link href={routes.clockDisplay(tournament.id)} data-testid="live-clock-link">
            <Timer className="mr-2 h-4 w-4" aria-hidden="true" />
            Live clock
          </Link>
        </Button>
      ) : null}
      {tournament.seasonId ? (
        <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
          <Link href={routes.publicSeason(tournament.seasonId)} data-testid="season-leaderboard-link">
            <Trophy className="mr-2 h-4 w-4" aria-hidden="true" />
            Season leaderboard
          </Link>
        </Button>
      ) : null}
    </nav>
  );
}
