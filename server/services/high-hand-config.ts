/**
 * Setting a tournament's list of high hands (round 10; round10-contracts §3.1, shared/api/high-hands
 * highHandsUpdateSchema): PUT /api/tournaments/:id/high-hands, and `highHands` on POST and PUT
 * /api/tournaments, all through applyHighHandsChange in the caller's transaction (the tournament row
 * locked FOR UPDATE first, then its registrations). The bookkeeping is shared/domain/high-hands
 * planHighHandsChange: a tournament keeps its legacy high hand until its list really changes, and then
 * takes it into the list with its entrants and awards (adoptLegacyHighHand), so no pot, award or amount
 * owed moves. Completed and cancelled tournaments refuse any change, so they stay as they were.
 */
import type { Request } from "express";
import type { AuditData } from "@shared/api/admin";
import type { HighHandInput, HighHandsUpdateInput } from "@shared/api/high-hands";
import {
  adoptLegacyHighHand,
  findHighHand,
  highHandAwardsOf,
  highHandIdsOf,
  highHandLabel,
  highHandsOf,
  highHandsPhrase,
  highHandWinsOf,
  LEGACY_HIGH_HAND_ID,
  planHighHandsChange,
  potsAwardsProblem,
  repricedHighHands,
  tournamentHighHandSummary,
  type HighHandRepricing,
  type HighHandSettings,
} from "@shared/domain/high-hands";
import { formatMoney, toBasisPoints, toCents } from "@shared/domain/money";
import { computePrizePool, rakeLabel } from "@shared/domain/prize-pool";
import { fieldEntries } from "@shared/domain/waiting-list";
import type { Tournament } from "@shared/schema";
import { db, type Transaction } from "../db";
import { badRequest, conflict, notFound } from "../http/errors";
import { insertActivity } from "../repositories/activity";
import { getClub } from "../repositories/clubs";
import * as highHandsRepo from "../repositories/high-hands";
import { setTournamentColumns, lockTournamentForUpdate } from "../repositories/tournaments";
import { recordAudit } from "./audit";
import { activeHighHands, loadHighHandStore, loadMoneyState, registrationsWithHighHands, withHighHands, writeEntrySummary, type MoneyState } from "./high-hands";
import { loadPrizePoolContext, moneyResponse, type MoneyResponse } from "./prize-pool";
import { closedMessage, entriesRepricedConflict, highHandAwardsConflict, isClosed } from "./tournament-views";

export interface HighHandsChange {
  /** The list as staff set it, in order. */
  highHands: readonly HighHandInput[];
  reason: string | null;
}

export interface HighHandsChangeResult {
  /** The tournament row as the change left it. */
  tournament: Tournament;
  /** Each high hand whose fee changes while entries are recorded in it: for the caller to confirm last (ENTRIES_REPRICED). */
  repricings: HighHandRepricing[];
}

const who = (count: number) => (count === 1 ? "1 player has" : `${count} players have`);

/** "First half $5 (AP 10%)", "Second half $5 (no AP)". */
function describeHighHand(highHand: HighHandSettings, label: string): string {
  const fee = formatMoney(toCents(highHand.entryFee));
  const ap =
    highHand.rakeType === "percentage"
      ? `${label} ${toBasisPoints(highHand.rakeAmount) / 100}%`
      : highHand.rakeType === "fixed"
        ? `${label} ${formatMoney(toCents(highHand.rakeAmount))}`
        : `no ${label}`;
  const winners = highHand.winners && highHand.winners > 1 ? `, ${highHand.winners} winners` : "";
  return `${highHand.name} ${fee} (${ap}${winners})`;
}

/** One high hand as the audit row keeps it. */
const audited = (highHand: HighHandSettings, index: number): AuditData["tournament.high_hands"]["after"][number] => ({
  id: highHand.id,
  name: highHand.name,
  position: highHand.position ?? index + 1,
  entryFee: String(highHand.entryFee ?? "0.00"),
  rakeType: highHand.rakeType ?? "none",
  rakeAmount: String(highHand.rakeAmount ?? "0.00"),
  winners: highHand.winners ?? 1,
  note: highHand.note ?? null,
});

const potNets = (state: MoneyState) =>
  computePrizePool(state.tournament, state.registrations).highHands.map(({ highHandId, net }) => ({ highHandId, netCents: net }));

/**
 * The registrations in a high hand, paid or not, the waiting list included, and any that won a prize
 * in it (an award the legacy high hand made to an entry that was not in it): taking it off the list
 * would leave their money or their prize nowhere.
 */
function entrantsOf(state: MoneyState, highHandId: string): number {
  return state.registrations.filter(
    (registration) =>
      highHandIdsOf(state.tournament, registration).includes(highHandId) ||
      highHandWinsOf(state.tournament, registration).some((win) => win.highHandId === highHandId),
  ).length;
}

