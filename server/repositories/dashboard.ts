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
      // Round 5 (item 16): money carried in is part of a live pool.
      carriedIn: tournaments.carriedIn,
      prizePoolSnapshot: tournaments.prizePoolSnapshot,
    })
    .from(tournaments)
    .where(inScope(scope));
}

/** Buy-ins, re-buys and add-ons summed over some registrations, and how many registrations they are. */
export interface Entries {
  registrations: number;
  buyIns: number;
  rebuys: number;
  addons: number;
}

export interface EntryTotals {
  tournamentId: string;
  /** The registrations whose payment is confirmed, free entries left out: what a prize pool counts (round 6, poolEntries). */
  paid: Entries;
  /** The others: only a tournament completed before snapshots still counts them. */
  unpaid: Entries;
  /** Round 7: the free entries the club does not pay in for (accepted; their buy-ins bring nothing). */
  free: Entries;
  /** Round 7: the free entries the club pays the buy-ins of into the pool. */
  funded: Entries;
  /** The sum of the stored prizes, decimal text. */
  prizes: string;
}

const isFree = sql`${tournamentRegistrations.freeEntry} is true`;
const notFree = sql`${tournamentRegistrations.freeEntry} is not true`;
const paid = sql`${tournamentRegistrations.paymentConfirmed} is true and ${notFree}`;
const unpaid = sql`${tournamentRegistrations.paymentConfirmed} is not true and ${notFree}`;
const free = sql`${isFree} and ${tournamentRegistrations.freeEntryFunded} is not true`;
const funded = sql`${isFree} and ${tournamentRegistrations.freeEntryFunded} is true`;

/** `column` summed over the registrations `which` picks, 0 for none. */
const sumWhere = (column: AnyColumn, which: SQL) =>
  sql<number>`coalesce(sum(${column}) filter (where ${which}), 0)`.mapWith(Number);

/** How many registrations `which` picks, and their buy-ins, re-buys and add-ons, as the select's columns. */
const entriesWhere = (which: SQL) => ({
  registrations: sql<number>`count(*) filter (where ${which})`.mapWith(Number),
  buyIns: sumWhere(tournamentRegistrations.buyIns, which),
  rebuys: sumWhere(tournamentRegistrations.rebuys, which),
  addons: sumWhere(tournamentRegistrations.addons, which),
});

/**
 * Entries (paid, unpaid and free entries apart) and stored prizes summed per tournament in scope: one
 * query for every registration (perf-20).
 */
export async function entryTotalsByTournament(ex: Executor, scope: DashboardScope): Promise<EntryTotals[]> {
  return await ex
    .select({
      tournamentId: tournamentRegistrations.tournamentId,
      paid: entriesWhere(paid),
      unpaid: entriesWhere(unpaid),
      free: entriesWhere(free),
      funded: entriesWhere(funded),
      prizes: sql<string>`coalesce(sum(${tournamentRegistrations.prizeAmount}), 0)::text`,
    })
    .from(tournamentRegistrations)
    .innerJoin(tournaments, eq(tournaments.id, tournamentRegistrations.tournamentId))
    .where(inScope(scope))
    .groupBy(tournamentRegistrations.tournamentId);
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
