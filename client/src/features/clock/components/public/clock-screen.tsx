import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { Maximize, Minimize, Volume2, VolumeX, WifiOff } from "lucide-react";
import type { LiveDisplayDto } from "@shared/api/live-display";
import { anteText, formatBlinds, type ClockStructure, type DerivedClock } from "@shared/domain/clock";
import { isClosedStatus } from "@shared/domain/tournaments";
import { routes } from "@/app/routes";
import { ClubLogo } from "@/components/image/club-logo";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { breakNote, ClockFace, ClockStrip, periodTitle } from "./clock-face";
import { DisplayMoney } from "./display-money";
import { PayoutsOverlay, SeatingOverlay } from "./display-overlays";
import { DisplayQr } from "./display-qr";
import { DisplayStats } from "./display-stats";
import { useClockSound, type ClockSound } from "./use-clock-sound";
import { keepFocusOnMouseDown } from "./keep-focus";
import { useFullscreen, useWakeLock, type Fullscreen } from "./use-screen";

/** The corner buttons fade out after this long without the pointer moving (keyboard focus brings them back). */
export const CONTROLS_HIDE_MS = 3000;

/** The cue the minute warning plays at. */
const MINUTE_WARNING_MS = 60_000;

/** What the screen reader hears when the level changes (never the seconds). */
function levelAnnouncement(derived: DerivedClock, structure: Pick<ClockStructure, "anteMode">): string {
  const play = derived.currentPlayLevel;
  if (!play) {
    const note = breakNote(derived);
    return `Break, ${String(derived.level.durationMinutes)} minutes${note ? `: ${note}` : ""}`;
  }
  const ante = anteText(play, structure.anteMode);
  return `${periodTitle(derived)}: blinds ${formatBlinds(play)}${ante ? `, ${ante}` : ""}`;
}

/** Plays the chimes: a level change while running (never on the first draw), one minute left, a break starting. */
function useClockCues(derived: DerivedClock | null, play: ClockSound["play"]): void {
  const previous = useRef<DerivedClock | null>(null);
  useEffect(() => {
    const before = previous.current;
    previous.current = derived;
    if (!before || !derived || derived.status !== "running") return;
    if (derived.levelIndex > before.levelIndex) play(derived.isBreak ? "break" : "level");
    else if (derived.levelIndex === before.levelIndex && before.remainingMs > MINUTE_WARNING_MS && derived.remainingMs <= MINUTE_WARNING_MS) play("minute");
  }, [derived, play]);
}

/** Whether the pointer moved in the last CONTROLS_HIDE_MS. */
function usePointerAwake(): boolean {
  const [awake, setAwake] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const wake = () => {
      setAwake(true);
      clearTimeout(timer);
      timer = setTimeout(() => setAwake(false), CONTROLS_HIDE_MS);
    };
    window.addEventListener("pointermove", wake);
    window.addEventListener("pointerdown", wake);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointermove", wake);
      window.removeEventListener("pointerdown", wake);
    };
  }, []);
  return awake;
}

/** Sized with the screen like the rest of the TV's words: read from across the room (TDN2-TV-STATE-TOO-SMALL). */
function OfflineBadge({ className }: { className?: string }) {
  return (
    <p
      role="status"
      className={cn(
        "flex items-center gap-[0.5em] rounded-full border-2 border-destructive px-[0.75em] py-[0.25em] text-[clamp(1rem,min(2vw,2.8vh),2rem)] font-semibold text-destructive",
        className,
      )}
    >
      <WifiOff className="h-[1.1em] w-[1.1em]" aria-hidden="true" />
      Offline · reconnecting
    </p>
  );
}

/** What the staff's controls (loaded only for them) can use of the screen. */
export interface ScreenTools {
  sound: ClockSound;
  fullscreen: Fullscreen;
  /** The pointer moved lately: on-screen controls may show. */
  awake: boolean;
}

interface ClockScreenProps {
  display: LiveDisplayDto;
  derived: DerivedClock | null;
  offline: boolean;
  /** The club's staff controls, given the screen's tools (none for everyone else). */
  controls?: (tools: ScreenTools) => ReactNode;
}

/**
 * The TV clock, full screen: the clock in the middle, the room's figures on one side, the money and the
 * QR code on the other (one column on a phone or a portrait screen), and a layer over it all when the
 * TD puts the seats or the payouts up.
 */
