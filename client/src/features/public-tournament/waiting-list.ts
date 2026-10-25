/**
 * The waiting list behind a full field (round 5, item 15) as the screens show it. Max players caps the
 * players a tournament accepts, never its sign-ups: the server numbers each sign-up beyond the field
 * (`waitingListPosition`, shared/domain/waiting-list), and every screen splits the registrations the
 * same way, so the field the TD counts is the field players see. Public-safe: the QR sign-up, the
 * public tournament page and the TD's desk all read it.
 */
import { waitingListPositions, type WaitingListEntry } from "@shared/domain/waiting-list";

export interface WaitingListed<T> {
  registration: T;
  /** Its place on the list: 1 is next in. */
  position: number;
}

export interface Lineup<T> {
  /** Everyone in the field (accepted, played, or signed up while there was room), in the order given. */
  field: T[];
  /** Everyone on the waiting list, next in first. */
  waiting: WaitingListed<T>[];
}

/** A tournament's registrations as the field and the waiting list behind it. */
export function lineupOf<T extends WaitingListEntry & { id: string }>(registrations: readonly T[], maxPlayers: number | null | undefined): Lineup<T> {
  const positions = waitingListPositions(registrations, maxPlayers);
  const field: T[] = [];
  const waiting: WaitingListed<T>[] = [];
  for (const registration of registrations) {
    const position = positions.get(registration.id);
    if (position === undefined) field.push(registration);
    else waiting.push({ registration, position });
  }
  return { field, waiting: waiting.sort((a, b) => a.position - b.position) };
}

/**
 * Where a sign-up made now goes: null while the field has room, else its number on the waiting list.
 * A new sign-up is the latest, so it waits once the field holds Max players.
 */
export function nextSignUpPlace(lineup: Lineup<unknown>, maxPlayers: number | null | undefined): number | null {
  if (typeof maxPlayers !== "number") return null;
  return lineup.field.length >= maxPlayers ? lineup.waiting.length + 1 : null;
}

/** The registration's place on the waiting list, or null when it is in the field. */
export const waitingListPlaceOf = (registration: { waitingListPosition?: number | null } | null | undefined): number | null => {
  const position = registration?.waitingListPosition;
  return typeof position === "number" && position > 0 ? position : null;
};
