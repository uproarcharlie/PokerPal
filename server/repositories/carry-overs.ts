import { and, asc, eq, gt, isNull, ne, or, type SQL } from "drizzle-orm";
import { prizeCarryOvers, seasons, tournaments, type PrizeCarryOver } from "@shared/schema";
import type { Executor } from "../db";

/** The carry-over `sourceTournamentId` wrote at finalize (one per tournament), if any. */
export async function carryOverOfSource(ex: Executor, sourceTournamentId: string): Promise<PrizeCarryOver | undefined> {
  const [row] = await ex.select().from(prizeCarryOvers).where(eq(prizeCarryOvers.sourceTournamentId, sourceTournamentId));
  return row;
}

/** The carry-over `sourceTournamentId` wrote at finalize, locked until the transaction ends. */
export async function lockCarryOverOfSource(ex: Executor, sourceTournamentId: string): Promise<PrizeCarryOver | undefined> {
  const [row] = await ex.select().from(prizeCarryOvers).where(eq(prizeCarryOvers.sourceTournamentId, sourceTournamentId)).for("update");
  return row;
}

/** One carry-over, locked until the transaction ends: two tournaments taking it at once queue here. */
export async function lockCarryOver(ex: Executor, id: string): Promise<PrizeCarryOver | undefined> {
  const [row] = await ex.select().from(prizeCarryOvers).where(eq(prizeCarryOvers.id, id)).for("update");
  return row;
}

export type NewCarryOver = Pick<typeof prizeCarryOvers.$inferInsert, "sourceTournamentId" | "sourceName" | "targetSeasonId" | "amountCents" | "createdBy">;

export async function insertCarryOver(ex: Executor, values: NewCarryOver): Promise<PrizeCarryOver> {
  const [row] = await ex.insert(prizeCarryOvers).values(values).returning();
  return row;
}

/** A correction's new amount, name and season for a carry-over no tournament has taken yet. */
export async function updateCarryOver(
  ex: Executor,
  id: string,
  values: Pick<PrizeCarryOver, "sourceName" | "targetSeasonId" | "amountCents">,
): Promise<PrizeCarryOver | undefined> {
  const [row] = await ex.update(prizeCarryOvers).set(values).where(eq(prizeCarryOvers.id, id)).returning();
  return row;
}

/** Marks a carry-over taken by `tournamentId` (by `userId`), or free again with null. */
export async function setCarryOverAppliedTo(ex: Executor, id: string, tournamentId: string | null, userId: string | null): Promise<void> {
  await ex
    .update(prizeCarryOvers)
    .set({ appliedToTournamentId: tournamentId, appliedAt: tournamentId ? new Date() : null, appliedBy: tournamentId ? userId : null })
    .where(eq(prizeCarryOvers.id, id));
}

export interface CarryOverWithSource {
  carryOver: PrizeCarryOver;
  /** When the tournament that carried it over was finalized. */
  sourceFinalizedAt: Date | null;
  /** The season it was carried over to, if any. */
  seasonName: string | null;
}

/**
 * The carry-overs a tournament of `clubId` in `seasonId` may take: money still free (and more than $0)
 * that another completed tournament of the club carried over to this season, or to no season. Oldest
 * first, so the money that has waited longest is offered first.
 */
export async function availableCarryOvers(
  ex: Executor,
  target: { tournamentId: string; clubId: string; seasonId: string | null },
): Promise<CarryOverWithSource[]> {
  const season: SQL | undefined = target.seasonId
    ? or(isNull(prizeCarryOvers.targetSeasonId), eq(prizeCarryOvers.targetSeasonId, target.seasonId))
    : isNull(prizeCarryOvers.targetSeasonId);
  return await ex
    .select({ carryOver: prizeCarryOvers, sourceFinalizedAt: tournaments.finalizedAt, seasonName: seasons.name })
    .from(prizeCarryOvers)
    .innerJoin(tournaments, eq(tournaments.id, prizeCarryOvers.sourceTournamentId))
    .leftJoin(seasons, eq(seasons.id, prizeCarryOvers.targetSeasonId))
    .where(
      and(
        eq(tournaments.clubId, target.clubId),
        eq(tournaments.status, "completed"),
        ne(prizeCarryOvers.sourceTournamentId, target.tournamentId),
        isNull(prizeCarryOvers.appliedToTournamentId),
        gt(prizeCarryOvers.amountCents, 0),
        season,
      ),
    )
    .orderBy(asc(prizeCarryOvers.createdAt), asc(prizeCarryOvers.id));
}
