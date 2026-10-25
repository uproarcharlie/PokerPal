import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { undistributedNote } from "@/lib/prize-pool";
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
  it("words the pool that is not paid out once, for every screen", () => {
    expect(undistributedNote({ source: "live", undistributedCents: 4750 }, { paid: 1, field: 1 })).toBe(
      "Only 1 player: $47.50 of the pool is not paid out unless more players enter.",
    );
    expect(undistributedNote({ source: "snapshot", undistributedCents: 2000 }, { paid: 2, field: 2 })).toBe(
      "$20 of the pool was not paid out: there were fewer players than paid places.",
    );
    expect(undistributedNote({ source: "live", undistributedCents: 0 }, { paid: 9, field: 9 })).toBeNull();
  });

  it("counts the paid players while some of the field has not paid: the money comes with the payments (R6REV0-MONEY-02)", () => {
    // 12 playing, 2 paid, the standard 3 places: 3rd's $40 is not paid out.
    const live = { source: "live", undistributedCents: 4_000 } as const;
    expect(undistributedNote(live, { paid: 2, field: 12 }, "staff")).toBe("Only 2 paid players: $40 of the pool is not paid out until more payments are confirmed.");
    expect(undistributedNote(live, { paid: 2, field: 12 })).toBe("Only 2 paid players: $40 of the pool is not paid out yet.");
    expect(undistributedNote(live, { paid: 1, field: 3 })).toBe("Only 1 paid player: $40 of the pool is not paid out yet.");
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
