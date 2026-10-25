/**
 * A tournament's money as every screen shows it, worked out with the same shared/domain functions the
 * server pays from (finalize, GET /api/tournaments/:id/prize-pool), so what a TD sees on the admin
 * page, players see on the public page and finalize pays are the same numbers.
 */
import { formatMoney, type Cents } from "@shared/domain/money";
import {
  computePrizePool,
  payoutsForDisplay,
  type EntryInput,
  type PayoutDisplay,
  type PayoutDisplayTournament,
  type PrizePoolBreakdown,
  type PrizePoolInput,
  type StoredResultInput,
} from "@shared/domain/prize-pool";

export interface TournamentMoney {
  /** The live calculation (gross, AP, net, v2 payouts, high hand). */
  breakdown: PrizePoolBreakdown;
  /** The payouts to show: what was paid for a completed tournament, none for a cancelled one, else the live v2 split. */
  display: PayoutDisplay;
  /**
   * The prize pool to headline: the paid total once completed, nothing once cancelled, else the
   * current net pool (also for a completed tournament whose prizes were never recorded, which screens
   * label as not recorded).
   */
  poolCents: Cents;
}

export function tournamentMoney(
  tournament: PrizePoolInput & PayoutDisplayTournament,
  registrations: ReadonlyArray<EntryInput & StoredResultInput>,
): TournamentMoney {
  const breakdown = computePrizePool(tournament, registrations);
  const display = payoutsForDisplay(tournament, breakdown, registrations);
  // What was paid: the frozen or stored prizes, or nothing for a cancelled tournament.
  const settled = display.source === "snapshot" || display.source === "stored" || display.source === "cancelled";
  return { breakdown, display, poolCents: settled ? display.totalCents : breakdown.net };
}

/**
 * What the club keeps of what came in, as every money screen names it (the AP panel, the finalize
 * confirmation): its AP, under the club's label; under a prize pool fixed by hand, what that leaves the
 * club ("AP the club keeps"), or "Added by the club" when the pool is more than came in. Always the
 * implied take (gross less the pool paid), never the rates' figure a fixed pool overrides (MONEY-AP-03).
 */
export function clubTake(pool: { impliedCents: Cents; netSource: PrizePoolBreakdown["netSource"] }, rakeLabel: string): { label: string; cents: Cents } {
  if (pool.impliedCents < 0) return { label: "Added by the club", cents: -pool.impliedCents };
  return { label: pool.netSource === "manual_pool" ? `${rakeLabel} the club keeps` : rakeLabel, cents: pool.impliedCents };
}

/**
 * Why part of the pool is not paid out, in one wording for every screen that says so (the TD's and the
 * players' prize structure, the paid pool): fewer players than paid places. Null when all of it is
 * paid. `entrants` is how many players are entered (for a game still running).
 */
export function undistributedNote(display: Pick<PayoutDisplay, "source" | "undistributedCents">, entrants: number): string | null {
  if (display.undistributedCents <= 0) return null;
  const amount = formatMoney(display.undistributedCents);
  return display.source === "live"
    ? `Only ${entrants} ${entrants === 1 ? "player" : "players"}: ${amount} of the pool is not paid out unless more players enter.`
    : `${amount} of the pool was not paid out: there were fewer players than paid places.`;
}

