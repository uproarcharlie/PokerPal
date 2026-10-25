import type { PublicRegistration } from "@shared/api/public";
import type { PaymentStatus } from "@shared/api/registrations";
import { hasPaid } from "@shared/domain/prize-pool";
import { fieldEntries } from "@shared/domain/waiting-list";
import { playerName } from "../../player-name";

/** A finalized tournament's whole finishing order, best first, for correcting it (D19). */
export function finishersOf(registrations: readonly PublicRegistration[]): Array<{ registrationId: string; playerName: string }> {
  return registrations
    .filter((registration) => registration.finalPosition != null)
    .sort((a, b) => (a.finalPosition ?? 0) - (b.finalPosition ?? 0))
    .map((registration) => ({ registrationId: registration.id, playerName: playerName(registration) }));
}

/** One player in the order Correct Results starts from. */
export interface CorrectionEntry {
  registrationId: string;
  playerName: string;
  /** Whether finalize stored a place for them: it leaves a player in the field out only for not paying (round 6). */
  placed: boolean;
  /** Whether their payment is confirmed, as the club's staff are told. */
  paid: boolean;
}

/** A registration as the club's staff are sent it: with its payment. */
type StaffRow = PublicRegistration & Partial<PaymentStatus>;

/**
 * The order Correct Results starts from: the stored finishing order, best first, then everyone in the
 * field finalize left without a place (left out for not paying), in sign-up order, so the order it sends
 * names the whole field and a late payment has a place to go (R6REV1-PHONE-01).
 */
export function correctionOrderOf(registrations: readonly StaffRow[], maxPlayers: number | null | undefined): CorrectionEntry[] {
  const entry = (registration: StaffRow, placed: boolean): CorrectionEntry => ({
    registrationId: registration.id,
    playerName: playerName(registration),
    placed,
    paid: hasPaid(registration),
  });
  const placed = registrations
    .filter((registration) => registration.finalPosition != null)
    .sort((a, b) => (a.finalPosition ?? 0) - (b.finalPosition ?? 0))
    .map((registration) => entry(registration, true));
  const unplaced = fieldEntries(registrations, maxPlayers)
    .filter((registration) => registration.finalPosition == null)
    .map((registration) => entry(registration, false));
  return [...placed, ...unplaced];
}
