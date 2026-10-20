import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { registrationDto } from "@test/helpers/f2-public";
import { StandingsTable } from "./standings-table";

const players = [
  registrationDto("r1", "Aroha Ngata", { knockouts: 2 }),
  registrationDto("r2", "Finn O'Connor", { isEliminated: true, eliminationTime: "2026-10-23T08:00:00.000Z" }),
];

describe("StandingsTable on a phone (lead visual review: Knockouts ran off a 375 px screen)", () => {
  it("keeps only Place, Player and Prize as columns: status, knockouts and points sit under each name", () => {
    render(<StandingsTable registrations={players} completed={false} trackPoints />);

    const table = screen.getByRole("table");
    // The wide-screen columns...
    for (const name of ["Status", "Knockouts", "Points"]) {
      expect(within(table).getByRole("columnheader", { name })).toHaveClass("hidden", "md:table-cell");
    }
    for (const name of ["Place", "Player", "Prize"]) {
      expect(within(table).getByRole("columnheader", { name })).not.toHaveClass("hidden");
    }
    // ...and the line under each name that says the same on a phone.
    const aroha = within(screen.getByTestId("standing-player-r1")).getByTestId("standing-summary");
    expect(aroha).toHaveClass("md:hidden");
    expect(aroha).toHaveTextContent("Active");
    expect(aroha).toHaveTextContent("2 knockouts");
    const finn = within(screen.getByTestId("standing-player-r2")).getByTestId("standing-summary");
    expect(finn).toHaveTextContent("Eliminated");
    // No knockouts, and no points while the game is on: nothing more to say.
    expect(finn).not.toHaveTextContent(/knockout|pts/);
  });

  it("gives each finisher's points under their name once the tournament is over", () => {
    render(
      <StandingsTable
        registrations={[registrationDto("r1", "Aroha Ngata", { finalPosition: 1, pointsAwarded: 120, knockouts: 1 })]}
        completed
        trackPoints
      />,
    );

    const summary = within(screen.getByTestId("standing-player-r1")).getByTestId("standing-summary");
    expect(summary).toHaveTextContent("1st");
    expect(summary).toHaveTextContent("1 knockout");
    expect(summary).toHaveTextContent("120 pts");
  });
});
