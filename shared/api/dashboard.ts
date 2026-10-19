/**
 * GET /api/dashboard/stats (signed in). Scoped to the viewer's clubs (owned or managed; every club for
 * an admin), so no one sees another club's totals (MONEY-23). Today's four fields, kept.
 */
export interface DashboardStatsDto {
  /** Tournaments in "registration" or "in_progress". */
  activeTournaments: number;
  /** The players known at the clubs, each once, as their Players lists show them (every player for an admin). */
  totalPlayers: number;
  /**
   * Whole dollars: cancelled tournaments are left out; a completed one counts what it paid (snapshot,
   * or stored prizes for legacy rows); any other counts max(0, computePrizePool(...).net). One query
   * for all registrations (perf-20); rake per pot and fixed rake per entry, as finalize (money-14).
   */
  totalPrizePool: number;
  /** Clubs in scope. */
  activeClubs: number;
}
