/**
 * Who may ask for what from the player-actions page (a re-buy, an add-on or a knockout claim), and
 * the refusals the server sends: one copy of the rules for the page, the request
 * (POST /api/tournaments/:id/pending-actions) and the count change that applies it. PURE: no
 * runtime imports outside shared/domain.
 */
import { toCents, type MoneyInput } from "./money";

/** What a player can ask for from their phone: the one list the request schema, these rules and finalize's warnings use. */
export const PLAYER_ACTION_TYPES = ["rebuy", "addon", "knockout"] as const;
export type PlayerActionType = (typeof PLAYER_ACTION_TYPES)[number];

/** How each request is named in sentences ("Bob's re-buy"). */
export const PLAYER_ACTION_LABELS: Readonly<Record<PlayerActionType, string>> = {
  rebuy: "re-buy",
  addon: "add-on",
  knockout: "knockout",
};

/** Whether a stored action_type is one this app knows (rows written before Phase 2 may hold other text). */
export function isPlayerActionType(value: string): value is PlayerActionType {
  return (PLAYER_ACTION_TYPES as readonly string[]).includes(value);
}

/** A tournament takes re-buys when it has a re-buy price; a player who is out may then buy back in. */
export function offersRebuys(tournament: { rebuyAmount?: MoneyInput }): boolean {
  return toCents(tournament.rebuyAmount) > 0;
}

/** A tournament sells add-ons when it has an add-on price. */
export function offersAddons(tournament: { addonAmount?: MoneyInput }): boolean {
  return toCents(tournament.addonAmount) > 0;
}

export const PRIZE_POOL_LOCKED_MESSAGE = "Prize pool is locked. No rebuys or addons allowed.";

export function maxRebuysMessage(max: number): string {
  return `This tournament allows at most ${max} re-buy${max === 1 ? "" : "s"} per player`;
}

/** Whether `rebuys` re-buys in all would go past the tournament's limit (no limit when it has none). */
export function overRebuyLimit(tournament: { maxRebuys?: number | null }, rebuys: number): boolean {
  return tournament.maxRebuys !== null && tournament.maxRebuys !== undefined && rebuys > tournament.maxRebuys;
}

export interface RequestTournament {
  rebuyAmount?: MoneyInput;
  addonAmount?: MoneyInput;
  maxRebuys?: number | null;
  prizePoolLocked?: boolean | null;
}

export interface RequestRegistration {
  isEliminated?: boolean | null;
  rebuys?: number | null;
}

export type RequestRefusal =
  | { code: "PLAYER_ELIMINATED"; message: string }
  | { code: "NOT_OFFERED"; message: string }
  | { code: "PRIZE_POOL_LOCKED"; message: string }
  | { code: "MAX_REBUYS_REACHED"; message: string };

/** Why a tournament does not take a re-buy or an add-on at all (it has no price for it), or null when it does. */
export function notOfferedRefusal(tournament: RequestTournament, actionType: "rebuy" | "addon"): RequestRefusal | null {
  if (actionType === "rebuy" && !offersRebuys(tournament)) return { code: "NOT_OFFERED", message: "This tournament has no re-buys" };
  if (actionType === "addon" && !offersAddons(tournament)) return { code: "NOT_OFFERED", message: "This tournament has no add-ons" };
  return null;
}

/**
 * Why a registered player may not ask for `actionType` now, or null when they may. The player must
 * still be in, except for a re-buy at a tournament that takes them (buying back in after going out);
 * a re-buy or add-on needs a tournament that sells one (the page offers no other: CQ-P2-05), and is
 * refused while the pool is locked or past the re-buy limit. A knockout's target is checked by the
 * server against the stored registrations.
 */
export function requestRefusal(
  tournament: RequestTournament,
  registration: RequestRegistration,
  actionType: PlayerActionType,
): RequestRefusal | null {
  const reentry = actionType === "rebuy" && offersRebuys(tournament);
  if (registration.isEliminated && !reentry) return { code: "PLAYER_ELIMINATED", message: "That player is out of the tournament" };
  if (actionType === "knockout") return null;
  const notOffered = notOfferedRefusal(tournament, actionType);
  if (notOffered) return notOffered;
  if (tournament.prizePoolLocked) return { code: "PRIZE_POOL_LOCKED", message: PRIZE_POOL_LOCKED_MESSAGE };
  if (actionType === "rebuy" && overRebuyLimit(tournament, (registration.rebuys ?? 0) + 1)) {
    return { code: "MAX_REBUYS_REACHED", message: maxRebuysMessage(tournament.maxRebuys ?? 0) };
  }
  return null;
}

export interface ActionRegistration {
  playerId: string;
  isEliminated: boolean | null;
  /** Who knocked them out, when recorded. */
  eliminatedBy?: string | null;
}

/**
 * Who the page offers for a request: anyone still in, and for a re-buy at a tournament that takes
 * them also anyone who is out, buying back in (TN-04).
 */
export function requestersFor<T extends ActionRegistration>(
  actionType: PlayerActionType | null,
  registrations: readonly T[],
  tournament: { rebuyAmount?: MoneyInput },
): T[] {
  const reentry = actionType === "rebuy" && offersRebuys(tournament);
  return registrations.filter((r) => reentry || !r.isEliminated);
}

/**
 * Who a knockout can be claimed on: another player still in, or one the TD marked out without saying
 * who got them, which confirming credits to the claimer (TN-06).
 */
export function knockoutTargetsFor<T extends ActionRegistration>(registrations: readonly T[], claimerId: string): T[] {
  return registrations.filter((r) => r.playerId !== claimerId && (!r.isEliminated || !r.eliminatedBy));
}
