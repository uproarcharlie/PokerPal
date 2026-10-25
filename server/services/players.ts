/**
 * Players: the staff list, the QR page's search, sign-up (public) and edits (staff). Players are
 * global; a club reaches a player through registrations for its tournaments, and sees their contact
 * details (and may edit them) only as their home club: the club that added them, else the club of
 * their first surviving registration, recorded once and never moved (canManagePlayer in
 * server/http/authz.ts).
 */
import type { Request } from "express";
import {
  normaliseName,
  normalisePhone,
  STAFF_PLAYER_FIELDS,
  type CreatePlayerInput,
  type PlayersQuery,
  type UpdatePlayerInput,
} from "@shared/api/players";
import { pickFields, PUBLIC_PLAYER_FIELDS } from "@shared/api/public";
import type { Player } from "@shared/schema";
import type { AppEnv } from "../config/env";
import { db, type Executor } from "../db";
import { canManageClub, type AuthUser, type ClubScope } from "../http/authz";
import { badRequest, forbidden, notFound, unauthenticated } from "../http/errors";
import { getClub } from "../repositories/clubs";
import * as playersRepo from "../repositories/players";
import { getTournament } from "../repositories/tournaments";
import { assertOpen } from "./tournament-views";
import { recordAudit } from "./audit";
import { assertOwnedImage, noteReplacedImage } from "./images/upload";

const INVALID_MESSAGE = "Invalid player data";

export const toStaffPlayer = (player: Player) => pickFields(player, STAFF_PLAYER_FIELDS);
export const toPublicPlayer = (player: Player) => pickFields(player, PUBLIC_PLAYER_FIELDS);

/** A player on a staff list: contact details only when `canEdit` (the viewer runs their home club, or is an admin). */
export function toClubPlayer(player: Player, canEdit: boolean) {
  const staff = toStaffPlayer(player);
  return canEdit ? { ...staff, canEdit: true as const } : { ...staff, email: null, phone: null, canEdit: false as const };
}

/** For each of `playerIds`, whether a viewer with `scope` may edit them and see their contact details. */
export async function contactAccess(ex: Executor, scope: ClubScope, playerIds: readonly string[]): Promise<(playerId: string) => boolean> {
  if (scope.all) return () => true;
  const homes = await playersRepo.homeClubIds(ex, playerIds);
  const mine = new Set(scope.clubIds);
  return (playerId) => {
    const home = homes.get(playerId);
    return home !== undefined && mine.has(home);
  };
}

/**
 * GET /api/players: the players known at the viewer's clubs, registered there or added by them
 * (every player for an admin), oldest first, as ClubPlayer.
 */
export async function listStaffPlayers(scope: ClubScope, query: PlayersQuery) {
  let clubIds: readonly string[] | "all" = scope.all ? "all" : scope.clubIds;
  if (query.clubId) clubIds = clubIds === "all" || clubIds.includes(query.clubId) ? [query.clubId] : [];
  const rows = await playersRepo.findPlayers(db, { clubIds, nameContains: query.q }, "created");
  const canEdit = await contactAccess(db, scope, rows.map((row) => row.id));
  return rows.map((row) => toClubPlayer(row, canEdit(row.id)));
}

/**
 * Who the QR register page's search covers: the players known at one club, registered there or
 * added by it (anonymous visitors), everyone known at some club (that club's staff, registering a
 * visitor from another club), or every player (admins).
 */
export type PlayerSearchScope = { clubId: string } | "known" | "all";

/** The QR register page's search: names containing `q`, A to Z, as PublicPlayer. */
export async function searchPlayers(search: { q: string; limit: number; scope: PlayerSearchScope }) {
  const { scope } = search;
  const clubIds = typeof scope === "string" ? scope : [scope.clubId];
  const rows = await playersRepo.findPlayers(db, { clubIds, nameContains: search.q, limit: search.limit }, "name");
  return rows.map(toPublicPlayer);
}

/** Every other player with the same phone number (by normalisePhone), oldest first. */
async function playersWithPhone(ex: Executor, phone: string, exceptId?: string): Promise<Player[]> {
  const digits = phone.replace(/^\+/, "");
  const candidates = await playersRepo.findPlayersByPhoneDigits(ex, digits);
  return candidates.filter((player) => player.id !== exceptId && normalisePhone(player.phone) === phone);
}

