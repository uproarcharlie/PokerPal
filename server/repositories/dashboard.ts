import { count, eq, inArray, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { clubs, players, tournamentRegistrations, tournaments } from "@shared/schema";
import type { Executor } from "../db";
import { countPlayersKnownAt } from "./players";

/** Which clubs' numbers to count: every club (admins), or the listed ones (never empty here). */
export type DashboardScope = { all: true } | { all: false; clubIds: readonly string[] };

const inScope = (scope: DashboardScope): SQL | undefined =>
  scope.all ? undefined : inArray(tournaments.clubId, [...scope.clubIds]);

/** The columns the prize-pool maths reads, for every tournament in scope. */
export async function tournamentsForStats(ex: Executor, scope: DashboardScope) {
  return await ex
    .select({
      id: tournaments.id,
      status: tournaments.status,
      buyInAmount: tournaments.buyInAmount,
      rebuyAmount: tournaments.rebuyAmount,
      addonAmount: tournaments.addonAmount,
      rakeType: tournaments.rakeType,
      rakeAmount: tournaments.rakeAmount,
      rebuyRakeType: tournaments.rebuyRakeType,
      rebuyRakeAmount: tournaments.rebuyRakeAmount,
      addonRakeType: tournaments.addonRakeType,
      addonRakeAmount: tournaments.addonRakeAmount,
      payoutStructure: tournaments.payoutStructure,
      customPayouts: tournaments.customPayouts,
      manualPrizePool: tournaments.manualPrizePool,
      rakeOverride: tournaments.rakeOverride,
      // Round 5 (item 16): a difference added to the prizes, and money carried in, are part of a live pool.
      prizeDifference: tournaments.prizeDifference,
      carriedIn: tournaments.carriedIn,
      prizePoolSnapshot: tournaments.prizePoolSnapshot,
    })
    .from(tournaments)
    .where(inScope(scope));
}

/** Buy-ins, re-buys and add-ons summed over some registrations. */
export interface Entries {
  buyIns: number;
  rebuys: number;
  addons: number;
}

export interface EntryTotals {
  tournamentId: string;
  /** The registrations whose payment is confirmed: what a prize pool counts (round 6, poolEntries). */
  paid: Entries;
  /** The others: only a tournament completed before snapshots still counts them. */
  unpaid: Entries;
  /** The sum of the stored prizes, decimal text. */
  prizes: string;
}

const paid = sql`${tournamentRegistrations.paymentConfirmed} is true`;
const unpaid = sql`${tournamentRegistrations.paymentConfirmed} is not true`;

/** `column` summed over the registrations `which` picks, 0 for none. */
const sumWhere = (column: AnyColumn, which: SQL) =>
  sql<number>`coalesce(sum(${column}) filter (where ${which}), 0)`.mapWith(Number);

/** Entries (paid and unpaid apart) and stored prizes summed per tournament in scope: one query for every registration (perf-20). */
export async function entryTotalsByTournament(ex: Executor, scope: DashboardScope): Promise<EntryTotals[]> {
  const rows = await ex
    .select({
      tournamentId: tournamentRegistrations.tournamentId,
      paidBuyIns: sumWhere(tournamentRegistrations.buyIns, paid),
      paidRebuys: sumWhere(tournamentRegistrations.rebuys, paid),
      paidAddons: sumWhere(tournamentRegistrations.addons, paid),
      unpaidBuyIns: sumWhere(tournamentRegistrations.buyIns, unpaid),
      unpaidRebuys: sumWhere(tournamentRegistrations.rebuys, unpaid),
      unpaidAddons: sumWhere(tournamentRegistrations.addons, unpaid),
      prizes: sql<string>`coalesce(sum(${tournamentRegistrations.prizeAmount}), 0)::text`,
    })
    .from(tournamentRegistrations)
    .innerJoin(tournaments, eq(tournaments.id, tournamentRegistrations.tournamentId))
    .where(inScope(scope))
    .groupBy(tournamentRegistrations.tournamentId);
  return rows.map((row) => ({
    tournamentId: row.tournamentId,
    paid: { buyIns: row.paidBuyIns, rebuys: row.paidRebuys, addons: row.paidAddons },
    unpaid: { buyIns: row.unpaidBuyIns, rebuys: row.unpaidRebuys, addons: row.unpaidAddons },
    prizes: row.prizes,
  }));
}

/** Every player for admins; otherwise the players known at the clubs (countPlayersKnownAt), as their Players lists show them. */
export async function countPlayers(ex: Executor, scope: DashboardScope): Promise<number> {
  if (!scope.all) return countPlayersKnownAt(ex, scope.clubIds);
  const [row] = await ex.select({ value: count() }).from(players);
  return row?.value ?? 0;
}

export async function countClubs(ex: Executor, scope: DashboardScope): Promise<number> {
  const [row] = await ex
    .select({ value: count() })
    .from(clubs)
    .where(scope.all ? undefined : inArray(clubs.id, [...scope.clubIds]));
  return row?.value ?? 0;
}
