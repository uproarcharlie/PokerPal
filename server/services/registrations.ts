/**
 * Tournament registrations: sign-up, the TD's updates, count changes and payment. Every change runs in
 * one transaction that first locks the tournament row (then the registration rows it touches), so the
 * checks below and the writes they guard never interleave with another change to the same tournament:
 * no duplicate sign-ups, no player accepted past Max players, no re-buy slipping past the prize-pool
 * lock (data-integrity-10, MONEY-21). Counters change by SQL increments, and each change's activity row
 * is written in the same transaction.
 *
 * Max players (round 5, item 15, the owner's rule): sign-ups may go past it, onto a numbered waiting
 * list (shared/domain/waiting-list), but nobody, staff or owner, can accept more than it: confirming a
 * payment, or anything else that puts a waiting-list entry in the field (a re-buy, add-on, knockout or
 * bust), is 409 TOURNAMENT_FULL once Max players are in, with no override. Registrations answer with
 * their `waitingListPosition`.
 */
import type { Request } from "express";
import type {
  AdjustCountsInput,
  StaffRegistrationInput,
  UpdateRegistrationInput,
} from "@shared/api/registrations";
import { pickFields, PUBLIC_REGISTRATION_FIELDS } from "@shared/api/public";
import type { ActivityEventType } from "@shared/api/tournaments";
import { centsToDecimalString, centsToDollars, formatMoney, toCents, type Cents } from "@shared/domain/money";
import { lateTopUpText, offersHighHand, PRIZE_POOL_LOCKED_MESSAGE, topUpRefusal, type TopUpCounts } from "@shared/domain/player-actions";
import { registrationRemovalProblem } from "@shared/domain/standings";
import { acceptRefusal, inFieldByRight, waitingListPositions, type WaitingListEntry } from "@shared/domain/waiting-list";
import {
  amountDueCents,
  computePrizePool,
  HIGH_HAND_PRIZES_MAX,
  highHandAwardsProblem,
  nextHighHandAward,
  splitHighHandAward,
  unawardedHighHandCents,
} from "@shared/domain/prize-pool";
import type { InsertTournamentRegistration, PendingAction, Player, Tournament, TournamentRegistration } from "@shared/schema";
import { db, type Transaction } from "../db";
import { viewerFor, type ClubScope } from "../http/authz";
import { badRequest, conflict, HttpError, notFound } from "../http/errors";
import { insertActivity } from "../repositories/activity";
import { clockElapsedMsNow } from "../repositories/clock";
import { deletePendingActionsForPlayer } from "../repositories/pending-actions";
import { claimHomeClubFromFirstRegistration, getPlayer, isKnownAtClub } from "../repositories/players";
import * as registrationsRepo from "../repositories/registrations";
import { getTournament, setTournamentColumns } from "../repositories/tournaments";
import { recordAudit } from "./audit";
import { clubRequiresSignUpPhoto, contactAccess, photoRequired, toClubPlayer, toPublicPlayer } from "./players";
import { assertApStillWithinGross } from "./prize-pool";
import { autoSeatNewRegistration, autoSeatOnPayment, releaseSeatOnElimination, restoreSeatAfterReturn } from "./seating";
import { assertHighHandAwardsFit, assertOpen, closedMessage, highHandAwardsConflict, isClosed } from "./tournament-views";
import { requireTournament } from "./tournaments";

/**
 * The registration as anyone sees it (PublicRegistration). With `waitingList` (each waiting-list
 * entry's place, waitingListOf) it says its place on the list, or null when it is in the field.
 */
export function toPublicRegistration(registration: TournamentRegistration, player: Player | null | undefined, waitingList?: ReadonlyMap<string, number>) {
  return {
    ...pickFields(registration, PUBLIC_REGISTRATION_FIELDS),
    player: player ? toPublicPlayer(player) : null,
    ...(waitingList ? { waitingListPosition: waitingList.get(registration.id) ?? null } : {}),
  };
}

/** The registration as the club's staff see it (ManagedRegistration): the public row, plus whether it has paid. */
export function toManagedRegistration(registration: TournamentRegistration, player: Player | null | undefined, waitingList?: ReadonlyMap<string, number>) {
  return { ...toPublicRegistration(registration, player, waitingList), paymentConfirmed: registration.paymentConfirmed };
}

/** Each waiting-list entry's place on the list (1 = next in), by registration id (round 5, item 15). */
function waitingListOf(tournament: Pick<Tournament, "maxPlayers">, registrations: readonly TournamentRegistration[]): Map<string, number> {
  return waitingListPositions(registrations, tournament.maxPlayers);
}

/** The waiting list as it stands now, read in the write's transaction. */
async function currentWaitingList(tx: Transaction, tournament: Tournament): Promise<Map<string, number>> {
  return waitingListOf(tournament, await registrationsRepo.registrationsOf(tx, tournament.id));
}

/**
 * 409 TOURNAMENT_FULL when `before` (a registration, or {} for a new one), not in the field by right,
 * would be (`after`: its payment confirmed, or a re-buy, add-on, knockout or bust recorded) while Max
 * players are in it already: "18 of 18 players accepted: raise Max players to accept more". No
 * override, for staff or owners: raise Max players, or remove an entry, first.
 */
async function assertRoomToAccept(tx: Transaction, tournament: Tournament, before: WaitingListEntry, after: WaitingListEntry): Promise<void> {
  if (inFieldByRight(before) || !inFieldByRight(after)) return;
  const others = (await registrationsRepo.registrationsOf(tx, tournament.id)).filter((registration) => registration.id !== before.id);
  const refusal = acceptRefusal(others, tournament.maxPlayers, before);
  if (refusal) throw conflict("TOURNAMENT_FULL", refusal);
}

