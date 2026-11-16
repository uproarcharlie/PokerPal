/**
 * A tournament's money as every screen shows it, worked out with the same shared/domain functions the
 * server pays from (finalize, GET /api/tournaments/:id/prize-pool), so what a TD sees on the admin
 * page, players see on the public page and finalize pays are the same numbers.
 */
import type { PublicPrizesDto } from "@shared/api/live-display";
import { formatMoney, type Cents } from "@shared/domain/money";
import { placeName } from "@shared/domain/payouts";
import {
  computePrizePool,
  payoutsForDisplay,
  unfilledPlacesCents,
  type EntryInput,
  type PayoutDisplay,
  type PayoutDisplayTournament,
  type PrizePoolBreakdown,
  type PrizePoolInput,
  type StoredResultInput,
} from "@shared/domain/prize-pool";
import { fieldEntries, type WaitingListEntry } from "@shared/domain/waiting-list";

export interface TournamentMoney {
  /** The live calculation (gross, AP, net, v3 payouts, high hand). */
  breakdown: PrizePoolBreakdown;
  /** The payouts to show: what was paid for a completed tournament, none for a cancelled one, else the live v3 split. */
  display: PayoutDisplay;
  /**
   * The prize pool to headline: the paid total once completed, nothing once cancelled, else the
   * current net pool, what the places pay (round 7; also for a completed tournament whose prizes were
   * never recorded, which screens label as not recorded).
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
 * The money as someone who does not run the club is shown it on the staff's page (round 6): their
 * registrations carry no payment status, and only paid players are in the pool, so the pool and the
 * places are the server's public prize pool. The breakdown is left as worked out locally; its AP and
 * gross are the staff's, and those screens are not shown to them.
 */
export function withPublicPrizes(local: TournamentMoney, prizes: PublicPrizesDto): TournamentMoney {
  const rows = prizes.payouts.map(({ position, amountCents, registrationId }) => ({
    position,
    amountCents,
    percentage: null,
    ...(registrationId ? { registrationId } : {}),
  }));
  return {
    breakdown: local.breakdown,
    display: {
      source: prizes.source,
      rows,
      totalCents: rows.reduce((total, row) => total + row.amountCents, 0),
      undistributedCents: prizes.undistributedCents,
    },
    poolCents: prizes.poolCents,
  };
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

/** Who a running game's pool is from: the players whose money is in it, and everyone playing. */
export interface PoolPlayers {
  /** The accepted players the pool counts (round 6: paid, or given a free entry). */
  paid: number;
  /** Everyone in the field, paid or not (the waiting list behind a full one is not). */
  field: number;
}

/** The staff's PoolPlayers: the paid players `money` counts, and the field the registrations make. */
export function poolPlayersOf(money: TournamentMoney, tournament: Pick<PrizePoolInput, "maxPlayers">, registrations: readonly WaitingListEntry[]): PoolPlayers {
  return { paid: money.breakdown.counts.registrations, field: fieldEntries(registrations, tournament.maxPlayers).length };
}

/**
 * Why part of a completed tournament's pool was not paid out, in one wording for every screen that says
 * so (the TD's and the players' prize structure, the paid pool): a snapshot frozen before round 7 kept
 * the share of places beyond the players in its pool. Null when all of it was paid out, as always since
 * round 7 (the pool is what the places pay: unfilledPlacesNote says, to the staff only, what the places
 * with no player in them would pay).
 */
export function undistributedNote(display: Pick<PayoutDisplay, "undistributedCents">): string | null {
  if (display.undistributedCents <= 0) return null;
  return `${formatMoney(display.undistributedCents)} of the pool was not paid out: there were fewer players than paid places.`;
}

/**
 * For the club's staff only (round 7: it is part of the club's fee): while fewer players are in the pool
 * than there are paid places, the places below them are not paid and what they would pay goes to the
 * club's fee with the rest of the leftover. Only accepted players are in the pool (round 6), so while
 * some of the field (`players.field`) is not, the money comes as payments are confirmed
 * (R6REV0-MONEY-02). Null when every place has a player, or nobody is in the pool yet.
 */
export function unfilledPlacesNote(
  breakdown: Pick<PrizePoolBreakdown, "manualPrizePool" | "netAfterAp" | "structure" | "counts">,
  players: PoolPlayers,
  rakeLabel: string,
): string | null {
  const cents = unfilledPlacesCents(breakdown);
  const { paid, field } = players;
  if (cents <= 0 || paid <= 0) return null;
  const who = paid >= field ? `${paid} ${paid === 1 ? "player" : "players"}` : `${paid} paid ${paid === 1 ? "player" : "players"}`;
  const until = paid >= field ? "unless more players enter" : "until more payments are confirmed";
  return `Only ${who}: places below ${placeName(paid)} are not paid, so the ${formatMoney(cents)} they would pay goes to ${rakeLabel} ${until}.`;
}
