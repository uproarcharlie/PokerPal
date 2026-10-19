import type { Request } from "express";
import type { Season } from "@shared/schema";
import type { CreateSeasonInput, UpdateSeasonInput } from "@shared/api/seasons";
import { pickFields, PUBLIC_SEASON_FIELDS, type PublicSeason } from "@shared/api/public";
import { db } from "../db";
import { badRequest, notFound } from "../http/errors";
import * as seasonsRepo from "../repositories/seasons";
import { recordAudit } from "./audit";

export function toPublicSeason(season: Season): PublicSeason {
  const fields = pickFields(season, PUBLIC_SEASON_FIELDS);
  return {
    ...fields,
    startDate: fields.startDate.toISOString(),
    endDate: fields.endDate?.toISOString() ?? null,
    createdAt: fields.createdAt?.toISOString() ?? null,
  };
}

/** Every season, or one club's; oldest first. */
export async function listSeasons(clubId: string | undefined): Promise<PublicSeason[]> {
  const seasons = clubId ? await seasonsRepo.getSeasonsByClub(db, clubId) : await seasonsRepo.getSeasons(db);
  return seasons.map(toPublicSeason);
}

export async function getSeason(id: string): Promise<PublicSeason> {
  const season = await seasonsRepo.getSeason(db, id);
  if (!season) throw notFound("Season not found");
  return toPublicSeason(season);
}

/** The caller manages `input.clubId` (checked by the route's guard). No end date means open-ended. */
export async function createSeason(input: CreateSeasonInput): Promise<PublicSeason> {
  const values: seasonsRepo.SeasonValues = {
    clubId: input.clubId,
    name: input.name,
    startDate: input.startDate,
    endDate: input.endDate ?? null,
    ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
  };
  return toPublicSeason(await seasonsRepo.createSeason(db, values));
}

const endBeforeStart = (startDate: Date, endDate: Date | null) => endDate !== null && endDate < startDate;

/**
 * Changes the fields sent. A season never changes club: the edit forms always resend `clubId`, so
 * the season's own club is accepted and any other is 400 CANNOT_MOVE (SEC-03). The end date may not
 * fall before the start, counting the stored date for whichever of the two is not sent.
 */
export async function updateSeason(seasonId: string, input: UpdateSeasonInput): Promise<PublicSeason> {
  const season = await db.transaction(async (tx) => {
    const existing = await seasonsRepo.lockSeason(tx, seasonId);
    if (!existing) throw notFound("Season not found");
    if (input.clubId !== undefined && input.clubId !== existing.clubId) {
      throw badRequest("A season cannot move to another club", "CANNOT_MOVE");
    }
    const fields: Partial<seasonsRepo.SeasonValues> = {};
    if (input.name !== undefined) fields.name = input.name;
    if (input.startDate !== undefined) fields.startDate = input.startDate;
    if (input.endDate !== undefined) fields.endDate = input.endDate;
    if (input.isActive !== undefined) fields.isActive = input.isActive;
    if (endBeforeStart(fields.startDate ?? existing.startDate, fields.endDate === undefined ? existing.endDate : fields.endDate)) {
      throw badRequest("Invalid season data", "VALIDATION", [
        { code: "custom", path: ["endDate"], message: "The end date must be on or after the start date" },
      ]);
    }
    if (Object.keys(fields).length === 0) return existing;
    return (await seasonsRepo.updateSeason(tx, seasonId, fields)) ?? existing;
  });
  return toPublicSeason(season);
}

/** Deletes the season with its points systems; its tournaments stay, unlinked (FK set null). Audited. */
export async function deleteSeason(req: Request, seasonId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const deleted = await seasonsRepo.deleteSeasonReturning(tx, seasonId);
    if (!deleted) throw notFound("Season not found");
    await recordAudit(
      req,
      { action: "season.delete", targetType: "season", targetId: seasonId, data: { name: deleted.name, clubId: deleted.clubId } },
      tx,
    );
  });
}