const playerName = (player: Player | null | undefined) => player?.name || "Unknown player";
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

// ---------------------------------------------------------------------------------------------------
// Reads

/**
 * GET /api/tournaments/:id/registrations (public): sign-up order, players reduced to PublicPlayer
 * (SEC-09); whether each entry has paid only for someone who runs the club (P2REV0-SEC-04). An
 * unknown tournament has none.
 */
export async function listRegistrations(req: Request, tournamentId: string) {
  const tournament = await getTournament(db, tournamentId);
  const canManage = tournament !== undefined && req.user !== undefined && (await viewerFor(req, tournament.clubId)).canManage;
  const rows = await registrationsRepo.listRegistrationsWithPlayers(db, tournamentId);
  const waitingList = tournament ? waitingListOf(tournament, rows.map(({ registration }) => registration)) : new Map<string, number>();
  return rows.map(({ registration, player }) =>
    canManage ? toManagedRegistration(registration, player, waitingList) : toPublicRegistration(registration, player, waitingList),
  );
}

/**
 * The payment desk's lists (staff): unpaid registrations with amountOwed, or paid ones with amountPaid,
 * in dollars. Players as ClubPlayer: contact details only for those whose home club the viewer runs.
 */
export async function listPaymentRegistrations(scope: ClubScope, tournamentId: string, paid: boolean) {
  const tournament = await requireTournament(tournamentId);
  const [rows, everyone] = await Promise.all([
    registrationsRepo.listRegistrationsWithPlayers(db, tournamentId, { paymentConfirmed: paid }),
    registrationsRepo.registrationsOf(db, tournamentId),
  ]);
  const waitingList = waitingListOf(tournament, everyone);
  const canEdit = await contactAccess(db, scope, rows.flatMap(({ player }) => (player ? [player.id] : [])));
  return rows.map(({ registration, player }) => {
    const amount = centsToDollars(amountDueCents(tournament, registration));
    const row = {
      ...pickFields(registration, PUBLIC_REGISTRATION_FIELDS),
      paymentConfirmed: registration.paymentConfirmed,
      waitingListPosition: waitingList.get(registration.id) ?? null,
      player: player ? toClubPlayer(player, canEdit(player.id)) : null,
    };
    return paid ? { ...row, amountPaid: amount } : { ...row, amountOwed: amount };
  });
}

// ---------------------------------------------------------------------------------------------------
// Building blocks shared with pending actions (all take the transaction and already-locked rows)

export interface LockedRegistration {
  tournament: Tournament;
  registration: TournamentRegistration;
}

/** Locks the registration's tournament, then the registration itself. 404 when it does not exist. */
export async function lockRegistrationById(tx: Transaction, registrationId: string): Promise<LockedRegistration> {
  const found = await registrationsRepo.getTournamentRegistration(tx, registrationId);
  const tournament = found && (await registrationsRepo.lockTournamentForRegistrationWrite(tx, found.tournamentId));
  const registration = tournament && (await registrationsRepo.lockRegistration(tx, registrationId));
  if (!tournament || !registration) throw notFound("Registration not found");
  return { tournament, registration };
}

/** 409 MAX_REBUYS_REACHED, MAX_ADDONS_REACHED or REBUY_OR_ADDON when the house rules do not allow going from `before` to `after`. */
function assertTopUpsAllowed(tournament: Tournament, before: TopUpCounts, after: TopUpCounts): void {
  const refusal = topUpRefusal(tournament, before, after);
  if (refusal) throw conflict(refusal.code, refusal.message);
}

/** A player's confirmed request: when they asked, and the clock's time then (null when unknown). */
export type TopUpRequest = Pick<PendingAction, "timestamp" | "clockElapsedMs">;

/**
 * "after the re-buy period, which ended at 2:15 on the clock" when the sale's clock time is past the
 * tournament's re-buy period; null without a period, without a clock, or before its end
 * (TDN3-HOUSE-RULES). A request's clock time is the one recorded when the player asked: the clock's
 * anchors as they are now cannot give it back once anyone has paused or moved the clock since
 * (P4REV1-R2-01), so a request without one is never called late. A desk sale's is now.
 */
async function lateTopUpOf(tx: Transaction, tournament: Tournament, request: TopUpRequest | undefined): Promise<string | null> {
  if (tournament.rebuyPeriodMinutes === null) return null;
  const elapsedClockMs = request ? request.clockElapsedMs : await clockElapsedMsNow(tx, tournament.id);
  return lateTopUpText(tournament.rebuyPeriodMinutes, elapsedClockMs);
}

async function logActivity(
  tx: Transaction,
  registration: Pick<TournamentRegistration, "tournamentId" | "playerId">,
  eventType: ActivityEventType,
  description: string,
  eventData?: Record<string, unknown>,
): Promise<void> {
  await insertActivity(tx, {
    tournamentId: registration.tournamentId,
    playerId: registration.playerId,
    eventType,
    description,
    eventData: eventData ? JSON.stringify(eventData) : undefined,
  });
}

/**
 * The re-buy and add-on entries. One sold after the re-buy period says so ("… after the re-buy period,
 * which ended at 2:15 on the clock"): allowed, but never without a word. `request` is the player's
 * request it confirms, if any.
 */
async function logIncreases(
  tx: Transaction,
  tournament: Tournament,
  registration: TournamentRegistration,
  player: Player | undefined,
  added: { rebuys: number; addons: number },
  request?: TopUpRequest,
): Promise<void> {
  if (added.rebuys <= 0 && added.addons <= 0) return;
  const late = await lateTopUpOf(tx, tournament, request);
  const note = late ? ` ${late}` : "";
  const data = late ? { afterRebuyPeriod: true, rebuyPeriodMinutes: tournament.rebuyPeriodMinutes } : undefined;
  if (added.rebuys > 0) {
    await logActivity(tx, registration, "rebuy", `${playerName(player)} made ${plural(added.rebuys, "re-buy")}${note}`, data);
  }
  if (added.addons > 0) {
    await logActivity(tx, registration, "addon", `${playerName(player)} purchased ${plural(added.addons, "add-on")}${note}`, data);
  }
}

