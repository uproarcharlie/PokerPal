/**
 * The tournament form (create and edit): its values, the schema that checks them (the shared
 * `createTournamentSchema`, fed numbers from text boxes, plus the form's own switches), and the
 * request bodies built from them. Pure, so every rule is unit-tested.
 */
import { z } from "zod";
import type { RakeType } from "@shared/api/common";
import type { ClubDto, PublicRegistration, PublicTournament } from "@shared/api/public";
import { createTournamentSchema, type CreateTournamentInput, type UpdateTournamentInput } from "@shared/api/tournaments";
import { hasBounty } from "@shared/domain/bounty";
import type { HighHandsInput } from "@shared/domain/high-hands";
import { toCents } from "@shared/domain/money";
import { offersAddons, offersRebuys } from "@shared/domain/player-actions";
import { PAYOUT_STRUCTURE_KEYS, type PayoutStructureKey } from "@shared/domain/payouts";
import { mergeRakeRates, RAKE_COMPONENTS, rateOverPrice, rateOverPriceMessage, type RakeRatesProblem } from "@shared/domain/rake-rates";
import { fromZonedDateTimeLocal, plural, toZonedDateTimeLocal } from "@/lib/format";
import { typedNumber } from "@/lib/forms";
import { highHandEntrantsOf, highHandFormValues, highHandsFormSchema, type HighHandFormValue } from "./high-hands-form";
import { rakeTypeOf, rateAmountText } from "./rate-text";

/** What the form holds: text boxes as text, switches as booleans. */
export interface TournamentFormValues {
  name: string;
  description: string;
  imageUrl: string | null;
  clubId: string;
  seasonId: string;
  pointsSystemId: string;
  /**
   * A datetime-local value ("2026-10-24T19:30") on the club's wall clock, the zone every screen shows
   * the start in (P3REV-PARITY-TZ-01): `inClubZone` reads it as an instant before the schema parses it.
   */
  startDateTime: string;
  buyInAmount: string;
  /** Round 11: the bounty each buy-in pays on top of the buy-in (blank: not a bounty game). */
  bountyAmount: string;
  rakeType: RakeType;
  rakeAmount: string;
  enableRebuys: boolean;
  rebuyAmount: string;
  maxRebuys: string;
  rebuyPeriodMinutes: string;
  rebuyRakeType: RakeType;
  rebuyRakeAmount: string;
  enableAddons: boolean;
  addonAmount: string;
  /** House rules (TDN4-HOUSE-RULES-UNSET): add-ons per player (blank: no limit), and re-buys OR add-ons, never both. */
  maxAddons: string;
  rebuyOrAddon: boolean;
  addonRakeType: RakeType;
  addonRakeAmount: string;
  payoutStructure: PayoutStructureKey;
  /** Round 10: the high hands, in order (none: no high hand). */
  highHands: HighHandFormValue[];
  enableLateRegistration: boolean;
  trackPoints: boolean;
  minPlayers: string;
  maxPlayers: string;
  /** Round 5: seats per table, 2 to 10 (blank: the club's default). */
  seatsPerTable: string;
  useClubAddress: boolean;
  address: string;
  /** Round 8: "Show bank transfer details after sign-up" (needs the club's bank details). */
  showBankTransfer: boolean;
}

/** The settings a tournament is created with, before it is given a status. */
export type TournamentConfig = Omit<CreateTournamentInput, "status">;

const shape = createTournamentSchema.shape;

/** What a rate's box says when mergeRakeRates refuses it: one wording for the tournament form and the AP rates sheet. */
export const RATE_MESSAGES: Readonly<Record<RakeRatesProblem["code"], string>> = {
  AMOUNT_REQUIRED: "Enter an amount for that rate",
  PERCENT_OVER_100: "A percentage cannot be over 100",
};

/** The legacy high-hand settings (before round 10): the form sends the list (`highHands`) instead, never these. */
const LEGACY_HIGH_HAND_FIELDS = {
  enableHighHand: true,
  highHandAmount: true,
  highHandRakeType: true,
  highHandRakeAmount: true,
  highHandPayouts: true,
} as const;

/** The AP rates the form's own boxes hold: each high hand's is on its card. */
const FORM_RATES = RAKE_COMPONENTS.filter(({ type }) => type !== "highHandRakeType");

/**
 * The form's values, checked by the shared request schema. A rate is checked as the server checks it
 * (mergeRakeRates, then rateOverPrice: a fixed rate above the price it is taken from), but only for
 * the parts the tournament has: a re-buy rate typed before re-buys were switched off is not sent, so
 * it is not checked either. The high hands are a list (round 10), each checked on its card.
 */
