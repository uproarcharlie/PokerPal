import type { PublicRegistration } from "@shared/api/public";
import type { PaymentStatus } from "@shared/api/registrations";
import { unpaidEntries } from "@shared/domain/prize-pool";
import { acceptRefusal } from "@shared/domain/waiting-list";
import { lineupOf } from "@/features/public-tournament/waiting-list";
import type { PickerGroup } from "../mobile/desk-player-picker";

/** A registration as the club's staff are sent it: with its payment (a free entry is accepted, so paid). */
type StaffRow = PublicRegistration & Partial<PaymentStatus>;

/**
 * Who the phone's "Free entry" offers (round 7, item 6): the sign-ups in the field not paid yet, then
 * the waiting list in order. While Max players are accepted, a waiting-list player cannot be let in
 * (free or paid), so they are shown and not offered: "Field full".
 */
export function freeEntryCandidates(registrations: readonly StaffRow[], maxPlayers: number): PickerGroup[] {
  const lineup = lineupOf(registrations, maxPlayers);
  const full = acceptRefusal(registrations, maxPlayers) !== null;
  const groups: PickerGroup[] = [{ label: null, players: unpaidEntries({ maxPlayers }, registrations).map((registration) => ({ registration, detail: "Not paid yet" })) }];
  if (lineup.waiting.length > 0) {
    groups.push({
      label: "Waiting list",
      players: lineup.waiting.map(({ registration, position }) => ({
        registration,
        detail: `#${position} on the waiting list`,
        unavailable: full ? "Field full" : null,
      })),
    });
  }
  return groups;
}