/** Whether a player's request was made before the prize pool was (last) locked, so it was paid for in time. */
function requestedBeforeLock(tournament: Tournament, requestedAt: Date | null | undefined): boolean {
  const lockedAt = tournament.prizePoolLockedAt;
  return requestedAt instanceof Date && lockedAt instanceof Date && requestedAt.getTime() <= lockedAt.getTime();
}

/**
 * Adds `deltas` to a registration's counts (POST /counts, a confirmed pending re-buy or add-on). Open
 * tournaments only; increases are refused while the pool is locked or past maxRebuys; no count may go
 * below zero, and a decrease may not leave a manual AP total above the gross. Increases are logged.
 * A re-buy by a player who is out is their re-entry: they are back in, and whoever knocked them out
 * keeps that knockout (unlike a restore, which undoes a mistaken elimination).
 *
 * `request` is the player's request it confirms: one made before the pool was locked is still applied
 * after the lock, since the player paid at the table in time and the TD may lock at the end of the
 * re-buy break and then work through the queue (TN2-01). The lock still refuses
 * anything asked for, or added by staff, after it. `reenter: false` records a re-buy for a player who
 * is out without putting them back in: one they asked and paid for before going out (TN-RV2-01).
 */
export async function applyCountChange(
  tx: Transaction,
  { tournament, registration }: LockedRegistration,
  deltas: AdjustCountsInput,
  { request, reenter = true }: { request?: TopUpRequest; reenter?: boolean } = {},
): Promise<TournamentRegistration> {
  assertOpen(tournament);
  const delta = { rebuys: deltas.rebuys ?? 0, addons: deltas.addons ?? 0, knockouts: deltas.knockouts ?? 0 };
  const next = {
    rebuys: (registration.rebuys ?? 0) + delta.rebuys,
    addons: (registration.addons ?? 0) + delta.addons,
    knockouts: (registration.knockouts ?? 0) + delta.knockouts,
  };
  if (tournament.prizePoolLocked && (delta.rebuys > 0 || delta.addons > 0) && !requestedBeforeLock(tournament, request?.timestamp)) {
    throw conflict("PRIZE_POOL_LOCKED", PRIZE_POOL_LOCKED_MESSAGE);
  }
  assertTopUpsAllowed(tournament, { rebuys: registration.rebuys ?? 0, addons: registration.addons ?? 0 }, next);
  if (next.rebuys < 0 || next.addons < 0 || next.knockouts < 0) {
    throw conflict("COUNT_BELOW_ZERO", "A count cannot go below zero");
  }
  await assertRoomToAccept(tx, tournament, registration, { ...registration, ...next });

  let updated = await registrationsRepo.addToCounts(tx, registration.id, delta);
  if (!updated) throw notFound("Registration not found");
  const reentry = reenter && registration.isEliminated === true && delta.rebuys > 0;
  if (reentry) {
    updated = await registrationsRepo.updateTournamentRegistration(tx, registration.id, {
      isEliminated: false,
      eliminationTime: null,
      eliminatedBy: null,
    });
    if (!updated) throw notFound("Registration not found");
  }
  if (delta.rebuys < 0 || delta.addons < 0) {
    await assertApStillWithinGross(tx, tournament, await registrationsRepo.registrationsOf(tx, tournament.id));
  }
  const player = await getPlayer(tx, registration.playerId);
  await logIncreases(tx, tournament, updated, player, { rebuys: Math.max(delta.rebuys, 0), addons: Math.max(delta.addons, 0) }, request);
  if (reentry) await logActivity(tx, updated, "reentry", `${playerName(player)} is back in with a re-buy`);
  if (reentry) await restoreSeatAfterReturn(tx, tournament, registration.id);
  return updated;
}

const invalidEliminator = () =>
  badRequest("The knockout must go to another player who is still in this tournament", "INVALID_TARGET");

/** Columns of the registration itself that an elimination or restore writes along with its own. */
type RegistrationChanges = Partial<InsertTournamentRegistration>;

export interface EliminateOptions {
  /** Columns of the eliminated registration to write along with the elimination. */
  otherChanges?: RegistrationChanges;
  /**
   * The knockout was claimed by the eliminator from their phone (a pending action). The claim was only
   * accepted while they were still in, so it counts even if they have gone out since.
   */
  claimed?: boolean;
  /**
   * When the knockout happened, if earlier than now: a claim's own time, so a claim the TD confirms
   * late still ranks the player as busting when they did (MONEY-P2REV-03). Never later than now.
   */
  at?: Date | null;
}

/** The elimination time to store: `at` when it is a real time no later than now, else now. */
function eliminationTimeFor(at: Date | null | undefined): Date {
  const now = new Date();
  return at instanceof Date && Number.isFinite(at.getTime()) && at.getTime() < now.getTime() ? at : now;
}

/** The eliminator's registration, locked: another player of this tournament who was in when the knockout happened. */
async function lockEliminator(
  tx: Transaction,
  { tournament, registration }: LockedRegistration,
  eliminatedBy: string,
  claimed: boolean,
): Promise<TournamentRegistration> {
  if (eliminatedBy === registration.playerId) throw invalidEliminator();
  const eliminator = await registrationsRepo.lockPlayerRegistration(tx, tournament.id, eliminatedBy);
  if (!eliminator) throw invalidEliminator();
  if (eliminator.isEliminated && !claimed) {
    const name = (await getPlayer(tx, eliminatedBy))?.name ?? "That player";
    throw badRequest(`${name} is out of the tournament, so the knockout cannot go to them`, "INVALID_TARGET");
  }
  return eliminator;
}

