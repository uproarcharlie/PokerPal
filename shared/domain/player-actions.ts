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

/**
 * A tournament runs a high hand when it is switched on with an entry fee. These three are the one test
 * of whether a part exists, on every screen (the TD's desk, the edit form, the public page) as on the
 * server: a stored "0.00" price is not a part the tournament has (P3REV5-CQ-02).
 */
export function offersHighHand(tournament: { enableHighHand?: boolean | null; highHandAmount?: MoneyInput }): boolean {
  return tournament.enableHighHand === true && toCents(tournament.highHandAmount) > 0;
}

export const PRIZE_POOL_LOCKED_MESSAGE = "Prize pool is locked. No rebuys or addons allowed.";

const perPlayer = (max: number, what: string) => `at most ${max} ${what}${max === 1 ? "" : "s"} per player`;

export function maxRebuysMessage(max: number): string {
  return `This tournament allows ${perPlayer(max, "re-buy")}`;
}

export function maxAddonsMessage(max: number): string {
  return `This tournament allows ${perPlayer(max, "add-on")}`;
}

/** Whether `rebuys` re-buys in all would go past the tournament's limit (no limit when it has none). */
export function overRebuyLimit(tournament: { maxRebuys?: number | null }, rebuys: number): boolean {
  return tournament.maxRebuys !== null && tournament.maxRebuys !== undefined && rebuys > tournament.maxRebuys;
}

/**
 * A format's house rules on top-ups (the tournament's columns, migrations/0008): at most `maxRebuys`
 * re-buys and `maxAddons` add-ons per player (null: no limit), and with `rebuyOrAddon` a player takes
 * re-buys or add-ons, never both (Central Stars' "One Life Line": one re-buy OR one add-on).
 */
export interface TopUpRules {
  maxRebuys?: number | null;
  maxAddons?: number | null;
  rebuyOrAddon?: boolean | null;
}

export interface TopUpCounts {
  rebuys: number;
  addons: number;
}

export type TopUpRefusal = { code: "MAX_REBUYS_REACHED" | "MAX_ADDONS_REACHED" | "REBUY_OR_ADDON"; message: string };

/** "one re-buy OR one add-on per player" for the One Life Line, else "re-buys or add-ons, not both". */
function eitherRule(rules: TopUpRules): string {
  return rules.maxRebuys === 1 && rules.maxAddons === 1
    ? "this tournament allows one re-buy OR one add-on per player"
    : "this tournament allows re-buys or add-ons per player, not both";
}

/**
 * Why a registration's re-buys and add-ons may not go from `before` to `after` under the house rules,
 * or null when they may. Only an increase is refused (a correction down is always allowed): past a
 * limit, or, with `rebuyOrAddon`, ending up with both (TDN3-HOUSE-RULES). The one copy of the rules
 * for the player's phone, the desk's count changes, a sign-up with counts and an edited entry.
 */
export function topUpRefusal(rules: TopUpRules, before: TopUpCounts, after: TopUpCounts): TopUpRefusal | null {
  const moreRebuys = after.rebuys > before.rebuys;
  const moreAddons = after.addons > before.addons;
  if (moreRebuys && overRebuyLimit(rules, after.rebuys)) return { code: "MAX_REBUYS_REACHED", message: maxRebuysMessage(rules.maxRebuys ?? 0) };
  if (moreAddons && rules.maxAddons !== null && rules.maxAddons !== undefined && after.addons > rules.maxAddons) {
    return { code: "MAX_ADDONS_REACHED", message: maxAddonsMessage(rules.maxAddons) };
  }
  if (rules.rebuyOrAddon === true && (moreRebuys || moreAddons) && after.rebuys > 0 && after.addons > 0) {
    const already = !moreRebuys ? "Already took a re-buy: " : !moreAddons ? "Already took an add-on: " : "";
    const rule = eitherRule(rules);
    return { code: "REBUY_OR_ADDON", message: already ? `${already}${rule}` : `${rule.charAt(0).toUpperCase()}${rule.slice(1)}` };
  }
  return null;
}

/** "2:15": minutes of clock time as hours and minutes. */
const clockTimeText = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;

/**
 * Said of a re-buy or add-on sold once the re-buy period is over, "after the re-buy period, which
 * ended at 2:15 on the clock": the TV shows them closed from then on. Null while the period runs, or
 * when there is none or no clock (`elapsedClockMs` null). The sale is still allowed (the TD may make
 * an exception, and the prize-pool lock is what closes them for good); the activity entry says so.
 */
export function lateTopUpText(rebuyPeriodMinutes: number | null | undefined, elapsedClockMs: number | null): string | null {
  if (rebuyPeriodMinutes === null || rebuyPeriodMinutes === undefined || elapsedClockMs === null) return null;
  return elapsedClockMs >= rebuyPeriodMinutes * 60_000 ? `after the re-buy period, which ended at ${clockTimeText(rebuyPeriodMinutes)} on the clock` : null;
}

export interface RequestTournament extends TopUpRules {
  rebuyAmount?: MoneyInput;
  addonAmount?: MoneyInput;
  prizePoolLocked?: boolean | null;
}

export interface RequestRegistration {
  isEliminated?: boolean | null;
  rebuys?: number | null;
  addons?: number | null;
}

export type RequestRefusal =
  | { code: "PLAYER_ELIMINATED"; message: string }
  | { code: "NOT_OFFERED"; message: string }
  | { code: "PRIZE_POOL_LOCKED"; message: string }
  | TopUpRefusal;

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
 * refused while the pool is locked or when the house rules do not allow one more (topUpRefusal). A
 * knockout's target is checked by the server against the stored registrations.
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
  const before = { rebuys: registration.rebuys ?? 0, addons: registration.addons ?? 0 };
  const after = actionType === "rebuy" ? { ...before, rebuys: before.rebuys + 1 } : { ...before, addons: before.addons + 1 };
  return topUpRefusal(tournament, before, after);
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
