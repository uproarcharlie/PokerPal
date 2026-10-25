/**
 * The tournament form's "Seats per table" (round 5, item 12): blank follows the club's default (sent as
 * null), a number from 2 to 10 is the tournament's own, and an edit sends it only when it changed.
 */
import { describe, expect, it } from "vitest";
import { tournamentDto } from "@test/helpers/dto";
import { changedConfig, formValuesFromTournament, NEW_TOURNAMENT_VALUES, tournamentConfig, tournamentFormSchema, type TournamentFormValues } from "@/features/tournaments/tournament-form";

const filled: TournamentFormValues = {
  ...NEW_TOURNAMENT_VALUES,
  name: "Thursday Deepstack",
  clubId: "c1",
  startDateTime: "2026-10-24T19:30",
  buyInAmount: "50",
  maxPlayers: "30",
};

const configOf = (values: TournamentFormValues) => {
  const result = tournamentFormSchema.safeParse(values);
  if (!result.success) throw new Error(JSON.stringify(result.error.issues));
  return tournamentConfig(result.data);
};

describe("Seats per table on the tournament form", () => {
  it("sends blank as the club's default (null), and a number as the tournament's own", () => {
    expect(configOf(filled).seatsPerTable).toBeNull();
    expect(configOf({ ...filled, seatsPerTable: "6" }).seatsPerTable).toBe(6);
  });

  it("refuses a table of fewer than 2 or more than 10 seats", () => {
    expect(tournamentFormSchema.safeParse({ ...filled, seatsPerTable: "11" }).success).toBe(false);
    expect(tournamentFormSchema.safeParse({ ...filled, seatsPerTable: "1" }).success).toBe(false);
  });

  it("starts an edit from the tournament's own seats, and sends them only when changed", () => {
    const initial = formValuesFromTournament(tournamentDto({ seatsPerTable: 8, maxPlayers: 30 }), "Pacific/Auckland");
    expect(initial.seatsPerTable).toBe("8");
    expect(changedConfig(configOf({ ...initial }), configOf({ ...initial, seatsPerTable: "8" }))).toEqual({});
    expect(changedConfig(configOf({ ...initial }), configOf({ ...initial, seatsPerTable: "" }))).toEqual({ seatsPerTable: null });
  });
});