export interface Elimination {
  eliminated: TournamentRegistration;
  /** The eliminator's registration after their knockout was credited; null when nobody was credited. */
  eliminator: TournamentRegistration | null;
}

/**
 * Knocks a player out: the server stamps the time (now, or a confirmed claim's own time), and the
 * eliminator (another player of the same tournament who is still in, or nobody) is credited one
 * knockout. Logged as today ("Alice was eliminated by Bob").
 */
export async function eliminate(
  tx: Transaction,
  locked: LockedRegistration,
  eliminatedBy: string | null,
  { otherChanges = {}, claimed = false, at }: EliminateOptions = {},
): Promise<Elimination> {
  const { tournament, registration } = locked;
  assertOpen(tournament);
  if (registration.isEliminated) throw conflict("ALREADY_ELIMINATED", "This player has already been eliminated");
  const eliminatorRegistration = eliminatedBy !== null ? await lockEliminator(tx, locked, eliminatedBy, claimed) : undefined;
  await assertRoomToAccept(tx, tournament, registration, { ...registration, ...otherChanges, isEliminated: true });

  const eliminated = await registrationsRepo.updateTournamentRegistration(tx, registration.id, {
    ...otherChanges,
    isEliminated: true,
    eliminationTime: eliminationTimeFor(at),
    eliminatedBy,
  });
  if (!eliminated) throw notFound("Registration not found");
  await releaseSeatOnElimination(tx, registration.id);
  if (eliminatorRegistration) {
    await assertRoomToAccept(tx, tournament, eliminatorRegistration, { ...eliminatorRegistration, knockouts: (eliminatorRegistration.knockouts ?? 0) + 1 });
  }
  const eliminator = eliminatorRegistration
    ? ((await registrationsRepo.addToCounts(tx, eliminatorRegistration.id, { knockouts: 1 })) ?? null)
    : null;
  await logElimination(tx, eliminated, eliminatedBy);
  return { eliminated, eliminator };
}

/**
 * Confirms a player's knockout claim on someone who is already out with nobody recorded as their
 * eliminator (the TD marked them out before getting to the claim): the claimer gets the knockout, and
 * the elimination keeps its time. The feed already says the player went out, so this logs the credit
 * ("Alice is credited with knocking out Bob"), never a second elimination (TN-REV2-03).
 */
export async function creditKnockout(tx: Transaction, locked: LockedRegistration, eliminatedBy: string): Promise<Elimination> {
  const { tournament, registration } = locked;
  assertOpen(tournament);
  if (!registration.isEliminated || registration.eliminatedBy) {
    throw new Error("creditKnockout needs an elimination with no eliminator");
  }
  const eliminatorRegistration = await lockEliminator(tx, locked, eliminatedBy, true);
  await assertRoomToAccept(tx, tournament, eliminatorRegistration, { ...eliminatorRegistration, knockouts: (eliminatorRegistration.knockouts ?? 0) + 1 });
  const eliminated = await registrationsRepo.updateTournamentRegistration(tx, registration.id, { eliminatedBy });
  if (!eliminated) throw notFound("Registration not found");
  const eliminator = (await registrationsRepo.addToCounts(tx, eliminatorRegistration.id, { knockouts: 1 })) ?? null;
  const [claimer, knockedOut] = [await getPlayer(tx, eliminatedBy), await getPlayer(tx, eliminated.playerId)];
  await logActivity(
    tx,
    eliminated,
    "knockout_credited",
    `${playerName(claimer)} is credited with knocking out ${playerName(knockedOut)}`,
    { eliminatedBy },
  );
  return { eliminated, eliminator };
}

async function logElimination(tx: Transaction, eliminated: TournamentRegistration, eliminatedBy: string | null): Promise<void> {
  const player = await getPlayer(tx, eliminated.playerId);
  const eliminatorPlayer = eliminatedBy ? await getPlayer(tx, eliminatedBy) : undefined;
  await logActivity(
    tx,
    eliminated,
    "elimination",
    eliminatorPlayer
      ? `${playerName(player)} was eliminated by ${eliminatorPlayer.name}`
      : `${playerName(player)} was eliminated`,
    eliminatedBy ? { eliminatedBy } : undefined,
  );
}

/** Undoes an elimination: clears its time and eliminator, and takes the knockout back off the eliminator (money-25). */
async function restore(
  tx: Transaction,
  { tournament, registration }: LockedRegistration,
  otherChanges: RegistrationChanges,
): Promise<TournamentRegistration> {
  if (!registration.isEliminated) throw conflict("NOT_ELIMINATED", "This player has not been eliminated");
  if (registration.eliminatedBy) {
    const eliminator = await registrationsRepo.lockPlayerRegistration(tx, tournament.id, registration.eliminatedBy);
    if (eliminator) await registrationsRepo.removeKnockout(tx, eliminator.id);
  }
  const restored = await registrationsRepo.updateTournamentRegistration(tx, registration.id, {
    ...otherChanges,
    isEliminated: false,
    eliminationTime: null,
    eliminatedBy: null,
  });
  if (!restored) throw notFound("Registration not found");
  const player = await getPlayer(tx, registration.playerId);
  await logActivity(tx, restored, "player_restored", `${playerName(player)} was restored to active`);
  await restoreSeatAfterReturn(tx, tournament, registration.id);
  return restored;
}

// ---------------------------------------------------------------------------------------------------
// Writes

export interface SignUpCaller {
  /** Manages the tournament's club: may set the opening counts and payment, and any player. */
  staff: boolean;
  /** The request carries a valid sign-up token for this player (POST /api/players gave it to whoever typed their details). */
  vouched: boolean;
  /** The club that token was issued at (the player met its sign-up rules there), or null. */
  vouchedAt?: string | null;
}

