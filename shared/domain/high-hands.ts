/**
 * A tournament's high hands (round 10, the owner: "players will only want to sign up to one of the high
 * hands … so they pay 5 instead of 10"). PURE: no I/O, no Date, and no runtime imports outside
 * shared/domain.
 *
 * A game may run several high hands ("First half" and "Second half" at $5 each, until round 10 sold
 * together as one $10 entry). Each is a pot of its own: its own entry fee, AP rule (a percentage of the
 * pot, or one flat amount, as the legacy high hand's), number of prizes and winners. A player enters the
 * ones they choose and pays those fees at the door (round 8: a bank transfer is the buy-in only). Only
 * accepted entries (paid, or a free entry: the caller passes the pool's entries, shared/domain/prize-pool
 * poolEntries) are in a pot (round 6), and no pot is ever part of the prize pool or its AP override.
 *
 * Two stores, one view:
 * - A tournament that LISTS its high hands (tournament_high_hands, with registration_high_hands for who
 *   entered which and high_hand_awards for who won what, migrations/0019) carries them as an array in
 *   `highHands` (empty once every one is removed), each registration its `highHandIds` and `highHandWins`.
 * - Any other tournament has `highHands` null or absent. Its one high hand, when it offers one
 *   (offersLegacyHighHand), is its legacy columns, read here as ONE high hand with the id
 *   LEGACY_HIGH_HAND_ID and today's settings (highHandAmount, highHandRakeType/Amount,
 *   highHandPayouts); its entrants are the registrations' enteringHighHands and its awards their
 *   highHandWinner/highHandAmount. Every figure of such a tournament is what it was before round 10
 *   (the parity tests), and no row is rewritten for it: it starts listing its high hands only when staff
 *   change them (planHighHandsChange, adoptLegacyHighHand).
 *
 * The award rules are the legacy high hand's, applied to each pot on its own: the next award is what is
 * left over the winners still to come (nextHighHandAward), a tie splits an earlier winner's prize
 * (splitHighHandAward), and the awards never add up to more than the pot, nor, once every prize is
 * awarded, to anything but the pot (highHandAwardsProblem).
 */
import { centsToDecimalString, percentOfCents, toBasisPoints, toCents, type Cents, type MoneyInput } from "./money";

/** The id the legacy high hand (a tournament's high-hand columns) goes by wherever a high hand is named. */
export const LEGACY_HIGH_HAND_ID = "legacy";

/** What the legacy high hand is called, and what a high hand is called by default. */
export const DEFAULT_HIGH_HAND_NAME = "High hand";

export const HIGH_HAND_LIMITS = Object.freeze({
  /** High hands one tournament may list at once. */
  maxHighHands: 6,
  maxNameLength: 40,
  /** "Before the break", "Hands dealt 7pm–9pm". */
  maxNoteLength: 120,
});

/**
 * The most prizes one high hand can have, ties included: one rule for what may be set and what a tie may
 * add, so a stored count is always one the API accepts back (CQ-P2-04).
 */
export const HIGH_HAND_PRIZES_MAX = 20;

/** The numbers of winners the forms offer (a tie adds one more, up to HIGH_HAND_PRIZES_MAX). */
export const HIGH_HAND_WINNER_CHOICES = [1, 2, 3, 4] as const;

/** One high hand's settings. A tournament_high_hands row, and the API's HighHandDto, fit as they are. */
export interface HighHandSettings {
  id: string;
  name: string;
  /** Its place in the list, from 1. */
  position?: number | null;
  /** What entering it costs (decimal(10,2) text, as stored). */
  entryFee: MoneyInput;
  /** "percentage" of the pot, or "fixed" (one flat amount from the pot); anything else takes nothing. Staff only. */
  rakeType?: string | null;
  rakeAmount?: MoneyInput;
  /** How many prizes the pot is split into (null or 0 reads as 1). */
  winners?: number | null;
  /** When it runs, or anything else the players should know ("Before the break"). */
  note?: string | null;
}

/** The legacy high-hand columns of a tournament. A `Tournament` row fits as it is. */
export interface LegacyHighHandColumns {
  enableHighHand?: boolean | null;
  highHandAmount?: MoneyInput;
  highHandRakeType?: string | null;
  highHandRakeAmount?: MoneyInput;
  highHandPayouts?: number | null;
}

/** What a tournament's high hands are read from. A tournament row with its listed high hands fits. */
export interface HighHandsInput extends LegacyHighHandColumns {
  /** The listed high hands (removed ones left out), or null/absent for a tournament that lists none: its legacy columns. */
  highHands?: readonly HighHandSettings[] | null;
}

/** One high-hand prize an entry has won (a high_hand_awards row). */
export interface HighHandWinInput {
  highHandId: string;
  amountCents: Cents;
  /** A tie: the earlier winner (a registration id) whose prize this one shares. */
  splitWithRegistrationId?: string | null;
  /** When it was awarded (ISO), which orders the awards. */
  awardedAt?: string | null;
}