export type CreatePlayerOutcome =
  | { kind: "created"; player: Player }
  /** The phone and name match a stored player, who is returned instead of a duplicate. */
  | { kind: "existing"; player: Player }
  /** The phone belongs to someone with another name. */
  | { kind: "phone_taken"; other: Player };

/**
 * Of several stored players with the same phone and name (legacy duplicates, P2REV3-PROD-01), the one
 * who is really this person: the one `clubId` added, else the one who last played at `clubId`, else
 * the one who last played anywhere, else one with a home club, else the oldest. An older row with no
 * history (an earlier sign-up that never got as far as registering) never wins over one with results,
 * so a returning player's new results land beside their season points.
 */
export async function preferredMatch(ex: Executor, matches: readonly Player[], clubId: string | null): Promise<Player> {
  if (matches.length === 1) return matches[0];
  const ids = matches.map((player) => player.id);
  const [history, homes] = await Promise.all([playersRepo.registrationHistory(ex, ids, clubId), playersRepo.homeClubIds(ex, ids)]);
  const time = (date: Date | null | undefined) => date?.getTime() ?? Number.NEGATIVE_INFINITY;
  const created = (player: Player) => player.createdAt?.getTime() ?? 0;
  const ranked = [...matches].sort(
    (a, b) =>
      Number(clubId !== null && homes.get(b.id) === clubId) - Number(clubId !== null && homes.get(a.id) === clubId) ||
      time(history.get(b.id)?.lastRegisteredAtClub) - time(history.get(a.id)?.lastRegisteredAtClub) ||
      time(history.get(b.id)?.lastRegisteredAt) - time(history.get(a.id)?.lastRegisteredAt) ||
      Number(homes.has(b.id)) - Number(homes.has(a.id)) ||
      created(a) - created(b) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return ranked[0];
}

export const PHOTO_REQUIRED_MESSAGE = "Add a photo or pick an avatar to sign up";

/**
 * A QR sign-up at a club that asks every new player for a picture (clubs.require_signup_photo, round 5):
 * one without a picture is refused, 400 PHOTO_REQUIRED on `imageUrl`, before the phone number is looked
 * at, whoever's number it is (R5REV-SEC-02: an answer that depended on it would tell anyone which
 * numbers are stored, without leaving a trace). The club's staff are not held to it. A returning
 * player finds themselves with the QR page's search instead; one who sends a picture and turns out to
 * be stored already is matched to their player, who keeps the picture they have. The token the sign-up
 * gets names the club, so the registration knows the rule was met (registerPlayer, R5REV-SEC-01).
 */
async function assertSignUpPicture(user: AuthUser | undefined, clubId: string, input: Pick<CreatePlayerInput, "imageUrl">): Promise<void> {
  if (input.imageUrl) return;
  if (!(await clubRequiresSignUpPhoto(db, clubId)) || (await canManageClub(user, clubId))) return;
  throw photoRequired();
}

/** Whether the club asks every new player for a picture (clubs.require_signup_photo). Read on `ex`: a transaction's own connection. */
export async function clubRequiresSignUpPhoto(ex: Executor, clubId: string): Promise<boolean> {
  return (await getClub(ex, clubId))?.requireSignupPhoto === true;
}

/** 400 PHOTO_REQUIRED, on `imageUrl`. */
export function photoRequired() {
  return badRequest(PHOTO_REQUIRED_MESSAGE, "PHOTO_REQUIRED", [{ code: "custom", path: ["imageUrl"], message: PHOTO_REQUIRED_MESSAGE }]);
}

/**
 * The club adding a player to POST /api/players (see createPlayerSchema): `clubId`, which the caller
 * must run (403; 404 when it does not exist), else the club of `tournamentId`, which must be open for
 * sign-ups as its QR page is (404 when there is no such tournament, 409 TOURNAMENT_CLOSED once it is
 * completed or cancelled) and whose picture rule a new player must meet (400 PHOTO_REQUIRED), else none.
 */
export async function addingClub(
  user: AuthUser | undefined,
  input: Pick<CreatePlayerInput, "clubId" | "tournamentId" | "imageUrl">,
): Promise<string | null> {
  if (input.clubId !== undefined) {
    if (!user) throw unauthenticated();
    if (!(await getClub(db, input.clubId))) throw notFound("Club not found");
    if (!(await canManageClub(user, input.clubId))) throw forbidden("You can only add players for a club you run");
    return input.clubId;
  }
  if (input.tournamentId !== undefined) {
    const tournament = await getTournament(db, input.tournamentId);
    if (!tournament) throw notFound("Tournament not found");
    assertOpen(tournament);
    await assertSignUpPicture(user, tournament.clubId, input);
    return tournament.clubId;
  }
  return null;
}

export interface CreatePlayerContext {
  /**
   * The club adding the player: the staff member's club, or the club of the tournament whose QR page
   * this is. It becomes a new player's home club, so a player who never gets as far as a registration
   * still has an owner, and nobody else can claim them later (P2REV0-SEC-03). It also picks the right
   * one of legacy duplicates.
   */
  clubId: string | null;
}

/**
 * Creates a player, unless their phone number is already stored: then the stored player whose name
 * matches is returned (the best of several: preferredMatch), or the sign-up is refused. Sign-ups with
 * the same number take turns, so two at once cannot both create one. A new player's home club is the
 * club adding them, when there is one.
 */
export async function createPlayer(env: AppEnv, input: CreatePlayerInput, { clubId }: CreatePlayerContext): Promise<CreatePlayerOutcome> {
  assertOwnedImage(env, input.imageUrl, undefined, INVALID_MESSAGE);
  return db.transaction(async (tx) => {
    const phone = normalisePhone(input.phone);
    if (phone) {
      await playersRepo.lockPhoneNumber(tx, phone);
      const sameNumber = await playersWithPhone(tx, phone);
      if (sameNumber.length > 0) {
        const name = normaliseName(input.name);
        const matches = sameNumber.filter((player) => normaliseName(player.name) === name);
        return matches.length > 0
          ? { kind: "existing", player: await preferredMatch(tx, matches, clubId) }
          : { kind: "phone_taken", other: sameNumber[0] };
      }
    }
    const player = await playersRepo.createPlayer(tx, {
      name: input.name,
      phone: input.phone ?? null,
      email: input.email ?? null,
      imageUrl: input.imageUrl ?? null,
    });
    if (clubId !== null) await playersRepo.claimHomeClub(tx, player.id, clubId);
    return { kind: "created", player };
  });
}

export type UpdatePlayerOutcome = { kind: "updated"; player: Player } | { kind: "phone_taken"; other: Player };

const AUDITED_FIELDS = ["name", "phone", "email", "imageUrl"] as const;

/**
 * PUT /api/players/:id. Absent fields keep their value; null clears. A new phone number that another
 * player already has is refused (an unchanged one is kept even if a legacy duplicate shares it). A
 * change is audited (`player.update`, before/after of the changed fields), so a phone or email edit
 * always leaves a trail of who made it (P2REV0-01). A replaced photo is logged as an orphan once the
 * change is stored.
 */
export async function updatePlayer(env: AppEnv, req: Request, id: string, input: UpdatePlayerInput): Promise<UpdatePlayerOutcome> {
  let previousImageUrl: string | null = null;
  const outcome = await db.transaction(async (tx): Promise<UpdatePlayerOutcome> => {
    const current = await playersRepo.getPlayer(tx, id);
    if (!current) throw notFound("Player not found");
    assertOwnedImage(env, input.imageUrl, current.imageUrl, INVALID_MESSAGE);
    previousImageUrl = current.imageUrl;

    const phone = input.phone === undefined ? undefined : normalisePhone(input.phone);
    if (phone && phone !== normalisePhone(current.phone)) {
      await playersRepo.lockPhoneNumber(tx, phone);
      const [other] = await playersWithPhone(tx, phone, id);
      if (other) return { kind: "phone_taken", other };
    }

    // drizzle leaves out undefined values, so absent fields keep what is stored.
    const player = await playersRepo.updatePlayer(tx, id, input);
    if (!player) throw notFound("Player not found");
    const changed = AUDITED_FIELDS.filter((field) => current[field] !== player[field]);
    if (changed.length > 0) {
      const pick = (row: Player) => Object.fromEntries(changed.map((field) => [field, row[field]]));
      await recordAudit(req, { action: "player.update", targetType: "player", targetId: id, data: { before: pick(current), after: pick(player) } }, tx);
    }
    return { kind: "updated", player };
  });
  // After the commit: an image is an orphan only once the change that replaced it is stored.
  if (outcome.kind === "updated") noteReplacedImage(previousImageUrl, outcome.player.imageUrl, `player ${id}`);
  return outcome;
}
