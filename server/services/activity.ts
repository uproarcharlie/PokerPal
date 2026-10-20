/**
 * A tournament's activity feed. It is public: each entry carries only the player's public fields, and
 * the staff bookkeeping entries (STAFF_ONLY_ACTIVITY_TYPES) are shown only to people who can manage
 * the tournament's club.
 */
import type { Request } from "express";
import { STAFF_ONLY_ACTIVITY_TYPES } from "@shared/domain/tournaments";
import { db } from "../db";
import { canManageClub } from "../http/authz";
import { listActivity } from "../repositories/activity";
import { getTournament } from "../repositories/tournaments";

export async function tournamentActivity(req: Request, tournamentId: string, limit: number) {
  const tournament = req.user ? await getTournament(db, tournamentId) : undefined;
  const staff = tournament !== undefined && (await canManageClub(req.user, tournament.clubId));
  const rows = await listActivity(db, tournamentId, { limit, excludeTypes: staff ? [] : STAFF_ONLY_ACTIVITY_TYPES });
  return rows.map(({ activity, player }) => ({ ...activity, player }));
}