/** What an entry says about the high hands. A registration row (with its listed choices and wins) fits. */
export interface HighHandEntryInput {
  /** Legacy: in the tournament's one high hand. For a tournament that lists its high hands: in at least one of them. */
  enteringHighHands?: boolean | null;
  /** The listed high hands it entered (registration_high_hands); read only for a tournament that lists them. */
  highHandIds?: readonly string[] | null;
  /** Legacy: won the one high hand, for highHandAmount. */
  highHandWinner?: boolean | null;
  highHandAmount?: MoneyInput;
  /** The listed high hands' prizes it won (high_hand_awards); read only for a tournament that lists them. */
  highHandWins?: readonly HighHandWinInput[] | null;
  /** How many registrations the entry stands for (a row of totals); 1 by default. */
  registrationCount?: number;
}

/** One pot's money, in cents. */
export interface HighHandBreakdown {
  /** Accepted entries in it. */
  entrants: number;
  gross: Cents;
  /** What the club takes of it: staff only, never on a public page or the TV. */
  rake: Cents;
  /** gross - rake: what its winners share (below zero only for a flat AP bigger than the pot). */
  net: Cents;
  /** How many prizes it is split into; what each winner gets is nextHighHandAward's. */
  winners: number;
}

/** One high hand's pot: who is in it and what it holds. */
export interface HighHandPot extends HighHandBreakdown {
  highHandId: string;
  name: string;
  position: number;
  feeCents: Cents;
}

/** One prize awarded from one pot. */
export interface HighHandAward {
  highHandId: string;
  registrationId: string;
  amountCents: Cents;
  splitWithRegistrationId: string | null;
  awardedAt: string | null;
}

/** Whether the tournament lists its high hands (round 10), rather than keeping its one high hand in its legacy columns. */
export function listsHighHands(tournament: HighHandsInput): tournament is HighHandsInput & { highHands: readonly HighHandSettings[] } {
  return Array.isArray(tournament.highHands);
}

/**
 * Whether the legacy columns describe a high hand: switched on with an entry fee. A stored "0.00" price
 * is not a high hand the tournament has (P3REV5-CQ-02).
 */
export function offersLegacyHighHand(tournament: LegacyHighHandColumns): boolean {
  return tournament.enableHighHand === true && toCents(tournament.highHandAmount) > 0;
}

/** The legacy columns as one high hand, with today's settings. */
export function legacyHighHand(tournament: LegacyHighHandColumns): HighHandSettings {
  return {
    id: LEGACY_HIGH_HAND_ID,
    name: DEFAULT_HIGH_HAND_NAME,
    position: 1,
    entryFee: tournament.highHandAmount,
    rakeType: tournament.highHandRakeType ?? "none",
    rakeAmount: tournament.highHandRakeAmount,
    winners: tournament.highHandPayouts,
    note: null,
  };
}

const positionOf = (highHand: HighHandSettings) => highHand.position ?? Number.MAX_SAFE_INTEGER;

/** The tournament's high hands, in order: its listed ones, else the legacy one when it offers it, else none. */
export function highHandsOf(tournament: HighHandsInput): HighHandSettings[] {
  if (listsHighHands(tournament)) {
    return tournament.highHands
      .map((highHand, index) => ({ highHand, index }))
      .sort((a, b) => positionOf(a.highHand) - positionOf(b.highHand) || a.index - b.index)
      .map(({ highHand }) => highHand);
  }
  return offersLegacyHighHand(tournament) ? [legacyHighHand(tournament)] : [];
}

/**
 * Whether the tournament runs any high hand: the one test every screen and the server use
 * (shared/domain/player-actions offersHighHand). Any list will do (a form's, whose new high hands have
 * no id yet): only whether it has one is read.
 */
export function offersHighHands(tournament: LegacyHighHandColumns & { highHands?: readonly object[] | null }): boolean {
  return Array.isArray(tournament.highHands) ? tournament.highHands.length > 0 : offersLegacyHighHand(tournament);
}

export function findHighHand(tournament: HighHandsInput, highHandId: string): HighHandSettings | undefined {
  return highHandsOf(tournament).find((highHand) => highHand.id === highHandId);
}

/** "First half high hand"; a name that already says it ("High hand 2") as it is. */
export function highHandLabel(name: string): string {
  const trimmed = name.trim();
  return /high[\s-]*hand/i.test(trimmed) ? trimmed : `${trimmed} high hand`;
}

