import { describe, expect, it } from "vitest";
import { tournamentDto } from "@test/helpers/f1-tournaments";
import { formErrorMap } from "@/lib/forms";
import {
  changedConfig,
  clearedRecordedPrices,
  formValuesFromTournament,
  inClubZone,
  NEW_TOURNAMENT_VALUES,
  recordedEntries,
  tournamentConfig,
  tournamentFormSchema,
  type TournamentFormValues,
} from "./tournament-form";

const filled: TournamentFormValues = {
  ...NEW_TOURNAMENT_VALUES,
  name: "Thursday Deepstack",
  clubId: "c1",
  startDateTime: "2026-10-24T19:30",
  buyInAmount: "50",
  maxPlayers: "30",
};

const parse = (values: TournamentFormValues) => tournamentFormSchema.safeParse(values, { errorMap: formErrorMap });

function errorsOf(values: TournamentFormValues): Record<string, string> {
  const result = parse(values);
  if (result.success) return {};
  return Object.fromEntries(result.error.issues.map((issue) => [issue.path.join("."), issue.message]));
}

const ZONE = "Pacific/Auckland";

function configOf(values: TournamentFormValues, timeZone = ZONE) {
  const result = parse(inClubZone(values, timeZone));
  if (!result.success) throw new Error(JSON.stringify(result.error.issues));
  return tournamentConfig(result.data);
}

describe("tournamentFormSchema", () => {
  it("sends what the shared create schema stores: numbers as numbers, amounts as decimal text, blanks as nothing", () => {
    const config = configOf({ ...filled, minPlayers: "4", seasonId: "", description: "  " });

    expect(config).toMatchObject({
      name: "Thursday Deepstack",
      clubId: "c1",
      buyInAmount: "50.00",
      maxPlayers: 30,
      minPlayers: 4,
      highHandPayouts: 1,
      seasonId: null,
      pointsSystemId: null,
      description: null,
      rakeType: "none",
      rakeAmount: null,
      payoutStructure: "standard",
    });
    // 7:30 pm in the club's zone (NZDT, UTC+13), whatever zone the test machine is in.
    expect(config.startDateTime).toEqual(new Date("2026-10-24T06:30:00.000Z"));
    expect(config).not.toHaveProperty("enableRebuys");
  });

  it("names every missing required field", () => {
    expect(errorsOf(NEW_TOURNAMENT_VALUES)).toMatchObject({
      name: "Required",
      clubId: "Choose a club",
      startDateTime: "Choose the start date and time",
      buyInAmount: "Enter an amount of 0 or more, with at most 2 decimal places",
      maxPlayers: "Required",
    });
  });

  it("words a number that is not a whole number, or out of range, for people", () => {
    expect(errorsOf({ ...filled, maxPlayers: "lots" })).toEqual({ maxPlayers: "Must be a whole number" });
    expect(errorsOf({ ...filled, maxPlayers: "1" })).toEqual({ maxPlayers: "Must be 2 or more" });
    expect(errorsOf({ ...filled, enableHighHand: true, highHandAmount: "5", highHandPayouts: "2.5" })).toEqual({ highHandPayouts: "Must be a whole number" });
  });

  it("checks each AP rate the way the server does, on the amount field", () => {
    expect(errorsOf({ ...filled, rakeType: "percentage", rakeAmount: "" })).toEqual({ rakeAmount: "Enter an amount for that rate" });
    expect(errorsOf({ ...filled, rakeType: "percentage", rakeAmount: "120" })).toEqual({ rakeAmount: "A percentage cannot be over 100" });
    expect(errorsOf({ ...filled, enableRebuys: true, rebuyAmount: "25", rebuyRakeType: "fixed", rebuyRakeAmount: "" })).toEqual({
      rebuyRakeAmount: "Enter an amount for that rate",
    });
  });

  it("refuses a fixed rate above the price it is taken from, on its box, as the server would (R4-CQ-07)", () => {
    expect(errorsOf({ ...filled, enableRebuys: true, rebuyAmount: "25", rebuyRakeType: "fixed", rebuyRakeAmount: "30" })).toEqual({
      rebuyRakeAmount: "$30 per re-buy is more than a re-buy costs ($25): the prize pool would go below zero",
    });
    expect(errorsOf({ ...filled, enableRebuys: true, rebuyAmount: "25", rebuyRakeType: "fixed", rebuyRakeAmount: "25" })).toEqual({});
  });

  it("does not check or send the rate of a part the tournament does not have", () => {
    const values = { ...filled, enableRebuys: false, rebuyAmount: "25", rebuyRakeType: "percentage" as const, rebuyRakeAmount: "" };

    expect(errorsOf(values)).toEqual({});
    expect(configOf(values)).toMatchObject({ rebuyAmount: null, maxRebuys: null, rebuyPeriodMinutes: null, rebuyRakeType: "none", rebuyRakeAmount: null });
  });
});

