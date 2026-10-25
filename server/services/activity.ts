/**
 * A tournament's activity feed. It is public: each entry carries only the player's public fields, and
 * the staff bookkeeping entries (STAFF_ONLY_ACTIVITY_TYPES) are shown only to people who can manage
 * the tournament's club.
 *
 * A table break, draw, balance, final table (or the undo of one) keeps every move it made and its undo
 * record in its eventData, for the TD's "Show last moves" and Undo (SeatingDto.lastChange). The feed
 * leaves those out for everyone: every public page polls it, and no screen reads them from it
 * (P4REV3-LOAD-02); the entry's own figures (players moved, tables) stay.
 */
import type { Request } from "express";
import { SEATING_CHANGE_EVENTS } from "@shared/api/seating";
import { STAFF_ONLY_ACTIVITY_TYPES } from "@shared/domain/tournaments";
import { db } from "../db";
import { canManageClub } from "../http/authz";
import { listActivity } from "../repositories/activity";
import { getTournament } from "../repositories/tournaments";

/** What a seating change keeps in eventData for the TD's seating panel only. */
const SEATING_BOOKKEEPING_KEYS: readonly string[] = ["moves", "undo"];

const SEATING_CHANGES: ReadonlySet<string> = new Set(SEATING_CHANGE_EVENTS);

/** The entry's eventData as the feed sends it: a seating change's without its moves and undo record. */
export function feedEventData(eventType: string, eventData: string | null): string | null {
  if (eventData === null || !SEATING_CHANGES.has(eventType)) return eventData;
  let data: unknown;
  try {
    data = JSON.parse(eventData);
  } catch {
    return eventData;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return eventData;
  return JSON.stringify(Object.fromEntries(Object.entries(data).filter(([key]) => !SEATING_BOOKKEEPING_KEYS.includes(key))));
}

export async function tournamentActivity(req: Request, tournamentId: string, limit: number) {
  const tournament = req.user ? await getTournament(db, tournamentId) : undefined;
  const staff = tournament !== undefined && (await canManageClub(req.user, tournament.clubId));
  const rows = await listActivity(db, tournamentId, { limit, excludeTypes: staff ? [] : STAFF_ONLY_ACTIVITY_TYPES });
  return rows.map(({ activity, player }) => ({ ...activity, eventData: feedEventData(activity.eventType, activity.eventData), player }));
}
