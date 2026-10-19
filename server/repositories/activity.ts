import { and, desc, eq, notInArray, sql, type SQL } from "drizzle-orm";
import { activityLog, players, type ActivityLog, type InsertActivityLog } from "@shared/schema";
import { pickFields, PUBLIC_ACTIVITY_FIELDS, type PublicPlayer } from "@shared/api/public";
import type { ActivityEventType } from "@shared/api/tournaments";
import type { Executor } from "../db";
import { publicPlayerColumns } from "./players";

/** The columns of PUBLIC_ACTIVITY_FIELDS: a column added to activity_log later stays out of the feed until listed there. */
const publicActivityColumns = pickFields(activityLog, PUBLIC_ACTIVITY_FIELDS);

export interface ActivityWithPlayer {
  activity: Pick<ActivityLog, (typeof PUBLIC_ACTIVITY_FIELDS)[number]>;
  /** Only the player's public fields; null when the entry names no player. */
  player: PublicPlayer | null;
}

/**
 * The newest `limit` entries of a tournament's activity with each entry's player, in one query
 * (perf-23), leaving out the event types in `excludeTypes`. Newest first; entries written at the same
 * instant (never by one transaction: see insertActivity) fall back to id order.
 */
export async function listActivity(
  ex: Executor,
  tournamentId: string,
  { limit, excludeTypes = [] }: { limit: number; excludeTypes?: readonly ActivityEventType[] },
): Promise<ActivityWithPlayer[]> {
  const conditions: SQL[] = [eq(activityLog.tournamentId, tournamentId)];
  if (excludeTypes.length > 0) conditions.push(notInArray(activityLog.eventType, [...excludeTypes]));
  return await ex
    .select({ activity: publicActivityColumns, player: publicPlayerColumns })
    .from(activityLog)
    .leftJoin(players, eq(players.id, activityLog.playerId))
    .where(and(...conditions))
    .orderBy(desc(activityLog.timestamp), desc(activityLog.id))
    .limit(limit);
}

/** A new activity entry: an `InsertActivityLog` whose type is one of ACTIVITY_EVENT_TYPES. */
export type NewActivity = Omit<InsertActivityLog, "eventType"> & { eventType: ActivityEventType };

/**
 * Write with the same executor as the change it records, so both commit or neither does. The time is
 * the statement's (clock_timestamp), not the transaction's start (now()), so several entries written
 * by one change keep the order they were written in.
 */
export async function insertActivity(ex: Executor, entry: NewActivity): Promise<ActivityLog> {
  const [activity] = await ex
    .insert(activityLog)
    .values({ ...entry, timestamp: sql`clock_timestamp()` })
    .returning();
  return activity;
}