export const tournamentFormSchema = createTournamentSchema
  .omit({ status: true, highHands: true, ...LEGACY_HIGH_HAND_FIELDS })
  .extend({
    clubId: z.string().trim().min(1, "Choose a club").pipe(shape.clubId),
    startDateTime: z.string().trim().min(1, "Choose the start date and time").pipe(shape.startDateTime),
    maxRebuys: typedNumber(shape.maxRebuys),
    maxAddons: typedNumber(shape.maxAddons),
    rebuyPeriodMinutes: typedNumber(shape.rebuyPeriodMinutes),
    highHands: highHandsFormSchema,
    minPlayers: typedNumber(shape.minPlayers),
    maxPlayers: typedNumber(shape.maxPlayers),
    seatsPerTable: typedNumber(shape.seatsPerTable),
    enableRebuys: z.boolean(),
    enableAddons: z.boolean(),
  })
  .superRefine((values, ctx) => {
    const config = tournamentConfig(values);
    const merged = mergeRakeRates({}, config);
    if (!merged.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [merged.field], message: RATE_MESSAGES[merged.code] });
    const overPrice = merged.ok ? rateOverPrice(config) : null;
    if (overPrice) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [overPrice.field], message: rateOverPriceMessage(overPrice) });
    // A $0 price is no re-buy or add-on at all (offersRebuys): players would never be offered one.
    if (values.enableRebuys && values.rebuyAmount !== null && !offersRebuys(values)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rebuyAmount"], message: "Enter a re-buy price above $0, or switch re-buys off" });
    }
    if (values.enableAddons && values.addonAmount !== null && !offersAddons(values)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["addonAmount"], message: "Enter an add-on price above $0, or switch add-ons off" });
    }
  });

export type TournamentFormOutput = z.output<typeof tournamentFormSchema>;

/**
 * The values with the start time read on the club's wall clock (`timeZone`), as the schema must parse
 * them: a device in another zone sends the time the TD typed from the flyer, not that time where the
 * device is. A start that is not a datetime-local value is left for the schema to refuse.
 */
export function inClubZone(values: TournamentFormValues, timeZone: string): TournamentFormValues {
  const instant = fromZonedDateTimeLocal(values.startDateTime, timeZone);
  return instant ? { ...values, startDateTime: instant } : values;
}

/**
 * The settings to send. A part the tournament does not have is sent empty, so a price typed before a
 * switch was turned off is never stored (CA-15); a rate of "none" sends no amount (the server stores 0).
 * "Re-buys OR add-ons" means something only while the tournament sells both. The high hands go as
 * their list (round 10), with none of the legacy high-hand fields (the server refuses the two together).
 */
export function tournamentConfig(values: TournamentFormOutput): TournamentConfig {
  const { enableRebuys, enableAddons, ...config } = values;
  const result: TournamentConfig = { ...config };
  if (!enableRebuys) {
    Object.assign(result, { rebuyAmount: null, maxRebuys: null, rebuyPeriodMinutes: null, rebuyRakeType: "none" });
  }
  if (!enableAddons) Object.assign(result, { addonAmount: null, maxAddons: null, addonRakeType: "none" });
  if (!enableRebuys || !enableAddons) result.rebuyOrAddon = null;
  for (const { type, amount } of FORM_RATES) {
    if ((result[type] ?? "none") === "none") result[amount] = null;
  }
  return result;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  // The high hands' list (round 10): the same when it would send the same.
  if (Array.isArray(a) && Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b);
  return a === b;
}

/**
 * An edit's request body: only what changed, so a field nobody touched is never resent (a finished
 * tournament refuses money settings that differ from what it paid with). A rate goes with its type:
 * the server refuses a new type without its amount.
 */
export function changedConfig(initial: TournamentConfig, current: TournamentConfig): UpdateTournamentInput {
  const changes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(current)) {
    if (key !== "clubId" && !sameValue(value, (initial as Record<string, unknown>)[key])) changes[key] = value;
  }
  for (const { type, amount } of FORM_RATES) {
    if (type in changes || amount in changes) {
      changes[type] = current[type];
      changes[amount] = current[amount];
    }
  }
  return changes as UpdateTournamentInput;
}

/**
 * What the players already have at each price (editing). The pool counts every recorded entry at the
 * tournament's current prices, so a part with entries recorded stays on, and its price is never left
 * empty: those entries would silently count as $0 (P3REV0-PARITY-EDIT-REPRICE). A high hand anyone is
 * in stays on the list (round 10: by its id).
 */
export interface RecordedEntries {
  rebuys: number;
  addons: number;
  highHandEntrants: Readonly<Record<string, number>>;
}

type RecordedFields = Pick<PublicRegistration, "rebuys" | "addons" | "enteringHighHands" | "highHandIds">;

export function recordedEntries(tournament: HighHandsInput, registrations: readonly RecordedFields[]): RecordedEntries {
  return {
    rebuys: registrations.reduce((total, registration) => total + (registration.rebuys ?? 0), 0),
    addons: registrations.reduce((total, registration) => total + (registration.addons ?? 0), 0),
    highHandEntrants: highHandEntrantsOf(tournament, registrations),
  };
}

const RECORDED_PRICES = [
  { field: "rebuyAmount", count: "rebuys", one: "re-buy", many: "re-buys" },
  { field: "addonAmount", count: "addons", one: "add-on", many: "add-ons" },
] as const;

