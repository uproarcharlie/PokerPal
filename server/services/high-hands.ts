/**
 * A tournament's high hands as every service reads them (round 10; round10-contracts §1.2, §8). A
 * tournament with any tournament_high_hands row LISTS its high hands: its active rows, in order, go to
 * shared/domain as `highHands`, and each registration carries the ones it entered (`highHandIds`) and
 * the prizes it won (`highHandWins`). One with none keeps its one high hand in its legacy columns, read
 * by shared/domain as the high hand "legacy" (`highHands` null, both lists empty).
 *
 * Every computePrizePool, amountDueCents, toPublicPrizes, buildFinalizePlan or offersHighHand on a
 * tournament that lists its high hands must get these inputs, or it reads the legacy columns, which
 * are then only a summary: so every money read and DTO goes through this loader. It imports no other
 * service, so any of them may use it. Lock order (as every write's): the tournament row first, then its
 * registrations, then these tables.
 */
import { RAKE_TYPES, type RakeType } from "@shared/api/common";
import type { HighHandDto, HighHandWinDto } from "@shared/api/high-hands";
import { registrationHighHandSummary } from "@shared/domain/high-hands";
import { toCents } from "@shared/domain/money";
import type { HighHandAwardRow, RegistrationHighHand, Tournament, TournamentHighHand, TournamentRegistration } from "@shared/schema";
import type { Executor } from "../db";
import * as highHandsRepo from "../repositories/high-hands";
import { registrationsOf, updateTournamentRegistration } from "../repositories/registrations";

/** What a tournament's high-hand tables hold: its high hands (removed ones included), who entered which, and who won what. */
export interface HighHandStore {
  rows: readonly TournamentHighHand[];
  entrants: readonly RegistrationHighHand[];
  awards: readonly HighHandAwardRow[];
}

/** A tournament with its listed high hands still on the list, in order, or null when it lists none (its legacy columns). */
export type WithHighHands<T> = T & { highHands: TournamentHighHand[] | null };
export type TournamentWithHighHands = WithHighHands<Tournament>;

/** The high hands an entry is in and the prizes it won, as every registration answer carries them (both empty for a legacy tournament). */
export interface EntryHighHands {
  highHandIds: string[];
  highHandWins: HighHandWinDto[];
}
export type RegistrationWithHighHands = TournamentRegistration & EntryHighHands;

/** The tournament's high-hand rows; a tournament that lists none has nothing else to read. */
export async function loadHighHandStore(ex: Executor, tournamentId: string): Promise<HighHandStore> {
  const rows = await highHandsRepo.highHandRowsOf(ex, tournamentId);
  if (rows.length === 0) return { rows, entrants: [], awards: [] };
  const entrants = await highHandsRepo.entrantRowsOf(ex, tournamentId);
  const awards = await highHandsRepo.awardRowsOf(ex, tournamentId);
  return { rows, entrants, awards };
}

/** The high hands still on the list, in order (rows come in list order); null for a tournament that lists none. */
export function activeHighHands(rows: readonly TournamentHighHand[]): TournamentHighHand[] | null {
  return rows.length === 0 ? null : rows.filter((row) => row.removedAt === null);
}

export function withHighHands<T extends Tournament>(tournament: T, store: Pick<HighHandStore, "rows">): WithHighHands<T> {
  return { ...tournament, highHands: activeHighHands(store.rows) };
}

const toWin = (award: HighHandAwardRow): HighHandWinDto => ({
  highHandId: award.highHandId,
  amountCents: award.amountCents,
  splitWithRegistrationId: award.splitWithRegistrationId,
  awardedAt: award.awardedAt.toISOString(),
});

/** Each registration's high hands, in the list's order, and its prizes, in award order: high hands taken off the list left out. */
function entryHighHandsByRegistration(store: HighHandStore): (registrationId: string) => EntryHighHands {
  const active = activeHighHands(store.rows);
  if (active === null) return () => ({ highHandIds: [], highHandWins: [] });
  const order = new Map(active.map((row, index) => [row.id, index]));
  const entered = new Map<string, string[]>();
  for (const entrant of store.entrants) {
    if (order.has(entrant.highHandId)) entered.set(entrant.registrationId, [...(entered.get(entrant.registrationId) ?? []), entrant.highHandId]);
  }
  const won = new Map<string, HighHandWinDto[]>();
  for (const award of store.awards) {
    if (order.has(award.highHandId)) won.set(award.registrationId, [...(won.get(award.registrationId) ?? []), toWin(award)]);
  }
  return (registrationId) => ({
    highHandIds: (entered.get(registrationId) ?? []).sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)),
    highHandWins: won.get(registrationId) ?? [],
  });
}

