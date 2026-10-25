import type { RefObject } from "react";
import { Link } from "wouter";
import { ExternalLink, ListOrdered, MonitorPlay, MoreHorizontal, Pencil, Play, RotateCcw, Square, Trash2, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useMediaQuery } from "@/components/shared/use-media-query";
import { routes, VENUE_SCREEN } from "@/app/routes";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { isClosedStatus } from "@shared/domain/tournaments";
import type { WaitingCount } from "./desk-actions";

/**
 * The dialogs and sheets the page opens: the bar's, and on a phone the quick actions' (bust, re-buy,
 * add-on, payments) and the header's request desk.
 */
export type DeskDialog = "register" | "edit" | "delete" | "finalize" | "correct" | "highHand" | "lock" | "bust" | "rebuy" | "addon" | "payments" | "requests";

interface TournamentActionsBarProps {
  tournament: TournamentDetailDto;
  /** How many players are in; undefined until they have loaded (Start waits for them). */
  totalPlayers: number | undefined;
  /** Player requests still waiting: ending the tournament discards them. */
  waitingRequests: WaitingCount;
  /** A finalized tournament's players in their stored order, for Correct Results; undefined until loaded. */
  hasFinishers: boolean | undefined;
  statusChanging: boolean;
  onStatusChange: (status: "in_progress" | "registration") => void;
  onOpen: (dialog: DeskDialog) => void;
  /** The More menu's button: the dialogs chosen from it give focus back to it. */
  moreMenuRef?: RefObject<HTMLButtonElement>;
  /**
   * "bar" (the default): beside the title. "stack": the phone's More tab (round5-contracts §8.1): one
   * 44 px button a row, Edit and Delete as buttons, and no Register Player (the quick-action button has it).
   */
  layout?: "bar" | "stack";
}

/**
 * Below this width the other screens and the settings go in one "More" menu. Beside a usual title,
 * these five and the TD's own actions (Register Player, Reopen registration, End Tournament with its
 * count) need some 1,900 px on one row: narrower, they wrapped onto a second row even on a 1280 px
 * laptop, and on a phone they pinned a third of the screen (lead's visual review, item 3).
 */
const MORE_MENU_QUERY = "(max-width: 1999px)";

/** The settings as the phone's More tab lists them: the other screens are its tools, below. */
function SettingsButtons({ tournament, onOpen }: Pick<TournamentActionsBarProps, "tournament" | "onOpen">) {
  const { canManage, canOwn } = tournament.viewer;
  return (
    <>
      {canManage ? (
        <Button variant="outline" size="lg" className="w-full" onClick={() => onOpen("edit")} data-testid="edit-tournament">
          <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />
          Edit tournament
        </Button>
      ) : null}
      {canOwn ? (
        <Button
          variant="outline"
          size="lg"
          onClick={() => onOpen("delete")}
          className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
          data-testid="delete-tournament"
        >
          <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
          Delete tournament
        </Button>
      ) : null}
    </>
  );
}

