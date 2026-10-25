/**
 * The building blocks of test/api/authz-matrix.api.test.ts's route rows, shared so a domain can keep
 * its rows in a file of its own (test/helpers/authz-rows-*.ts) and the matrix spreads them in: who may
 * call a route (Statuses), the request each kind of visitor makes (Case, Call), and the fixtures rows
 * commonly act on.
 */
import type request from "supertest";
import type { Club, Tournament } from "@shared/schema";
import { createPlayer, createRegistration, createTournament, type NewTournament } from "../factories";
import type { SignedInUser } from "./auth";
import type { ClubStaffAgents, Visitor } from "./club-staff";

/** The status each kind of visitor gets. */
export type Statuses = Readonly<Record<Visitor, number>>;

export const everyone = (ok: number): Statuses => ({ anonymous: ok, stranger: ok, manager: ok, owner: ok, admin: ok, deactivated: ok });
/** Any active, signed-in user: a deactivated account's session counts for nothing. */
export const signedIn = (ok: number): Statuses => ({ ...everyone(ok), anonymous: 401, deactivated: 401 });
/** A platform admin, the club's owner or one of its managers. */
export const staffOf = (ok: number): Statuses => ({ ...signedIn(ok), stranger: 403 });
/** A platform admin or the club's owner. */
export const ownerOf = (ok: number): Statuses => ({ ...staffOf(ok), manager: 403 });
export const adminOnly = (ok: number): Statuses => ({ ...signedIn(403), admin: ok });

export interface Context {
  staff: ClubStaffAgents;
  /** A club of this request's own, owned by `staff.owner` and managed by `staff.manager` (and the deactivated manager). */
  club: Club;
  visitor: Visitor;
  /** The visitor's own account; null when anonymous. */
  user: SignedInUser | null;
  agent: request.Agent;
}

export interface Call {
  path: string;
  json?: object;
  /** Sends a small PNG as the multipart `image`, with these fields. */
  upload?: Record<string, string>;
}

export interface Case {
  /** Names the case when a route has more than one. */
  name?: string;
  expect: Statuses;
  call(ctx: Context): Promise<Call> | Call;
}

export interface RouteRow {
  /** What the route must mount, as test/helpers/routes.ts names guards. */
  guards: string[];
  cases: Case[];
  /** The same request on an id that nothing has, for routes acting on one resource. */
  missing?(): Promise<Call> | Call;
}

export const single = (expect: Statuses, call: Case["call"]): Case[] => [{ expect, call }];

/** An open tournament of `club` that sells re-buys and add-ons. */
export const tournamentIn = (club: Club, overrides: Partial<NewTournament> = {}) =>
  createTournament({ clubId: club.id, status: "registration", rebuyAmount: "50.00", addonAmount: "25.00", ...overrides });

export async function registeredPlayer(tournament: Tournament, overrides: { isEliminated?: boolean; minutesIn?: number } = {}) {
  const player = await createPlayer();
  const registration = await createRegistration({
    tournamentId: tournament.id,
    playerId: player.id,
    isEliminated: overrides.isEliminated ?? false,
    eliminationTime: overrides.isEliminated ? new Date(Date.UTC(2026, 2, 1, 19, overrides.minutesIn ?? 30)) : null,
  });
  return { player, registration };
}
