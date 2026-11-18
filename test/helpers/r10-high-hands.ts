/**
 * Round 10 fixtures for the web tests: a game with two high hands at $5 each ("First half" and "Second
 * half", the owner's night), the answers of the award endpoints, and a phone's screen (390 × 844, as
 * hosts run games).
 */
import { onTestFinished } from "vitest";
import type { HighHandAwardResultDto, HighHandDto, HighHandWinDto } from "@shared/api/high-hands";
import type { PublicRegistration } from "@shared/api/public";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { highHandPot, highHandStandings, type HighHandAward, type HighHandStanding } from "@shared/domain/high-hands";
import type { Cents } from "@shared/domain/money";
import { screenWidth } from "./f1-tournaments";
import * as base from "./dto";

/** The two high hands, $5 each; the first takes 10% AP (staff see it, nobody else). */
export const FIRST_HALF: HighHandDto = { id: "hh1", name: "First half", position: 1, entryFee: "5.00", winners: 1, note: "Before the break", rakeType: "percentage", rakeAmount: "10.00" };
export const SECOND_HALF: HighHandDto = { id: "hh2", name: "Second half", position: 2, entryFee: "5.00", winners: 1, note: "After the break", rakeType: "none", rakeAmount: "0.00" };
export const TWO_HALVES: HighHandDto[] = [FIRST_HALF, SECOND_HALF];

/** As a player sees them: no AP rule. */
export const publicHalves = (): HighHandDto[] => TWO_HALVES.map(({ rakeType: _type, rakeAmount: _amount, ...highHand }) => highHand);

/** A game that lists the two high hands, its legacy columns their summary ($10 for both). */
export function listedTournament(overrides: Partial<TournamentDetailDto> = {}): TournamentDetailDto {
  return base.tournamentDto({ enableHighHand: true, highHandAmount: "10.00", highHands: TWO_HALVES, ...overrides });
}

/** A prize won from one of the listed high hands. */
export const win = (highHandId: string, amountCents: number, awardedAt = "2026-11-18T08:00:00.000Z"): HighHandWinDto => ({
  highHandId,
  amountCents: amountCents as Cents,
  splitWithRegistrationId: null,
  awardedAt,
});

/** One pot's standing, from its money and its awards (shared/domain highHandStandings), as the desk works it out. */
export function standingOf(
  highHand: { id: string; name: string },
  { netCents, winners = 1, awards = [] }: { netCents: number; winners?: number; awards?: Array<{ registrationId: string; amountCents: number }> },
): HighHandStanding {
  const pot = { ...highHandPot({ id: highHand.id, name: highHand.name, entryFee: "0.00", winners }, 0), gross: netCents, net: netCents };
  const made: HighHandAward[] = awards.map((award) => ({ highHandId: highHand.id, splitWithRegistrationId: null, awardedAt: null, ...award }));
  return highHandStandings([pot], made)[0];
}

/** POST/PATCH …/awards: the award made, its winner's registration, and the pot after it. */
export function awardResult(registration: PublicRegistration, highHandId: string, amountCents: number): HighHandAwardResultDto {
  const award = { highHandId, registrationId: registration.id, amountCents: amountCents as Cents, splitWithRegistrationId: null, awardedAt: "2026-11-18T08:00:00.000Z", playerName: registration.player?.name ?? "" };
  return {
    highHandId,
    pot: { ...highHandPot({ id: highHandId, name: "Pot", entryFee: "0.00" }, 0), gross: amountCents, net: amountCents },
    awards: [award],
    nextAwardCents: null,
    unawardedCents: 0 as Cents,
    award,
    splitFrom: null,
    registration: { ...registration, paymentConfirmed: true, paymentConfirmedAt: null } as HighHandAwardResultDto["registration"],
  };
}

/** A host's phone: 390 px wide and 844 tall, for the rest of the test (put back when it ends). */
export function hostPhone(): void {
  screenWidth(390);
  const { innerWidth, innerHeight } = window;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
  onTestFinished(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: innerWidth });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: innerHeight });
  });
}
