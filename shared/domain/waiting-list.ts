/**
 * Max players and the waiting list (round 5, item 15). PURE: no runtime imports outside shared/domain.
 *
 * The owner's rule (2026-10-25): "you can have more than the max entries but the admin should not be
 * able to accept more than the max". Max players caps the players a tournament ACCEPTS (payment
 * confirmed at the desk), never its sign-ups. The field is everyone accepted, everyone who has already
 * played (busted, re-bought, added on, knocked someone out or been placed: they are in, paid or not),
 * then the other sign-ups in sign-up order while places are left; everyone after them is on the
 * waiting list, numbered from 1 in sign-up order. Waiting-list players are not seated, not counted in
 * the entries, chips in play or average stack, and (the owner's open question: prizePool's
 * poolEntries) not in the prize pool. When an accepted player's entry is removed, or Max players is
 * raised, the first on the list moves into the field.
 */

/** A registration as the waiting list reads it. A `TournamentRegistration` row, or a registration DTO, fits as it is. */
export interface WaitingListEntry {
  /** Entries with no id (a row of totals) are always in the field. */
  id?: string;
  registrationTime?: Date | string | null;
  paymentConfirmed?: boolean | null;
  isEliminated?: boolean | null;
  finalPosition?: number | null;
  rebuys?: number | null;
  addons?: number | null;
  knockouts?: number | null;
  /**
   * The place on the list the server gave the entry (registrations as the API answers them: the public
   * ones carry no payment status to work it out from). When entries carry it, it is used as it is.
   */
  waitingListPosition?: number | null;
}

/** Whether the entry has played: then it is in the field whatever its payment, and never waits. */
export function hasPlayed(entry: WaitingListEntry): boolean {
  return (
    entry.isEliminated === true ||
    (entry.finalPosition ?? null) !== null ||
    (entry.rebuys ?? 0) > 0 ||
    (entry.addons ?? 0) > 0 ||
    (entry.knockouts ?? 0) > 0
  );
}

/** When the entry signed up, in ms; an entry with no time sorts last, as the database's lists put it. */
const signedUpAt = (entry: WaitingListEntry): number => {
  const time = entry.registrationTime instanceof Date ? entry.registrationTime.getTime() : entry.registrationTime ? Date.parse(entry.registrationTime) : Number.NaN;
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
};

/** Sign-up order: registration time, then id. */
export function bySignUp(a: WaitingListEntry, b: WaitingListEntry): number {
  const [x, y] = [signedUpAt(a), signedUpAt(b)];
  if (x !== y) return x < y ? -1 : 1;
  const [p, q] = [a.id ?? "", b.id ?? ""];
  return p < q ? -1 : p > q ? 1 : 0;
}

const capOf = (maxPlayers: number | null | undefined): number | null =>
  typeof maxPlayers === "number" && Number.isFinite(maxPlayers) ? Math.max(0, Math.floor(maxPlayers)) : null;

/**
 * Each waiting-list entry's place on the list (1 = next in), by id. Empty without a Max players, and
 * for entries that carry no id. Entries that carry `waitingListPosition` are read as they are.
 */
export function waitingListPositions(entries: readonly WaitingListEntry[], maxPlayers: number | null | undefined): Map<string, number> {
  const positions = new Map<string, number>();
  if (entries.some((entry) => entry.waitingListPosition !== undefined)) {
    for (const entry of entries) {
      const position = entry.waitingListPosition;
      if (entry.id !== undefined && typeof position === "number" && position > 0) positions.set(entry.id, position);
    }
    return positions;
  }
  const cap = capOf(maxPlayers);
  if (cap === null) return positions;
  const known = entries.filter((entry): entry is WaitingListEntry & { id: string } => entry.id !== undefined);
  let places = Math.max(0, cap - known.filter(inFieldByRight).length);
  for (const entry of known.filter((candidate) => !inFieldByRight(candidate)).sort(bySignUp)) {
    if (places > 0) places -= 1;
    else positions.set(entry.id, positions.size + 1);
  }
  return positions;
}

/** The entries in the field: every one but those on the waiting list, in the order given. */
export function fieldEntries<T extends WaitingListEntry>(entries: readonly T[], maxPlayers: number | null | undefined): T[] {
  const waiting = waitingListPositions(entries, maxPlayers);
  return waiting.size === 0 ? [...entries] : entries.filter((entry) => entry.id === undefined || !waiting.has(entry.id));
}

/**
 * How many sign-ups wait, from counts alone (a list of tournaments counts its registrations in SQL):
 * `registered` sign-ups, `byRight` of them in the field by right (inFieldByRight). The size of
 * waitingListPositions for those entries.
 */
export function waitingListCount(registered: number, byRight: number, maxPlayers: number | null | undefined): number {
  const cap = capOf(maxPlayers);
  if (cap === null) return 0;
  return Math.max(0, registered - byRight - Math.max(0, cap - byRight));
}

/** Whether the entry is in the field by right: accepted (paid), or it has played. Nobody can take its place. */
export function inFieldByRight(entry: WaitingListEntry): boolean {
  return entry.paymentConfirmed === true || hasPlayed(entry);
}

/**
 * Why an entry cannot be accepted (409 TOURNAMENT_FULL), with no override: Max players are in the
 * field by right already ("18 of 18 players accepted: raise Max players to accept more"). `others` is
 * every other registration of the tournament. Accepting is anything that puts an entry in the field
 * by right: confirming its payment, or (refused alike for a waiting-list player) a re-buy, add-on,
 * knockout or bust. Null while there is room, and always for an entry in the field by right already
 * (a payment reconciled after it played).
 */
export function acceptRefusal(others: readonly WaitingListEntry[], maxPlayers: number, entry: WaitingListEntry = {}): string | null {
  const cap = capOf(maxPlayers);
  if (cap === null || inFieldByRight(entry)) return null;
  const accepted = others.filter(inFieldByRight).length;
  if (accepted < cap) return null;
  return `${accepted} of ${cap} players accepted: raise Max players to accept more`;
}
