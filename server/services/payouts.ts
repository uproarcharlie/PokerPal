/**
 * The payout editor (round 5, item 1): PUT /api/tournaments/:id/prize-pool/payouts changes how the pool
 * is split, mid-game too, while the pool is locked as well (the published payouts change: the editor
 * says so first), until the tournament is completed or cancelled. A standard structure, or custom
 * places each set as a percentage of the pool or a fixed amount, stored in tournaments.custom_payouts by
 * shared/domain/payouts serializeCustomPayouts (the classic array whenever every place is a percentage
 * adding up to 100%, so every build since Phase 2 reads it). Every screen, the TV, the preview and
 * finalize pay it through computePrizePool. The places are paid as set: a leftover goes to the club's
 * fee (round 7, "Leftover $150 → AP") and a shortfall is added by the club. A change of the structure or
 * the places is logged to the staff's feed with the leftover or what the club adds and the reason, and
 * audited; sending what is stored writes nothing. A `prizeDifference` from a page loaded before round 7
 * is not part of the parsed input, so it changes nothing.
 */
import type { Request } from "express";
import type { AuditData } from "@shared/api/admin";
import { toPayoutPlaces, type PayoutsUpdateInput } from "@shared/api/prize-pool";
import {
  describePayoutPlaces,
  parseCustomPayouts,
  PAYOUT_STRUCTURE_LABELS,
  serializeCustomPayouts,
  type PayoutPlace,
  type PayoutStructureKey,
} from "@shared/domain/payouts";
import { differenceNote } from "@shared/domain/prize-difference";
import { computePrizePool, rakeLabel } from "@shared/domain/prize-pool";
import type { Tournament } from "@shared/schema";
import { db } from "../db";
import { notFound } from "../http/errors";
import { insertActivity } from "../repositories/activity";
import { lockTournamentForUpdate, setTournamentColumns } from "../repositories/tournaments";
import { recordAudit } from "./audit";
import { loadPrizePoolContext, moneyResponse, type MoneyResponse } from "./prize-pool";
import { assertOpen } from "./tournament-views";

interface PayoutsChange {
  payoutStructure: PayoutStructureKey;
  /** The custom places sent; null for a standard structure, which leaves the stored custom places as they are. */
  places: PayoutPlace[] | null;
  /** What custom_payouts holds after the change. */
  customPayouts: string | null;
}

/**
 * Whether the stored custom places are the ones sent: the same text, or the same places written another
 * way (a classic list saved by hand as "[50, 30, 20]" is "[50,30,20]").
 */
function samePlaces(stored: string | null, next: string | null): boolean {
  if (stored === next) return true;
  const parsed = parseCustomPayouts(stored);
  return parsed.ok && serializeCustomPayouts(parsed.places) === next;
}

/** The change `input` makes to `tournament`'s payouts, or null when it is what is stored. */
function payoutsChange(tournament: Tournament, input: PayoutsUpdateInput): PayoutsChange | null {
  // The request schema requires the places of a custom structure.
  const places = input.payoutStructure === "custom" ? toPayoutPlaces(input.places ?? []) : null;
  const customPayouts = places ? serializeCustomPayouts(places) : tournament.customPayouts;
  const stored = tournament.payoutStructure || "standard";
  const structureChanged = stored !== input.payoutStructure || (places !== null && !samePlaces(tournament.customPayouts, customPayouts));
  if (!structureChanged) return null;
  return { payoutStructure: input.payoutStructure, places, customPayouts };
}

/**
 * "Payouts changed to Custom: 1st $600, 2nd $300, 3rd $150; Leftover $150 → AP (Short field)", or
 * "Payouts changed to Top 5 (40/25/20/10/5)".
 */
function describeChange(change: PayoutsChange, note: string | null, reason: string | null): string {
  const { payoutStructure, places } = change;
  const structure = places ? `Custom: ${describePayoutPlaces(places)}` : PAYOUT_STRUCTURE_LABELS[payoutStructure];
  return `Payouts changed to ${structure}${note ? `; ${note}` : ""}${reason ? ` (${reason})` : ""}`;
}

/** PUT /api/tournaments/:id/prize-pool/payouts */
export async function changePayouts(req: Request, id: string, input: PayoutsUpdateInput): Promise<MoneyResponse> {
  return await db.transaction(async (tx) => {
    const tournament = await lockTournamentForUpdate(tx, id);
    if (!tournament) throw notFound("Tournament not found");
    assertOpen(tournament, "its payouts");
    const context = await loadPrizePoolContext(tx, tournament);
    const change = payoutsChange(tournament, input);
    if (!change) return await moneyResponse(req, context);

    const reason = input.reason ?? null;
    const updated =
      (await setTournamentColumns(tx, id, {
        payoutStructure: change.payoutStructure,
        ...(change.places ? { customPayouts: change.customPayouts } : {}),
      })) ?? tournament;
    const after = computePrizePool(updated, context.registrations);
    const { difference } = after;
    await insertActivity(tx, {
      tournamentId: id,
      eventType: "payouts_changed",
      description: describeChange(change, differenceNote(difference, rakeLabel(context.club)), reason),
      eventData: JSON.stringify({
        payoutStructure: change.payoutStructure,
        ...(change.places ? { places: change.places } : {}),
        reason,
        difference,
      }),
    });
    const audit: AuditData["tournament.payouts"] = {
      before: { payoutStructure: tournament.payoutStructure, customPayouts: tournament.customPayouts },
      after: { payoutStructure: updated.payoutStructure, customPayouts: updated.customPayouts },
      reason,
      netCents: after.net,
    };
    await recordAudit(req, { action: "tournament.payouts", targetType: "tournament", targetId: id, data: audit }, tx);
    return await moneyResponse(req, { ...context, tournament: updated });
  });
}
