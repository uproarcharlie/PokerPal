/**
 * A QR sign-up with a bank transfer to make, kept in this tab (R8REV1-PHONE-02). The player copies the
 * account number, the Particulars and the Reference one at a time into their banking app, and a phone
 * often unloads the page while that app is open: back on it, the page would start again at step 1, and
 * signing up again only says they are already registered. So the sign-up's answer stays in this tab's
 * sessionStorage, under the tournament, until "Register Another Player". The details are the player's
 * own (the one answer they are sent in) and never leave the phone. A browser that refuses storage (a
 * private window) keeps the confirmation only while the page is open, as before.
 */
import type { PublicPlayer } from "@shared/api/public";
import type { PaymentInstructionsDto, RegistrationCreatedDto } from "@shared/api/registrations";
import { waitingListPlaceOf } from "./waiting-list";

/** What the confirmation is shown from again: who signed up, the sign-up's answer, and the high hand they ticked. */
export interface SavedSignUp {
  player: PublicPlayer;
  registration: RegistrationCreatedDto;
  enteringHighHands: boolean;
}

/**
 * The bank transfer the sign-up is asked to make now: the club's account and the buy-in. Null on the
 * waiting list ("don't pay yet"), with nothing to pay (a free entry, a $0 game), or where the tournament
 * shows no bank details.
 */
export function transferToMake(registration: RegistrationCreatedDto | null | undefined): PaymentInstructionsDto | null {
  const pay = registration?.paymentInstructions;
  if (!pay || !("accountNumber" in pay) || pay.waitingList || waitingListPlaceOf(registration) !== null) return null;
  return pay.amountDueCents > 0 ? pay : null;
}

/** Bumped when SavedSignUp changes, so a page never shows what an older one kept. */
const VERSION = 1;

const storageKey = (tournamentId: string) => `pokerpal.signUp.${tournamentId}`;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isText = (value: unknown): value is string => typeof value === "string";
const isTextOrNull = (value: unknown) => value === null || isText(value);
const isCents = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value >= 0;

/** Whether what storage holds is a whole sign-up with a transfer to make, as this version keeps it. */
function isSaved(value: unknown): value is SavedSignUp & { version: number } {
  if (!isRecord(value) || value.version !== VERSION || typeof value.enteringHighHands !== "boolean") return false;
  const { player, registration } = value;
  if (!isRecord(player) || !isText(player.id) || !isText(player.name) || !isTextOrNull(player.imageUrl ?? null)) return false;
  if (!isRecord(registration) || !isText(registration.id) || !isRecord(registration.seating) || !isText(registration.seating.status)) return false;
  const pay = registration.paymentInstructions;
  return (
    isRecord(pay) &&
    [pay.accountName, pay.accountNumber, pay.particulars, pay.reference].every(isText) &&
    [pay.bankName, pay.instructions].every(isTextOrNull) &&
    [pay.amountDueCents, pay.highHandAtDoorCents].every(isCents)
  );
}

/** The sign-up this tab made for the tournament and still has a transfer to make for, or null. */
export function readSavedSignUp(tournamentId: string): SavedSignUp | null {
  try {
    const stored: unknown = JSON.parse(window.sessionStorage.getItem(storageKey(tournamentId)) ?? "null");
    if (!isSaved(stored) || transferToMake(stored.registration) === null) return null;
    const { version: _version, ...signUp } = stored;
    return signUp;
  } catch {
    return null;
  }
}

/** Keeps a sign-up with a transfer to make; any other leaves nothing behind (there is nothing to come back for). */
export function saveSignUp(tournamentId: string, signUp: SavedSignUp): void {
  try {
    if (transferToMake(signUp.registration) === null) window.sessionStorage.removeItem(storageKey(tournamentId));
    else window.sessionStorage.setItem(storageKey(tournamentId), JSON.stringify({ version: VERSION, ...signUp }));
  } catch {
    // Not kept (storage refused): the confirmation stays while the page is open.
  }
}

/** Forgets the tournament's kept sign-up: the next player signs up on this phone, or it no longer stands. */
export function forgetSignUp(tournamentId: string): void {
  try {
    window.sessionStorage.removeItem(storageKey(tournamentId));
  } catch {
    // Storage refused: nothing was kept.
  }
}
