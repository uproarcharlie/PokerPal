import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "wouter";
import { Maximize, Minimize, Settings2, Volume2, VolumeX, WifiOff } from "lucide-react";
import type { LiveDisplayDto } from "@shared/api/live-display";
import { anteText, formatBlinds, type BlindLevel, type ClockStructure, type DerivedClock, type EdgeMargin } from "@shared/domain/clock";
import { isClosedStatus } from "@shared/domain/tournaments";
import { routes } from "@/app/routes";
import { StatusBadge } from "@/components/shared/status-badge";
import { useMediaQuery } from "@/components/shared/use-media-query";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { HANDHELD_QUERY } from "../../api";
import { CentrePiece, centreText } from "./centre-piece";
import { breakNote, breakText, ClockFace, ClockStrip, nextText, periodTitle, statusWord, timerTemplate } from "./clock-face";
import { useClockCues } from "./clock-cues";
import { DisplayMoney, moneyText } from "./display-money";
import { PayoutsOverlay, SeatingOverlay } from "./display-overlays";
import { DisplayQr, qrCaption } from "./display-qr";
import { DisplayStats, displayTiles } from "./display-stats";
import { keepFocusOnMouseDown } from "./keep-focus";
import { planScreen, px, type CentreText, type FaceText, type ScreenPlan } from "./screen-plan";
import { screenPrefsOf, type ScreenPrefs } from "./screen-prefs";
import { ScreenSettingsDialog, type SaveDisplaySettings } from "./screen-settings";
import { TvLogo } from "./tv-logo";
import { useClockSound, type ClockSound } from "./use-clock-sound";
import { useFullscreen, useOverflowGuard, useStageSize, useWakeLock, type Fullscreen } from "./use-screen";

/** The corner buttons fade out after this long without the pointer moving (keyboard focus brings them back). */
export const CONTROLS_HIDE_MS = 3000;

const NO_LEVELS: readonly BlindLevel[] = [];

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

/**
 * The edge margin as padding, never less than the screen's own safe area (a phone's notch, rounded
 * corners): every part of the clock stays inside it (round 5, item 22).
 */
export function edgePadding(margin: EdgeMargin): CSSProperties {
  const along = (inset: string, unit: "dvh" | "dvw") => `max(env(safe-area-inset-${inset}), ${String(margin)}${unit})`;
  return { padding: `${along("top", "dvh")} ${along("right", "dvw")} ${along("bottom", "dvh")} ${along("left", "dvw")}` };
}

