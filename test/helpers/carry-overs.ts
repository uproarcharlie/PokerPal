/**
 * Carried-over prize money for the API tests (round 5, item 16): a completed tournament of a club whose
 * finalize carried `amountCents` over (a prize_carry_overs row), as finalize writes it, optionally to a
 * season and optionally already taken by a tournament (whose carried_in then lists it).
 */
import { eq } from "drizzle-orm";
import { prizeCarryOvers, tournaments, type PrizeCarryOver, type Tournament } from "@shared/schema";
import type { CarriedIn } from "@shared/domain/prize-difference";
import { getDb } from "../../server/db";
import { createTournament } from "../factories";

export interface CarryOverSpec {
  clubId: string;
  amountCents?: number;
  /** The season it was carried over to; null (the default) for the club's next tournament. */
  seasonId?: string | null;
  /** The tournament that already took it. */
  appliedTo?: Tournament;
  sourceName?: string;
}

/** The completed source tournament and its carry-over (with `appliedTo`'s carried_in listing it). */
export async function createCarryOver(spec: CarryOverSpec): Promise<{ source: Tournament; carryOver: PrizeCarryOver }> {
  const db = getDb();
  const source = await createTournament({
    clubId: spec.clubId,
    seasonId: spec.seasonId ?? null,
    name: spec.sourceName ?? "Test Wednesday",
    status: "completed",
    finalizedAt: new Date("2026-03-04T23:00:00Z"),
  });
  const [carryOver] = await db
    .insert(prizeCarryOvers)
    .values({
      sourceTournamentId: source.id,
      sourceName: source.name,
      targetSeasonId: spec.seasonId ?? null,
      amountCents: spec.amountCents ?? 5_000,
      appliedToTournamentId: spec.appliedTo?.id ?? null,
      appliedAt: spec.appliedTo ? new Date() : null,
    })
    .returning();
  if (spec.appliedTo) {
    const entry: CarriedIn = { carryOverId: carryOver.id, fromTournamentId: source.id, fromName: source.name, amountCents: carryOver.amountCents };
    await db.update(tournaments).set({ carriedIn: [...(spec.appliedTo.carriedIn ?? []), entry] }).where(eq(tournaments.id, spec.appliedTo.id));
  }
  return { source, carryOver };
}

/** The carry-over rows `sourceTournamentId` wrote. */
export async function carryOversOf(sourceTournamentId: string): Promise<PrizeCarryOver[]> {
  return await getDb().select().from(prizeCarryOvers).where(eq(prizeCarryOvers.sourceTournamentId, sourceTournamentId));
}
