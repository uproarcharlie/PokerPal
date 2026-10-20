/**
 * /api/players/*. Players are global (no club column): a club reaches a player through registrations
 * for its tournaments. Contact details and edits belong to the player's home club (and to admins):
 * the club that added them (POST /api/players with clubId or tournamentId), else the club of their
 * first surviving registration, recorded once and never moved. Any account can open a club and
 * register any player into it, so a later registration grants nothing, and deleting the home club's
 * tournaments, or the club, does not hand the player on (SEC-P2-01, P2REV0-01, P2REV0-SEC-03).
 * Everyone else gets PublicPlayer.
 */
import { z } from "zod";
import type { Player } from "../schema";
import { idSchema, imageUrlSchema, requiredText, type Json } from "./common";
import { phoneSchema } from "./auth";
import type { PublicPlayer } from "./public";

/**
 * The comparable form of a phone number: digits only, keeping a leading "+" (so "021 123-4567" and
 * "0211234567" match). Null when there are no digits.
 */
export function normalisePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;
  return trimmed.startsWith("+") ? `+${digits}` : digits;
}

/** The comparable form of a name: trimmed, inner whitespace collapsed, case-folded. */
export function normaliseName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
}

const optionalEmail = z
  .preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.string().trim().toLowerCase().max(254).email("Invalid email address").nullable(),
  )
  .optional();

/**
 * POST /api/players. Public (the QR register page) with the public-write limit, and used by staff.
 * Anonymous callers must give a phone number (400 VALIDATION otherwise).
 *
 * Who is adding the player, which becomes a new player's home club (P2REV0-SEC-03): `clubId`, a club
 * the signed-in caller runs (403 otherwise, 404 when there is no such club), or `tournamentId`, the
 * tournament whose QR page this is (404 when there is none, 409 TOURNAMENT_CLOSED once it is completed
 * or cancelled). With neither, a new player has no home club until their first registration.
 *
 * Duplicate phone (normalisePhone): if the stored player's name matches (normaliseName), that player
 * is returned with 200 and `existing: true`, so a visitor from another club can register without
 * learning anything they did not type; of several such legacy duplicates, the one with the history
 * (P2REV3-PROD-01). Otherwise 409 PHONE_TAKEN, naming nobody unless the caller may manage that player
 * (an admin, or staff of their home club), who gets `details: { player: PublicPlayer }`.
 */
export const createPlayerSchema = z.object({
  name: requiredText(100),
  phone: phoneSchema,
  email: optionalEmail,
  imageUrl: imageUrlSchema,
  clubId: idSchema.optional(),
  tournamentId: idSchema.optional(),
});
export type CreatePlayerInput = z.infer<typeof createPlayerSchema>;

/** PUT /api/players/:id (staff). Absent keeps; null or blank clears (a removed photo really is removed: img-04). */
export const updatePlayerSchema = z
  .object({
    name: requiredText(100).optional(),
    phone: phoneSchema,
    email: optionalEmail,
    imageUrl: imageUrlSchema,
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), "Nothing to update");
export type UpdatePlayerInput = z.infer<typeof updatePlayerSchema>;

/**
 * GET /api/players?q=&clubId= (staff): players who registered at the viewer's clubs (every player for
 * an admin), as ClubPlayer.
 */
export const playersQuerySchema = z.object({
  q: z.string().trim().min(1).max(60).optional(),
  clubId: idSchema.optional(),
});
export type PlayersQuery = z.infer<typeof playersQuerySchema>;

/**
 * A player with their contact details, for someone who may manage them (admin, or staff of their home
 * club). The linked account id stays admin-only (AdminUserRow).
 */
export const STAFF_PLAYER_FIELDS = ["id", "name", "email", "phone", "imageUrl", "createdAt"] as const satisfies readonly (keyof Player)[];
export type StaffPlayer = Json<Pick<Player, (typeof STAFF_PLAYER_FIELDS)[number]>>;

/**
 * A player as a club's staff list shows them (GET /api/players, the payment desk). `canEdit`: the
 * viewer may edit them and see their contact details (admin, or staff of their home club). When it is
 * false, `email` and `phone` are null whatever is stored: the player is visiting from another club.
 */
export type ClubPlayer =
  | (StaffPlayer & { canEdit: true })
  | (Omit<StaffPlayer, "email" | "phone"> & { email: null; phone: null; canEdit: false });

/**
 * POST /api/players: 201 for a new player, 200 with `existing: true` for the phone + name match.
 * Any signed-in caller gets StaffPlayer for a player they just created; for an existing one only a
 * caller who may manage that player (an admin, or staff of their home club) does. Everyone else gets
 * PublicPlayer (never the stored contact details). `signUpToken` lets the caller sign this player up
 * for a tournament from the QR page (POST /api/tournaments/:id/registrations) for the next two hours.
 */
export type CreatePlayerResponse = (StaffPlayer | PublicPlayer) & { existing?: true; signUpToken: string };
