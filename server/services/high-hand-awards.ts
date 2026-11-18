/**
 * Awarding a tournament's high hands one pot at a time (round 10; round10-contracts §3.1): POST, PATCH
 * and DELETE /api/tournaments/:id/high-hands/:highHandId/awards[/:registrationId], the club's staff's.
 * Each runs in one transaction under the tournament's lock, then the registration's (as every
 * registration write), and works the prize out on the server with shared/domain/high-hands: the next
 * award is what is left of that pot over the winners still to come (nextHighHandAward), a tie splits
 * an earlier winner's prize (splitHighHandAward), and a corrected prize keeps the pot's awards fitting
 * it (highHandAwardsProblem). Allowed after the game, as high hands always were (they are settled at
 * the end of the night). The legacy high hand ("legacy") is awarded exactly as PUT /api/registrations/:id
 * awards it (highHandWinner, highHandAmount, highHandSplitWith: the same rules, activity and audit); its
 * prize corrected or taken back here is also logged and audited as a listed one's (R10REV1-AUDIT-03).
 */
import type { Request } from "express";
import type { HighHandAwardCorrectionInput, HighHandAwardInput, HighHandAwardsDto } from "@shared/api/high-hands";
import {
  findHighHand,
  HIGH_HAND_PRIZES_MAX,
  highHandAwardsOf,
  highHandAwardsProblem,
  highHandIdsOf,
  highHandLabel,
  highHandStandings,
  highHandWinsOf,
  LEGACY_HIGH_HAND_ID,
  listsHighHands,
  nextHighHandAward,
  splitHighHandAward,
  type HighHandAward,
  type HighHandSettings,
} from "@shared/domain/high-hands";
import { formatMoney, toCents, type Cents } from "@shared/domain/money";
import { computePrizePool } from "@shared/domain/prize-pool";
import { waitingListPositions } from "@shared/domain/waiting-list";
import type { Tournament, TournamentRegistration } from "@shared/schema";
import { db, type Transaction } from "../db";
import { actingUserId } from "../http/authz";
import { badRequest, conflict, notFound } from "../http/errors";
import { insertActivity } from "../repositories/activity";
import * as highHandsRepo from "../repositories/high-hands";
import { getPlayer, playerNames } from "../repositories/players";
import { getTournamentRegistration, lockRegistration, lockTournamentForRegistrationWrite } from "../repositories/registrations";
import { getTournament } from "../repositories/tournaments";
import { recordAudit } from "./audit";
import {
  loadHighHandStore,
  loadMoneyState,
  withEntryHighHands,
  withHighHands,
  writeEntrySummary,
  type HighHandStore,
  type MoneyState,
  type TournamentWithHighHands,
} from "./high-hands";
import { applyRegistrationUpdate, toManagedRegistration, type LockedRegistration } from "./registrations";
import { highHandAwardsConflict } from "./tournament-views";

interface AwardRequest {
  tournamentId: string;
  highHandId: string;
  registrationId: string;
}

/** What an award request acts on, locked: the tournament, the registration (when it is the tournament's) and the high hand it names. */
interface AwardTarget {
  locked: LockedRegistration | null;
  tournament: TournamentWithHighHands;
  store: HighHandStore;
  highHand: HighHandSettings;
}

/**
 * Locks the tournament, then the registration when it is one of the tournament's (null otherwise),
 * and finds the high hand: 404 for an unknown tournament or a high hand it does not run (taken off the
 * list, or "legacy" once it lists them).
 */
async function lockTarget(tx: Transaction, { tournamentId, highHandId, registrationId }: AwardRequest): Promise<AwardTarget> {
  const row = await lockTournamentForRegistrationWrite(tx, tournamentId);
  if (!row) throw notFound("Tournament not found");
  const store = await loadHighHandStore(tx, row.id);
  const tournament = withHighHands(row, store);
  const highHand = findHighHand(tournament, highHandId);
  if (!highHand) throw notFound("That high hand is not one of this tournament's");
  const found = await getTournamentRegistration(tx, registrationId);
  const registration = found?.tournamentId === row.id ? await lockRegistration(tx, registrationId) : undefined;
  return { locked: registration ? { tournament: row, registration } : null, tournament, store, highHand };
}

const playerNameOf = async (tx: Transaction, registration: Pick<TournamentRegistration, "playerId">) =>
  (await getPlayer(tx, registration.playerId))?.name || "Unknown player";

