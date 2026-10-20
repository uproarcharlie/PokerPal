import type { PublicRegistration } from "@shared/api/public";
import { playerName } from "../../player-name";

/** A finalized tournament's whole finishing order, best first, for correcting it (D19). */
export function finishersOf(registrations: readonly PublicRegistration[]): Array<{ registrationId: string; playerName: string }> {
  return registrations
    .filter((registration) => registration.finalPosition != null)
    .sort((a, b) => (a.finalPosition ?? 0) - (b.finalPosition ?? 0))
    .map((registration) => ({ registrationId: registration.id, playerName: playerName(registration) }));
}
