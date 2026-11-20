import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { tournamentItem } from "@test/helpers/f3-clubs";
import { screenWidth } from "@test/helpers/f1-tournaments";
import { mockSignedOut, renderWithApp } from "@test/helpers/web";
import { PublicTournamentCard } from "./public-tournament-card";

beforeEach(() => {
  screenWidth(390);
  mockSignedOut();
});

describe("PublicTournamentCard: the price (round 11, on a phone)", () => {
  it("shows a bounty game's buy-in with its bounty", () => {
    renderWithApp(<PublicTournamentCard tournament={tournamentItem({ buyInAmount: "50.00", bountyAmount: "100.00" })} timeZone="Pacific/Auckland" />);

    expect(screen.getByText(/^Buy-in:/)).toHaveTextContent(/^Buy-in: \$50\.00 \+ \$100\.00 bounty$/);
  });

  it("shows the buy-in alone in a game with no bounty", () => {
    renderWithApp(<PublicTournamentCard tournament={tournamentItem({ buyInAmount: "50.00", bountyAmount: null })} timeZone="Pacific/Auckland" />);

    expect(screen.getByText(/^Buy-in:/)).toHaveTextContent(/^Buy-in: \$50\.00$/);
    expect(screen.queryByText(/bounty/)).not.toBeInTheDocument();
  });
});