/** The pot of `highHandId` and its awards as they stand in `state`, each award with its player named. */
async function awardsDto(tx: Transaction, state: MoneyState, highHandId: string): Promise<HighHandAwardsDto> {
  const pot = computePrizePool(state.tournament, state.registrations).highHands.find((candidate) => candidate.highHandId === highHandId);
  if (!pot) throw notFound("That high hand is not one of this tournament's");
  const [standing] = highHandStandings([pot], highHandAwardsOf(state.tournament, state.registrations));
  const playerOf = new Map(state.registrations.map((registration) => [registration.id, registration.playerId]));
  const names = await playerNames(tx, Array.from(playerOf.values()));
  return {
    highHandId,
    pot,
    awards: standing.awards.map((award) => ({ ...award, playerName: names.get(playerOf.get(award.registrationId) ?? "") ?? "Unknown player" })),
    nextAwardCents: standing.nextAwardCents,
    unawardedCents: standing.unawardedCents,
  };
}

/** The answer to an award or correction: the high hand's pot and awards after it, the award, the tie's other award, and the winner's registration. */
async function resultDto(tx: Transaction, tournamentId: string, highHandId: string, registrationId: string, splitWith: string | null) {
  const row = await getTournament(tx, tournamentId);
  if (!row) throw notFound("Tournament not found");
  const state = await loadMoneyState(tx, row);
  const awards = await awardsDto(tx, state, highHandId);
  const award = awards.awards.find((candidate) => candidate.registrationId === registrationId);
  const registration = state.registrations.find((candidate) => candidate.id === registrationId);
  if (!award || !registration) throw notFound("Registration not found");
  const waitingList = waitingListPositions(state.registrations, row.maxPlayers);
  return {
    ...awards,
    award,
    splitFrom: splitWith ? (awards.awards.find((candidate) => candidate.registrationId === splitWith) ?? null) : null,
    registration: toManagedRegistration(registration, await getPlayer(tx, registration.playerId), waitingList),
  };
}

/** The tournament's money as a write left it (a tie adds a prize to the high hand, or, for the legacy one, to the tournament). */
async function stateAfter(tx: Transaction, tournament: Tournament): Promise<MoneyState> {
  return loadMoneyState(tx, (await getTournament(tx, tournament.id)) ?? tournament);
}

/** The legacy columns of the registrations an award changed, written as the summary of their high hands. */
async function writeSummaries(tx: Transaction, tournament: Tournament, registrationIds: readonly string[]): Promise<void> {
  const state = await loadMoneyState(tx, tournament);
  for (const registration of state.registrations.filter((candidate) => registrationIds.includes(candidate.id))) {
    await writeEntrySummary(tx, registration, registration.highHandIds, registration.highHandWins);
  }
}

/** One prize awarded (a listed high hand's), corrected or taken back: the feed's `high_hand` line (public: what players win is) and the audit row. */
async function recordAward(
  tx: Transaction,
  req: Request,
  {
    state,
    highHand,
    registration,
    description,
    change,
    amountCents,
    splitWith,
    reason,
  }: {
    state: MoneyState;
    highHand: HighHandSettings;
    registration: TournamentRegistration;
    description: string;
    change: "awarded" | "corrected" | "taken_back";
    amountCents: { before: Cents | null; after: Cents | null };
    splitWith?: TournamentRegistration;
    reason: string | null;
  },
): Promise<void> {
  await insertActivity(tx, {
    tournamentId: registration.tournamentId,
    playerId: registration.playerId,
    eventType: "high_hand",
    description,
    eventData: JSON.stringify({
      highHandId: highHand.id,
      highHandName: highHand.name,
      amountCents: amountCents.after ?? amountCents.before,
      ...(splitWith ? { splitWith: splitWith.playerId } : {}),
      ...(change === "awarded" ? {} : { change }),
    }),
  });
  const pot = computePrizePool(state.tournament, state.registrations).highHands.find((candidate) => candidate.highHandId === highHand.id);
  await recordAudit(
    req,
    {
      action: "high_hand.award",
      targetType: "tournament",
      targetId: registration.tournamentId,
      data: {
        highHandId: highHand.id,
        highHandName: highHand.name,
        registrationId: registration.id,
        playerName: await playerNameOf(tx, registration),
        change,
        amountCents,
        splitWithRegistrationId: splitWith?.id ?? null,
        reason,
        potNetCents: pot?.net ?? 0,
      },
    },
    tx,
  );
}

