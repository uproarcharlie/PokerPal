import { and, asc, desc, eq, isNotNull, ne, sql } from "drizzle-orm";
import { players, tournamentRegistrations, tournaments } from "@shared/schema";
import type { PublicPlayer } from "@shared/api/public";
import type { Executor } from "../db";
import { publicPlayerColumns } from "./players";

export interface LeaderboardRow {
  rank: number;
  player: PublicPlayer;
  points: number;
  tournaments: number;
}

/**
 * A season's standings in one aggregate (perf-21): every player with points from any of the
 * season's tournaments, highest total first, ties by name. `rank` is competition ranking (1, 2, 2, 4);
 * `tournaments` counts the tournaments in which the player scored.
 */
export async function seasonLeaderboard(ex: Executor, seasonId: string): Promise<LeaderboardRow[]> {
  const total = sql`sum(${tournamentRegistrations.pointsAwarded})`;
  return ex
    .select({
      rank: sql<number>`rank() over (order by ${total} desc)`.mapWith(Number),
      player: publicPlayerColumns,
      points: sql<number>`${total}`.mapWith(Number),
      tournaments: sql<number>`count(distinct ${tournamentRegistrations.tournamentId})`.mapWith(Number),
    })
    .from(tournamentRegistrations)
    .innerJoin(tournaments, eq(tournaments.id, tournamentRegistrations.tournamentId))
    .innerJoin(players, eq(players.id, tournamentRegistrations.playerId))
    .where(
      and(
        eq(tournaments.seasonId, seasonId),
        isNotNull(tournamentRegistrations.pointsAwarded),
        ne(tournamentRegistrations.pointsAwarded, 0),
      ),
    )
    .groupBy(players.id)
    .orderBy(desc(total), asc(players.name), asc(players.id));
}