/**
 * POST /api/tournaments/:id/registrations. `staff` (someone who manages the club) may also set the
 * opening counts and payment, and may register any player. Nobody is held to Max players at sign-up
 * (round 5, item 15): a sign-up beyond it joins the waiting list (`waitingListPosition`), but staff
 * registering a player as paid, or with re-buys or add-ons, accept them, which past Max players is
 * 409 TOURNAMENT_FULL. Everyone else
 * gets the defaults for every other column (SEC-06), and may sign up only a player the QR page could
 * have found for them: one known at this club, registered there or added by it (what its search returns), or one
 * whose details they typed in just now (`vouched`: the sign-up token POST /api/players returned).
 * Anyone else is answered as if the player did not exist (P2REV0-02). Sign-ups stay open while the
 * game is in progress, as they always have: `enableLateRegistration` is not enforced until the Phase 4
 * clock knows when late registration ends. A player with no home club yet gets the club of their
 * first surviving registration (usually this one; an earlier one an older build wrote, if any).
 */
export async function registerPlayer(tournamentId: string, input: StaffRegistrationInput, caller: SignUpCaller) {
  return db.transaction(async (tx) => {
    const tournament = await registrationsRepo.lockTournamentForRegistrationWrite(tx, tournamentId);
    if (!tournament) throw notFound("Tournament not found");
    assertOpen(tournament);
    if (tournament.prizePoolLocked) {
      throw conflict("PRIZE_POOL_LOCKED", "Prize pool is locked. No new registrations allowed.");
    }
    // Switched on with no price (or $0) is no high hand, as every screen shows it (P3REV3-CQ-03).
    if (input.enteringHighHands && !offersHighHand(tournament)) {
      throw badRequest("High hands entry is not available for this tournament", "HIGH_HAND_NOT_AVAILABLE");
    }
    assertTopUpsAllowed(tournament, { rebuys: 0, addons: 0 }, { rebuys: input.rebuys ?? 0, addons: input.addons ?? 0 });

    const player = await getPlayer(tx, input.playerId);
    const knownHere = async () => player !== undefined && (await isKnownAtClub(tx, player.id, tournament.clubId));
    const reachable = player !== undefined && (caller.staff || caller.vouched || (await knownHere()));
    if (!player || !reachable) throw new HttpError(404, "PLAYER_NOT_FOUND", "Player not found");
    // A player added elsewhere (or with no club) never met this club's photo rule: a returning player
    // of the club is not held to it, nor is one added on its own QR page (R5REV-SEC-01).
    if (!caller.staff && caller.vouched && caller.vouchedAt !== tournament.clubId && !player.imageUrl) {
      if ((await clubRequiresSignUpPhoto(tx, tournament.clubId)) && !(await knownHere())) throw photoRequired();
    }
    if (await registrationsRepo.lockPlayerRegistration(tx, tournament.id, player.id)) {
      throw conflict("ALREADY_REGISTERED", "Player is already registered for this tournament");
    }
    const opening = { rebuys: input.rebuys ?? 0, addons: input.addons ?? 0, paymentConfirmed: input.paymentConfirmed ?? false };
    await assertRoomToAccept(tx, tournament, {}, opening);
    const before = input.enteringHighHands ? await registrationsRepo.registrationsOf(tx, tournament.id) : undefined;

    const registration = await registrationsRepo.createTournamentRegistration(tx, {
      tournamentId: tournament.id,
      playerId: player.id,
      buyIns: input.buyIns ?? 1,
      enteringHighHands: input.enteringHighHands ?? false,
      ...opening,
    });
    if (before) {
      assertHighHandAwardsFit({ tournament, registrations: before }, { tournament, registrations: [...before, registration] });
    }
    await claimHomeClubFromFirstRegistration(tx, player.id);
    const waitingList = await currentWaitingList(tx, tournament);
    const place = waitingList.get(registration.id);
    await logActivity(
      tx,
      registration,
      "registration",
      place === undefined ? `${playerName(player)} registered for the tournament` : `${playerName(player)} registered for the tournament: #${place} on the waiting list`,
    );
    const seating = await autoSeatNewRegistration(tx, tournament, registration.id);
    const dto = caller.staff ? toManagedRegistration(registration, player, waitingList) : toPublicRegistration(registration, player, waitingList);
    return { ...dto, seating };
  });
}

type RegistrationField = Exclude<keyof UpdateRegistrationInput, "eliminatedBy" | "highHandSplitWith">;

/** What a completed or cancelled tournament still lets staff change (payments are often reconciled after the game). */
const EDITABLE_WHEN_CLOSED: ReadonlySet<RegistrationField> = new Set<RegistrationField>([
  "paymentConfirmed",
  "enteringHighHands",
  "highHandWinner",
  "highHandAmount",
]);

const STORED_DEFAULTS = {
  isEliminated: false,
  buyIns: 1,
  rebuys: 0,
  addons: 0,
  knockouts: 0,
  enteringHighHands: false,
  paymentConfirmed: false,
  highHandWinner: false,
  highHandAmount: null,
} as const satisfies Record<RegistrationField, unknown>;

/** The fields `input` would change (sent, and different from what is stored). */
function changedFields(input: UpdateRegistrationInput, current: TournamentRegistration): RegistrationField[] {
  return (Object.keys(STORED_DEFAULTS) as RegistrationField[]).filter(
    (field) => input[field] !== undefined && input[field] !== (current[field] ?? STORED_DEFAULTS[field]),
  );
}

