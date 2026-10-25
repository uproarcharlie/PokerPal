/**
 * Fixtures for the player-facing tournament pages' web tests (F2): the public scenario over the shared
 * DTO factories (./dto), and MSW handlers for a tournament's public data as a visitor gets it (round 6:
 * none of the club's takings, the prize pool worked out by the server).
 */
import { http, HttpResponse } from "msw";
import { toPublicPrizes, type PublicPrizesDto } from "@shared/api/live-display";
import { TOURNAMENT_TAKINGS_FIELDS, type ClubDto, type PublicRegistration } from "@shared/api/public";
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

/**
 * `tournament` (as its staff see it) as GET /api/tournaments/:id answers someone who does not run the
 * club: without the takings, nor the finalize snapshot (the server's toPublicTournament).
 */
export function visitorView(tournament: TournamentDetailDto): TournamentDetailDto {
  const view: TournamentDetailDto = { ...tournament, prizePoolSnapshot: null };
  for (const key of TOURNAMENT_TAKINGS_FIELDS) delete view[key];
  return view;
}

/**
 * GET /api/public/tournaments/:id/prizes for `tournament` (as its staff see it, takings and snapshot
 * included) and `registrations`, every one of them paid: the server's own toPublicPrizes.
 */
export function prizesDto(tournament: TournamentDetailDto, registrations: readonly PublicRegistration[] = [], overrides: Partial<PublicPrizesDto> = {}): PublicPrizesDto {
  return { ...toPublicPrizes(tournament, registrations.map((registration) => ({ ...registration, paymentConfirmed: true }))), ...overrides };
}

/**
 * Answers GET /api/tournaments/t1 (as `tournament.viewer` gets it), its club, its registrations and its
 * public prize pool (`prizes`, else worked out from the tournament and registrations); returns how often
 * each was asked for.
 */
export function mockTournamentPages(
  tournament: TournamentDetailDto,
  registrations: PublicRegistration[] = [],
  club: ClubDto = clubDto(),
  prizes: PublicPrizesDto = prizesDto(tournament, registrations),
): { detail: () => number; registrations: () => number; prizes: () => number } {
  let detailRequests = 0;
  let registrationRequests = 0;
  let prizeRequests = 0;
  const detail = tournament.viewer.canManage ? tournament : visitorView(tournament);
  server.use(
    http.get(`/api/tournaments/${tournament.id}`, () => {
      detailRequests++;
      return HttpResponse.json(detail);
    }),
    http.get(`/api/clubs/${club.id}`, () => HttpResponse.json(club)),
    http.get(`/api/tournaments/${tournament.id}/registrations`, () => {
      registrationRequests++;
      return HttpResponse.json(registrations);
    }),
    http.get(`/api/public/tournaments/${tournament.id}/prizes`, () => {
      prizeRequests++;
      return HttpResponse.json(prizes);
    }),
  );
  return { detail: () => detailRequests, registrations: () => registrationRequests, prizes: () => prizeRequests };
}
