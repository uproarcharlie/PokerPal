/**
 * What an AP change would pay, worked out before it is sent with the functions the server and
 * finalize pay with (lib/prize-pool `tournamentMoney` over shared/domain), so the TD sees the pool and
 * the places finalize will pay before saving. Plus the arithmetic behind the adjust dialog's quick
 * buttons, in exact cents.
 */
import { moneySchema } from "@shared/api/common";
import type { PrizePoolAdjustmentInput } from "@shared/api/prize-pool";
import type { PublicRegistration } from "@shared/api/public";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { centsToDecimalString, toCents, type Cents } from "@shared/domain/money";
import type { MergedRakeRates } from "@shared/domain/rake-rates";
import { tournamentMoney, type TournamentMoney } from "@/lib/prize-pool";

export type AdjustmentMode = PrizePoolAdjustmentInput["mode"];

/** The amount typed, in cents, when it is one the server accepts ("12", "12.5", "12.50"); else null. */
export function typedCents(text: string): Cents | null {
  const parsed = moneySchema.safeParse(text);
  return parsed.success ? toCents(parsed.data) : null;
}

/**
 * The tournament's money with `mode` applied: a fixed AP total or a fixed pool of `amountCents` (the
 * other cleared, as the server does), or both cleared. Null when the mode needs an amount and none was typed.
 */
export function previewAdjustment(
  tournament: TournamentDetailDto,
  registrations: readonly PublicRegistration[],
  mode: AdjustmentMode,
  amountCents: Cents | null,
): TournamentMoney | null {
  if (mode !== "calculated" && amountCents === null) return null;
  const amount = amountCents === null ? null : centsToDecimalString(amountCents);
  return tournamentMoney(
    { ...tournament, rakeOverride: mode === "ap_override" ? amount : null, manualPrizePool: mode === "manual_pool" ? amount : null },
    registrations,
  );
}

/**
 * The tournament's money with new rates (`mergeRakeRates`' result). Saving the rates goes back to the
 * calculated AP unless the TD keeps the fixed AP total; a manual prize pool stays.
 */
export function previewRates(
  tournament: TournamentDetailDto,
  registrations: readonly PublicRegistration[],
  rates: MergedRakeRates,
  keepOverride: boolean,
): TournamentMoney {
  return tournamentMoney(
    { ...tournament, ...rates, rakeType: rates.rakeType ?? "none", rakeOverride: keepOverride ? tournament.rakeOverride : null },
    registrations,
  );
}

/** "Half": half the calculated AP, to the cent below. */
export const halfCents = (cents: Cents): Cents => Math.floor(Math.max(0, cents) / 2);

/** "−$5" / "+$5": from the amount typed (or `start` when the box holds none), never below $0. */
export const stepCents = (typed: Cents | null, start: Cents, delta: Cents): Cents => Math.max(0, (typed ?? start) + delta);

/** "Round down to $10": a pool in whole tens of dollars. */
export const roundDownCents = (cents: Cents, step: Cents = 1000): Cents => Math.floor(Math.max(0, cents) / step) * step;