/** The tournament's money as it stands before a change, and the high hand's awards so far. */
async function stateOf(tx: Transaction, target: AwardTarget): Promise<{ state: MoneyState; awards: HighHandAward[] }> {
  const state = await loadMoneyState(tx, target.tournament);
  return { state, awards: highHandAwardsOf(state.tournament, state.registrations).filter((award) => award.highHandId === target.highHand.id) };
}

/** POST …/high-hands/:highHandId/awards (the rules are on shared/api/high-hands highHandAwardSchema). */
export async function awardHighHand(req: Request, tournamentId: string, highHandId: string, input: HighHandAwardInput) {
  return await db.transaction(async (tx) => {
    const target = await lockTarget(tx, { tournamentId, highHandId, registrationId: input.registrationId });
    if (!target.locked) throw badRequest("That entry is not in this tournament", "INVALID_TARGET");
    const { tournament, highHand } = target;
    const entry = withEntryHighHands(target.store, target.locked.registration);
    const label = highHandLabel(highHand.name);
    if (!highHandIdsOf(tournament, entry).includes(highHand.id)) {
      throw badRequest(`${await playerNameOf(tx, entry)} is not in the ${label}`, "HIGH_HAND_NOT_ENTERED", { highHandId, registrationId: entry.id });
    }
    if (highHandWinsOf(tournament, entry).some((win) => win.highHandId === highHand.id)) {
      throw conflict("HIGH_HAND_ALREADY_WON", `${await playerNameOf(tx, entry)} has already won the ${label}: for a tie, award it to the other player, split with them`);
    }

    if (!listsHighHands(tournament)) {
      await applyRegistrationUpdate(tx, req, target.locked, { highHandWinner: true, ...(input.splitWith ? { highHandSplitWith: input.splitWith } : {}) });
      return await resultDto(tx, tournament.id, highHand.id, entry.id, input.splitWith ?? null);
    }

    const { state, awards } = await stateOf(tx, target);
    const pot = computePrizePool(state.tournament, state.registrations).highHands.find((candidate) => candidate.highHandId === highHand.id);
    if (!pot) throw notFound("That high hand is not one of this tournament's");
    const name = await playerNameOf(tx, entry);
    let amountCents: Cents;
    let split: { winner: TournamentRegistration; shareCents: Cents; keepCents: Cents } | undefined;
    if (input.splitWith === undefined) {
      const next = nextHighHandAward(pot, awards.map((award) => award.amountCents));
      if (next === null) {
        const winners = `${pot.winners} ${pot.winners === 1 ? "winner" : "winners"}`;
        throw conflict("HIGH_HAND_AWARDED", `Every ${label} prize has been awarded (${winners}): for a tie, split it with its winner`);
      }
      amountCents = next;
    } else {
      const theirs = awards.find((award) => award.registrationId === input.splitWith);
      const winner = theirs && state.registrations.find((registration) => registration.id === theirs.registrationId);
      if (!theirs || !winner) throw badRequest(`The ${label} can only be split with one of its winners`, "INVALID_TARGET");
      if (pot.winners + 1 > HIGH_HAND_PRIZES_MAX) {
        throw conflict("HIGH_HAND_AWARDED", `A high hand can have at most ${HIGH_HAND_PRIZES_MAX} prizes, ties included`);
      }
      const { shareCents, keepCents } = splitHighHandAward(theirs.amountCents);
      await highHandsRepo.setAwardAmount(tx, highHand.id, winner.id, keepCents);
      await highHandsRepo.updateHighHand(tx, tournament.id, highHand.id, { winners: pot.winners + 1 });
      await recordAudit(
        req,
        {
          action: "high_hand.split",
          targetType: "tournament",
          targetId: tournament.id,
          data: {
            registrationId: entry.id,
            splitWithRegistrationId: winner.id,
            shareCents,
            keepCents,
            highHandPayouts: { before: pot.winners, after: pot.winners + 1 },
            highHandId: highHand.id,
          },
        },
        tx,
      );
      amountCents = shareCents;
      split = { winner, shareCents, keepCents };
    }
    await highHandsRepo.insertAward(tx, {
      tournamentId: tournament.id,
      highHandId: highHand.id,
      registrationId: entry.id,
      amountCents,
      splitWithRegistrationId: split?.winner.id ?? null,
      awardedBy: actingUserId(req),
    });
    await writeSummaries(tx, tournament, [entry.id, ...(split ? [split.winner.id] : [])]);
    let description = `${name} won the ${label}${amountCents > 0 ? ` (${formatMoney(amountCents)})` : ""}`;
    if (split) {
      const other = await playerNameOf(tx, split.winner);
      description = `${name} won the ${label}, split with ${other} (${formatMoney(split.shareCents)}; ${other} keeps ${formatMoney(split.keepCents)})`;
    }
    await recordAward(tx, req, {
      state: await stateAfter(tx, tournament),
      highHand,
      registration: entry,
      description,
      change: "awarded",
      amountCents: { before: null, after: amountCents },
      splitWith: split?.winner,
      reason: null,
    });
    return await resultDto(tx, tournament.id, highHand.id, entry.id, split?.winner.id ?? null);
  });
}