/** What a PUT does to the high hand: the amount this registration stores, and the winner it splits with. */
interface HighHandChange {
  /** The highHandAmount to store (undefined: leave it). */
  amount: string | null | undefined;
  /** Set when this award ties with an earlier winner: that winner, what each now keeps, and the prize count before. */
  split?: { winner: TournamentRegistration; shareCents: number; keepCents: number; prizesBefore: number };
}

/**
 * Records a tie: `registration` shares the prize an earlier winner (`winnerId`) was awarded
 * (splitHighHandAward: half each, any odd cent staying with the earlier winner), and the tournament
 * gets one more high-hand prize, so the awards still add up to what was awarded before and the next
 * prize is worked out as before (TN2-04). Allowed after the game too, like every high-hand change
 * (a tie found while settling up), up to HIGH_HAND_PRIZES_MAX prizes; the caller audits it.
 */
async function splitHighHand(
  tx: Transaction,
  { tournament }: LockedRegistration,
  registrations: readonly TournamentRegistration[],
  winners: number,
  winnerId: string,
): Promise<HighHandChange> {
  const winner = registrations.find((r) => r.id === winnerId && r.highHandWinner === true);
  if (!winner) throw badRequest("A high hand can only be split with one of this tournament's high-hand winners", "INVALID_TARGET");
  if (winners + 1 > HIGH_HAND_PRIZES_MAX) {
    throw conflict("HIGH_HAND_AWARDED", `A high hand can have at most ${HIGH_HAND_PRIZES_MAX} prizes, ties included`);
  }
  const { shareCents, keepCents } = splitHighHandAward(toCents(winner.highHandAmount));
  const kept = await registrationsRepo.updateTournamentRegistration(tx, winner.id, { highHandAmount: centsToDecimalString(keepCents) });
  if (!kept) throw notFound("Registration not found");
  await setTournamentColumns(tx, tournament.id, { highHandPayouts: winners + 1 });
  return { amount: centsToDecimalString(shareCents), split: { winner: kept, shareCents, keepCents, prizesBefore: winners } };
}

/**
 * The high hand a PUT records. Awarding is worked out here, under the tournament lock, never taken
 * from the client: what is left of the high-hand pot over the winners still to come, the last taking
 * the remainder (nextHighHandAward), so the awards add up to the pot however it grew between them
 * (MONEY-36); or, with `highHandSplitWith`, half of an earlier winner's prize (a tie). Taking an award
 * back clears its amount; a winner's amount changed by hand must keep the awards within the pot, and
 * equal to it once every prize is awarded (highHandAwardsProblem, as for any change to the pot).
 */
async function highHandChange(
  tx: Transaction,
  locked: LockedRegistration,
  input: UpdateRegistrationInput,
  changed: readonly RegistrationField[],
): Promise<HighHandChange> {
  const { tournament, registration } = locked;
  const winnerChanged = changed.includes("highHandWinner");
  const awarding = winnerChanged && input.highHandWinner === true;
  if (input.highHandSplitWith !== undefined && !awarding) {
    throw badRequest("Send highHandSplitWith only when awarding a high hand to a player who has not won it (highHandWinner: true)");
  }
  if (winnerChanged && input.highHandWinner === false) return { amount: null };
  const correcting = !winnerChanged && registration.highHandWinner === true && changed.includes("highHandAmount");
  if (!awarding && !correcting) return { amount: input.highHandAmount };
  if (!tournament.enableHighHand) {
    throw badRequest("This tournament has no high hand", "HIGH_HAND_NOT_AVAILABLE");
  }

  const registrations = await registrationsRepo.registrationsOf(tx, tournament.id);
  const { highHand } = computePrizePool(tournament, registrations);
  if (awarding && input.highHandSplitWith !== undefined) {
    return splitHighHand(tx, locked, registrations, highHand.winners, input.highHandSplitWith);
  }
  const others = registrations
    .filter((r) => r.id !== registration.id && r.highHandWinner === true)
    .map((r) => toCents(r.highHandAmount));
  if (awarding) {
    const award = nextHighHandAward(highHand, others);
    if (award === null) {
      throw conflict(
        "HIGH_HAND_AWARDED",
        `Every high-hand prize has been awarded (${plural(highHand.winners, "winner")}): for a tie, split the high hand with its winner`,
      );
    }
    return { amount: centsToDecimalString(award) };
  }
  // The same rule as every change to the pot: never more than the pot, and once every prize is awarded exactly the pot.
  const problem = highHandAwardsProblem(highHand, [...others, toCents(input.highHandAmount)]);
  if (problem) throw highHandAwardsConflict(problem);
  return { amount: input.highHandAmount };
}

/**
 * `isEliminated` sent with its stored value is not a change (a client resending the row with a
 * payment fix, after the game too: P2REV4-CQ2-08). Only a request that is about the elimination alone
 * (isEliminated, perhaps with eliminatedBy) is still answered 409 ALREADY_ELIMINATED or
 * NOT_ELIMINATED, so a double-tapped Eliminate or Restore says what happened; so is a different
 * eliminator for a player already out (restore, then eliminate again, to change it).
 */
function assertEliminationIntent(input: UpdateRegistrationInput, current: TournamentRegistration, changed: readonly RegistrationField[]): void {
  if (input.isEliminated === undefined || changed.includes("isEliminated")) return;
  const aboutEliminationOnly = Object.keys(input).every((key) => key === "isEliminated" || key === "eliminatedBy");
  const newEliminator = input.isEliminated && input.eliminatedBy !== undefined && input.eliminatedBy !== current.eliminatedBy;
  if (!aboutEliminationOnly && !newEliminator) return;
  throw input.isEliminated
    ? conflict("ALREADY_ELIMINATED", "This player has already been eliminated")
    : conflict("NOT_ELIMINATED", "This player has not been eliminated");
}