/**
 * Sets the tournament's high hands to `change.highHands`, in the caller's transaction, `current`
 * locked FOR UPDATE (the rules are on shared/api/high-hands highHandsUpdateSchema). Nothing is written
 * or logged when nothing changes. The re-pricing it would make is returned for the caller to confirm,
 * once every other refusal has passed (PUT /api/tournaments asks it with its own prices in one 409).
 */
export async function applyHighHandsChange(tx: Transaction, req: Request, current: Tournament, change: HighHandsChange): Promise<HighHandsChangeResult> {
  const before = await loadMoneyState(tx, current, { lock: true });
  const plan = planHighHandsChange(before.tournament, change.highHands);
  if (plan.kind === "unchanged") return { tournament: current, repricings: [] };
  if (isClosed(current)) throw conflict("TOURNAMENT_CLOSED", closedMessage(current, "its high hands"));
  if (plan.kind === "unknown") {
    throw badRequest("That high hand is not one of this tournament's: reload the page", "HIGH_HAND_NOT_AVAILABLE", { highHandId: plan.id });
  }
  const label = rakeLabel(await getClub(tx, current.clubId));

  if (plan.kind === "legacy_off") {
    const entrants = entrantsOf(before, LEGACY_HIGH_HAND_ID);
    if (entrants > 0) {
      throw conflict("HIGH_HAND_ENTRIES", `${who(entrants)} entered the high hand: take them out of it before turning it off`, {
        highHandId: LEGACY_HIGH_HAND_ID,
        entrants,
      });
    }
    const updated = (await setTournamentColumns(tx, current.id, { enableHighHand: false })) ?? current;
    await record(tx, req, { before, after: { ...before, tournament: withHighHands(updated, { rows: [] }) }, label, change, removed: [LEGACY_HIGH_HAND_ID] });
    return { tournament: updated, repricings: [] };
  }

  // Taking a high hand off the list while anyone is in it would leave their fee collected for nothing.
  const removed = [...plan.remove, ...(plan.removesLegacy ? [LEGACY_HIGH_HAND_ID] : [])];
  for (const highHandId of removed) {
    const entrants = entrantsOf(before, highHandId);
    if (entrants === 0) continue;
    const name = findHighHand(before.tournament, highHandId)?.name ?? "high hand";
    throw conflict("HIGH_HAND_ENTRIES", `${who(entrants)} entered the ${highHandLabel(name)}: take them out of it before removing it`, {
      highHandId,
      entrants,
    });
  }

  const adopted = plan.create.some((item) => item.adoptsLegacy) ? adoptLegacyHighHand(before.tournament, before.registrations) : null;
  // A new high hand can take in the legacy one's players only as the legacy one is taken into the list.
  if (!adopted && change.highHands.some((highHand) => highHand.legacyEntrants === true)) {
    throw badRequest("The high hands have changed since this page was loaded, so no players can be carried over: reload the page", "HIGH_HAND_NOT_AVAILABLE", {
      highHandId: LEGACY_HIGH_HAND_ID,
    });
  }
  // The row the legacy high hand becomes (the same pot under a new id), and the new ones its players are entered in too.
  let adoptedId: string | null = null;
  const alsoIn: string[] = [];
  for (const { adoptsLegacy, takesLegacyEntrants, ...settings } of plan.create) {
    const row = await highHandsRepo.insertHighHand(tx, { tournamentId: current.id, ...settings });
    if (!adopted || (!adoptsLegacy && !takesLegacyEntrants)) continue;
    await highHandsRepo.insertEntrants(tx, current.id, adopted.entrantIds.map((registrationId) => ({ registrationId, highHandId: row.id })));
    if (!adoptsLegacy) {
      alsoIn.push(row.id);
      continue;
    }
    adoptedId = row.id;
    for (const award of adopted.awards) {
      await highHandsRepo.insertAward(tx, { tournamentId: current.id, highHandId: row.id, ...award, splitWithRegistrationId: null, awardedBy: null });
    }
  }
  for (const { id, ...settings } of plan.update) await highHandsRepo.updateHighHand(tx, current.id, id, settings);
  for (const id of plan.remove) await highHandsRepo.updateHighHand(tx, current.id, id, { removedAt: new Date() });

  const store = await loadHighHandStore(tx, current.id);
  const updated = (await setTournamentColumns(tx, current.id, tournamentHighHandSummary(activeHighHands(store.rows) ?? []))) ?? current;
  const after: MoneyState = { tournament: withHighHands(updated, store), registrations: registrationsWithHighHands(store, before.registrations), store };
  // The legacy columns of the entries taken into the list stay their summary (they already say the same, but for a prize stored as no amount).
  if (adopted) {
    for (const registration of after.registrations) await writeEntrySummary(tx, registration, registration.highHandIds, registration.highHandWins);
  }

  // Every pot's awards must still fit it: a new fee, AP or number of prizes. The legacy pot taken into
  // the list is compared with itself under its new id, so, as the legacy rule, it is checked only when
  // its money or prizes change (money paid in after its last award never stops a second high hand).
  const potsBefore = computePrizePool(before.tournament, before.registrations).highHands.map((pot) =>
    adoptedId !== null && pot.highHandId === LEGACY_HIGH_HAND_ID ? { ...pot, highHandId: adoptedId } : pot,
  );
  const problem = potsAwardsProblem(
    potsBefore,
    computePrizePool(after.tournament, after.registrations).highHands,
    highHandAwardsOf(after.tournament, after.registrations),
  );
  if (problem) throw highHandAwardsConflict(problem);

  const adoption = adopted ? { entrants: adopted.entrantIds.length, awards: adopted.awards.length, ...(alsoIn.length > 0 ? { alsoIn } : {}) } : undefined;
  await record(tx, req, { before, after, label, change, removed, adopted: adoption });
  // Every entry in the field, paid or not, at a high hand whose fee changes (the waiting list is asked again when it gets in).
  return { tournament: updated, repricings: repricedHighHands(before.tournament, change.highHands, fieldEntries(before.registrations, current.maxPlayers)) };
}

