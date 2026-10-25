import type { Request } from "express";
import { z } from "zod";
import type { Club, InsertClub } from "@shared/schema";
import {
  CLUB_DESCRIPTION_STORED_MAX,
  clubSlugSchema,
  MAX_CLUBS_PER_OWNER,
  type ClubsQuery,
  type CreateClubInput,
  type MemberCountsResponse,
  type UpdateClubInput,
} from "@shared/api/clubs";
import type { Viewer } from "@shared/api/common";
import { readTheme } from "@shared/domain/theme";
import { safeHttpUrl } from "@shared/domain/urls";
import { pickFields, PUBLIC_CLUB_FIELDS, type ClubDto } from "@shared/api/public";
import type { AppEnv } from "../config/env";
import { db, type Executor } from "../db";
import { isAdmin, viewerFor, viewersFor, type AuthUser } from "../http/authz";
import { badRequest, conflict, notFound } from "../http/errors";
import { parseOrThrow } from "../http/validate";
import * as clubsRepo from "../repositories/clubs";
import * as playersRepo from "../repositories/players";
import { recordAudit } from "./audit";
import { assertOwnedImage, noteDeletedImages, noteReplacedImage } from "./images/upload";
import { createSanitizedTextCache, sanitizeClubDescription } from "./sanitize-html";

const INVALID = { message: "Invalid club data" };

/** Stored descriptions sanitised again on read, each distinct text once per process (P2REV0-SEC-02). */
const servedDescription = createSanitizedTextCache(sanitizeClubDescription, 4_000_000);

const SOCIAL_LINKS = ["discordUrl", "twitterUrl", "facebookUrl", "instagramUrl", "websiteUrl"] as const;

/**
 * A club as anyone may see it: the public columns only (never ownerId), the description sanitised
 * again and the social links checked again, because stored rows may predate both rules (SEC-08,
 * P2REV0-SEC-05: a link that is not http(s) is sent as null), and whether the viewer manages or owns it.
 */
export function toClubDto(club: Club, viewer: Viewer): ClubDto {
  const links = Object.fromEntries(SOCIAL_LINKS.map((key) => [key, safeHttpUrl(club[key])])) as Pick<ClubDto, (typeof SOCIAL_LINKS)[number]>;
  return {
    ...pickFields(club, PUBLIC_CLUB_FIELDS),
    ...links,
    description: servedDescription(club.description),
    // A stored theme that does not read is never sent (as the TV, seat finder and season pages do).
    theme: readTheme(club.theme),
    createdAt: club.createdAt?.toISOString() ?? null,
    viewer,
  };
}

/** GET /api/clubs: oldest first, the first `limit` when given. */
export async function listClubs(req: Request, query: ClubsQuery = {}): Promise<ClubDto[]> {
  const [clubs, viewerOf] = await Promise.all([clubsRepo.getClubs(db, query.limit), viewersFor(req)]);
  return clubs.map((club) => toClubDto(club, viewerOf(club)));
}

async function withViewer(req: Request, club: Club | undefined): Promise<ClubDto> {
  if (!club) throw notFound("Club not found");
  return toClubDto(club, await viewerFor(req, club.id));
}

export async function getClub(req: Request, id: string): Promise<ClubDto> {
  return withViewer(req, await clubsRepo.getClub(db, id));
}

export async function getClubBySlug(req: Request, slug: string): Promise<ClubDto> {
  return withViewer(req, await clubsRepo.getClubBySlug(db, slug));
}

/** The club's members: the players known at it (registered there, or it is their home club), as its Players list shows them. */
export async function membersCount(clubId: string): Promise<number> {
  return playersRepo.countPlayersKnownAt(db, [clubId]);
}

export async function memberCounts(): Promise<MemberCountsResponse> {
  return Object.fromEntries(await playersRepo.countPlayersKnownAtEachClub(db));
}

function isKnownTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Fields the request changes that must pass rules stricter than the form schema (the image: assertOwnedImage). */
const changedFieldsSchema = z.object({
  slug: clubSlugSchema.optional(),
  timezone: z.string().refine(isKnownTimeZone, "Unknown time zone").nullable().optional(),
});

/**
 * The fields to write, with slug, timezone and imageUrl checked when they differ from what is stored
 * (`existing` absent: a new club, so every field is new). An unchanged legacy value is accepted as it
 * is: edit forms resend every field. 400 VALIDATION with the field's path, like the form schema.
 */