/** The refusal for a change a completed or cancelled tournament no longer takes. */
function closedRefusal(tournament: Tournament): HttpError {
  const fix = tournament.status === "completed" ? ". To change the finishing order, use Correct Results" : "";
  return conflict("TOURNAMENT_CLOSED", `${closedMessage(tournament)}: only payment and high-hand details can change${fix}`);
}

/**
 * PUT /api/registrations/:id (the rules are listed on updateRegistrationSchema). One UPDATE for the
 * registration's own fields, the eliminator's knockout in the same transaction, and the activity
 * rows as today. A high-hand tie changes the tournament's number of prizes, so it is also audited.
 */
export async function updateRegistration(req: Request, registrationId: string, input: UpdateRegistrationInput) {
  return db.transaction(async (tx) => {
    const locked = await lockRegistrationById(tx, registrationId);
    const { tournament, registration: current } = locked;
    const changed = changedFields(input, current);

    if (isClosed(tournament) && changed.some((field) => !EDITABLE_WHEN_CLOSED.has(field))) throw closedRefusal(tournament);
    if (input.eliminatedBy !== undefined && input.isEliminated !== true) {
      throw badRequest("Send eliminatedBy only when eliminating a player (isEliminated: true)");
    }
    assertEliminationIntent(input, current, changed);

    const added = {
      buyIns: Math.max((input.buyIns ?? 0) - (current.buyIns ?? 0), 0),
      rebuys: Math.max((input.rebuys ?? 0) - (current.rebuys ?? 0), 0),
      addons: Math.max((input.addons ?? 0) - (current.addons ?? 0), 0),
    };
    const joinsHighHand = changed.includes("enteringHighHands") && input.enteringHighHands === true;
    if (tournament.prizePoolLocked && (added.buyIns > 0 || added.rebuys > 0 || added.addons > 0 || joinsHighHand)) {
      throw conflict("PRIZE_POOL_LOCKED", "Prize pool is locked. No rebuys, addons, or high hand entries allowed.");
    }
    const counts = { rebuys: current.rebuys ?? 0, addons: current.addons ?? 0 };
    assertTopUpsAllowed(tournament, counts, { rebuys: input.rebuys ?? counts.rebuys, addons: input.addons ?? counts.addons });
    if (joinsHighHand && !offersHighHand(tournament)) {
      throw badRequest("High hands entry is not available for this tournament", "HIGH_HAND_NOT_AVAILABLE");
    }
    // Accepting a waiting-list entry (its payment, or its first re-buy, add-on or knockout) needs room in the field; a bust checks in eliminate.
    await assertRoomToAccept(tx, tournament, current, {
      ...current,
      paymentConfirmed: input.paymentConfirmed ?? current.paymentConfirmed,
      rebuys: input.rebuys ?? current.rebuys,
      addons: input.addons ?? current.addons,
      knockouts: input.knockouts ?? current.knockouts,
    });
    // Ticking or unticking an entry moves the high-hand pot, which the awards already made must still
    // fit. So does a payment taken back (only paid entries are in the pot) while the game is open. A
    // payment taken is never refused for it (highHandLeftByPayment), nor is any payment after the game.
    const movesPot =
      changed.includes("enteringHighHands") || (changed.includes("paymentConfirmed") && input.paymentConfirmed === false && !isClosed(tournament));
    const potBefore = movesPot ? await registrationsRepo.registrationsOf(tx, tournament.id) : undefined;

    const highHand = await highHandChange(tx, locked, input, changed);
    // Absent fields stay undefined, which drizzle leaves out of the UPDATE.
    const fields: RegistrationChanges = {
      buyIns: input.buyIns,
      rebuys: input.rebuys,
      addons: input.addons,
      knockouts: input.knockouts,
      enteringHighHands: input.enteringHighHands,
      paymentConfirmed: input.paymentConfirmed,
      highHandWinner: input.highHandWinner,
      highHandAmount: highHand.amount,
    };

    let updated: TournamentRegistration;
    if (changed.includes("isEliminated")) {
      updated = input.isEliminated
        ? (await eliminate(tx, locked, input.eliminatedBy ?? null, { otherChanges: fields })).eliminated
        : await restore(tx, locked, fields);
    } else if (Object.values(fields).some((value) => value !== undefined)) {
      const row = await registrationsRepo.updateTournamentRegistration(tx, current.id, fields);
      if (!row) throw notFound("Registration not found");
      updated = row;
    } else {
      updated = current;
    }
    if (potBefore) {
      const potAfter = await registrationsRepo.registrationsOf(tx, tournament.id);
      assertHighHandAwardsFit({ tournament, registrations: potBefore }, { tournament, registrations: potAfter });
    }
    // Fewer entries, or a payment taken back, lowers the gross a manual AP total must stay within.
    const unpaid = changed.includes("paymentConfirmed") && input.paymentConfirmed === false;
    const lowered = unpaid || (["buyIns", "rebuys", "addons"] as const).some((field) => (input[field] ?? Infinity) < (current[field] ?? 0));
    if (lowered) await assertApStillWithinGross(tx, tournament, await registrationsRepo.registrationsOf(tx, tournament.id));

    const player = await getPlayer(tx, current.playerId);
    await logIncreases(tx, tournament, updated, player, added);
    if (changed.includes("highHandWinner") && input.highHandWinner === true) {
      await logHighHand(tx, updated, player, highHand);
    }
    if (highHand.split) {
      const { winner, shareCents, keepCents, prizesBefore } = highHand.split;
      await recordAudit(
        req,
        {
          action: "high_hand.split",
          targetType: "tournament",
          targetId: tournament.id,
          data: {
            registrationId: updated.id,
            splitWithRegistrationId: winner.id,
            shareCents,
            keepCents,
            highHandPayouts: { before: prizesBefore, after: prizesBefore + 1 },
          },
        },
        tx,
      );
    }
    return toManagedRegistration(updated, player, await currentWaitingList(tx, tournament));
  });
}

