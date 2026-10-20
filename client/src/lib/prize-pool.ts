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

