import { useState, type ReactNode } from "react";
import { ChevronRight, MonitorPlay } from "lucide-react";
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
import { PHONE_QUERY, useMediaQuery } from "@/components/shared/use-media-query";
import { PhoneSheet } from "@/components/shared/phone-sheet";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useClub } from "@/features/clubs/hooks";
import { qk } from "@/lib/api/query-keys";
import { clubTimeZone } from "@/lib/format";
import { DISPLAY_REFRESH_MS } from "../api";
import { useLiveClock } from "../hooks";
import { structureSummary } from "../structure-form";
import { ChipFigures } from "./chip-figures";
import { ClockControls } from "./clock-controls";
import { ClockSetup } from "./clock-setup";
import type { ClockOpenRequest } from "./clock-status-chip";
import { DisplaySettingsCard } from "./display-settings-card";
import { EarlyBirdsCard } from "./early-birds-card";
import { CLOCK_STATUS_WORDS, ClockFace, periodName } from "./public/clock-face";
import { RebuyWindowNotice } from "./rebuy-window-notice";
import { RestOfStructureSheet } from "./rest-of-structure-sheet";
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

/** The sheets the Clock tab opens: the rest of the structure (any screen), and on a phone the structure, the TV's settings and early birds. */
type ClockSheetName = "rest" | "structure" | "display" | "early-birds";

/** The clock once it is set up. Re-drawn every second it shows; the cards below only when their own data changes. */
function ClockWorkspace(props: ClockWorkspaceProps) {
  const phone = useMediaQuery(PHONE_QUERY);
  const [sheet, setSheet] = useState<ClockSheetName | null>(null);
  const { tournament, clock, derived, canEdit } = props;
  const rest = canEdit ? (
    <RestOfStructureSheet open={sheet === "rest"} onOpenChange={(open) => setSheet(open ? "rest" : null)} tournamentId={tournament.id} clock={clock} derived={derived} />
  ) : null;
  return (
    <>
      {phone ? <PhoneWorkspace {...props} sheet={sheet} onSheet={setSheet} /> : <WideWorkspace {...props} onChangeRest={() => setSheet("rest")} />}
      {rest}
    </>
  );
}

/** One of the phone's Clock tools: a row the width of the screen that opens its sheet. */
function ToolRow({ title, description, onOpen, disabled }: { title: string; description: ReactNode; onOpen: () => void; disabled?: boolean }) {
  return (
    <li>
      <Button variant="ghost" className="h-auto min-h-14 w-full justify-between gap-3 whitespace-normal px-3 py-2 text-left" onClick={onOpen} disabled={disabled}>
        <span className="min-w-0">
          <span className="block text-base font-semibold text-foreground">{title}</span>
          <span className="block text-sm font-normal text-muted-foreground">{description}</span>
        </span>
        <ChevronRight aria-hidden="true" className="text-muted-foreground" />
      </Button>
    </li>
  );
}

/**
 * The Clock tab on a phone (round 5, items 10 and 17): the clock and its controls fit one screen, the
 * Start / Pause button the width of it; the structure, the rest of it, the TV's settings and early
 * birds each open in a sheet of their own, the whole screen.
 */