function checkedFields<T extends CreateClubInput | UpdateClubInput>(env: AppEnv, input: T, existing?: Club): T {
  const changed = (key: "slug" | "timezone") =>
    input[key] !== undefined && (existing === undefined || input[key] !== existing[key]);
  const toCheck = Object.fromEntries((["slug", "timezone"] as const).filter(changed).map((key) => [key, input[key]]));
  const checked = parseOrThrow(changedFieldsSchema, toCheck, INVALID);
  assertOwnedImage(env, input.imageUrl, existing?.imageUrl, INVALID.message);
  const fields: T = { ...input, ...checked };
  if (fields.description !== undefined) {
    fields.description = sanitizeClubDescription(fields.description);
    if ((fields.description?.length ?? 0) > CLUB_DESCRIPTION_STORED_MAX) {
      throw badRequest(INVALID.message, "VALIDATION", [
        { code: "custom", path: ["description"], message: "The description is too long once its formatting is saved: shorten it" },
      ]);
    }
  }
  return fields;
}

async function assertSlugFree(ex: Executor, slug: string | undefined, exceptId?: string): Promise<void> {
  if (slug !== undefined && (await clubsRepo.isSlugTaken(ex, slug, exceptId))) {
    throw conflict("SLUG_TAKEN", "That club URL is already taken");
  }
}

/**
 * The signed-in `owner` owns the new club. An account that is not an admin's may own at most
 * MAX_CLUBS_PER_OWNER (409 CLUB_LIMIT_REACHED); one account's creates take turns, so two at once
 * cannot both pass the count. A slug race ends on the unique constraint (409 SLUG_TAKEN).
 */
export async function createClub(env: AppEnv, owner: AuthUser, input: CreateClubInput): Promise<ClubDto> {
  const fields = checkedFields(env, input);
  const club = await db.transaction(async (tx) => {
    if (!isAdmin(owner)) {
      await clubsRepo.lockClubsOfOwner(tx, owner.id);
      if ((await clubsRepo.countClubsOwnedBy(tx, owner.id)) >= MAX_CLUBS_PER_OWNER) {
        throw conflict(
          "CLUB_LIMIT_REACHED",
          `You already own ${MAX_CLUBS_PER_OWNER} clubs, the most one account can open. Ask an admin if you need another.`,
        );
      }
    }
    await assertSlugFree(tx, fields.slug);
    const values: InsertClub = { ...fields, ownerId: owner.id };
    return clubsRepo.createClub(tx, values);
  });
  return toClubDto(club, { canManage: true, canOwn: true });
}

/** Only the fields sent change; ownerId never does here (PUT /api/clubs/:id/owner). A replaced logo is logged once stored. */
export async function updateClub(env: AppEnv, req: Request, clubId: string, input: UpdateClubInput): Promise<ClubDto> {
  let previousImageUrl: string | null = null;
  const club = await db.transaction(async (tx) => {
    const existing = await clubsRepo.lockClub(tx, clubId);
    if (!existing) throw notFound("Club not found");
    previousImageUrl = existing.imageUrl;
    const fields = checkedFields(env, input, existing);
    if (fields.slug !== existing.slug) await assertSlugFree(tx, fields.slug, clubId);
    if (Object.values(fields).every((value) => value === undefined)) return existing;
    return (await clubsRepo.updateClub(tx, clubId, fields)) ?? existing;
  });
  // After the commit: an image is an orphan only once the change that replaced it is stored.
  noteReplacedImage(previousImageUrl, club.imageUrl, `club ${clubId}`);
  return toClubDto(club, await viewerFor(req, clubId));
}

/**
 * Hard delete, as before (soft delete needs sign-off: DATA-25), cascading to the club's tournaments,
 * recorded in the audit log. The club's logo and its tournaments' banners stay in storage and are
 * logged as orphans once the delete is stored, and are named in the audit row (P2-PRODDATA-03).
 */
export async function deleteClub(req: Request, clubId: string): Promise<void> {
  const { logo, banners } = await db.transaction(async (tx) => {
    const tournamentBanners = await clubsRepo.clubTournamentImageUrls(tx, clubId);
    const deleted = await clubsRepo.deleteClubReturning(tx, clubId);
    if (!deleted) throw notFound("Club not found");
    await recordAudit(
      req,
      {
        action: "club.delete",
        targetType: "club",
        targetId: clubId,
        data: { name: deleted.name, slug: deleted.slug, imageUrl: deleted.imageUrl, tournamentImageUrls: tournamentBanners },
      },
      tx,
    );
    return { logo: deleted.imageUrl, banners: tournamentBanners };
  });
  noteDeletedImages([logo, ...banners], `club ${clubId} (with its tournaments)`);
}