export function ClockScreen({ display, derived, offline, controls }: ClockScreenProps) {
  const sound = useClockSound();
  const fullscreen = useFullscreen();
  const awake = usePointerAwake();
  // Awake for the whole game, not only while the clock runs: Level 1 and the QR code while players
  // arrive, a paused dispute, a meal break, a clock still to be set up (P4REV0-WAKELOCK-PAUSED).
  useWakeLock(!isClosedStatus(display.tournament.status));
  useClockCues(derived, sound.play);
  const clock = display.clock;
  // A layer over the clock is for a game in play: a finished or cancelled one shows its own message.
  const overlay = clock && derived && !isClosedStatus(display.tournament.status) ? clock.displaySettings.overlay : "none";
  // A layer covers the header: the strip over it then says the screen is offline (TDN3-OVERLAY-STUCK).
  const strip = derived ? (
    <>
      {offline ? <OfflineBadge className="mx-auto mb-[1vh] w-fit" /> : null}
      <ClockStrip derived={derived} />
    </>
  ) : null;

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 px-[3vw] pt-[2vh]">
        <ClubLogo name={display.club.name} imageUrl={display.club.imageUrl} size="md" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[clamp(0.9rem,1.4vw,1.4rem)] text-muted-foreground">{display.club.name}</p>
          <h1 className="truncate text-[clamp(1.25rem,2.6vw,2.6rem)] font-bold text-foreground">{display.tournament.name}</h1>
        </div>
        {offline && overlay === "none" ? <OfflineBadge /> : null}
        {display.tournament.status !== "in_progress" ? <StatusBadge status={display.tournament.status} /> : null}
        {sound.needsTap ? (
          <Button variant="outline" size="sm" onMouseDown={keepFocusOnMouseDown} onClick={sound.unlock}>
            <Volume2 aria-hidden="true" />
            Tap to enable sound
          </Button>
        ) : null}
        <div className={cn("flex gap-2 transition-opacity has-[:focus-visible]:opacity-100", awake ? "opacity-100" : "opacity-0")}>
          {sound.supported ? (
            <Button variant="ghost" size="icon" onMouseDown={keepFocusOnMouseDown} onClick={sound.toggle} aria-label={sound.on ? "Mute the clock" : "Turn the clock's sound on"} aria-pressed={!sound.on}>
              {sound.on ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}
            </Button>
          ) : null}
          {fullscreen.supported ? (
            <Button variant="ghost" size="icon" onMouseDown={keepFocusOnMouseDown} onClick={fullscreen.toggle} aria-label={fullscreen.active ? "Leave full screen" : "Full screen"}>
              {fullscreen.active ? <Minimize aria-hidden="true" /> : <Maximize aria-hidden="true" />}
            </Button>
          ) : null}
        </div>
      </header>

      <div className="flex flex-1 flex-col px-[3vw] py-[2vh]">
        <ScreenBody display={display} derived={derived} />
      </div>

      {derived && clock ? (
        <p className="sr-only" aria-live="polite">
          {levelAnnouncement(derived, clock.structure)}
        </p>
      ) : null}
      {overlay === "seating" && strip ? <SeatingOverlay tournamentId={display.tournament.id} strip={strip} /> : null}
      {overlay === "payouts" && strip && clock ? <PayoutsOverlay money={display.money} entrants={display.stats.entrants} settings={clock.displaySettings} strip={strip} /> : null}
      {controls?.({ sound, fullscreen, awake })}
    </div>
  );
}

function Message({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-[3vh] text-center">
      <h2 className="font-display text-[clamp(2rem,6vw,5rem)] font-bold text-foreground">{title}</h2>
      {children}
    </div>
  );
}

function ScreenBody({ display, derived }: { display: LiveDisplayDto; derived: DerivedClock | null }) {
  const { tournament, clock, qr, season } = display;
  const code = qr ? <DisplayQr qr={qr} season={season} /> : null;
  if (tournament.status === "cancelled") return <Message title="This tournament was cancelled" />;
  if (tournament.status === "completed") {
    return (
      <Message title="Tournament complete">
        <Button asChild variant="outline" size="lg">
          <Link href={routes.publicTournament(tournament.id)}>See the results</Link>
        </Button>
        {code}
      </Message>
    );
  }
  if (!clock || !derived) {
    return (
      <Message title="Clock not set up yet">
        <p className="text-[clamp(1rem,2vw,1.75rem)] text-muted-foreground">The blinds appear here as soon as the tournament director sets the clock up.</p>
        {code}
      </Message>
    );
  }
  return (
    <div className="grid flex-1 grid-cols-1 items-center gap-[3vh] lg:grid-cols-[minmax(13rem,1fr)_minmax(0,2.6fr)_minmax(13rem,1fr)] lg:gap-[2vw]">
      <div className="lg:order-2">
        <ClockFace derived={derived} structure={clock.structure} variant="tv" />
      </div>
      <DisplayStats display={display} derived={derived} className="lg:order-1" />
      <div className="flex flex-col gap-[3vh] lg:order-3">
        <DisplayMoney money={display.money} entrants={display.stats.entrants} showPrizePool={clock.displaySettings.showPrizePool} />
        {code}
      </div>
    </div>
  );
}