/** Read from across the room like the rest of the TV's words (TDN2-TV-STATE-TOO-SMALL). */
function OfflineBadge({ size, className }: { size: number; className?: string }) {
  return (
    <p
      role="status"
      className={cn("flex w-fit items-center gap-[0.5em] rounded-full border-2 border-destructive bg-background px-[0.75em] py-[0.2em] font-bold text-destructive", className)}
      style={{ fontSize: px(size) }}
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
  /**
   * The tournament's sound and edge margin as this screen uses them, their dialog, and how the staff's
   * controls let it save changes (`offerChanges`; null takes the offer back): without them the dialog
   * only shows the settings.
   */
  screen: { prefs: ScreenPrefs; openSettings: () => void; offerChanges: (save: SaveDisplaySettings | null) => void };
}

interface ClockScreenProps {
  display: LiveDisplayDto;
  derived: DerivedClock | null;
  offline: boolean;
  /** The club's staff controls, given the screen's tools (none for everyone else). */
  controls?: (tools: ScreenTools) => ReactNode;
}

/** The clock's words, for the plan to size them: the level's number only where the TD shows it (round 5, item 21). */
function faceText(derived: DerivedClock, structure: Pick<ClockStructure, "anteMode">, showLevel: boolean): FaceText {
  const play = derived.currentPlayLevel;
  const status = statusWord(derived);
  return {
    title: showLevel ? periodTitle(derived).toUpperCase() : "",
    note: breakNote(derived),
    status: status ? { text: status.toUpperCase(), size: derived.status === "paused" ? "big" : "small" } : null,
    timer: timerTemplate(derived),
    blinds: play ? formatBlinds(play) : null,
    ante: play ? anteText(play, structure.anteMode) : null,
    breakLine: breakText(derived).toUpperCase(),
    next: `Next: ${nextText(derived.next, structure) ?? "Final level"}`,
  };
}

/** A face to plan with while the centrepiece takes its place. */
const NO_FACE: FaceText = { title: "", note: null, status: null, timer: "00:00", blinds: null, ante: null, breakLine: "", next: "" };

/**
 * The TV clock, filling exactly the screen it is on, whatever its size (round 5, items 17, 19, 21–26):
 * the club's logo centred at the top with the event's name under it, the clock in the middle, the
 * room's figures on one side and the money and the QR code on the other (under the clock on a portrait
 * screen), each part only while there is room for it, in their order of priority. Before the start, on
 * a break and once the game is over the logo is the centrepiece instead, with "Starting soon", the
 * break's countdown or the result under it. Only the core figures show unless the TD switches more on.
 * Nothing scrolls: sized from the visible area inside the tournament's edge margin, re-measured
 * whenever it changes, and shrunk a step further if anything still spills. A layer over it all when
 * the TD puts the seats or the payouts up.
 */
export function ClockScreen({ display, derived, offline, controls }: ClockScreenProps) {
  const handheld = useMediaQuery(HANDHELD_QUERY);
  const clock = display.clock;
  const settings = clock?.displaySettings ?? null;
  const prefs = screenPrefsOf(settings, handheld);
  const sound = useClockSound({ volume: prefs.volume });
  const fullscreen = useFullscreen();
  const awake = usePointerAwake();
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Offered by the staff's controls once they load: only they may change the tournament's settings.
  const [saveSettings, setSaveSettings] = useState<SaveDisplaySettings | null>(null);
  const offerChanges = useCallback((save: SaveDisplaySettings | null) => setSaveSettings(() => save), [setSaveSettings]);
  // Awake for the whole game, not only while the clock runs: Level 1 and the QR code while players
  // arrive, a paused dispute, a meal break, a clock still to be set up (P4REV0-WAKELOCK-PAUSED).
  useWakeLock(!isClosedStatus(display.tournament.status));
  useClockCues(display.tournament.id, derived, clock?.structure.levels ?? NO_LEVELS, sound.play, prefs.cues);
  const stage = useRef<HTMLDivElement>(null);
  const size = useStageSize(stage);

  // A layer over the clock is for a game in play: a finished or cancelled one shows its own message.
  const overlay = clock && derived && !isClosedStatus(display.tournament.status) ? clock.displaySettings.overlay : "none";
  const playing = Boolean(clock && derived) && !isClosedStatus(display.tournament.status);
  const tiles = playing && settings ? displayTiles(display, derived, settings) : [];
  const money = playing && settings ? moneyText(display.money, settings.showPrizePool, display.stats.entrants) : null;
  const caption = display.qr ? qrCaption(display.qr, display.season) : null;
  const clubName = display.club.name.trim() !== display.tournament.name.trim() ? display.club.name : null;
  const showLevel = settings?.showLevel ?? false;
  const centre = centreText(display, derived);
  const face = !centre && derived && clock ? faceText(derived, clock.structure, showLevel) : NO_FACE;
  // What is drawn, bar the seconds: when it changes, the guard looks again.
  const squeeze = useOverflowGuard(stage, size, JSON.stringify([face.title, face.note, face.status, face.blinds, face.ante, face.next, centre, tiles.length, money, caption, overlay]));
  const plan = planScreen({
    width: size.width,
    height: size.height,
    logo: Boolean(display.club.imageUrl),
    name: display.tournament.name,
    clubName,
    face,
    centre,
    tiles,
    money,
    // The code is still there to scan on a screen with no clock to show, bar a cancelled game's.
    qrCaption: display.tournament.status === "cancelled" ? null : caption,
    squeeze,
  });
  const small = Math.max(14, 0.028 * plan.height);
  // A layer covers the header: the strip over it then says the screen is offline (TDN3-OVERLAY-STUCK).
  const strip = derived ? (
    <>
      {offline ? <OfflineBadge size={small} className="mx-auto mb-[1vh]" /> : null}
      <ClockStrip derived={derived} showLevel={showLevel} />
    </>
  ) : null;
  const tools: ScreenTools = { sound, fullscreen, awake, screen: { prefs, openSettings: () => setSettingsOpen(true), offerChanges } };
  const cornerButton = "h-11 w-11 bg-background/70 [&_svg]:size-5";

  return (
    <div className="fixed inset-0 overflow-hidden bg-background text-foreground" style={edgePadding(prefs.applied)} data-testid="clock-screen" data-edge-margin={prefs.applied}>
      <div ref={stage} className="relative flex h-full w-full flex-col overflow-hidden" data-layout={plan.layout}>
        <ScreenHeader display={display} plan={plan} clubName={clubName} />

        <div className="flex min-h-0 flex-1 flex-col">
          <ScreenBody display={display} derived={derived} plan={plan} tiles={tiles} money={money} centre={centre} />
        </div>

        {/* The corners, clear of the centred header: the screen's state on the left, its buttons on the right. */}
        <div className="absolute left-0 top-0 flex max-w-[30%] flex-col items-start gap-2">
          {offline && overlay === "none" ? <OfflineBadge size={small} /> : null}
          {sound.needsTap ? (
            <Button variant="outline" className="h-11 bg-background/70" onMouseDown={keepFocusOnMouseDown} onClick={sound.unlock}>
              <Volume2 aria-hidden="true" />
              Tap to enable sound
            </Button>
          ) : null}
        </div>
        <div className="absolute right-0 top-0 flex max-w-[30%] flex-col items-end gap-2">
          {display.tournament.status !== "in_progress" ? <StatusBadge status={display.tournament.status} /> : null}
          <div className={cn("flex gap-1 transition-opacity has-[:focus-visible]:opacity-100", awake ? "opacity-100" : "opacity-0")}>
            {sound.supported ? (
              <Button
                variant="ghost"
                size="icon"
                className={cornerButton}
                onMouseDown={keepFocusOnMouseDown}
                onClick={sound.toggle}
                aria-label={sound.on ? "Mute the clock" : "Turn the clock's sound on"}
                aria-pressed={!sound.on}
              >
                {sound.on ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}
              </Button>
            ) : null}
            <Button variant="ghost" size="icon" className={cornerButton} onMouseDown={keepFocusOnMouseDown} onClick={() => setSettingsOpen(true)} aria-label="Screen settings: sound and edge margin">
              <Settings2 aria-hidden="true" />
            </Button>
            {fullscreen.supported ? (
              <Button variant="ghost" size="icon" className={cornerButton} onMouseDown={keepFocusOnMouseDown} onClick={fullscreen.toggle} aria-label={fullscreen.active ? "Leave full screen" : "Full screen"}>
                {fullscreen.active ? <Minimize aria-hidden="true" /> : <Maximize aria-hidden="true" />}
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {derived && clock ? (
        <p className="sr-only" aria-live="polite">
          {levelAnnouncement(derived, clock.structure)}
        </p>
      ) : null}
      {overlay === "seating" && strip ? <SeatingOverlay tournamentId={display.tournament.id} strip={strip} size={size} padding={edgePadding(prefs.applied)} /> : null}
      {overlay === "payouts" && strip && clock ? (
        <PayoutsOverlay money={display.money} entrants={display.stats.entrants} settings={clock.displaySettings} strip={strip} size={size} padding={edgePadding(prefs.applied)} />
      ) : null}
      {controls?.(tools)}
      <ScreenSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} prefs={prefs} onChange={saveSettings} sound={sound} handheld={handheld} />
    </div>
  );
}

/** The club's logo centred at the top (contained, never cropped), the event's name under it, the club's name smaller. */
function ScreenHeader({ display, plan, clubName }: { display: LiveDisplayDto; plan: ScreenPlan; clubName: string | null }) {
  const { header } = plan;
  return (
    <header className="flex shrink-0 flex-col items-center text-center" style={{ height: px(header.height), gap: px(header.gap) }}>
      {header.top > 0 ? (
        <div className="flex w-full shrink-0 items-center justify-center" style={{ height: px(header.top) }}>
          {header.logo > 0 ? <TvLogo name={display.club.name} imageUrl={display.club.imageUrl} width={Math.min(header.logo * 3, plan.width * 0.5)} height={header.logo} /> : null}
        </div>
      ) : null}
      <h1
        className="max-w-full truncate font-display font-black tracking-tight text-foreground"
        style={{ fontSize: px(header.name), lineHeight: 1.1, maxWidth: plan.layout === "landscape" ? "64%" : "92%" }}
      >
        {display.tournament.name}
      </h1>
      {header.club && clubName ? (
        <p className="max-w-[64%] truncate font-semibold uppercase tracking-wider text-muted-foreground" style={{ fontSize: px(header.club), lineHeight: 1.25 }}>
          {clubName}
        </p>
      ) : null}
    </header>
  );
}

interface ScreenBodyProps {
  display: LiveDisplayDto;
  derived: DerivedClock | null;
  plan: ScreenPlan;
  tiles: ReturnType<typeof displayTiles>;
  money: ReturnType<typeof moneyText>;
  centre: CentreText | null;
}

function ScreenBody({ display, derived, plan, tiles, money, centre }: ScreenBodyProps) {
  const { tournament, clock, qr, season } = display;
  const H = plan.height;
  const results =
    tournament.status === "completed" && plan.centre ? (
      <Button asChild variant="outline" size="lg" style={{ height: px(plan.centre.action) }}>
        <Link href={routes.publicTournament(tournament.id)}>See the results</Link>
      </Button>
    ) : null;
  const middle =
    centre && plan.centre ? (
      <CentrePiece display={display} derived={derived} text={centre} plan={plan.centre} action={results} />
    ) : derived && clock ? (
      <ClockFace derived={derived} structure={clock.structure} variant="tv" plan={plan.face} />
    ) : null;
  const moneyPanel = money && plan.money ? <DisplayMoney money={display.money} text={money} plan={plan.money} /> : null;
  const code = qr && plan.qr ? <DisplayQr qr={qr} season={season} size={plan.qr.size} caption={plan.qr.caption} /> : null;
  // "safe" keeps a column's top in view if it ever holds more than it shows; a browser without it centres.
  const centred: CSSProperties = { justifyContent: "safe center" };

  if (plan.layout === "landscape") {
    return (
      <div className="flex min-h-0 flex-1" style={{ gap: px(plan.gap) }}>
        {plan.side > 0 ? (
          <div className="flex min-h-0 shrink-0 flex-col justify-center overflow-hidden" style={{ width: px(plan.side), ...centred }} data-fit>
            <DisplayStats tiles={tiles} plan={plan.tiles} />
          </div>
        ) : null}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center overflow-hidden" style={centred} data-fit>
          {middle}
        </div>
        {plan.side > 0 ? (
          <div className="flex min-h-0 shrink-0 flex-col justify-center overflow-hidden" style={{ width: px(plan.side), gap: px(0.015 * H), ...centred }} data-fit>
            {moneyPanel}
            {code}
          </div>
        ) : null}
      </div>
    );
  }

  const first = Math.min(2, plan.tiles.shown);
  const part = (from: number, to: number) => ({ ...plan.tiles, shown: to - from, values: plan.tiles.values.slice(from, to) });
  return (
    <div className="flex min-h-0 flex-1 flex-col items-stretch justify-center overflow-hidden" style={{ gap: px(plan.gap), ...centred }} data-fit>
      <div className="flex justify-center">{middle}</div>
      <DisplayStats tiles={tiles} plan={part(0, first)} />
      {moneyPanel || code ? (
        <div className={cn("grid items-start", moneyPanel && code ? "grid-cols-2" : "grid-cols-1 justify-items-center")} style={{ gap: px(plan.gap) }}>
          {moneyPanel}
          {code}
        </div>
      ) : null}
      <DisplayStats tiles={tiles.slice(first)} plan={part(first, plan.tiles.shown)} />
    </div>
  );
}