/** The registration's award of the high hand, locked: 404 when it has not won it (or is not the tournament's). */
async function lockWinner(tx: Transaction, request: AwardRequest) {
  const target = await lockTarget(tx, request);
  const { state, awards } = await stateOf(tx, target);
  const award = target.locked ? awards.find((candidate) => candidate.registrationId === request.registrationId) : undefined;
  if (!target.locked || !award) throw notFound(`That entry has not won the ${highHandLabel(target.highHand.name)}`);
  return { ...target, locked: target.locked, state, awards, award };
}

/** How a correction or take-back names the high hand: "First half high hand", and the legacy one "high hand", as its feed lines always have. */
const awardLabel = (highHand: HighHandSettings) => (highHand.id === LEGACY_HIGH_HAND_ID ? "high hand" : highHandLabel(highHand.name));

/**
 * PATCH …/high-hands/:highHandId/awards/:registrationId (the rules are on shared/api/high-hands
 * highHandAwardCorrectionSchema). The legacy high hand's prize is corrected by the PUT's rules; either
 * way a changed prize is in the feed and the audit log (R10REV1-AUDIT-03).
 */
export async function correctHighHandAward(req: Request, request: AwardRequest, input: HighHandAwardCorrectionInput) {
  return await db.transaction(async (tx) => {
    const { tournament, highHand, locked, state, awards, award } = await lockWinner(tx, request);
    const amountCents = toCents(input.amount);
    if (amountCents !== award.amountCents) {
      if (!listsHighHands(tournament)) {
        await applyRegistrationUpdate(tx, req, locked, { highHandAmount: input.amount });
      } else {
        const pot = computePrizePool(state.tournament, state.registrations).highHands.find((candidate) => candidate.highHandId === highHand.id);
        const others = awards.filter((other) => other !== award).map((other) => other.amountCents);
        const problem = pot ? highHandAwardsProblem(pot, [...others, amountCents]) : null;
        if (problem) throw highHandAwardsConflict({ ...problem, highHandId: highHand.id, name: highHand.name });
        await highHandsRepo.setAwardAmount(tx, highHand.id, award.registrationId, amountCents);
        await writeSummaries(tx, tournament, [award.registrationId]);
      }
      const reason = input.reason ?? null;
      const description = `${await playerNameOf(tx, locked.registration)}'s ${awardLabel(highHand)} prize is now ${formatMoney(amountCents)}`;
      await recordAward(tx, req, {
        state: await stateAfter(tx, tournament),
        highHand,
        registration: locked.registration,
        description: reason ? `${description} - ${reason}` : description,
        change: "corrected",
        amountCents: { before: award.amountCents, after: amountCents },
        reason,
      });
    }
    return await resultDto(tx, tournament.id, highHand.id, award.registrationId, null);
  });
}

/**
 * DELETE …/high-hands/:highHandId/awards/:registrationId: the award taken back (a mistake); a tie's
 * other winner keeps theirs. The legacy high hand's is taken back by the PUT's rules; either way the
 * feed says so and the audit log keeps what it was (R10REV1-AUDIT-03).
 */
export async function takeBackHighHandAward(req: Request, request: AwardRequest): Promise<HighHandAwardsDto> {
  return await db.transaction(async (tx) => {
    const { tournament, highHand, locked, award } = await lockWinner(tx, request);
    if (!listsHighHands(tournament)) {
      await applyRegistrationUpdate(tx, req, locked, { highHandWinner: false });
    } else {
      await highHandsRepo.deleteAward(tx, highHand.id, award.registrationId);
      await writeSummaries(tx, tournament, [award.registrationId]);
    }
    await recordAward(tx, req, {
      state: await stateAfter(tx, tournament),
      highHand,
      registration: locked.registration,
      description: `${await playerNameOf(tx, locked.registration)}'s ${awardLabel(highHand)} win was taken back`,
      change: "taken_back",
      amountCents: { before: award.amountCents, after: null },
      reason: null,
    });
    return await awardsDto(tx, await stateAfter(tx, tournament), highHand.id);
  });
}