function PhoneWorkspace({ tournament, display, clock, derived, canEdit, timeZone, openRequest, sheet, onSheet }: ClockWorkspaceProps & { sheet: ClockSheetName | null; onSheet: (sheet: ClockSheetName | null) => void }) {
  const preset = BLIND_PRESETS.find((candidate) => candidate.key === clock.presetKey);
  const tvLink = routes.clockDisplay(tournament.id, VENUE_SCREEN);
  const close = (open: boolean) => !open && onSheet(null);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-baseline justify-between gap-3 space-y-0 p-4 pb-1">
          <CardTitle>Clock</CardTitle>
          <CardDescription className="truncate">
            {CLOCK_STATUS_WORDS[derived.status]} · {preset ? preset.name : "Custom structure"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 p-4 pt-1">
          <ClockFace derived={derived} structure={clock.structure} variant="compact" />
          {canEdit ? <ClockControls tournament={tournament} clock={clock} derived={derived} openRequest={openRequest} layout="phone" /> : null}
          {canEdit ? <RebuyWindowNotice tournament={display.tournament} structure={clock.structure} /> : null}
          <LiveStatus follows={[{ queryKey: qk.tournaments.display(tournament.id), interval: DISPLAY_REFRESH_MS.panel }]} timeZone={timeZone} />
        </CardContent>
      </Card>

      {canEdit ? (
        <Card>
          <CardHeader className="p-4 pb-1">
            <CardTitle>Clock tools</CardTitle>
          </CardHeader>
          <CardContent className="p-2 pt-0">
            <ul role="list" className="divide-y divide-border">
              <ToolRow
                title="Change the rest of the structure"
                description={`Level length, blinds and breaks after ${periodName(derived)}`}
                onOpen={() => onSheet("rest")}
                disabled={derived.status === "finished"}
              />
              <ToolRow title="Edit the blind structure" description={structureSummary(clock.structure.levels)} onOpen={() => onSheet("structure")} />
              <ToolRow title="TV display" description="What the TV shows, and its sounds" onOpen={() => onSheet("display")} />
              <ToolRow title="Early birds" description="Give the early-bird bonus" onOpen={() => onSheet("early-birds")} />
            </ul>
            <div className="flex flex-wrap gap-2 p-2">
              <Button asChild variant="outline" className="h-11 flex-1">
                <a href={tvLink} target="_blank" rel="noreferrer">
                  <MonitorPlay aria-hidden="true" />
                  Open TV display
                </a>
              </Button>
              <CopyLinkButton value={absoluteUrl(tvLink)} label="Copy TV link" className="h-11 flex-1" />
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="p-4">
            <CardTitle>Blind structure</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <StructureTable structure={clock.structure} currentIndex={derived.levelIndex} caption="Blind structure" />
          </CardContent>
        </Card>
      )}

      <ChipFigures stats={display.stats} structure={clock.structure} derived={derived} />

      {canEdit ? (
        <>
          <PhoneSheet width="wide" open={sheet === "structure"} onOpenChange={close} title="Blind structure" description="Every level and break, row by row.">
            <StructureEditor tournamentId={tournament.id} clubId={tournament.clubId} clock={clock} currentLevelId={derived.level.id} timeZone={timeZone} bare />
          </PhoneSheet>
          <PhoneSheet width="wide" open={sheet === "display"} onOpenChange={close} title="TV display" description="Changes show on the TV within a few seconds.">
            <DisplaySettingsCard
              tournamentId={tournament.id}
              settings={clock.displaySettings}
              rakeLabel={display.club.rakeLabel}
              poolLocked={display.tournament.prizePoolLocked}
              qr={display.qr}
              season={display.season}
              bare
            />
          </PhoneSheet>
          <PhoneSheet width="wide" open={sheet === "early-birds"} onOpenChange={close} title="Early birds">
            <EarlyBirdsCard tournamentId={tournament.id} startDateTime={tournament.startDateTime} earlyBirdStack={clock.structure.earlyBirdStack} timeZone={timeZone} bare />
          </PhoneSheet>
        </>
      ) : null}
    </div>
  );
}

/** The Clock tab from a tablet up: the clock and its controls, then the TV's settings, the structure and early birds as cards. */
function WideWorkspace({ tournament, display, clock, derived, canEdit, timeZone, openRequest, onChangeRest }: ClockWorkspaceProps & { onChangeRest: () => void }) {
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
          <StructureEditor tournamentId={tournament.id} clubId={tournament.clubId} clock={clock} currentLevelId={derived.level.id} timeZone={timeZone} onChangeRest={onChangeRest} />
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