/** The other screens and the settings: in the "More" menu, or as buttons on a screen wide enough for one row. */
function SecondaryActions({ tournament, onOpen, moreMenuRef }: Pick<TournamentActionsBarProps, "tournament" | "onOpen" | "moreMenuRef">) {
  const inMenu = useMediaQuery(MORE_MENU_QUERY);
  const { canManage, canOwn } = tournament.viewer;

  if (inMenu) {
    return (
      // Not modal: a menu item opens a dialog, which must get the focus and the pointer.
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button ref={moreMenuRef} variant="outline" aria-label="More actions">
            <MoreHorizontal className="mr-2 h-4 w-4" aria-hidden="true" />
            More
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={routes.adminRegistrations(tournament.id)}>
              <UserPlus className="mr-2 h-4 w-4" aria-hidden="true" />
              Registrations
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={routes.publicTournament(tournament.id)}>
              <ExternalLink className="mr-2 h-4 w-4" aria-hidden="true" />
              Public View
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href={routes.clockDisplay(tournament.id, VENUE_SCREEN)} target="_blank" rel="noreferrer" data-testid="open-tv-clock">
              <MonitorPlay className="mr-2 h-4 w-4" aria-hidden="true" />
              TV clock
            </a>
          </DropdownMenuItem>
          {canManage ? (
            <DropdownMenuItem onSelect={() => onOpen("edit")} data-testid="edit-tournament">
              <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />
              Edit
            </DropdownMenuItem>
          ) : null}
          {canOwn ? (
            <DropdownMenuItem
              onSelect={() => onOpen("delete")}
              className="text-destructive focus:bg-destructive/10 focus:text-destructive"
              data-testid="delete-tournament"
            >
              <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
              Delete
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <>
      <Button asChild variant="outline" size="sm">
        <Link href={routes.adminRegistrations(tournament.id)}>
          <UserPlus className="mr-2 h-4 w-4" aria-hidden="true" />
          Registrations
        </Link>
      </Button>
      <Button asChild variant="outline" size="sm">
        <Link href={routes.publicTournament(tournament.id)}>
          <ExternalLink className="mr-2 h-4 w-4" aria-hidden="true" />
          Public View
        </Link>
      </Button>
      <Button asChild variant="outline" size="sm">
        <a href={routes.clockDisplay(tournament.id, VENUE_SCREEN)} target="_blank" rel="noreferrer" data-testid="open-tv-clock">
          <MonitorPlay className="mr-2 h-4 w-4" aria-hidden="true" />
          TV clock
        </a>
      </Button>
      {canManage ? (
        <Button variant="outline" size="sm" onClick={() => onOpen("edit")} data-testid="edit-tournament">
          <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />
          Edit
        </Button>
      ) : null}
      {canOwn ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => onOpen("delete")}
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          data-testid="delete-tournament"
        >
          <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
          Delete
        </Button>
      ) : null}
    </>
  );
}

/**
 * What can be done with the tournament (its status is under the title). Staff controls show only to
 * the club's staff (`viewer.canManage`); Delete only to its owner or an admin (`viewer.canOwn`), on
 * every screen size. From a laptop's width the TD's own actions stay on one row beside the title.
 */
export function TournamentActionsBar({
  tournament,
  totalPlayers,
  waitingRequests,
  hasFinishers,
  statusChanging,
  onStatusChange,
  onOpen,
  moreMenuRef,
  layout = "bar",
}: TournamentActionsBarProps) {
  const { status, viewer } = tournament;
  const canManage = viewer.canManage;
  const closed = isClosedStatus(status);
  const canStart = canManage && status === "registration" && totalPlayers !== undefined && totalPlayers >= (tournament.minPlayers ?? 0);
  const running = canManage && status === "in_progress";
  const stack = layout === "stack";
  // On a phone each action is a whole-width, 44 px row (round5-contracts §8.1).
  const size = stack ? "lg" : undefined;
  const width = stack ? "w-full" : undefined;

  return (
    <div className={stack ? "grid gap-2" : "flex flex-wrap items-center gap-2 xl:flex-nowrap"}>
      {stack ? null : <SecondaryActions tournament={tournament} onOpen={onOpen} moreMenuRef={moreMenuRef} />}
      {canManage && !closed && !stack ? (
        <Button variant="outline" onClick={() => onOpen("register")} data-testid="register-player">
          <UserPlus className="mr-2 h-4 w-4" aria-hidden="true" />
          Register Player
        </Button>
      ) : null}
      {canStart ? (
        <Button size={size} className={width} onClick={() => onStatusChange("in_progress")} busy={statusChanging} data-testid="start-tournament">
          <Play className="mr-2 h-4 w-4" aria-hidden="true" />
          Start Tournament
        </Button>
      ) : null}
      {running ? (
        // Back to open for sign-ups (what "Pause" always did): the clock has its own pause (phase4-contracts §8.1).
        <Button
          variant="outline"
          size={size}
          className={width}
          onClick={() => onStatusChange("registration")}
          busy={statusChanging}
          data-testid="pause-tournament"
        >
          <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
          Reopen registration
        </Button>
      ) : null}
      {running ? (
        <Button variant="destructive" size={size} className={width} onClick={() => onOpen("finalize")} data-testid="end-tournament">
          <Square className="mr-2 h-4 w-4" aria-hidden="true" />
          End Tournament
          {typeof waitingRequests === "number" && waitingRequests > 0 ? (
            <Badge variant="secondary" className="ml-2" data-testid="end-tournament-waiting">
              {waitingRequests} waiting
            </Badge>
          ) : null}
        </Button>
      ) : null}
      {canManage && status === "completed" && hasFinishers === true ? (
        <Button variant="outline" size={size} className={width} onClick={() => onOpen("correct")} data-testid="correct-results">
          <ListOrdered className="mr-2 h-4 w-4" aria-hidden="true" />
          Correct Results
        </Button>
      ) : null}
      {stack ? <SettingsButtons tournament={tournament} onOpen={onOpen} /> : null}
    </div>
  );
}