describe("house rules (TDN4-HOUSE-RULES-UNSET)", () => {
  const both = { ...filled, enableRebuys: true, rebuyAmount: "25", maxRebuys: "1", enableAddons: true, addonAmount: "25" };

  it("sends the add-ons per player and re-buys OR add-ons while the tournament sells both", () => {
    expect(configOf({ ...both, maxAddons: "1", rebuyOrAddon: true })).toMatchObject({ maxRebuys: 1, maxAddons: 1, rebuyOrAddon: true });
    expect(configOf({ ...both, maxAddons: "" })).toMatchObject({ maxAddons: null, rebuyOrAddon: false });
    expect(errorsOf({ ...both, maxAddons: "one" })).toEqual({ maxAddons: "Must be a whole number" });
  });

  it("clears them with the part they belong to", () => {
    expect(configOf({ ...both, enableAddons: false, maxAddons: "1", rebuyOrAddon: true })).toMatchObject({ maxAddons: null, rebuyOrAddon: null });
    expect(configOf({ ...both, enableRebuys: false, maxAddons: "1", rebuyOrAddon: true })).toMatchObject({ maxAddons: 1, rebuyOrAddon: null });
  });

  it("opens an edit on the rules stored, and an untouched form changes none of them", () => {
    const stored = tournamentDto({ rebuyAmount: "25.00", maxRebuys: 1, addonAmount: "25.00", maxAddons: 1, rebuyOrAddon: true });
    const values = formValuesFromTournament(stored, ZONE);
    expect(values).toMatchObject({ maxAddons: "1", rebuyOrAddon: true });
    expect(changedConfig(configOf(values), configOf(values))).toEqual({});
    expect(changedConfig(configOf(values), configOf({ ...values, rebuyOrAddon: false }))).toEqual({ rebuyOrAddon: false });
    expect(formValuesFromTournament(tournamentDto({ maxAddons: null, rebuyOrAddon: null }), ZONE)).toMatchObject({ maxAddons: "", rebuyOrAddon: false });
  });
});

describe("tournamentConfig (CA-15)", () => {
  it("never stores a re-buy, add-on or high-hand price typed before its switch was turned off", () => {
    const config = configOf({
      ...filled,
      rebuyAmount: "25",
      maxRebuys: "2",
      addonAmount: "20",
      addonRakeType: "fixed",
      addonRakeAmount: "2",
      highHandAmount: "10",
      highHandRakeType: "percentage",
      highHandRakeAmount: "10",
    });

    expect(config).toMatchObject({
      rebuyAmount: null,
      maxRebuys: null,
      addonAmount: null,
      addonRakeType: "none",
      addonRakeAmount: null,
      highHandAmount: null,
      highHandRakeType: "none",
      highHandRakeAmount: null,
    });
  });

  it("keeps them while their switch is on", () => {
    const config = configOf({
      ...filled,
      enableRebuys: true,
      rebuyAmount: "25",
      maxRebuys: "2",
      rebuyRakeType: "percentage",
      rebuyRakeAmount: "10",
      enableHighHand: true,
      highHandAmount: "10",
      highHandPayouts: "3",
    });

    expect(config).toMatchObject({
      rebuyAmount: "25.00",
      maxRebuys: 2,
      rebuyPeriodMinutes: 60,
      rebuyRakeType: "percentage",
      rebuyRakeAmount: "10.00",
      highHandAmount: "10.00",
      highHandPayouts: 3,
    });
  });
});

describe("an edit", () => {
  const stored = tournamentDto({
    status: "registration",
    rebuyAmount: "25.00",
    maxRebuys: 2,
    rebuyPeriodMinutes: 60,
    rebuyRakeType: "percentage",
    rebuyRakeAmount: "10.00",
    startDateTime: "2026-10-24T06:30:45.000Z",
  });
  const initial = formValuesFromTournament(stored, ZONE);

  it("starts from the tournament as stored, and an untouched form changes nothing", () => {
    expect(initial).toMatchObject({ enableRebuys: true, rebuyAmount: "25.00", maxRebuys: "2", rakeType: "fixed", rakeAmount: "5.00", maxPlayers: "20" });
    expect(changedConfig(configOf(initial), configOf(initial))).toEqual({});
  });

  it("sends only what was changed", () => {
    expect(changedConfig(configOf(initial), configOf({ ...initial, name: "Renamed", maxPlayers: "40" }))).toEqual({ name: "Renamed", maxPlayers: 40 });
  });

  it("sends a rate's type and amount together, as the server needs a new type's amount", () => {
    const changes = changedConfig(configOf(initial), configOf({ ...initial, rakeType: "percentage", rakeAmount: "5.00" }));

    expect(changes).toEqual({ rakeType: "percentage", rakeAmount: "5.00" });
  });

  it("turning re-buys off clears the price, the limit and the rate", () => {
    expect(changedConfig(configOf(initial), configOf({ ...initial, enableRebuys: false }))).toEqual({
      rebuyAmount: null,
      maxRebuys: null,
      rebuyPeriodMinutes: null,
      rebuyRakeType: "none",
      rebuyRakeAmount: null,
    });
  });

  it("reads a stored rate of none without an amount, and an unknown payout structure as Standard", () => {
    const values = formValuesFromTournament(tournamentDto({ rakeType: "none", rakeAmount: "0.00", payoutStructure: "legacy" }), ZONE);

    expect(values).toMatchObject({ rakeType: "none", rakeAmount: "", payoutStructure: "standard" });
  });
});

