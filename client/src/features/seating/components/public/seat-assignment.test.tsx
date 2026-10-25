import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { AutoSeatSkip } from "@shared/domain/table-advisor";
import { screenWidth } from "@test/helpers/f1-tournaments";
import { mockSignedOut, renderWithApp } from "@test/helpers/web";
import { seatRef } from "@test/helpers/seating-dto";
import { SeatAssignment } from "./seat-assignment";

describe("SeatAssignment", () => {
  // The page a player sees after the QR sign-up: nobody is signed in.
  beforeEach(() => mockSignedOut());

  it("tells a player auto-seat sat down where they sit, in large type, with the way to the seat finder (390 px)", () => {
    screenWidth(390);
    renderWithApp(<SeatAssignment seating={{ status: "seated", seat: seatRef("tB", 2, 7) }} tournamentId="t1" />);

    const seat = screen.getByRole("region", { name: "Your seat" });
    expect(seat).toHaveTextContent("You're at Table 2, Seat 7");
    expect(screen.getByRole("link", { name: "Find your seat" })).toHaveAttribute("href", "/tournament/t1/seats");
  });

  it("names a table by its name", () => {
    renderWithApp(<SeatAssignment seating={{ status: "seated", seat: seatRef("tF", 5, 2, "Feature table") }} tournamentId="t1" />);

    expect(screen.getByRole("region", { name: "Your seat" })).toHaveTextContent("You're at Feature table, Seat 2");
  });

  it.each<[AutoSeatSkip, string, boolean]>([
    ["tables_full", "Every table is full right now: you're seated as soon as the next table opens.", true],
    ["no_tables", "Seats haven't been drawn yet.", true],
    ["awaiting_payment", "Your seat is drawn once you've paid at the desk.", false],
    ["off", "Your seat will be called at the desk.", false],
  ])("says why a player is not seated yet (%s)", (reason, says, linksFinder) => {
    renderWithApp(<SeatAssignment seating={{ status: "waiting", reason }} tournamentId="t1" />);

    expect(screen.getByRole("region", { name: "Your seat" })).toHaveTextContent(says);
    expect(screen.queryByRole("link", { name: "Find your seat" }) !== null).toBe(linksFinder);
  });
});
