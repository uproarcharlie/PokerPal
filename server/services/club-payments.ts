/**
 * Payments by bank transfer (round 8): the club's bank details (Club settings → Payments), which only
 * its owner, its managers and admins read or change, with who changed them last, and the payment
 * instructions a sign-up's answer carries for a tournament that shows them (tournaments.show_bank_transfer),
 * the details only with a buy-in to transfer. Nothing else sends the details: no public read, club
 * page or TV screen (shared/api/public BANK_DETAIL_KEYS).
 */
import type { Request } from "express";
import {
  BANK_DETAILS_CHANGES_SHOWN,
  BANK_DETAILS_FIELDS,
  type BankDetails,
  type BankDetailsChangeDto,
  type ClubPaymentsDto,
  type UpdateClubPaymentsInput,
} from "@shared/api/clubs";
import { paymentParticulars, paymentReference, type SignUpPaymentDto } from "@shared/api/registrations";
import { toCents } from "@shared/domain/money";
import { offersHighHand } from "@shared/domain/player-actions";
import { amountDueCents } from "@shared/domain/prize-pool";
import type { Club, Player, Tournament, TournamentRegistration } from "@shared/schema";
import { db, type Executor } from "../db";
import { badRequest, notFound } from "../http/errors";
import { auditTrailOf, type AuditTrailEntry } from "../repositories/audit-log";
import * as clubsRepo from "../repositories/clubs";
import { recordAudit } from "./audit";

/** The zone a club's days are told in when it has no valid one of its own. */
const DEFAULT_TIME_ZONE = "Pacific/Auckland";

/**
 * The club's bank details: its account's name and number, both set (a row written by hand with only
 * one of them has none), and the bank and note when it has them.
 */
export function bankDetailsOf(club: Pick<Club, "bankAccountName" | "bankAccountNumber" | "bankName" | "bankInstructions">): BankDetails | null {
  const accountName = club.bankAccountName?.trim();
  const accountNumber = club.bankAccountNumber?.trim();
  if (!accountName || !accountNumber) return null;
  return { accountName, accountNumber, bankName: club.bankName?.trim() || null, instructions: club.bankInstructions?.trim() || null };
}

/** A `club.bank_details` audit row's details before or after the change (recordAudit writes BankDetails or null). */
function auditedDetails(data: AuditTrailEntry["data"], side: "before" | "after"): Partial<BankDetails> | null {
  const details = data?.[side];
  return details !== null && typeof details === "object" ? (details as Partial<BankDetails>) : null;
}

function toChange(entry: AuditTrailEntry): BankDetailsChangeDto {
  const before = auditedDetails(entry.data, "before");
  const after = auditedDetails(entry.data, "after");
  return {
    at: entry.createdAt.toISOString(),
    by: entry.actorName,
    change: before === null ? "added" : after === null ? "removed" : "changed",
    fields: BANK_DETAILS_FIELDS.filter((field) => (before?.[field] ?? null) !== (after?.[field] ?? null)),
  };
}

/** The club's bank details, and who last changed them and when (R8REV0-PRIV-03: any of its staff may). */
async function paymentsOf(ex: Executor, club: Club): Promise<ClubPaymentsDto> {
  const trail = await auditTrailOf(ex, "club.bank_details", { type: "club", id: club.id }, BANK_DETAILS_CHANGES_SHOWN);
  return { clubId: club.id, bankDetails: bankDetailsOf(club), changes: trail.map(toChange) };
}

/** GET /api/clubs/:id/payments (the club's staff). */
export async function getClubPayments(clubId: string): Promise<ClubPaymentsDto> {
  const club = await clubsRepo.getClub(db, clubId);
  if (!club) throw notFound("Club not found");
  return paymentsOf(db, club);
}

const sameDetails = (a: BankDetails | null, b: BankDetails | null) =>
  a === null || b === null
    ? a === b
    : a.accountName === b.accountName && a.accountNumber === b.accountNumber && a.bankName === b.bankName && a.instructions === b.instructions;

