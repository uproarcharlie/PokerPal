/**
 * The seasons feature's web-test scenario (F4), over the shared DTO factories (./dto): every club,
 * season and points system is named by the test that uses it.
 */
import type { ClubDto, PublicPointsSystem, PublicSeason } from "@shared/api/public";
import * as base from "./dto";

type Given<T, K extends keyof T> = Partial<T> & Pick<T, K>;

export function clubDto(club: Given<ClubDto, "id" | "name">): ClubDto {
  return base.clubDto({ slug: club.id, timezone: null, ...club });
}

/** A season as the date boxes save it: days at midnight UTC. */
export function seasonDto(season: Given<PublicSeason, "id" | "name" | "clubId">): PublicSeason {
  return base.seasonDto({ startDate: "2026-03-01T00:00:00.000Z", createdAt: "2026-02-01T00:00:00.000Z", ...season });
}

export function pointsSystemDto(system: Given<PublicPointsSystem, "id" | "seasonId" | "name">): PublicPointsSystem {
  return base.pointsSystemDto(system);
}
