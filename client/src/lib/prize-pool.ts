/**
 * A tournament's money as every screen shows it, worked out with the same shared/domain functions the
 * server pays from (finalize, GET /api/tournaments/:id/prize-pool), so what a TD sees on the admin
 * page, players see on the public page and finalize pays are the same numbers.
 */
import type { PublicPrizesDto } from "@shared/api/live-display";
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
import { fieldEntries, type WaitingListEntry } from "@shared/domain/waiting-list";

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
  /**
   * The paid players the pool counts (round 6). While part of the pool is not paid out, the places
   * listed are one per paid player, so a screen not told who has paid counts its places.
   */
  paid: number;
  /** Everyone in the field, paid or not (the waiting list behind a full one is not). */
  field: number;
}

/** The staff's PoolPlayers: the paid players `money` counts, and the field the registrations make. */
export function poolPlayersOf(money: TournamentMoney, tournament: Pick<PrizePoolInput, "maxPlayers">, registrations: readonly WaitingListEntry[]): PoolPlayers {
  return { paid: money.breakdown.counts.registrations, field: fieldEntries(registrations, tournament.maxPlayers).length };
}

/** Who reads the note: the club's staff, who confirm the payments, or the room. */
export type NoteReader = "staff" | "room";

/**
 * Why part of the pool is not paid out, in one wording for every screen that says so (the TD's and the
 * players' prize structure, the TV, the paid pool): fewer players in the pool than paid places. Only
 * paid players are in it (round 6), so while some of the field has not paid the note counts the paid
 * players and says the money comes as payments do, not as more players enter (R6REV0-MONEY-02). Null
 * when all of it is paid out. `players` is for a game still running.
 */
export function undistributedNote(display: Pick<PayoutDisplay, "source" | "undistributedCents">, players: PoolPlayers, reader: NoteReader = "room"): string | null {
  if (display.undistributedCents <= 0) return null;
  const amount = formatMoney(display.undistributedCents);
  if (display.source !== "live") return `${amount} of the pool was not paid out: there were fewer players than paid places.`;
  const { paid, field } = players;
  if (paid >= field) return `Only ${paid} ${paid === 1 ? "player" : "players"}: ${amount} of the pool is not paid out unless more players enter.`;
  const until = reader === "staff" ? "until more payments are confirmed" : "yet";
  return `Only ${paid} paid ${paid === 1 ? "player" : "players"}: ${amount} of the pool is not paid out ${until}.`;
}

