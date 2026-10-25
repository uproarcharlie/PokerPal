/**
 * A deal (a "chop") at the end of a tournament: the players still in agree to share what their places
 * would pay differently, e.g. by chip count. PURE: no runtime imports outside shared/domain.
 *
 * Finalize still ranks everyone (the finish order decides positions and season points); a deal only
 * replaces the amounts of the players still in. It must share exactly what finalize would pay those
 * players together, so the pool, the AP and every busted player's prize stay as they are.
 */
import { formatMoney, type Cents } from "./money";

/** What each player still in is paid instead of their place's payout, and why. */
export interface DealInput {
  amounts: ReadonlyArray<{ registrationId: string; amountCents: Cents }>;
  /** Shown in the activity feed and kept in the snapshot, e.g. "Chip chop at 3 handed". */
  reason: string;
}

/** One player a deal can include: still in, with what their place pays now (null before the finish order is known). */
export interface DealablePlayer {
  registrationId: string;
  playerId: string;
  playerName: string;
  /** Their place in the finish order given, or null when it is not known yet. */
  position: number | null;
  plannedCents: Cents | null;
}

/**
 * What a deal shares: the players still in (two or more) and the total their places pay, which a deal
 * must add up to. The total does not depend on their order (they take places 1 to N between them).
 */
export interface Dealable {
  totalCents: Cents;
  players: DealablePlayer[];
}

export type DealProblemCode =
  /** Fewer than two players are still in: there is nobody to deal with. */
  | "DEAL_TOO_FEW_PLAYERS"
  /** The deal does not name exactly the players still in, each once (registrationId: the first one wrong). */
  | "DEAL_PLAYERS"
  /** An amount is not a whole number of cents of $0 or more (registrationId: whose). */
  | "DEAL_AMOUNT"
  /** The amounts do not add up to Dealable.totalCents. */
  | "DEAL_TOTAL"
  /** No reason was given. */
  | "DEAL_REASON";

export interface DealProblem {
  code: DealProblemCode;
  message: string;
  registrationId?: string;
}

/** The deal finalize paid, frozen in the snapshot (PrizePoolSnapshot.deal). */
export interface SnapshotDeal {
  reason: string;
  /** What the players still in shared: their places' payouts together. */
  totalCents: Cents;
  players: Array<{
    registrationId: string;
    playerId: string;
    playerName: string;
    position: number;
    /** What their place paid by the payout structure. */
    plannedCents: Cents;
    /** What the deal paid them. */
    amountCents: Cents;
  }>;
}

export const DEAL_LIMITS = { maxReasonLength: 200 } as const;

/**
 * What is wrong with a deal for `dealable` (null: fewer than two players still in). Empty when
 * finalize can pay it: exactly the players still in, each once, whole cents of $0 or more each, adding
 * up to `dealable.totalCents`, with a reason.
 */
export function dealProblems(dealable: Dealable | null, deal: DealInput): DealProblem[] {
  if (!dealable || dealable.players.length < 2) {
    return [{ code: "DEAL_TOO_FEW_PLAYERS", message: "A deal needs two or more players still in" }];
  }
  const problems: DealProblem[] = [];
  const stillIn = new Set(dealable.players.map((player) => player.registrationId));
  const named = new Set<string>();
  for (const { registrationId } of deal.amounts) {
    if (!stillIn.has(registrationId) || named.has(registrationId)) {
      problems.push({ code: "DEAL_PLAYERS", message: "A deal shares the prizes of the players still in: give each of them one amount", registrationId });
      break;
    }
    named.add(registrationId);
  }
  if (problems.length === 0 && named.size !== stillIn.size) {
    const missing = dealable.players.find((player) => !named.has(player.registrationId));
    problems.push({ code: "DEAL_PLAYERS", message: `Give ${missing?.playerName ?? "every player still in"} an amount too`, registrationId: missing?.registrationId });
  }
  const bad = deal.amounts.find(({ amountCents }) => !Number.isSafeInteger(amountCents) || amountCents < 0);
  if (bad) problems.push({ code: "DEAL_AMOUNT", message: "Each amount must be $0 or more, to the cent", registrationId: bad.registrationId });
  if (!bad) {
    const sum = deal.amounts.reduce((total, { amountCents }) => total + amountCents, 0);
    if (sum !== dealable.totalCents) {
      const off = sum > dealable.totalCents ? `${formatMoney(sum - dealable.totalCents)} too much` : `${formatMoney(dealable.totalCents - sum)} short`;
      problems.push({ code: "DEAL_TOTAL", message: `The deal must share ${formatMoney(dealable.totalCents)} (it is ${off})` });
    }
  }
  if (deal.reason.trim() === "") problems.push({ code: "DEAL_REASON", message: "Say what was agreed, e.g. \"Chip chop at 3 handed\"" });
  return problems;
}

/**
 * The "even chop" the deal editor offers first: the total split equally in whole dollars, and the odd
 * dollars and cents to the player listed first (as leftovers go to 1st), so it adds up exactly.
 */
export function evenChop(totalCents: Cents, registrationIds: readonly string[]): Array<{ registrationId: string; amountCents: Cents }> {
  if (registrationIds.length === 0) return [];
  const total = Number.isSafeInteger(totalCents) ? Math.max(0, totalCents) : 0;
  const each = Math.floor(total / registrationIds.length / 100) * 100;
  const odd = total - each * registrationIds.length;
  return registrationIds.map((registrationId, index) => ({ registrationId, amountCents: each + (index === 0 ? odd : 0) }));
}

/** "Alice $1,200, Bob $1,000, Carl $800": the activity feed's wording of a deal. */
export function describeDeal(deal: Pick<SnapshotDeal, "players">): string {
  return deal.players.map((player) => `${player.playerName} ${formatMoney(player.amountCents)}`).join(", ");
}
