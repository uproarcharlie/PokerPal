import { count, eq, inArray, sql, type SQL } from "drizzle-orm";
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
      prizePoolSnapshot: tournaments.prizePoolSnapshot,
    })
    .from(tournaments)
    .where(inScope(scope));
}

export interface EntryTotals {
  tournamentId: string;
  buyIns: number;
  rebuys: number;
  addons: number;
  /** The sum of the stored prizes, decimal text. */
  prizes: string;
}

/** Entries and stored prizes summed per tournament in scope: one query for every registration (perf-20). */
export async function entryTotalsByTournament(ex: Executor, scope: DashboardScope): Promise<EntryTotals[]> {
  return await ex
    .select({
      tournamentId: tournamentRegistrations.tournamentId,
      buyIns: sql<number>`coalesce(sum(${tournamentRegistrations.buyIns}), 0)`.mapWith(Number),
      rebuys: sql<number>`coalesce(sum(${tournamentRegistrations.rebuys}), 0)`.mapWith(Number),
      addons: sql<number>`coalesce(sum(${tournamentRegistrations.addons}), 0)`.mapWith(Number),
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
