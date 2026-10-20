/**
 * Fixtures for the player-facing tournament pages' web tests (F2): the public scenario over the shared
 * DTO factories (./dto), and MSW handlers for a tournament's public data.
 */
import { http, HttpResponse } from "msw";
import type { ClubDto, PublicRegistration } from "@shared/api/public";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { server } from "../msw/server";
import * as base from "./dto";

export const { tournamentDto } = base;

/** Central Stars as the public pages get it: its rake labelled "AP", no time zone of its own. */
export function clubDto(overrides: Partial<ClubDto> = {}): ClubDto {
  return base.clubDto({ timezone: null, rakeLabel: "AP", ...overrides });
}

/** One entry, signed up at 7 pm on the night. */
export function registrationDto(id: string, name: string, overrides: Partial<PublicRegistration> = {}): PublicRegistration {
  return base.registrationDto(id, name, { registrationTime: "2026-10-23T06:00:00.000Z", ...overrides });
}

/** Answers GET /api/tournaments/t1, its club and its registrations; returns how often each was asked for. */
export function mockTournamentPages(
  tournament: TournamentDetailDto,
  registrations: PublicRegistration[] = [],
  club: ClubDto = clubDto(),
): { detail: () => number; registrations: () => number } {
  let detailRequests = 0;
  let registrationRequests = 0;
  server.use(
    http.get(`/api/tournaments/${tournament.id}`, () => {
      detailRequests++;
      return HttpResponse.json(tournament);
    }),
    http.get(`/api/clubs/${club.id}`, () => HttpResponse.json(club)),
    http.get(`/api/tournaments/${tournament.id}/registrations`, () => {
      registrationRequests++;
      return HttpResponse.json(registrations);
    }),
  );
  return { detail: () => detailRequests, registrations: () => registrationRequests };
}
