/**
 * The season changes, made by the club's staff: seasons and their points systems. Apart from api.ts
 * so the public pages, which read seasons, never load them (test/unit/public-bundle.test.ts).
 */
import type { CreatePointsSystemInput } from "@shared/api/points";
import type { PublicPointsSystem, PublicSeason } from "@shared/api/public";
import type { CreateSeasonInput, UpdateSeasonInput } from "@shared/api/seasons";
import { apiSend, segment } from "@/lib/api/http";
import { seasonPath } from "./api";

export const createSeason = (input: CreateSeasonInput) => apiSend<PublicSeason>("POST", "/api/seasons", input);

export const updateSeason = (id: string, input: UpdateSeasonInput) => apiSend<PublicSeason>("PUT", seasonPath(id), input);

export const deleteSeason = (id: string) => apiSend("DELETE", seasonPath(id));

/** The system and its allocations are created together, so a refused allocation leaves no half-built system. */
export const createPointsSystem = (seasonId: string, input: CreatePointsSystemInput) =>
  apiSend<PublicPointsSystem>("POST", `${seasonPath(seasonId)}/points-systems`, input);

export const deletePointsSystem = (id: string) => apiSend("DELETE", `/api/points-systems/${segment(id)}`);