/**
 * The re-buy and add-on prices an edit's `changes` clear (empty or $0) while entries are recorded at
 * them, each with what to say on its box: the form refuses them before the server does
 * (REBUYS_RECORDED, ADDONS_RECORDED). A price the edit leaves alone is never refused.
 */
export function clearedRecordedPrices(
  changes: Partial<Pick<TournamentConfig, "rebuyAmount" | "addonAmount">>,
  recorded: RecordedEntries,
): { field: "rebuyAmount" | "addonAmount"; message: string }[] {
  const cleared = RECORDED_PRICES.filter(({ field, count }) => field in changes && recorded[count] > 0 && toCents(changes[field]) === 0);
  return cleared.map(({ field, count, one, many }) => ({
    field,
    message: `${plural(recorded[count], one, many)} ${recorded[count] === 1 ? "is" : "are"} recorded: enter the ${one} price. To stop taking more, lock the prize pool.`,
  }));
}

export const NEW_TOURNAMENT_VALUES: TournamentFormValues = {
  name: "",
  description: "",
  imageUrl: null,
  clubId: "",
  seasonId: "",
  pointsSystemId: "",
  startDateTime: "",
  buyInAmount: "",
  bountyAmount: "",
  rakeType: "none",
  rakeAmount: "",
  enableRebuys: false,
  rebuyAmount: "",
  maxRebuys: "",
  rebuyPeriodMinutes: "60",
  rebuyRakeType: "none",
  rebuyRakeAmount: "",
  enableAddons: false,
  addonAmount: "",
  maxAddons: "",
  rebuyOrAddon: false,
  addonRakeType: "none",
  addonRakeAmount: "",
  payoutStructure: "standard",
  highHands: [],
  enableLateRegistration: false,
  trackPoints: true,
  minPlayers: "8",
  maxPlayers: "",
  seatsPerTable: "",
  useClubAddress: true,
  address: "",
  showBankTransfer: false,
};

/**
 * The club a new tournament starts in: the one a club page's link named, when the viewer runs it, else
 * the viewer's only club (most owners run one: nothing to choose), else none. Create Season picks
 * its club by the same rule (P3REV6-CQ-03).
 */
export function startingClubId(choices: readonly Pick<ClubDto, "id">[], clubId: string | undefined): string {
  const named = choices.find((club) => club.id === clubId);
  if (named) return named.id;
  return choices.length === 1 ? choices[0].id : "";
}

/** A stored payout structure the form offers; anything older reads as Standard, which is what it pays. */
function payoutStructure(value: string): PayoutStructureKey {
  return (PAYOUT_STRUCTURE_KEYS as readonly string[]).includes(value) ? (value as PayoutStructureKey) : "standard";
}

const text = (value: string | number | null | undefined) => (value === null || value === undefined ? "" : String(value));

/** The form as a tournament stands, its start on the club's wall clock (`timeZone`): what an edit starts from. */
export function formValuesFromTournament(tournament: PublicTournament, timeZone: string): TournamentFormValues {
  const rate = (type: string | null | undefined, amount: string | null | undefined) => {
    const kind = rakeTypeOf(type);
    return { type: kind, amount: rateAmountText(kind, amount) };
  };
  const buyIn = rate(tournament.rakeType, tournament.rakeAmount);
  const rebuy = rate(tournament.rebuyRakeType, tournament.rebuyRakeAmount);
  const addon = rate(tournament.addonRakeType, tournament.addonRakeAmount);
  return {
    name: tournament.name,
    description: text(tournament.description),
    imageUrl: tournament.imageUrl,
    clubId: tournament.clubId,
    seasonId: text(tournament.seasonId),
    pointsSystemId: text(tournament.pointsSystemId),
    startDateTime: toZonedDateTimeLocal(tournament.startDateTime, timeZone),
    buyInAmount: tournament.buyInAmount,
    bountyAmount: hasBounty(tournament) ? text(tournament.bountyAmount) : "",
    rakeType: buyIn.type,
    rakeAmount: buyIn.amount,
    enableRebuys: offersRebuys(tournament),
    rebuyAmount: text(tournament.rebuyAmount),
    maxRebuys: text(tournament.maxRebuys),
    rebuyPeriodMinutes: text(tournament.rebuyPeriodMinutes),
    rebuyRakeType: rebuy.type,
    rebuyRakeAmount: rebuy.amount,
    enableAddons: offersAddons(tournament),
    addonAmount: text(tournament.addonAmount),
    maxAddons: text(tournament.maxAddons),
    rebuyOrAddon: tournament.rebuyOrAddon === true,
    addonRakeType: addon.type,
    addonRakeAmount: addon.amount,
    payoutStructure: payoutStructure(tournament.payoutStructure),
    highHands: highHandFormValues(tournament),
    enableLateRegistration: tournament.enableLateRegistration === true,
    trackPoints: tournament.trackPoints !== false,
    minPlayers: text(tournament.minPlayers),
    maxPlayers: text(tournament.maxPlayers),
    seatsPerTable: text(tournament.seatsPerTable),
    useClubAddress: tournament.useClubAddress !== false,
    address: text(tournament.address),
    showBankTransfer: tournament.showBankTransfer === true,
  };
}
