import { MonitorPlay } from "lucide-react";
import type { ClockDto } from "@shared/api/clock";
import type { LiveDisplayDto } from "@shared/api/live-display";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { BLIND_PRESETS } from "@shared/domain/blind-structures";
import type { DerivedClock } from "@shared/domain/clock";
import { isClosedStatus } from "@shared/domain/tournaments";
import { absoluteUrl, routes, VENUE_SCREEN } from "@/app/routes";
import { CopyLinkButton } from "@/components/shared/copy-link-button";
import { LiveStatus } from "@/components/shared/live-status";
import { EmptyState, LoadingRows, QueryState } from "@/components/shared/query-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useClub } from "@/features/clubs/hooks";
import { qk } from "@/lib/api/query-keys";
import { clubTimeZone } from "@/lib/format";
import { DISPLAY_REFRESH_MS } from "../api";
import { useLiveClock } from "../hooks";
import { ChipFigures } from "./chip-figures";
import { ClockControls } from "./clock-controls";
import { ClockSetup } from "./clock-setup";
import type { ClockOpenRequest } from "./clock-status-chip";
import { DisplaySettingsCard } from "./display-settings-card";
import { EarlyBirdsCard } from "./early-birds-card";
import { CLOCK_STATUS_WORDS, ClockFace } from "./public/clock-face";
import { RebuyWindowNotice } from "./rebuy-window-notice";
import { StructureEditor } from "./structure-editor";
import { StructureTable } from "./structure-table";

interface ClockPanelProps {
  tournament: TournamentDetailDto;
  /** The header chip's last tap: it brings Start / Pause into view (ClockControls). */
  openRequest?: ClockOpenRequest | null;
}

/**
 * The tournament page's Clock tab: set the clock up, run it (the controls, with the level and status on
 * screen sent along so a double tap never skips a level), edit the structure, choose what the TV shows,
 * give the early-bird bonus, and open the TV display. Read-only for anyone who cannot manage the
 * tournament, and once it is closed.
 */
export function ClockPanel({ tournament, openRequest }: ClockPanelProps) {
  const live = useLiveClock(tournament.id, { refetchMs: DISPLAY_REFRESH_MS.panel });
  const club = useClub(tournament.clubId);
  const timeZone = clubTimeZone(club.data);
  const canEdit = tournament.viewer.canManage && !isClosedStatus(tournament.status);
  const { derived } = live;

  return (
    <QueryState query={live.query} loading={<LoadingRows rows={4} />} errorTitle="The clock could not be loaded">
      {(display) =>
        display.clock && derived ? (
          <ClockWorkspace
            tournament={tournament}
            display={display}
            clock={display.clock}
            derived={derived}
            canEdit={canEdit}
            timeZone={timeZone}
            openRequest={openRequest}
          />
        ) : canEdit ? (
          <ClockSetup tournament={tournament} timeZone={timeZone} />
        ) : (
          <EmptyState title="No clock yet" description="The clock appears here once the tournament director sets it up." />
        )
      }
    </QueryState>
  );
}

interface ClockWorkspaceProps {
  tournament: TournamentDetailDto;
  display: LiveDisplayDto;
  clock: ClockDto;
  derived: DerivedClock;
  canEdit: boolean;
  timeZone: string;
  openRequest?: ClockOpenRequest | null;
}

/** The clock once it is set up. Re-drawn every second it shows; the cards below only when their own data changes. */
function ClockWorkspace({ tournament, display, clock, derived, canEdit, timeZone, openRequest }: ClockWorkspaceProps) {
  const preset = BLIND_PRESETS.find((candidate) => candidate.key === clock.presetKey);
  // The venue's screen, whatever its size: a tablet at the bar follows the clock as closely as the TV.
  const tvLink = routes.clockDisplay(tournament.id, VENUE_SCREEN);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
          <div className="space-y-1.5">
            <CardTitle>Clock</CardTitle>
            <CardDescription>
              {CLOCK_STATUS_WORDS[derived.status]} · {preset ? preset.name : "Custom structure"}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <a href={tvLink} target="_blank" rel="noreferrer">
                <MonitorPlay aria-hidden="true" />
                Open TV display
              </a>
            </Button>
            <CopyLinkButton value={absoluteUrl(tvLink)} label="Copy TV link" size="sm" />
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <LiveStatus follows={[{ queryKey: qk.tournaments.display(tournament.id), interval: DISPLAY_REFRESH_MS.panel }]} timeZone={timeZone} />
          <ClockFace derived={derived} structure={clock.structure} variant="compact" />
          {canEdit ? <ClockControls tournament={tournament} clock={clock} derived={derived} openRequest={openRequest} /> : null}
          {canEdit ? <RebuyWindowNotice tournament={display.tournament} structure={clock.structure} /> : null}
          <ChipFigures stats={display.stats} structure={clock.structure} derived={derived} />
        </CardContent>
      </Card>

      {canEdit ? (
        <>
          {/* What the TV shows (the seats at a table break, the payouts at the bubble) is changed mid-game, the structure rarely: it comes first (TDN2-TV-CARD-BURIED). */}
          <DisplaySettingsCard
            tournamentId={tournament.id}
            settings={clock.displaySettings}
            rakeLabel={display.club.rakeLabel}
            poolLocked={display.tournament.prizePoolLocked}
            qr={display.qr}
            season={display.season}
          />
          <StructureEditor tournamentId={tournament.id} clubId={tournament.clubId} clock={clock} currentLevelId={derived.level.id} timeZone={timeZone} />
          <EarlyBirdsCard tournamentId={tournament.id} startDateTime={tournament.startDateTime} earlyBirdStack={clock.structure.earlyBirdStack} timeZone={timeZone} />
        </>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Blind structure</CardTitle>
          </CardHeader>
          <CardContent>
            <StructureTable structure={clock.structure} currentIndex={derived.levelIndex} caption="Blind structure" />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
