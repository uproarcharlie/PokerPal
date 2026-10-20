import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { LeaderboardEntryDto } from "@shared/api/seasons";
import { SeasonLeaderboardTable } from "./season-leaderboard-table";

const entry = (rank: number, name: string, points: number, tournaments: number) =>
  ({ rank, player: { id: `p-${rank}`, name, imageUrl: null }, points, tournaments }) satisfies LeaderboardEntryDto;

describe("SeasonLeaderboardTable (MA-05)", () => {
  it("keeps the points beside each player on a phone: the tournaments count moves under the name", () => {
    render(<SeasonLeaderboardTable entries={[entry(1, "Ava Ngata", 1250, 3), entry(4, "Dee Moana", 10, 1)]} seasonName="Summer" />);

    const table = screen.getByRole("table", { name: "Summer leaderboard" });
    // The Tournaments column is for wider screens only...
    expect(within(table).getByRole("columnheader", { name: "Tournaments" })).toHaveClass("hidden", "sm:table-cell");
    // ...and on a phone each player's line says it, so only Rank, Player and Points take the width.
    const ava = within(table).getByTestId("leaderboard-row-p-1");
    expect(within(ava).getByText("3 tournaments")).toHaveClass("sm:hidden");
    expect(within(ava).getByText("1,250")).toBeInTheDocument();
    expect(within(within(table).getByTestId("leaderboard-row-p-4")).getByText("1 tournament")).toBeInTheDocument();
  });
});
