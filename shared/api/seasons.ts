/** /api/seasons/*: seasons and the season leaderboard. */
import { z } from "zod";
import { dateSchema, idSchema, nullableDateSchema, requiredText } from "./common";
import type { PublicPlayer } from "./public";

/** GET /api/seasons?clubId= */
export const seasonsQuerySchema = z.object({ clubId: idSchema.optional() });

const refineDates = <T extends { startDate?: Date; endDate?: Date | null }>(season: T) =>
  !season.startDate || !season.endDate || season.endDate >= season.startDate;
const DATE_ORDER = { message: "The end date must be on or after the start date", path: ["endDate"] };

/** POST /api/seasons: the caller must be able to manage `clubId`. A blank endDate means open-ended. */
export const createSeasonSchema = z
  .object({
    clubId: idSchema,
    name: requiredText(100),
    startDate: dateSchema,
    endDate: nullableDateSchema,
    isActive: z.boolean().optional(),
  })
  .refine(refineDates, DATE_ORDER);
export type CreateSeasonInput = z.infer<typeof createSeasonSchema>;

/**
 * PUT /api/seasons/:id: any subset. The edit forms always send clubId, so it is accepted when it equals
 * the season's club and refused otherwise (400 CANNOT_MOVE): a season never changes club (SEC-03).
 */
export const updateSeasonSchema = z
  .object({
    clubId: idSchema.optional(),
    name: requiredText(100).optional(),
    startDate: dateSchema.optional(),
    endDate: nullableDateSchema,
    isActive: z.boolean().optional(),
  })
  .refine(refineDates, DATE_ORDER);
export type UpdateSeasonInput = z.infer<typeof updateSeasonSchema>;

/**
 * GET /api/seasons/:id/leaderboard: players with non-zero points from the season's tournaments,
 * highest first, ties by name. `rank` is competition ranking (1, 2, 2, 4); `tournaments` counts the
 * tournaments that scored. One SQL aggregate; no contact details.
 */
export interface LeaderboardEntryDto {
  rank: number;
  player: PublicPlayer;
  points: number;
  tournaments: number;
}