/**
 * PUT /api/clubs/:id/payments (the club's staff): the bank details replaced whole, or removed (null).
 * A change is recorded in the audit log, before and after, in the same transaction: a new account
 * number redirects every transfer that follows, so who changed it, and when, is kept, and shown to
 * the club's staff with the details.
 */
export async function updateClubPayments(req: Request, clubId: string, input: UpdateClubPaymentsInput): Promise<ClubPaymentsDto> {
  const details = input.bankDetails;
  return db.transaction(async (tx) => {
    const current = await clubsRepo.lockClub(tx, clubId);
    if (!current) throw notFound("Club not found");
    const updated = await clubsRepo.updateClub(tx, clubId, {
      bankAccountName: details?.accountName ?? null,
      bankAccountNumber: details?.accountNumber ?? null,
      bankName: details?.bankName ?? null,
      bankInstructions: details?.instructions ?? null,
    });
    const before = bankDetailsOf(current);
    const after = updated ? bankDetailsOf(updated) : null;
    if (!sameDetails(before, after)) {
      await recordAudit(req, { action: "club.bank_details", targetType: "club", targetId: clubId, data: { before, after } }, tx);
    }
    if (!updated) throw notFound("Club not found");
    return paymentsOf(tx, updated);
  });
}

/**
 * 400 VALIDATION on showBankTransfer when a tournament of the club would start showing bank details
 * after sign-up while the club has none to show.
 */
export async function assertCanShowBankTransfer(ex: Executor, clubId: string): Promise<void> {
  const club = await clubsRepo.getClub(ex, clubId);
  if (club && bankDetailsOf(club)) return;
  const message = "Add the club's bank details (Club settings, Payments) before showing them after sign-up";
  throw badRequest(message, "VALIDATION", [{ code: "custom", path: ["showBankTransfer"], message }]);
}

/** The club's own time zone when it is one Intl knows, else New Zealand's. */
function clubTimeZone(club: Pick<Club, "timezone">): string {
  const zone = club.timezone?.trim();
  if (!zone) return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-NZ", { timeZone: zone });
    return zone;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

export interface SignUpForPayment {
  tournament: Tournament;
  club: Club | undefined;
  registration: TournamentRegistration;
  player: Pick<Player, "name">;
  /** The entry is on the waiting list behind a full field. */
  waitingList: boolean;
}

/**
 * What the player who has just signed up is told about paying by transfer (SignUpPaymentDto):
 * undefined unless the tournament shows bank details after sign-up and its club has them, and for an
 * entry the desk registered as paid already (it owes nothing). The amount is the entry's buy-ins only
 * (the owner, 2026-11-16: the high-hand entry is paid at the door, and is only mentioned), 0 for a free
 * entry. The club's account goes only with a buy-in to transfer now (PaymentInstructionsDto): never to
 * the waiting list, told not to pay yet, nor with nothing to pay (R8REV0-PRIV-01). The reference is
 * the player's name and the particulars the tournament's short name, each cut to the 12 characters a
 * transfer takes.
 */
export function paymentInstructionsFor({ tournament, club, registration, player, waitingList }: SignUpForPayment): SignUpPaymentDto | undefined {
  if (!tournament.showBankTransfer || !club) return undefined;
  if (registration.paymentConfirmed === true && registration.freeEntry !== true) return undefined;
  const details = bankDetailsOf(club);
  if (!details) return undefined;
  const buyInsOnly = { ...registration, rebuys: 0, addons: 0, enteringHighHands: false };
  const due = {
    amountDueCents: amountDueCents(tournament, buyInsOnly),
    highHandAtDoorCents: registration.enteringHighHands === true && offersHighHand(tournament) ? toCents(tournament.highHandAmount) : 0,
  };
  if (waitingList || due.amountDueCents === 0) return { ...due, waitingList };
  return {
    ...details,
    ...due,
    particulars: paymentParticulars(tournament, clubTimeZone(club)),
    reference: paymentReference(player.name),
    waitingList: false,
  };
}
