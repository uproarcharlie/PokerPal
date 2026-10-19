/**
 * GET /api/dashboard/stats: the admin dashboard's four headline numbers, for the clubs the viewer
 * owns or manages (every club for an admin), so no one sees another club's totals (MONEY-23). The prize
 * money uses shared/domain, as finalize does (money-14): cancelled tournaments add nothing, completed
 * ones what they paid, any other its current pool.
 */
import type { DashboardStatsDto } from "@shared/api/dashboard";
import { toCents } from "@shared/domain/money";
import { prizeMoneyCents } from "@shared/domain/prize-pool";
import { db } from "../db";
import { clubScope, type AuthUser } from "../http/authz";
import * as dashboardRepo from "../repositories/dashboard";

const ACTIVE_STATUSES: ReadonlySet<string> = new Set(["registration", "in_progress"]);

export async function dashboardStats(user: AuthUser): Promise<DashboardStatsDto> {
  const scope = await clubScope(user);
  if (!scope.all && scope.clubIds.length === 0) {
    return { activeTournaments: 0, totalPlayers: 0, totalPrizePool: 0, activeClubs: 0 };
  }

  const tournaments = await dashboardRepo.tournamentsForStats(db, scope);
  const totals = new Map((await dashboardRepo.entryTotalsByTournament(db, scope)).map((row) => [row.tournamentId, row]));
  let prizeCents = 0;
  for (const tournament of tournaments) {
    const entries = totals.get(tournament.id);
    prizeCents += prizeMoneyCents(tournament, entries ? [entries] : [], toCents(entries?.prizes));
  }

  return {
    activeTournaments: tournaments.filter((t) => ACTIVE_STATUSES.has(t.status)).length,
    totalPlayers: await dashboardRepo.countPlayers(db, scope),
    totalPrizePool: Math.round(prizeCents / 100),
    activeClubs: await dashboardRepo.countClubs(db, scope),
  };
}
