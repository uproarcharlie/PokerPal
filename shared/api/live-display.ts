/**
 * The live display: what the TV clock at /clock/:tournamentId, the TD's clock panel and the header's
 * clock chip all read (one endpoint, one query), and the public season leaderboard the TV's QR code
 * leads to (phase4-contracts §3–§4). Both are public, PII-free projections (no contact details, no
 * user ids: shared/api/public FORBIDDEN_PUBLIC_KEYS), sent with Cache-Control: no-store and counted
 * by the `live` rate limit, never the venue's shared budget.
 */
import type { Cents } from "../domain/money";
import type { DifferenceLine } from "../domain/prize-difference";
import type { NetSource } from "../domain/prize-pool";
import type { ClubTheme } from "../domain/theme";
import type { TournamentStatus } from "../domain/tournaments";
import type { ClockDto, QrTarget } from "./clock";
import type { LeaderboardEntryDto } from "./seasons";

/**
 * GET /api/public/tournaments/:id/display (anyone), and the answer to every clock write. `serverNow`
 * (epoch ms, taken just before the response is sent) lets a screen tick from the server's time:
 * deriveClock(clock, levels, estimatedServerNow) on every frame.
 */
export interface LiveDisplayDto {
  serverNow: number;
  tournament: {
    id: string;
    name: string;
    status: TournamentStatus;
    startDateTime: string;
    seasonId: string | null;
    /**
     * Kept for the TV's re-buy tile: once the pool is locked the desk refuses every re-buy and add-on
     * (PRIZE_POOL_LOCKED), so the room should read "Closed" whatever the period's countdown says. No
     * screen reads it yet (P4REV4-R3-CQ-03).
     */
    prizePoolLocked: boolean;
    /** Minutes of clock time (breaks included) during which re-buys are sold; null: no limit set. */
    rebuyPeriodMinutes: number | null;
    offersRebuys: boolean;
    offersAddons: boolean;
  };
  /** `theme`: the club's colours (round 5; readTheme), null for the LovePoker look: the TV wears them. */
  club: { id: string; name: string; slug: string; imageUrl: string | null; rakeLabel: string; theme: ClubTheme | null };
  /** Null when the tournament has no season (or it was deleted). */
  season: { id: string; name: string } | null;
  /** Null until the TD sets the clock up. */
  clock: ClockDto | null;
  stats: {
    entrants: number;
    /** Players still in. */
    remaining: number;
    buyIns: number;
    rebuys: number;
    addons: number;
    earlyBirds: number;
    activeTables: number;
    /** computeChipStats: null when a stack it needs is not set, or both showAverageStack and showChipsInPlay are off. */
    totalChips: number | null;
    /** computeChipStats: null when a stack it needs is not set, or showAverageStack is off. */
    averageStack: number | null;
  };
  money: {
    /** Per displaySettings.showPrizePool: "when_locked" shows it once the pool is locked or the tournament completed. */
    show: boolean;
    /** Not locked and not completed: the figures can still change (the TV marks them "est."). */
    estimated: boolean;
    /** rakeLabel(club), e.g. "AP". */
    rakeLabel: string;
    /** Null unless shown. Completed: what was paid. */
    netCents: Cents | null;
    /**
     * Whether netCents is calculated, follows a manual AP total or is a fixed pool. No screen reads it
     * yet (P4REV4-R3-CQ-03); kept until the client's display fixtures stop setting it, then removed.
     */
    netSource: NetSource | null;
    /**
     * Only with displaySettings.showAp: the club's take (impliedRake, never below 0); while `lines`
     * itemise the pool, the AP alone (the rates' or the manual total), what the club kept, carried
     * over or added being in those lines.
     */
    apCents: Cents | null;
    /**
     * With showAp, when the prize pool is fixed above what was taken in (a guarantee) and no `lines`
     * itemise it: what the club adds on top, e.g. 60000 for "Added by the club $600" (apCents is then
     * 0). Null otherwise.
     */
    clubAddedCents: Cents | null;
    /** Null unless shown with showPayouts. */
    payouts: Array<{ position: number; amountCents: Cents }> | null;
    /**
     * Null unless shown. The pool's honest breakdown beside it (round 5, item 16; differenceLines, the
     * TD's and the public pages' lines): money carried in from earlier tournaments, what the club keeps
     * of the difference, what is carried over and where, what was added to the prizes, what the club
     * adds. Completed: as finalize froze it. Empty when the prizes are exactly the money available.
     */
    lines: DifferenceLine[] | null;
  };
  /** Where the QR code leads (a path on this site), or null for no QR. Season falls back to the tournament page. */
  qr: { target: Exclude<QrTarget, "none">; path: string } | null;
  viewer: {
    /**
     * The tournament is open and the viewer may run its clock: signed in as a manager of the club, or
     * a screen holding the clock key in force (CLOCK_KEY_HEADER). The TV then shows its controls.
     */
    canControl: boolean;
    /**
     * The tournament is open and the viewer is signed in as a manager of the club: PATCH
     * …/clock/display (the layer over the clock, the TV's sound and edge margin) takes their changes.
     * A screen holding only the clock key runs the clock, and is shown those settings, not changing them.
     */
    canChangeDisplay: boolean;
    /**
     * For a manager of the club: when the TV's clock key now in force was issued and when it stops
     * working (ISO), or both null for none. A key is in force until it expires, is revoked or replaced,
     * and only while whoever issued it may still manage the club.
     */
    clockKeyIssuedAt: string | null;
    clockKeyExpiresAt: string | null;
  };
}

/** `details` of every 409 a clock write answers: the clock as it now is. */
export interface ClockConflictDetails {
  display: LiveDisplayDto;
}

/**
 * GET /api/public/seasons/:id/leaderboard (anyone): the season page the TV's QR code opens. Same rows
 * as GET /api/seasons/:id/leaderboard (competition ranking, players with points only, PublicPlayer),
 * with the season and club to head the page. 404 NOT_FOUND for an unknown season.
 */
export interface PublicSeasonLeaderboardDto {
  season: { id: string; name: string; startDate: string; endDate: string | null; isActive: boolean };
  club: { id: string; name: string; slug: string; imageUrl: string | null; theme: ClubTheme | null };
  entries: LeaderboardEntryDto[];
  /** The season's tournaments that are completed, and all of them (cancelled ones left out). */
  tournaments: { completed: number; total: number };
  generatedAt: string;
}