describe("the start time, in the club's zone (P3REV-PARITY-TZ-01)", () => {
  it("opens an edit on the time the page shows, in the club's zone, and reads it back the same", () => {
    const stored = tournamentDto({ startDateTime: "2026-10-24T06:30:45.000Z" });

    expect(formValuesFromTournament(stored, "Pacific/Auckland").startDateTime).toBe("2026-10-24T19:30");
    expect(formValuesFromTournament(stored, "Australia/Sydney").startDateTime).toBe("2026-10-24T17:30");
    expect(formValuesFromTournament(tournamentDto({ startDateTime: "not a date" }), ZONE).startDateTime).toBe("");
  });

  it("sends a typed start as that time in the club's zone, not the device's", () => {
    expect(configOf(filled, "Pacific/Auckland").startDateTime).toEqual(new Date("2026-10-24T06:30:00.000Z"));
    expect(configOf(filled, "Australia/Sydney").startDateTime).toEqual(new Date("2026-10-24T08:30:00.000Z"));
  });

  it("leaves a start it cannot read for the schema to refuse", () => {
    expect(inClubZone({ ...filled, startDateTime: "" }, ZONE).startDateTime).toBe("");
    expect(errorsOf(inClubZone({ ...filled, startDateTime: "" }, ZONE))).toMatchObject({ startDateTime: "Choose the start date and time" });
  });
});

describe("a part priced at $0 (P3REV5-CQ-02)", () => {
  it("opens with its switch off, as players and the server see it: no re-buys, no add-ons", () => {
    const initial = formValuesFromTournament(tournamentDto({ rebuyAmount: "0.00", addonAmount: "0.00" }), ZONE);

    expect(initial).toMatchObject({ enableRebuys: false, enableAddons: false });
    expect(changedConfig(configOf(initial), configOf(initial))).toEqual({});
  });

  it("is refused while its switch is on, with what to do instead", () => {
    expect(errorsOf({ ...filled, enableRebuys: true, rebuyAmount: "0" })).toEqual({ rebuyAmount: "Enter a re-buy price above $0, or switch re-buys off" });
    expect(errorsOf({ ...filled, enableAddons: true, addonAmount: "0.00" })).toEqual({ addonAmount: "Enter an add-on price above $0, or switch add-ons off" });
    expect(errorsOf({ ...filled, enableRebuys: true, rebuyAmount: "20" })).toEqual({});
  });

  it("refuses a high hand switched on with no price or $0, and opens a stored one with its switch off (P3REV3-CQ-03)", () => {
    const refusal = { highHandAmount: "Enter a high-hand price above $0, or switch high hands off" };
    expect(errorsOf({ ...filled, enableHighHand: true, highHandAmount: "" })).toEqual(refusal);
    expect(errorsOf({ ...filled, enableHighHand: true, highHandAmount: "0" })).toEqual(refusal);
    expect(errorsOf({ ...filled, enableHighHand: true, highHandAmount: "5" })).toEqual({});
    expect(errorsOf({ ...filled, enableHighHand: false, highHandAmount: "" })).toEqual({});

    expect(formValuesFromTournament(tournamentDto({ enableHighHand: true, highHandAmount: null }), ZONE).enableHighHand).toBe(false);
    expect(formValuesFromTournament(tournamentDto({ enableHighHand: true, highHandAmount: "5.00" }), ZONE).enableHighHand).toBe(true);
  });
});

describe("entries already recorded (P3REV0-PARITY-EDIT-REPRICE)", () => {
  it("counts the players' re-buys, add-ons and high-hand entries", () => {
    const recorded = recordedEntries([
      { rebuys: 2, addons: 1, enteringHighHands: true },
      { rebuys: null, addons: 0, enteringHighHands: false },
      { rebuys: 1, addons: null, enteringHighHands: null },
    ]);
    expect(recorded).toEqual({ rebuys: 3, addons: 1, highHandEntrants: 1 });
  });

  it("refuses an edit that clears a price entries are recorded at, and nothing else", () => {
    const recorded = { rebuys: 3, addons: 1, highHandEntrants: 0 };
    expect(clearedRecordedPrices({ rebuyAmount: null }, recorded)).toEqual([
      { field: "rebuyAmount", message: "3 re-buys are recorded: enter the re-buy price. To stop taking more, lock the prize pool." },
    ]);
    expect(clearedRecordedPrices({ addonAmount: "0.00" }, recorded)).toEqual([
      { field: "addonAmount", message: "1 add-on is recorded: enter the add-on price. To stop taking more, lock the prize pool." },
    ]);
    // A new price is a re-price, which the server asks the TD to confirm; a price left alone is never refused.
    expect(clearedRecordedPrices({ rebuyAmount: "20.00" }, recorded)).toEqual([]);
    expect(clearedRecordedPrices({}, recorded)).toEqual([]);
    expect(clearedRecordedPrices({ rebuyAmount: null, addonAmount: null }, { rebuys: 0, addons: 0, highHandEntrants: 0 })).toEqual([]);
  });
});
