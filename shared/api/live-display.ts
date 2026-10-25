/**
 * The live display: what the TV clock at /clock/:tournamentId, the TD's clock panel and the header's
 * clock chip all read (one endpoint, one query), the public season leaderboard the TV's QR code leads
 * to (phase4-contracts §3–§4), and the prize pool as the players see it on the public page and the TV
 * (round 6). All are public, PII-free projections (no contact details, no user ids: shared/api/public
 * FORBIDDEN_PUBLIC_KEYS), sent with Cache-Control: no-store and polled. The TV is in the room whoever
 * is signed in on it, and the public page is the players', so neither carries the club's takings
 * (shared/api/public FORBIDDEN_TAKINGS_KEYS): only the prize pool, the places and the money carried in.
 * No zod here: the public pages that only show things load this module.
 */
import type { SnapshotDeal } from "../domain/deal";
import { formatMoney, type Cents } from "../domain/money";
import { offersHighHand } from "../domain/player-actions";
import type { CarriedIn } from "../domain/prize-difference";
import {
  computePrizePool,
  payoutsForDisplay,
  type EntryInput,
  type PaidSnapshotInput,
  type PayoutDisplaySource,
  type PayoutDisplayTournament,
  type PrizePoolInput,
  type StoredResultInput,
} from "../domain/prize-pool";
import type { ClubTheme } from "../domain/theme";
import type { TournamentStatus } from "../domain/tournaments";
import type { ClockDto, QrTarget } from "./clock";
import type { LeaderboardEntryDto } from "./seasons";

/** Money carried into a pool from an earlier tournament of the club, as players are told of it. */
export interface PublicCarriedIn {
  /** The earlier tournament's name, as it was when its money was carried over. */
  fromName: string;
  amountCents: Cents;
}

/**
 * What the screens say of the money carried in, in one wording for the public page and the TV:
 * "Includes $200 carried over from Week 3" ("… from Week 3 and Week 4" for two, "…, Week 4 and Week 5"
 * for more). Null when nothing was carried in.
 */
export function carriedInNote(carriedIn: readonly PublicCarriedIn[]): string | null {
  if (carriedIn.length === 0) return null;
  const cents = carriedIn.reduce((total, entry) => total + entry.amountCents, 0);
  const names = carriedIn.map((entry) => entry.fromName);
  const from = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `Includes ${formatMoney(cents)} carried over from ${from}`;
}

/** One paid place as the public sees it. */
export interface PublicPayoutDto {
  position: number;
  amountCents: Cents;
  /** Who it went to, once the prizes are paid (the registration's id; a deal marks its players). */
  registrationId?: string;
}

/**
 * GET /api/public/tournaments/:id/prizes (anyone, round 6): what the players play for, worked out on
 * the server (toPublicPrizes) with the same shared functions finalize pays with, so no public page needs
 * the club's takings to show it. Every viewer gets the same body, staff included (it is what the public
 * page shows them). PII-free, takings-free.
 */
export interface PublicPrizesDto {
  tournamentId: string;
  /** The TD has locked the pool: from then on the public page shows the amounts. */
  locked: boolean;
  /** Not locked and not completed: the figures can still change. */
  estimated: boolean;
  /**
   * Where the payouts come from (payoutsForDisplay): "live" while the game is open (what finalize would
   * pay now), "snapshot"/"stored" once paid, "unrecorded" for results typed in without prizes, and
   * "cancelled" (nothing is paid).
   */
  source: PayoutDisplaySource;
  /** The prize pool to headline: what was paid once completed, 0 once cancelled, else the current pool (never below 0). */
  poolCents: Cents;
  /** What each place pays: the live split for as many places as the pool counts players, or what was paid. */
  payouts: PublicPayoutDto[];
  /**
   * The part of the pool no place pays: places beyond the players in the pool (live: the places listed
   * are then one per player), or what the paid prizes left.
   */
  undistributedCents: Cents;
  /** Money carried in from earlier tournaments (carriedInNote words it). Empty when none. */
  carriedIn: PublicCarriedIn[];
  /** The high-hand pot players play for (the entry fees less the club's share), or null without a high hand. */
  highHandPotCents: Cents | null;
  /** The deal the last players made, once paid with one (source "snapshot"): what each was paid instead of their place. */
  deal: SnapshotDeal | null;
}

/**
 * The tournament fields the public prize pool is worked out from: a tournament row fits as it is. Its
 * snapshot, once finalized, says what was paid, carried in and dealt.
 */