/** "the First half high hand", "the First half and Second half high hands", "the High hand 1 and High hand 2". */
export function highHandsPhrase(names: readonly string[]): string {
  const trimmed = names.map((name) => name.trim());
  if (trimmed.length <= 1) return `the ${highHandLabel(trimmed[0] ?? "")}`;
  const list = (words: readonly string[]) => `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
  return trimmed.some((name) => highHandLabel(name) === name) ? `the ${list(trimmed.map(highHandLabel))}` : `the ${list(trimmed)} high hands`;
}

/** The high hands the entry is in, in the tournament's order (ids of high hands it does not run are left out). */
export function highHandIdsOf(tournament: HighHandsInput, entry: HighHandEntryInput): string[] {
  if (!listsHighHands(tournament)) {
    return entry.enteringHighHands === true && offersLegacyHighHand(tournament) ? [LEGACY_HIGH_HAND_ID] : [];
  }
  const entered = new Set(entry.highHandIds ?? []);
  return highHandsOf(tournament)
    .filter((highHand) => entered.has(highHand.id))
    .map((highHand) => highHand.id);
}

/** The high-hand prizes the entry has won, in award order (prizes of high hands it does not run are left out). */
export function highHandWinsOf(tournament: HighHandsInput, entry: HighHandEntryInput): HighHandWinInput[] {
  if (!listsHighHands(tournament)) {
    if (entry.highHandWinner !== true || !offersLegacyHighHand(tournament)) return [];
    return [{ highHandId: LEGACY_HIGH_HAND_ID, amountCents: toCents(entry.highHandAmount), splitWithRegistrationId: null, awardedAt: null }];
  }
  const running = new Set(highHandsOf(tournament).map((highHand) => highHand.id));
  return (entry.highHandWins ?? []).filter((win) => running.has(win.highHandId)).sort(byAwardTime);
}

function byAwardTime(a: { awardedAt?: string | null }, b: { awardedAt?: string | null }): number {
  return (a.awardedAt ?? "").localeCompare(b.awardedAt ?? "");
}

/* ---------- fees: what an entry owes for its high hands (paid at the door) ---------- */

export const highHandFeeCents = (highHand: Pick<HighHandSettings, "entryFee">): Cents => toCents(highHand.entryFee);

/** What entering `highHandIds` costs: the fees of those of the tournament's high hands (other ids are ignored). */
export function highHandFeesCents(tournament: HighHandsInput, highHandIds: readonly string[]): Cents {
  const chosen = new Set(highHandIds);
  return highHandsOf(tournament).reduce((sum, highHand) => (chosen.has(highHand.id) ? sum + highHandFeeCents(highHand) : sum), 0);
}

/** What entering every high hand costs: the "All high hands $10" shortcut. 0 without a high hand. */
export function allHighHandsFeeCents(tournament: HighHandsInput): Cents {
  return highHandsOf(tournament).reduce((sum, highHand) => sum + highHandFeeCents(highHand), 0);
}

/** One high hand an entry pays for at the door. */
export interface HighHandAtDoor {
  highHandId: string;
  name: string;
  feeCents: Cents;
}

/** The high hands the entry pays for at the door, in order, with each fee ("First half high hand $5 — pay at the door"). */
export function highHandsAtDoor(tournament: HighHandsInput, entry: HighHandEntryInput): HighHandAtDoor[] {
  const entered = new Set(highHandIdsOf(tournament, entry));
  return highHandsOf(tournament)
    .filter((highHand) => entered.has(highHand.id))
    .map((highHand) => ({ highHandId: highHand.id, name: highHand.name, feeCents: highHandFeeCents(highHand) }));
}

/* ---------- pots ---------- */

/** A high hand's AP: a percentage of its pot, or one flat amount (not per entry: the legacy rule). */
export function highHandRakeCents(highHand: Pick<HighHandSettings, "rakeType" | "rakeAmount">, grossCents: Cents): Cents {
  if (highHand.rakeType === "percentage") return percentOfCents(grossCents, toBasisPoints(highHand.rakeAmount));
  if (highHand.rakeType === "fixed") return toCents(highHand.rakeAmount);
  return 0;
}

/** How many prizes a high hand's pot is split into: its count, 1 when it has none. */
export const highHandWinners = (highHand: Pick<HighHandSettings, "winners">): number =>
  highHand.winners && highHand.winners > 0 ? highHand.winners : 1;

/** One pot from its settings and how many accepted entries are in it. */
export function highHandPot(highHand: HighHandSettings, entrants: number, position = highHand.position ?? 1): HighHandPot {
  const feeCents = highHandFeeCents(highHand);
  const gross = entrants * feeCents;
  const rake = highHandRakeCents(highHand, gross);
  return { highHandId: highHand.id, name: highHand.name, position, feeCents, entrants, gross, rake, net: gross - rake, winners: highHandWinners(highHand) };
}

/**
 * Each high hand's pot, in order, from `poolEntries`: the entries the prize pool counts (accepted only:
 * poolEntries), which the caller has already chosen. Empty when the tournament runs no high hand.
 */
export function highHandPots(tournament: HighHandsInput, poolEntries: readonly HighHandEntryInput[]): HighHandPot[] {
  const entrants = new Map<string, number>();
  for (const entry of poolEntries) {
    for (const id of highHandIdsOf(tournament, entry)) entrants.set(id, (entrants.get(id) ?? 0) + (entry.registrationCount ?? 1));
  }
  return highHandsOf(tournament).map((highHand, index) => highHandPot(highHand, entrants.get(highHand.id) ?? 0, index + 1));
}

/**
 * The pots added together, for a screen that shows one high-hand figure: the entries in any of them, and
 * their gross, AP, net and prizes summed. Awards are made per pot, never from this.
 */
export function combinedHighHand(pots: readonly HighHandPot[], entrants: number): HighHandBreakdown {
  const sum = (key: "gross" | "rake" | "net" | "winners") => pots.reduce((total, pot) => total + pot[key], 0);
  return { entrants, gross: sum("gross"), rake: sum("rake"), net: sum("net"), winners: pots.length === 0 ? 1 : sum("winners") };
}

/* ---------- awards ---------- */

/**
 * A tie for a high hand (TN2-04): a new winner shares the prize an earlier winner was awarded. The new
 * winner gets half, rounded down to the cent; the earlier winner keeps the rest (any odd cent), so the
 * two still add up to the original award. The one copy of the rule for the award dialog and the server.
 */
export function splitHighHandAward(awardedCents: Cents): { shareCents: Cents; keepCents: Cents } {
  const shareCents = Math.floor(Math.max(awardedCents, 0) / 2);
  return { shareCents, keepCents: awardedCents - shareCents };
}

/**
 * The next high-hand award (MONEY-36): what is left of the pot after the awards already made, split
 * over the winners still to come and rounded down to the cent, the last winner taking everything left.
 * So however the pot grew between awards, the awards add up to the pot exactly. Null once every
 * prize has been awarded; 0 when nothing is left.
 */
export function nextHighHandAward(highHand: Pick<HighHandBreakdown, "net" | "winners">, awardedCents: readonly Cents[]): Cents | null {
  const winnersLeft = highHand.winners - awardedCents.length;
  if (winnersLeft <= 0) return null;
  const left = highHand.net - awardedCents.reduce((sum, amount) => sum + amount, 0);
  if (left <= 0) return 0;
  return winnersLeft === 1 ? left : Math.floor(left / winnersLeft);
}

/**
 * What of the high-hand pot no award pays once every prize has been awarded: money paid in after the
 * last award, such as a payment confirmed late (only paid entries are in the pot: round 6), which the TD
 * adds to a winner's prize (R6REV0-MONEY-01). 0 while prizes are still to come (nextHighHandAward gives
 * the rest out) and when the awards add up to the pot.
 */
export function unawardedHighHandCents(highHand: Pick<HighHandBreakdown, "net" | "winners">, awardedCents: readonly Cents[]): Cents {
  if (awardedCents.length === 0 || awardedCents.length < highHand.winners) return 0;
  return Math.max(0, highHand.net - awardedCents.reduce((sum, amount) => sum + amount, 0));
}

export type HighHandAwardsProblem = {
  /** HIGH_HAND_OVER_POOL: more awarded than the pot holds; HIGH_HAND_AWARDED: every prize is awarded, so the pot is spoken for. */
  code: "HIGH_HAND_OVER_POOL" | "HIGH_HAND_AWARDED";
  awardedCents: Cents;
  potCents: Cents;
};

/**
 * Whether the high-hand awards already made still fit the pot after a change to it (an entry ticked
 * or unticked, the fee, its rake or the number of prizes): the awards may never add up to more than
 * the pot, there may never be more winners than prizes, and once every prize is awarded the awards
 * must add up to the pot exactly, so no money is left that nobody can win (MONEY-P2REV-05). Null when
 * they fit, or when nothing has been awarded yet.
 */
export function highHandAwardsProblem(
  highHand: Pick<HighHandBreakdown, "net" | "winners">,
  awardedCents: readonly Cents[],
): HighHandAwardsProblem | null {
  if (awardedCents.length === 0) return null;
  const awarded = awardedCents.reduce((sum, amount) => sum + amount, 0);
  const pot = Math.max(highHand.net, 0);
  if (awarded > pot) return { code: "HIGH_HAND_OVER_POOL", awardedCents: awarded, potCents: pot };
  if (awardedCents.length > highHand.winners || (awardedCents.length === highHand.winners && awarded !== pot)) {
    return { code: "HIGH_HAND_AWARDED", awardedCents: awarded, potCents: pot };
  }
  return null;
}

/**
 * Every high-hand prize awarded in the tournament, pot by pot in the tournament's order and in award
 * order within a pot. A registration row (or the API's registration) with its wins fits as it is.
 */
export function highHandAwardsOf(tournament: HighHandsInput, registrations: ReadonlyArray<HighHandEntryInput & { id: string }>): HighHandAward[] {
  const awards = registrations.flatMap((registration) =>
    highHandWinsOf(tournament, registration).map((win) => ({
      highHandId: win.highHandId,
      registrationId: registration.id,
      amountCents: win.amountCents,
      splitWithRegistrationId: win.splitWithRegistrationId ?? null,
      awardedAt: win.awardedAt ?? null,
    })),
  );
  const order = new Map(highHandsOf(tournament).map((highHand, index) => [highHand.id, index]));
  return awards
    .map((award, index) => ({ award, index }))
    .sort((a, b) => (order.get(a.award.highHandId) ?? 0) - (order.get(b.award.highHandId) ?? 0) || byAwardTime(a.award, b.award) || a.index - b.index)
    .map(({ award }) => award);
}

/** The amounts awarded from one pot, in award order. */
export const awardedCentsOf = (awards: readonly HighHandAward[], highHandId: string): Cents[] =>
  awards.filter((award) => award.highHandId === highHandId).map((award) => award.amountCents);

/** Where one pot stands: its money, its awards, the next award and what no award pays. */
export interface HighHandStanding {
  pot: HighHandPot;
  awards: HighHandAward[];
  awardedCents: Cents;
  /** nextHighHandAward: what the next winner is paid; null once every prize is awarded. */
  nextAwardCents: Cents | null;
  /** unawardedHighHandCents: money paid in after the last prize was awarded, for the TD to add to a winner's prize. */
  unawardedCents: Cents;
  /** highHandAwardsProblem: the awards no longer fit the pot (a stored state the server refuses to reach). */
  problem: HighHandAwardsProblem | null;
}

/** Each pot's standing, in the pots' order. */
export function highHandStandings(pots: readonly HighHandPot[], awards: readonly HighHandAward[]): HighHandStanding[] {
  return pots.map((pot) => {
    const own = awards.filter((award) => award.highHandId === pot.highHandId);
    const cents = own.map((award) => award.amountCents);
    return {
      pot,
      awards: own,
      awardedCents: cents.reduce((sum, amount) => sum + amount, 0),
      nextAwardCents: nextHighHandAward(pot, cents),
      unawardedCents: unawardedHighHandCents(pot, cents),
      problem: highHandAwardsProblem(pot, cents),
    };
  });
}

/** A pot whose awards no longer fit it, and which pot. */
export type PotAwardsProblem = HighHandAwardsProblem & { highHandId: string; name: string };

/**
 * Whether a change leaves every pot's awards fitting it (highHandAwardsProblem, one pot at a time): the
 * first pot that does not, in order. Only a pot whose money or number of prizes changed (or that is new)
 * is checked, so a change that does not touch a pot is never refused for it (as the legacy rule:
 * server/services/tournament-views assertHighHandAwardsFit). Null when they all fit.
 */
export function potsAwardsProblem(
  before: readonly HighHandPot[],
  after: readonly HighHandPot[],
  awards: readonly HighHandAward[],
): PotAwardsProblem | null {
  const was = new Map(before.map((pot) => [pot.highHandId, pot]));
  for (const pot of after) {
    const previous = was.get(pot.highHandId);
    if (previous && previous.net === pot.net && previous.winners === pot.winners) continue;
    const problem = highHandAwardsProblem(pot, awardedCentsOf(awards, pot.highHandId));
    if (problem) return { ...problem, highHandId: pot.highHandId, name: pot.name };
  }
  return null;
}

/* ---------- choosing high hands ---------- */

/** A choice of high hands read against the tournament's: the ones it runs, in its order, and the ids it does not run. */
export interface HighHandChoice {
  ids: string[];
  unknown: string[];
}

/** `highHandIds` as the tournament runs them: duplicates dropped, in the tournament's order, unknown ids apart. */
export function readHighHandChoice(tournament: HighHandsInput, highHandIds: readonly string[]): HighHandChoice {
  const running = highHandsOf(tournament).map((highHand) => highHand.id);
  const chosen = new Set(highHandIds);
  return {
    ids: running.filter((id) => chosen.has(id)),
    unknown: Array.from(chosen).filter((id) => !running.includes(id)),
  };
}

/**
 * What a sign-up's or a correction's high-hand fields choose: `highHandIds` when sent (round 10), else
 * the legacy `enteringHighHands`, which means every high hand the tournament runs (true) or none (false),
 * as the one $10 entry did; undefined when neither is sent (the choice stays as it is).
 */
export function chosenHighHandIds(
  tournament: HighHandsInput,
  input: { highHandIds?: readonly string[] | null; enteringHighHands?: boolean | null },
): string[] | undefined {
  if (input.highHandIds !== undefined && input.highHandIds !== null) return [...input.highHandIds];
  if (input.enteringHighHands === undefined || input.enteringHighHands === null) return undefined;
  return input.enteringHighHands ? highHandsOf(tournament).map((highHand) => highHand.id) : [];
}

/** What changing an entry's high hands to `nextIds` does: the ones it joins and leaves, and those it leaves having won a prize in. */
export interface HighHandChoiceChange {
  joined: string[];
  left: string[];
  /** Left with an award in it: refused until the award is taken back (HIGH_HAND_WINNER). */
  leftWon: string[];
}

export function highHandChoiceChange(tournament: HighHandsInput, entry: HighHandEntryInput, nextIds: readonly string[]): HighHandChoiceChange {
  const before = highHandIdsOf(tournament, entry);
  const after = readHighHandChoice(tournament, nextIds).ids;
  const won = new Set(highHandWinsOf(tournament, entry).map((win) => win.highHandId));
  const left = before.filter((id) => !after.includes(id));
  return { joined: after.filter((id) => !before.includes(id)), left, leftWon: left.filter((id) => won.has(id)) };
}

/* ---------- the legacy columns kept as a summary ---------- */

/**
 * The legacy tournament columns a tournament that lists its high hands keeps as their summary, written
 * with every change to the list: switched on while it runs any, at what entering every one costs (the
 * "All high hands" price), so a screen or a build that reads only those columns still says whether there
 * is a high hand and what entering all of it costs. Nothing reads them for money while the list exists.
 */
export function tournamentHighHandSummary(highHands: readonly Pick<HighHandSettings, "entryFee">[]): {
  enableHighHand: boolean;
  highHandAmount: string | null;
} {
  if (highHands.length === 0) return { enableHighHand: false, highHandAmount: null };
  return { enableHighHand: true, highHandAmount: centsToDecimalString(highHands.reduce((sum, highHand) => sum + highHandFeeCents(highHand), 0)) };
}

/**
 * The legacy registration columns a registration of a tournament that lists its high hands keeps as
 * their summary, written in the same transaction as its choices and awards: in a high hand while it is
 * in any, a winner while it has won any, for what it has won in all.
 */
export function registrationHighHandSummary(highHandIds: readonly string[], wins: readonly Pick<HighHandWinInput, "amountCents">[]): {
  enteringHighHands: boolean;
  highHandWinner: boolean;
  highHandAmount: string | null;
} {
  return {
    enteringHighHands: highHandIds.length > 0,
    highHandWinner: wins.length > 0,
    highHandAmount: wins.length > 0 ? centsToDecimalString(wins.reduce((sum, win) => sum + win.amountCents, 0)) : null,
  };
}

/* ---------- staff changing the list ---------- */

/** One high hand as staff set it, in the order wanted (shared/api/high-hands highHandInputSchema's output fits). */
export interface HighHandChangeInput {
  /** A listed high hand's id, LEGACY_HIGH_HAND_ID for the legacy one, or absent for a new one. */
  id?: string;
  name: string;
  entryFee: MoneyInput;
  rakeType?: string | null;
  rakeAmount?: MoneyInput;
  winners?: number | null;
  note?: string | null;
  /**
   * A new high hand the legacy high hand's players are entered in too, as the change takes the legacy
   * one into the list (R10REV1-MONEY-02: its one entry covered both halves, so they stay in both and
   * owe what they did). Read only for a new high hand while the legacy one is taken in.
   */
  legacyEntrants?: boolean | null;
}

/** A high hand as it will be stored: its settings and its place in the list. */
export interface PlannedHighHand {
  name: string;
  position: number;
  entryFee: string;
  rakeType: string;
  rakeAmount: string;
  winners: number;
  note: string | null;
}

/**
 * What a change to the list does:
 * - "unchanged": nothing to write (the list resent as it is, or no high hand turned off).
 * - "legacy_off": a tournament that lists none turns its legacy high hand off (enableHighHand false), by
 *   the legacy rules (HIGH_HAND_ENTRIES while anyone is in it); no list is started.
 * - "list": the rows to create (`adoptsLegacy` for the legacy high hand taken into the list, with its
 *   entrants and awards: adoptLegacyHighHand; `takesLegacyEntrants` for a new one its entrants are put
 *   in too: HighHandChangeInput.legacyEntrants), update and remove (`removesLegacy`: the legacy high
 *   hand left out of a new list, refused while anyone is in it). From then on the tournament lists its
 *   high hands.
 * - "unknown": an id that is not one of the tournament's high hands (LEGACY_HIGH_HAND_ID once it lists
 *   them), or a high hand named twice.
 */
export type HighHandsChangePlan =
  | { kind: "unchanged" }
  | { kind: "legacy_off" }
  | {
      kind: "list";
      create: Array<PlannedHighHand & { adoptsLegacy: boolean; takesLegacyEntrants: boolean }>;
      update: Array<PlannedHighHand & { id: string }>;
      remove: string[];
      removesLegacy: boolean;
    }
  | { kind: "unknown"; id: string };

function planned(input: HighHandChangeInput, position: number): PlannedHighHand {
  const rakeType = input.rakeType === "percentage" || input.rakeType === "fixed" ? input.rakeType : "none";
  return {
    name: input.name.trim(),
    position,
    entryFee: centsToDecimalString(toCents(input.entryFee)),
    rakeType,
    rakeAmount: rakeType === "none" ? "0.00" : centsToDecimalString(toCents(input.rakeAmount)),
    winners: highHandWinners(input),
    note: input.note?.trim() ? input.note.trim() : null,
  };
}

const sameSettings = (a: PlannedHighHand, b: PlannedHighHand) =>
  a.name === b.name &&
  a.position === b.position &&
  a.entryFee === b.entryFee &&
  a.rakeType === b.rakeType &&
  a.rakeAmount === b.rakeAmount &&
  a.winners === b.winners &&
  a.note === b.note;

/**
 * What setting the tournament's high hands to `next` (in order) writes. Validation of each high hand
 * (a name, a fee above $0, a rate within 100%) is the request schema's; this is the bookkeeping, pure
 * so the legacy rules are tested here: a tournament that lists none keeps its columns until the list
 * really changes, and then takes its legacy high hand (LEGACY_HIGH_HAND_ID) into the list with its
 * entrants and awards, so no money moves.
 */
export function planHighHandsChange(tournament: HighHandsInput, next: readonly HighHandChangeInput[]): HighHandsChangePlan {
  const seen = new Set<string>();
  for (const item of next) {
    if (item.id === undefined) continue;
    if (seen.has(item.id)) return { kind: "unknown", id: item.id };
    seen.add(item.id);
  }
  const wanted = next.map((item, index) => ({ id: item.id, settings: planned(item, index + 1), legacyEntrants: item.id === undefined && item.legacyEntrants === true }));

  if (!listsHighHands(tournament)) {
    const offered = offersLegacyHighHand(tournament);
    const stray = wanted.find((item) => item.id !== undefined && (item.id !== LEGACY_HIGH_HAND_ID || !offered));
    if (stray?.id !== undefined) return { kind: "unknown", id: stray.id };
    if (wanted.length === 0) return offered ? { kind: "legacy_off" } : { kind: "unchanged" };
    const legacy = planned(legacyHighHand(tournament), 1);
    if (wanted.length === 1 && wanted[0].id === LEGACY_HIGH_HAND_ID && sameSettings(wanted[0].settings, legacy)) return { kind: "unchanged" };
    const adopting = seen.has(LEGACY_HIGH_HAND_ID);
    return {
      kind: "list",
      create: wanted.map((item) => ({ ...item.settings, adoptsLegacy: item.id === LEGACY_HIGH_HAND_ID, takesLegacyEntrants: adopting && item.legacyEntrants })),
      update: [],
      remove: [],
      removesLegacy: offered && !seen.has(LEGACY_HIGH_HAND_ID),
    };
  }

  const current = new Map(highHandsOf(tournament).map((highHand, index) => [highHand.id, planned(highHand, index + 1)]));
  const stray = wanted.find((item) => item.id !== undefined && !current.has(item.id));
  if (stray?.id !== undefined) return { kind: "unknown", id: stray.id };
  const create = wanted.filter((item) => item.id === undefined).map((item) => ({ ...item.settings, adoptsLegacy: false, takesLegacyEntrants: false }));
  const update = wanted.flatMap((item) => {
    const stored = item.id === undefined ? undefined : current.get(item.id);
    return item.id !== undefined && stored && !sameSettings(stored, item.settings) ? [{ ...item.settings, id: item.id }] : [];
  });
  const remove = Array.from(current.keys()).filter((id) => !seen.has(id));
  if (create.length === 0 && update.length === 0 && remove.length === 0) return { kind: "unchanged" };
  return { kind: "list", create, update, remove, removesLegacy: false };
}

/**
 * The legacy high hand as a tournament starts listing its high hands (planHighHandsChange's
 * `adoptsLegacy`): the registrations in it (registration_high_hands rows) and its awards
 * (high_hand_awards rows), each exactly as the columns hold them, so every pot, award and amount owed
 * is what it was (the adoption parity test). Null when the tournament offers no legacy high hand.
 */
export function adoptLegacyHighHand(
  tournament: HighHandsInput,
  registrations: ReadonlyArray<HighHandEntryInput & { id: string }>,
): { entrantIds: string[]; awards: Array<{ registrationId: string; amountCents: Cents }> } | null {
  if (listsHighHands(tournament) || !offersLegacyHighHand(tournament)) return null;
  return {
    entrantIds: registrations.filter((registration) => registration.enteringHighHands === true).map((registration) => registration.id),
    awards: registrations
      .filter((registration) => registration.highHandWinner === true)
      .map((registration) => ({ registrationId: registration.id, amountCents: toCents(registration.highHandAmount) })),
  };
}

/** A fee change to a high hand with entries recorded at it: the TD confirms the re-pricing (ENTRIES_REPRICED, repriceEntries). */
export interface HighHandRepricing {
  highHandId: string;
  name: string;
  /** Entries recorded in it (every one in the field, paid or not: what the desk will ask each for). */
  count: number;
  fromCents: Cents;
  toCents: Cents;
  /**
   * The legacy high hand taken into the list (R10REV1-MONEY-02): the high hands its entries will then
   * be in (toCents is their fees together), and the new ones they will not, by name, for the question
   * to say so ("in the First half high hand only, not the Second half").
   */
  nowIn?: string[];
  notIn?: string[];
}

/** One high hand of the list as it will be, as repricedHighHands reads it (a HighHandChangeInput fits). */
export type RepricedHighHandInput = Pick<HighHandChangeInput, "id" | "entryFee" | "legacyEntrants"> & { name?: string };

/**
 * Where the legacy high hand's entries will be once `next` takes it into the list (R10REV1-MONEY-02):
 * its own high hand and the new ones marked `legacyEntrants`, whose fees together are what each entry
 * then owes, and the new ones they will not be in. Null when `next` does not take it in, or the
 * tournament already lists its high hands.
 */
function legacyReach(tournament: HighHandsInput, next: readonly RepricedHighHandInput[]): { feeCents: Cents; nowIn: string[]; notIn: string[] } | null {
  const own = next.find((highHand) => highHand.id === LEGACY_HIGH_HAND_ID);
  if (listsHighHands(tournament) || !own) return null;
  const added = next.filter((highHand) => highHand.id === undefined);
  const carried = added.filter((highHand) => highHand.legacyEntrants === true);
  const nameOf = (highHand: RepricedHighHandInput) => (highHand.name ?? DEFAULT_HIGH_HAND_NAME).trim();
  return {
    feeCents: [own, ...carried].reduce((sum, highHand) => sum + highHandFeeCents(highHand), 0),
    nowIn: [own, ...carried].map(nameOf),
    notIn: added.filter((highHand) => highHand.legacyEntrants !== true).map(nameOf),
  };
}

/**
 * The high hands whose fee changes while entries are recorded at it. `recordedEntries` are the field's
 * entries, paid or not (the waiting list left out), as for the other prices
 * (shared/domain/prize-pool recordedEntryCounts); `next` is the list as it will be (new high hands, with
 * no id, are read only for the legacy high hand taken in: what its entries then owe is the fees of every
 * high hand they will be in, and the question names them: legacyReach).
 */
export function repricedHighHands(
  tournament: HighHandsInput,
  next: readonly RepricedHighHandInput[],
  recordedEntries: readonly HighHandEntryInput[],
): HighHandRepricing[] {
  const counts = new Map<string, number>();
  for (const entry of recordedEntries) {
    for (const id of highHandIdsOf(tournament, entry)) counts.set(id, (counts.get(id) ?? 0) + (entry.registrationCount ?? 1));
  }
  const reach = legacyReach(tournament, next);
  const wanted = new Map(next.flatMap((highHand) => (highHand.id === undefined ? [] : [[highHand.id, highHandFeeCents(highHand)] as const])));
  if (reach) wanted.set(LEGACY_HIGH_HAND_ID, reach.feeCents);
  return highHandsOf(tournament).flatMap((highHand) => {
    const count = counts.get(highHand.id) ?? 0;
    const from = highHandFeeCents(highHand);
    const to = wanted.get(highHand.id);
    if (count === 0 || to === undefined || to === from) return [];
    // Named only when the list has other high hands the entries could be in.
    const where = reach && highHand.id === LEGACY_HIGH_HAND_ID && reach.nowIn.length + reach.notIn.length > 1 ? { nowIn: reach.nowIn, notIn: reach.notIn } : {};
    return [{ highHandId: highHand.id, name: highHand.name, count, fromCents: from, toCents: to, ...where }];
  });
}

/** How many entries (in `entries`) are in each of the tournament's high hands. */
export function highHandEntrantCounts(tournament: HighHandsInput, entries: readonly HighHandEntryInput[]): Map<string, number> {
  const counts = new Map(highHandsOf(tournament).map((highHand) => [highHand.id, 0]));
  for (const entry of entries) {
    for (const id of highHandIdsOf(tournament, entry)) counts.set(id, (counts.get(id) ?? 0) + (entry.registrationCount ?? 1));
  }
  return counts;
}

/* ---------- the forms' helpers ---------- */

/**
 * The form's "Two high hands at $5 each" helper: a first-half and a second-half high hand at `feeEach`,
 * each with one prize and no AP (the TD sets those after).
 */
export function twoHighHandsPreset(feeEach: MoneyInput): Array<Omit<HighHandChangeInput, "id">> {
  const entryFee = centsToDecimalString(toCents(feeEach));
  return [
    { name: "First half", entryFee, rakeType: "none", rakeAmount: "0.00", winners: 1, note: "Before the break" },
    { name: "Second half", entryFee, rakeType: "none", rakeAmount: "0.00", winners: 1, note: "After the break" },
  ];
}

/* ---------- the finalize snapshot ---------- */

/** One pot as finalize froze it (shared/domain/finalize PrizePoolSnapshot.highHands): staff only, like the rest of the snapshot. */
export interface SnapshotHighHand {
  highHandId: string;
  name: string;
  feeCents: Cents;
  entrants: number;
  grossCents: Cents;
  rakeCents: Cents;
  netCents: Cents;
  winners: number;
  awards: Array<{ registrationId: string; playerName: string; amountCents: Cents; splitWithRegistrationId: string | null }>;
}

/** The pots as finalize records them, with each award's player named (`nameOf` takes a registration id). */
export function snapshotHighHands(standings: readonly HighHandStanding[], nameOf: (registrationId: string) => string): SnapshotHighHand[] {
  return standings.map(({ pot, awards }) => ({
    highHandId: pot.highHandId,
    name: pot.name,
    feeCents: pot.feeCents,
    entrants: pot.entrants,
    grossCents: pot.gross,
    rakeCents: pot.rake,
    netCents: pot.net,
    winners: pot.winners,
    awards: awards.map((award) => ({
      registrationId: award.registrationId,
      playerName: nameOf(award.registrationId),
      amountCents: award.amountCents,
      splitWithRegistrationId: award.splitWithRegistrationId,
    })),
  }));
}
