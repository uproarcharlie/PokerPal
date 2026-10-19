import { sql } from "drizzle-orm";
import { tournamentRegistrations } from "@shared/schema";
import type { Executor } from "../db";

export interface FinalResult {
  registrationId: string;
  finalPosition: number;
  /** decimal(10,2) text, or null for no prize. */
  prizeAmount: string | null;
  pointsAwarded: number | null;
}

/** Writes every registration's result in one statement, so a failure leaves none of them written. */
export async function writeFinalResults(ex: Executor, results: readonly FinalResult[]): Promise<void> {
  if (results.length === 0) return;
  const values = sql.join(
    results.map(
      (r) => sql`(${r.registrationId}::varchar, ${r.finalPosition}::integer, ${r.prizeAmount}::numeric, ${r.pointsAwarded}::integer)`,
    ),
    sql`, `,
  );
  await ex.execute(sql`
    UPDATE ${tournamentRegistrations} AS r
       SET final_position = v.final_position, prize_amount = v.prize_amount, points_awarded = v.points_awarded
      FROM (VALUES ${values}) AS v(id, final_position, prize_amount, points_awarded)
     WHERE r.id = v.id`);
}
