/**
 * GET /api/dashboard/stats: the admin dashboard's four headline numbers, for the clubs the viewer
 * owns or manages (every club for an admin), so no one sees another club's totals (MONEY-23). The prize
 * money uses shared/domain, as finalize does (money-14): cancelled tournaments add nothing, completed
 * ones what they paid, any other its current pool: its accepted players' entries only (round 6), with
 * money carried in and what the club pays in for free entries (round 7).
 */
import type { DashboardStatsDto } from "@shared/api/dashboard";
import { toCents } from "@shared/domain/money";
import { prizeMoneyCents, type EntryInput } from "@shared/domain/prize-pool";
import { db } from "../db";
import { clubScope, type AuthUser } from "../http/authz";
import * as dashboardRepo from "../repositories/dashboard";

const ACTIVE_STATUSES: ReadonlySet<string> = new Set(["registration", "in_progress"]);

/** Some registrations' summed entries as one entry for the pool maths, standing for as many registrations as they are. */
const totalsRow = ({ registrations, ...entries }: dashboardRepo.Entries, status: Pick<EntryInput, "paymentConfirmed" | "freeEntry" | "freeEntryFunded">): EntryInput => ({
  ...entries,
  ...status,
  registrationCount: registrations,
});

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
    // One row of totals for each kind of entry, with how many registrations it sums (the places paid are
    // counted from them): the pool decides what each counts (poolEntries, computePrizePool).
    const rows = entries
      ? [
          totalsRow(entries.paid, { paymentConfirmed: true }),
          totalsRow(entries.unpaid, { paymentConfirmed: false }),
          totalsRow(entries.free, { paymentConfirmed: true, freeEntry: true }),
          totalsRow(entries.funded, { paymentConfirmed: true, freeEntry: true, freeEntryFunded: true }),
        ]
      : [];
    prizeCents += prizeMoneyCents(tournament, rows, toCents(entries?.prizes));
  }

  return {
    activeTournaments: tournaments.filter((t) => ACTIVE_STATUSES.has(t.status)).length,
    totalPlayers: await dashboardRepo.countPlayers(db, scope),
    totalPrizePool: Math.round(prizeCents / 100),
    activeClubs: await dashboardRepo.countClubs(db, scope),
  };
}
