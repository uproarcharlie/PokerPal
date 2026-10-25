/**
 * The tournament form (create and edit): its values, the schema that checks them (the shared
 * `createTournamentSchema`, fed numbers from text boxes, plus the form's own switches), and the
 * request bodies built from them. Pure, so every rule is unit-tested.
 */
import { z } from "zod";
import { RAKE_TYPES, type RakeType } from "@shared/api/common";
import type { ClubDto, PublicRegistration, PublicTournament } from "@shared/api/public";
import { createTournamentSchema, type CreateTournamentInput, type UpdateTournamentInput } from "@shared/api/tournaments";
import { centsToDecimalString, isAmountSet, toBasisPoints, toCents, type MoneyInput } from "@shared/domain/money";
import { offersAddons, offersHighHand, offersRebuys } from "@shared/domain/player-actions";
import { PAYOUT_STRUCTURE_KEYS, type PayoutStructureKey } from "@shared/domain/payouts";
import { mergeRakeRates, RAKE_COMPONENTS, rateOverPrice, rateOverPriceMessage, type RakeRatesProblem } from "@shared/domain/rake-rates";
import { fromZonedDateTimeLocal, plural, toZonedDateTimeLocal } from "@/lib/format";
import { typedNumber } from "@/lib/forms";

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
  enableHighHand: boolean;
  highHandAmount: string;
  highHandPayouts: string;
  highHandRakeType: RakeType;
  highHandRakeAmount: string;
  enableLateRegistration: boolean;
  trackPoints: boolean;
  minPlayers: string;
  maxPlayers: string;
  useClubAddress: boolean;
  address: string;
}

/** The settings a tournament is created with, before it is given a status. */
export type TournamentConfig = Omit<CreateTournamentInput, "status">;

const shape = createTournamentSchema.shape;

/** What a rate's box says when mergeRakeRates refuses it: one wording for the tournament form and the AP rates sheet. */
export const RATE_MESSAGES: Readonly<Record<RakeRatesProblem["code"], string>> = {
  AMOUNT_REQUIRED: "Enter an amount for that rate",
  PERCENT_OVER_100: "A percentage cannot be over 100",
};

/**
 * The form's values, checked by the shared request schema. A rate is checked as the server checks it
 * (mergeRakeRates, then rateOverPrice: a fixed rate above the price it is taken from), but only for
 * the parts the tournament has: a re-buy rate typed before re-buys were switched off is not sent, so
 * it is not checked either.
 */
export const tournamentFormSchema = createTournamentSchema
  .omit({ status: true })
  .extend({
    clubId: z.string().trim().min(1, "Choose a club").pipe(shape.clubId),
    startDateTime: z.string().trim().min(1, "Choose the start date and time").pipe(shape.startDateTime),
    maxRebuys: typedNumber(shape.maxRebuys),
    maxAddons: typedNumber(shape.maxAddons),
    rebuyPeriodMinutes: typedNumber(shape.rebuyPeriodMinutes),
    highHandPayouts: typedNumber(shape.highHandPayouts),
    minPlayers: typedNumber(shape.minPlayers),
    maxPlayers: typedNumber(shape.maxPlayers),
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
    // A high hand switched on with no price, or $0, is no high hand either (offersHighHand): every screen
    // would leave it out, while the TD thought players were offered one (P3REV3-CQ-03).
    if (values.enableHighHand && !offersHighHand(values)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["highHandAmount"], message: "Enter a high-hand price above $0, or switch high hands off" });
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
 * "Re-buys OR add-ons" means something only while the tournament sells both.
 */
export function tournamentConfig(values: TournamentFormOutput): TournamentConfig {
  const { enableRebuys, enableAddons, ...config } = values;
  const result: TournamentConfig = { ...config };
  if (!enableRebuys) {
    Object.assign(result, { rebuyAmount: null, maxRebuys: null, rebuyPeriodMinutes: null, rebuyRakeType: "none" });
  }
  if (!enableAddons) Object.assign(result, { addonAmount: null, maxAddons: null, addonRakeType: "none" });
  if (!enableRebuys || !enableAddons) result.rebuyOrAddon = null;
  if (!config.enableHighHand) Object.assign(result, { highHandAmount: null, highHandRakeType: "none" });
  for (const { type, amount } of RAKE_COMPONENTS) {
    if ((result[type] ?? "none") === "none") result[amount] = null;
  }
  return result;
}

const sameValue = (a: unknown, b: unknown) =>
  a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;

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
  for (const { type, amount } of RAKE_COMPONENTS) {
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
 * empty: those entries would silently count as $0 (P3REV0-PARITY-EDIT-REPRICE).
 */
export interface RecordedEntries {
  rebuys: number;
  addons: number;
  highHandEntrants: number;
}

type RecordedFields = Pick<PublicRegistration, "rebuys" | "addons" | "enteringHighHands">;

export function recordedEntries(registrations: readonly RecordedFields[]): RecordedEntries {
  return registrations.reduce<RecordedEntries>(
    (total, registration) => ({
      rebuys: total.rebuys + (registration.rebuys ?? 0),
      addons: total.addons + (registration.addons ?? 0),
      highHandEntrants: total.highHandEntrants + (registration.enteringHighHands === true ? 1 : 0),
    }),
    { rebuys: 0, addons: 0, highHandEntrants: 0 },
  );
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
  enableHighHand: false,
  highHandAmount: "",
  highHandPayouts: "1",
  highHandRakeType: "none",
  highHandRakeAmount: "",
  enableLateRegistration: false,
  trackPoints: true,
  minPlayers: "8",
  maxPlayers: "",
  useClubAddress: true,
  address: "",
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

/** A stored rate type the forms offer (the tournament form, the AP rates sheet); anything older reads as none. */
export function rakeTypeOf(value: string | null | undefined): RakeType {
  return (RAKE_TYPES as readonly string[]).includes(value ?? "") ? (value as RakeType) : "none";
}

/**
 * A stored rate's amount as every form's box shows it: "10" for 10%, "5.00" for $5, blank for no rate
 * (P4REV4-CQ-03: one rule for the tournament form and the AP rates sheet).
 */
export function rateAmountText(type: RakeType, amount: MoneyInput): string {
  if (type === "none" || !isAmountSet(amount)) return "";
  return type === "percentage" ? String(toBasisPoints(amount) / 100) : centsToDecimalString(toCents(amount));
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
  const highHand = rate(tournament.highHandRakeType, tournament.highHandRakeAmount);
  return {
    name: tournament.name,
    description: text(tournament.description),
    imageUrl: tournament.imageUrl,
    clubId: tournament.clubId,
    seasonId: text(tournament.seasonId),
    pointsSystemId: text(tournament.pointsSystemId),
    startDateTime: toZonedDateTimeLocal(tournament.startDateTime, timeZone),
    buyInAmount: tournament.buyInAmount,
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
    enableHighHand: offersHighHand(tournament),
    highHandAmount: text(tournament.highHandAmount),
    highHandPayouts: text(tournament.highHandPayouts ?? 1),
    highHandRakeType: highHand.type,
    highHandRakeAmount: highHand.amount,
    enableLateRegistration: tournament.enableLateRegistration === true,
    trackPoints: tournament.trackPoints !== false,
    minPlayers: text(tournament.minPlayers),
    maxPlayers: text(tournament.maxPlayers),
    useClubAddress: tournament.useClubAddress !== false,
    address: text(tournament.address),
  };
}
