/**
 * Setting the scene through the real API, as the signed-in actor of an APIRequestContext: accounts,
 * clubs, seasons, points systems, tournaments, players and registrations. Each spec drives the flow
 * it tests through the UI and uses these only for what has to exist beforehand.
 */
import { expect, type APIRequestContext, type APIResponse } from "@playwright/test";
import type { z } from "zod";
import type { AuthUserResponse } from "../../../shared/api/auth";
import type { CreatePointsSystemInput } from "../../../shared/api/points";
import type { StaffPlayer } from "../../../shared/api/players";
import type { ClubDto, PublicPointsSystem, PublicRegistration, PublicSeason } from "../../../shared/api/public";
import type { createTournamentSchema, TournamentDetailDto } from "../../../shared/api/tournaments";

/** Strong enough for the sign-up rules (passwordProblems in shared/api/auth.ts). */
export const PASSWORD = "E2e-Sturdy-Pass1";

/** What Railway's proxy adds (see playwright.config.ts): without it the Secure session cookie is never set. */
export const PROXY_HEADERS = { "X-Forwarded-Proto": "https" } as const;

// Workers are separate processes and a retry runs in a new one, so the pid keeps their tokens apart.
const WORKER = `${Date.now().toString(36).slice(-5)}${process.pid.toString(36).padStart(4, "0")}`;
let sequence = 0;

/**
 * Lower-case letters and digits, unique within the run: for names, emails and slugs. Every token has
 * the same length, so none is part of another and a search for one finds only its own records.
 */
export function uniqueToken(): string {
  sequence += 1;
  return `${WORKER}${sequence.toString(36).padStart(3, "0")}`;
}

/** A phone number no other player in the run has (players are global and matched by phone). */
export function uniquePhone(): string {
  sequence += 1;
  const pad = (value: number, width: number) => String(value).padStart(width, "0");
  return `021 ${pad(Date.now() % 1_000_000, 6)}${pad(process.pid % 100_000, 5)}${pad(sequence, 4)}`;
}

/** The response's JSON, after checking its status (the body is in the failure message). */
export async function expectJson<T>(response: APIResponse, status: number): Promise<T> {
  const text = await response.text();
  expect(response.status(), `${response.url()} answered ${response.status()}: ${text}`).toBe(status);
  return (text ? JSON.parse(text) : undefined) as T;
}

export interface Account {
  id: string;
  name: string;
  email: string;
  password: string;
}

/** Signs up a new account through POST /api/auth/register; `request` is then signed in as it. */
export async function signUp(request: APIRequestContext, name: string): Promise<Account> {
  const email = `e2e-${uniqueToken()}@example.test`;
  const { user } = await expectJson<AuthUserResponse>(
    await request.post("/api/auth/register", { data: { name, email, password: PASSWORD } }),
    201,
  );
  return { id: user.id, name, email, password: PASSWORD };
}

/** A club owned by `request`'s user (whoever creates a club owns it). */
export async function createClub(request: APIRequestContext, name: string): Promise<ClubDto> {
  return expectJson<ClubDto>(await request.post("/api/clubs", { data: { name, slug: `club-${uniqueToken()}` } }), 201);
}

export async function createSeason(request: APIRequestContext, clubId: string, name: string): Promise<PublicSeason> {
  return expectJson<PublicSeason>(
    await request.post("/api/seasons", { data: { clubId, name, startDate: "2026-01-01", isActive: true } }),
    201,
  );
}

export async function createPointsSystem(
  request: APIRequestContext,
  seasonId: string,
  input: CreatePointsSystemInput,
): Promise<PublicPointsSystem> {
  return expectJson<PublicPointsSystem>(await request.post(`/api/seasons/${seasonId}/points-systems`, { data: input }), 201);
}

type TournamentInput = Partial<z.input<typeof createTournamentSchema>> & { clubId: string };

/** An open (registration) tournament with a $40 buy-in and no rake unless `input` says otherwise. */
export async function createTournament(request: APIRequestContext, input: TournamentInput): Promise<TournamentDetailDto> {
  return expectJson<TournamentDetailDto>(
    await request.post("/api/tournaments", {
      data: {
        name: `Tournament ${uniqueToken()}`,
        startDateTime: "2026-10-24T19:30:00+13:00",
        buyInAmount: "40.00",
        maxPlayers: 20,
        minPlayers: 2,
        status: "registration",
        ...input,
      },
    }),
    201,
  );
}

/** A player created by a signed-in staff member (who gets the staff view back). */
export async function createPlayer(request: APIRequestContext, name: string): Promise<StaffPlayer> {
  return expectJson<StaffPlayer>(await request.post("/api/players", { data: { name, phone: uniquePhone() } }), 201);
}

/** Registers the player as the tournament's staff: payment unconfirmed unless `paymentConfirmed`. */
export async function registerPlayer(
  request: APIRequestContext,
  tournamentId: string,
  playerId: string,
  extra: { paymentConfirmed?: boolean } = {},
): Promise<PublicRegistration> {
  return expectJson<PublicRegistration>(
    await request.post(`/api/tournaments/${tournamentId}/registrations`, { data: { playerId, ...extra } }),
    201,
  );
}

export async function registrationsOf(request: APIRequestContext, tournamentId: string): Promise<PublicRegistration[]> {
  return expectJson<PublicRegistration[]>(await request.get(`/api/tournaments/${tournamentId}/registrations`), 200);
}
