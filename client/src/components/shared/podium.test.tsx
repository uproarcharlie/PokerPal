import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PAYOUT_STRUCTURES } from "@shared/domain/payouts";
import { undistributedNote, unfilledPlacesNote } from "@/lib/prize-pool";
import { PlaceBadge, PlaceName, PODIUM, StandingStatus } from "./podium";

describe("the podium (P3REV5-CQ-09)", () => {
  it("draws the top three places in the same accent fills as the leaderboards' rank badges", () => {
    render(
      <>
        <PlaceName place={1} />
        <PlaceName place={4} suffix="Place" />
      </>,
    );

    expect(screen.getByText("1st").firstElementChild).toHaveClass(...PODIUM[1].split(" "));
    expect(screen.getByText("4th Place").children).toHaveLength(0);
  });
});

describe("undistributedNote (P3REV5-CQ-09)", () => {
  it("words what a pool paid before round 7 left unpaid, once for every screen", () => {
    expect(undistributedNote({ undistributedCents: 2000 })).toBe("$20 of the pool was not paid out: there were fewer players than paid places.");
    expect(undistributedNote({ undistributedCents: 0 })).toBeNull();
  });
});

describe("unfilledPlacesNote (R7FREV0-MONEY-01)", () => {
  // $180 for prizes on Standard: 1st $90, 2nd $54, 3rd $36.
  const pool = (paid: number) => ({
    manualPrizePool: null,
    netAfterAp: 18_000,
    structure: { requested: "standard", used: "standard" as const, basisPoints: PAYOUT_STRUCTURES.standard },
    counts: { registrations: paid, buyIns: paid, rebuys: 0, addons: 0, highHandEntrants: 0, freeEntries: 0, fundedFreeEntries: 0, freeBuyIns: 0, fundedBuyIns: 0 },
  });

  it("tells the staff what the places with no player in the pool would pay goes to the club's fee", () => {
    expect(unfilledPlacesNote(pool(2), { paid: 2, field: 2 }, "AP")).toBe(
      "Only 2 players: places below 2nd are not paid, so the $36 they would pay goes to AP unless more players enter.",
    );
    expect(unfilledPlacesNote(pool(1), { paid: 1, field: 1 }, "Rake")).toBe(
      "Only 1 player: places below 1st are not paid, so the $90 they would pay goes to Rake unless more players enter.",
    );
  });

  it("counts the paid players while some of the field has not paid: the money comes with the payments (R6REV0-MONEY-02)", () => {
    expect(unfilledPlacesNote(pool(2), { paid: 2, field: 12 }, "AP")).toBe(
      "Only 2 paid players: places below 2nd are not paid, so the $36 they would pay goes to AP until more payments are confirmed.",
    );
  });

  it("says nothing while every place has a player, or nobody is in the pool yet", () => {
    expect(unfilledPlacesNote(pool(3), { paid: 3, field: 3 }, "AP")).toBeNull();
    expect(unfilledPlacesNote(pool(9), { paid: 9, field: 9 }, "AP")).toBeNull();
    expect(unfilledPlacesNote(pool(0), { paid: 0, field: 4 }, "AP")).toBeNull();
  });
});

describe("PlaceBadge (P3REV3-CQ-09)", () => {
  it("draws 1st to 3rd in the podium's colours, a player still in in the live colour, the rest muted", () => {
    render(
      <>
        {[1, 2, 3, 4].map((place) => (
          <PlaceBadge key={place} place={place} />
        ))}
        <PlaceBadge place={null} />
        <PlaceBadge place={null} finished />
      </>,
    );
    const [first, second, third, fourth, stillIn, noPlace] = screen.getAllByTestId("place-badge");

    expect(first).toHaveClass(...PODIUM[1].split(" "));
    expect(second).toHaveClass(...PODIUM[2].split(" "));
    expect(third).toHaveClass(...PODIUM[3].split(" "));
    expect(fourth).toHaveClass("bg-muted");
    expect(stillIn).toHaveClass("bg-status-live");
    expect(stillIn).toHaveTextContent("Still in");
    expect(noPlace).toHaveClass("bg-muted");
    expect(noPlace).toHaveTextContent("No place");
  });
});

describe("StandingStatus (P3REV3-CQ-09)", () => {
  it("says the place once the tournament is over, never Active for the winner, and in or out before", () => {
    const { rerender } = render(<StandingStatus place={1} eliminated={false} completed />);
    expect(screen.getByText("1st")).toBeInTheDocument();

    rerender(<StandingStatus place={null} eliminated={false} completed />);
    expect(screen.getByText("Finished")).toBeInTheDocument();

    rerender(<StandingStatus place={7} eliminated completed={false} />);
    expect(screen.getByText("Eliminated")).toHaveClass("text-destructive");

    rerender(<StandingStatus place={null} eliminated={false} completed={false} />);
    expect(screen.getByText("Active")).toHaveClass("bg-status-live");
  });
});