export type PrizesTournament = PrizePoolInput &
  PayoutDisplayTournament & {
    id: string;
    prizePoolLocked?: boolean | null;
    enableHighHand?: boolean | null;
    prizePoolSnapshot?: (PaidSnapshotInput & { pool: { carriedIn?: readonly CarriedIn[] }; deal?: SnapshotDeal }) | null;
  };

/**
 * The public prize pool of `tournament` (PublicPrizesDto), from the same shared functions finalize pays
 * with: computePrizePool counts the paid players only, so `registrations` must carry their payment
 * status, as only the server's do. The money carried in is as finalize froze it once completed (a
 * snapshot from before round 5 records none), else as the pool holds it now: where it came from and how
 * much, nothing else.
 */
export function toPublicPrizes(tournament: PrizesTournament, registrations: ReadonlyArray<EntryInput & StoredResultInput>): PublicPrizesDto {
  const breakdown = computePrizePool(tournament, registrations);
  const display = payoutsForDisplay(tournament, breakdown, registrations);
  const snapshot = tournament.prizePoolSnapshot ?? null;
  const carriedIn = tournament.status === "completed" ? (snapshot?.pool.carriedIn ?? []) : breakdown.carriedIn;
  // What was paid (the frozen or stored prizes), or nothing for a cancelled tournament; else the current pool.
  const settled = display.source === "snapshot" || display.source === "stored" || display.source === "cancelled";
  const locked = tournament.prizePoolLocked === true;
  return {
    tournamentId: tournament.id,
    locked,
    estimated: !locked && tournament.status !== "completed",
    source: display.source,
    poolCents: settled ? display.totalCents : Math.max(0, breakdown.net),
    payouts: display.rows.map(({ position, amountCents, registrationId }) => (registrationId ? { position, amountCents, registrationId } : { position, amountCents })),
    undistributedCents: display.undistributedCents,
    carriedIn: carriedIn.map(({ fromName, amountCents }) => ({ fromName, amountCents })),
    highHandPotCents: offersHighHand(tournament) ? Math.max(0, breakdown.highHand.net) : null,
    deal: display.source === "snapshot" ? (snapshot?.deal ?? null) : null,
  };
}

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
  /**
   * `theme`: the club's colours (round 5; readTheme), null for the LovePoker look: the TV wears them.
   * `rakeLabel`: the club's name for its take ("AP"), for the TD's clock panel; the TV never shows it.
   */
  club: { id: string; name: string; slug: string; imageUrl: string | null; rakeLabel: string; theme: ClubTheme | null };
  /** Null when the tournament has no season (or it was deleted). */
  season: { id: string; name: string } | null;
  /** Null until the TD sets the clock up. */
  clock: ClockDto | null;
  /**
   * The field's numbers: every player in the game (the waiting list is not), paid or not (round 6: the
   * chips are on the table before the TD ticks the payment), whatever the prize pool counts.
   */
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
  /**
   * The prize money as the room sees it (server/services/public-prizes, as the public page): the pool
   * and the places, never what the club takes, keeps, adds or carries over (round 6).
   */
  money: {
    /** Per displaySettings.showPrizePool: "when_locked" shows it once the pool is locked or the tournament completed. */
    show: boolean;
    /** Not locked and not completed: the figures can still change (the TV marks them "est."). */
    estimated: boolean;
    /** Null unless shown. Completed: what was paid. */
    netCents: Cents | null;
    /** Null unless shown with showPayouts. */
    payouts: Array<{ position: number; amountCents: Cents }> | null;
    /**
     * Null unless shown: the money carried into the pool from earlier tournaments ("Includes $200
     * carried over from Week 3": carriedInNote). Completed: as finalize froze it. Empty when none.
     */
    carriedIn: PublicCarriedIn[] | null;
  };
  /** Where the QR code leads (a path on this site), or null for no QR. Season falls back to the tournament page. */
  qr: { target: Exclude<QrTarget, "none">; path: string } | null;
  viewer: {
    /**
     * The tournament is open and the viewer may run its clock: signed in as a manager of the club, or
     * a screen holding the clock key in force (CLOCK_KEY_HEADER). The TV then shows its controls, and
     * may change its own settings from there (PATCH …/clock/display: the layer over the clock, the
     * sounds and the edge margin; round 6). What the TV shows (the prize pool, the payouts, the
     * figures, the QR code) is the TD's, from the Clock tab.
     */
    canControl: boolean;
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
