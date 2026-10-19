import type { LeaderboardEntryDto } from "@shared/api/seasons";
import { db } from "../db";
import { notFound } from "../http/errors";
import { seasonLeaderboard } from "../repositories/leaderboard";
import * as seasonsRepo from "../repositories/seasons";

/** GET /api/seasons/:id/leaderboard: public, so players appear as PublicPlayer only (SEC-09). */
export async function getSeasonLeaderboard(seasonId: string): Promise<LeaderboardEntryDto[]> {
  if (!(await seasonsRepo.getSeason(db, seasonId))) throw notFound("Season not found");
  return seasonLeaderboard(db, seasonId);
}