/** The staff-only feed line ("High hands: First half $5 (AP 10%), Second half $5 (no AP)") and the audit row. */
async function record(
  tx: Transaction,
  req: Request,
  {
    before,
    after,
    label,
    change,
    removed,
    adopted,
  }: { before: MoneyState; after: MoneyState; label: string; change: HighHandsChange; removed: string[]; adopted?: AuditData["tournament.high_hands"]["adoptedLegacy"] },
): Promise<void> {
  const list = highHandsOf(after.tournament);
  const description = `High hands: ${list.length > 0 ? list.map((highHand) => describeHighHand(highHand, label)).join(", ") : "none"}`;
  await insertActivity(tx, {
    tournamentId: after.tournament.id,
    eventType: "high_hands_changed",
    description: change.reason ? `${description} - ${change.reason}` : description,
    eventData: JSON.stringify({ highHandIds: list.map((highHand) => highHand.id), reason: change.reason }),
  });
  const listedBefore = before.tournament.highHands;
  const { enableHighHand, highHandAmount, highHandRakeType, highHandRakeAmount, highHandPayouts } = before.tournament;
  const data: AuditData["tournament.high_hands"] = {
    before: listedBefore === null ? null : highHandsOf(before.tournament).map(audited),
    after: list.map(audited),
    ...(listedBefore === null ? { legacy: { enableHighHand, highHandAmount, highHandRakeType, highHandRakeAmount, highHandPayouts } } : {}),
    ...(adopted ? { adoptedLegacy: adopted } : {}),
    removed,
    reason: change.reason,
    potsBefore: potNets(before),
    potsAfter: potNets(after),
  };
  await recordAudit(req, { action: "tournament.high_hands", targetType: "tournament", targetId: after.tournament.id, data }, tx);
}

/**
 * "3 First half high-hand entries from $5 to $6"; for the legacy high hand taken into a list, which of
 * its high hands those entries will then be in, and which not (R10REV1-MONEY-02).
 */
export function describeHighHandRepricing(change: HighHandRepricing): string {
  const sentence = `${change.count} ${highHandLabel(change.name)} ${change.count === 1 ? "entry" : "entries"} from ${formatMoney(change.fromCents)} to ${formatMoney(change.toCents)}`;
  if (!change.nowIn || change.nowIn.length === 0) return sentence;
  const notIn = change.notIn && change.notIn.length > 0 ? ` only, not ${highHandsPhrase(change.notIn)}` : "";
  return `${sentence} (those players will be in ${highHandsPhrase(change.nowIn)}${notIn})`;
}

/** PUT /api/tournaments/:id/high-hands (the club's staff): answers the tournament and its prize pool, as the AP endpoints do. */
export async function updateHighHands(req: Request, id: string, input: HighHandsUpdateInput): Promise<MoneyResponse> {
  return await db.transaction(async (tx) => {
    const current = await lockTournamentForUpdate(tx, id);
    if (!current) throw notFound("Tournament not found");
    const { tournament, repricings } = await applyHighHandsChange(tx, req, current, { highHands: input.highHands, reason: input.reason ?? null });
    if (repricings.length > 0 && !input.repriceEntries) throw entriesRepricedConflict(repricings.map(describeHighHandRepricing), repricings);
    return moneyResponse(req, await loadPrizePoolContext(tx, tournament));
  });
}
