/**
 * The season reads, one hook each, used by every feature that shows a season, its leaderboard or its
 * points rules (the public club and tournament pages included). Changes are in staff-hooks.ts, so the
 * public pages never load them.
 */
import { useQuery } from "@tanstack/react-query";
import { pointsSystemQueries, seasonQueries } from "./api";

/** Every season the viewer may see (or one club's); nothing is asked while `enabled` is false. */
export const useSeasons = ({ clubId, enabled = true }: { clubId?: string | null; enabled?: boolean } = {}) =>
  useQuery({ ...seasonQueries.list(clubId ?? undefined), enabled });

/** One season; nothing is asked until its id is known. */
export const useSeason = (id: string | null | undefined) => useQuery({ ...seasonQueries.detail(id ?? ""), enabled: Boolean(id) });

/** A season's leaderboard; nothing is asked until a season is chosen. */
export const useSeasonLeaderboard = (seasonId: string | null | undefined) =>
  useQuery({ ...seasonQueries.leaderboard(seasonId ?? ""), enabled: Boolean(seasonId) });

/** A season's points systems. */
export const usePointsSystems = (seasonId: string | null | undefined) =>
  useQuery({ ...seasonQueries.pointsSystems(seasonId ?? ""), enabled: Boolean(seasonId) });

export const usePointsSystem = (id: string | null | undefined) =>
  useQuery({ ...pointsSystemQueries.detail(id ?? ""), enabled: Boolean(id) });

/** A points system's position points, ordered by position. */
export const usePointsAllocations = (pointsSystemId: string | null | undefined) =>
  useQuery({ ...pointsSystemQueries.allocations(pointsSystemId ?? ""), enabled: Boolean(pointsSystemId) });