export function registrationsWithHighHands<R extends TournamentRegistration>(store: HighHandStore, registrations: readonly R[]): Array<R & EntryHighHands> {
  const of = entryHighHandsByRegistration(store);
  return registrations.map((registration) => ({ ...registration, ...of(registration.id) }));
}

export function withEntryHighHands<R extends TournamentRegistration>(store: HighHandStore, registration: R): R & EntryHighHands {
  return { ...registration, ...entryHighHandsByRegistration(store)(registration.id) };
}

/** One registration with its high hands, read now (for an answer about one entry). */
export async function loadEntryHighHands<R extends TournamentRegistration>(ex: Executor, registration: R): Promise<R & EntryHighHands> {
  return withEntryHighHands(await loadHighHandStore(ex, registration.tournamentId), registration);
}

/** A tournament and its registrations with their high hands: what every money figure is worked out from. */
export interface MoneyState {
  tournament: TournamentWithHighHands;
  registrations: RegistrationWithHighHands[];
  store: HighHandStore;
}

/** The tournament's money state, read with `ex` (with `lock`, its registrations stay locked FOR UPDATE until the transaction ends). */
export async function loadMoneyState(ex: Executor, tournament: Tournament, { lock = false }: { lock?: boolean } = {}): Promise<MoneyState> {
  const registrations = await registrationsOf(ex, tournament.id, { lock });
  const store = await loadHighHandStore(ex, tournament.id);
  return { tournament: withHighHands(tournament, store), registrations: registrationsWithHighHands(store, registrations), store };
}

const isRakeType = (value: string): value is RakeType => (RAKE_TYPES as readonly string[]).includes(value);

/** The tournament's listed high hands as the API sends them (null: it lists none): each one's AP rule only for someone who runs the club. */
export function toHighHandDtos(highHands: readonly TournamentHighHand[] | null, canManage: boolean): HighHandDto[] | null {
  if (highHands === null) return null;
  return highHands.map((row) => ({
    id: row.id,
    name: row.name,
    position: row.position,
    entryFee: row.entryFee,
    winners: row.winners,
    note: row.note,
    ...(canManage ? { rakeType: isRakeType(row.rakeType) ? row.rakeType : "none", rakeAmount: row.rakeAmount } : {}),
  }));
}

/** Each tournament's high hands from rows of many (highHandRowsOfTournaments), by tournament id. */
export function highHandRowsByTournament(rows: readonly TournamentHighHand[]): Map<string, TournamentHighHand[]> {
  const byTournament = new Map<string, TournamentHighHand[]>();
  for (const row of rows) byTournament.set(row.tournamentId, [...(byTournament.get(row.tournamentId) ?? []), row]);
  return byTournament;
}

/**
 * Writes the legacy columns of a registration of a tournament that lists its high hands as their
 * summary (registrationHighHandSummary), when they say anything else: in any high hand, won any, and
 * what it won in all. A row that already says the same (a null flag is false; a non-winner's amount is
 * not read) is left as it is. Returns the row as stored.
 */
export async function writeEntrySummary(
  ex: Executor,
  registration: TournamentRegistration,
  highHandIds: readonly string[],
  wins: readonly { amountCents: number }[],
): Promise<TournamentRegistration> {
  const summary = registrationHighHandSummary(highHandIds, wins);
  const same =
    (registration.enteringHighHands === true) === summary.enteringHighHands &&
    (registration.highHandWinner === true) === summary.highHandWinner &&
    (!summary.highHandWinner || (summary.highHandAmount !== null && registration.highHandAmount !== null && toCents(registration.highHandAmount) === toCents(summary.highHandAmount)));
  if (same) return registration;
  return (await updateTournamentRegistration(ex, registration.id, summary)) ?? registration;
}