async function logHighHand(tx: Transaction, updated: TournamentRegistration, player: Player | undefined, change: HighHandChange) {
  if (change.split) {
    const { winner, shareCents, keepCents } = change.split;
    const other = await getPlayer(tx, winner.playerId);
    await logActivity(
      tx,
      updated,
      "high_hand",
      `${playerName(player)} won high hand, split with ${playerName(other)} (${formatMoney(shareCents)}; ${playerName(other)} keeps ${formatMoney(keepCents)})`,
      { amount: change.amount, splitWith: winner.playerId },
    );
    return;
  }
  const amount = toCents(change.amount) > 0 ? change.amount : null;
  await logActivity(
    tx,
    updated,
    "high_hand",
    `${playerName(player)} won high hand${amount ? ` (${formatMoney(toCents(amount))})` : ""}`,
    amount ? { amount } : undefined,
  );
}

/**
 * DELETE /api/registrations/:id (staff): takes a sign-up that should not be there (a mis-tap on the
 * wrong "John Smith", a fake QR sign-up) out of an open tournament. Only an entry nothing has happened
 * to yet: no elimination, re-buy, add-on, knockout, high-hand win or finishing position (409
 * REGISTRATION_IN_PLAY otherwise: restore or correct it instead). Its pending requests go with it.
 * The whole row is kept in the audit log, and the activity feed says the entry was removed. The
 * player's home club does not change.
 */
export async function removeRegistration(req: Request, registrationId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const locked = await lockRegistrationById(tx, registrationId);
    const { tournament, registration } = locked;
    if (isClosed(tournament)) throw closedRefusal(tournament);
    const before = await registrationsRepo.registrationsOf(tx, tournament.id);
    const problem = registrationRemovalProblem(registration, before);
    if (problem) {
      throw conflict(
        "REGISTRATION_IN_PLAY",
        `This entry already has ${problem} recorded, so it cannot be removed: restore or correct it instead`,
      );
    }

    await registrationsRepo.deleteTournamentRegistration(tx, registration.id);
    const after = before.filter((r) => r.id !== registration.id);
    assertHighHandAwardsFit({ tournament, registrations: before }, { tournament, registrations: after });
    await assertApStillWithinGross(tx, tournament, after);
    const requestsRemoved = await deletePendingActionsForPlayer(tx, tournament.id, registration.playerId);
    const player = await getPlayer(tx, registration.playerId);
    await logActivity(tx, registration, "registration_removed", `${playerName(player)}'s entry was removed`);
    await recordAudit(
      req,
      {
        action: "registration.remove",
        targetType: "registration",
        targetId: registration.id,
        data: { tournamentId: tournament.id, playerName: playerName(player), requestsRemoved, registration },
      },
      tx,
    );
  });
}

/** POST /api/registrations/:id/counts: atomic increments (replaces PATCH /api/registrations/:id). */
export async function adjustCounts(registrationId: string, deltas: AdjustCountsInput) {
  return db.transaction(async (tx) => {
    const locked = await lockRegistrationById(tx, registrationId);
    const updated = await applyCountChange(tx, locked, deltas);
    return toManagedRegistration(updated, await getPlayer(tx, updated.playerId));
  });
}

/**
 * What a payment just taken left of the high-hand pot that no award pays (unawardedHighHandCents): a
 * paid entry adds to the pot (round 6), and once every prize is awarded nobody is due the rest until
 * the TD adds it to a winner's prize. A payment is money the desk has taken, so it is never refused
 * for the side pot (R6REV0-MONEY-01); after the game the high hand is paid out, so nothing is left.
 */
async function highHandLeftByPayment(tx: Transaction, tournament: Tournament): Promise<Cents> {
  if (isClosed(tournament) || !offersHighHand(tournament)) return 0;
  const registrations = await registrationsRepo.registrationsOf(tx, tournament.id);
  const { highHand } = computePrizePool(tournament, registrations);
  const awarded = registrations.filter((r) => r.highHandWinner === true).map((r) => toCents(r.highHandAmount));
  return unawardedHighHandCents(highHand, awarded);
}

/**
 * PATCH /api/registrations/:id/confirm-payment: accepts the player. Idempotent: confirming a
 * confirmed payment changes nothing and logs nothing. Allowed after the game, for late
 * reconciliation. Accepting one more than Max players is 409 TOURNAMENT_FULL, for everyone (round 5,
 * item 15); a player who has already played is in the field, so their payment is always taken. Never
 * refused for the high-hand pot: what it leaves there unawarded is said (highHandLeftByPayment).
 */
export async function confirmPayment(registrationId: string) {
  return db.transaction(async (tx) => {
    const { tournament, registration } = await lockRegistrationById(tx, registrationId);
    await assertRoomToAccept(tx, tournament, registration, { ...registration, paymentConfirmed: true });
    const confirmed = await registrationsRepo.confirmPayment(tx, registration.id);
    const player = await getPlayer(tx, registration.playerId);
    if (confirmed) await logActivity(tx, confirmed, "payment_confirmed", `Payment confirmed for ${playerName(player)}`);
    // Round 5: a player waiting for their payment (or behind a full field) sits down as it is confirmed.
    const seating = confirmed && !isClosed(tournament) ? await autoSeatOnPayment(tx, tournament, registration.id) : null;
    const highHandUnawardedCents = confirmed && registration.enteringHighHands ? await highHandLeftByPayment(tx, tournament) : 0;
    // Accepted: in the field, never on the waiting list.
    return { ...toManagedRegistration(confirmed ?? registration, player, new Map()), seating, highHandUnawardedCents };
  });
}
