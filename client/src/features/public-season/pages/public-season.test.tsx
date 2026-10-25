import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "@test/msw/server";
import { apiError, mockSignedOut, renderWithApp } from "@test/helpers/web";
import { publicSeasonLeaderboardDto } from "@test/helpers/ap-dto";
import type { PublicSeasonLeaderboardDto } from "@shared/api/live-display";
import { isRunning, progressText } from "../components/public/season-header";
import { matchingEntries } from "../components/public/season-standings";
import PublicSeasonPage from "./public-season";

function renderPage(body: PublicSeasonLeaderboardDto | Response = publicSeasonLeaderboardDto()) {
  server.use(http.get("/api/public/seasons/s1/leaderboard", () => (body instanceof Response ? body : HttpResponse.json(body))));
  return renderWithApp(<PublicSeasonPage />, { path: "/season/s1", route: "/season/:seasonId" });
}

const rows = () => screen.getAllByTestId(/^leaderboard-row-/);

beforeEach(() => {
  mockSignedOut();
});

describe("PublicSeasonPage", () => {
  it("shows the club, the season and its standings, after loading", async () => {
    renderPage();

    expect(screen.getByRole("status")).toHaveTextContent("Loading the leaderboard");
    expect(await screen.findByRole("heading", { level: 1, name: "Summer 2026" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Central Stars/ })).toHaveAttribute("href", "/club/central-stars");
    expect(screen.getByText("1 Sept 2026 – 31 Mar 2027")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByTestId("season-progress")).toHaveTextContent("After 5 of 12 tournaments");
    expect(rows()).toHaveLength(4);
    expect(within(rows()[0]).getByText("Ann Smith")).toBeInTheDocument();
    expect(within(rows()[0]).getByText("120")).toBeInTheDocument();
    expect(screen.getByText("Powered by LovePoker.club")).toBeInTheDocument();
  });

  it("keeps the page out of search engines and names the season in the tab", async () => {
    renderPage();
    await screen.findByRole("heading", { level: 1, name: "Summer 2026" });
    expect(document.title).toBe("Summer 2026 leaderboard | LovePoker.club");
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute("content", "noindex");
  });

  it("finds a player by name, any case, keeping the season's ranks", async () => {
    const user = userEvent.setup();
    renderPage();
    const search = await screen.findByRole("searchbox", { name: "Find me" });

    await user.type(search, "CAL");
    expect(rows()).toHaveLength(1);
    expect(within(rows()[0]).getByText("Cal Brown")).toBeInTheDocument();
    // Tied second with Bea: still 2nd, not re-ranked 1st.
    expect(within(rows()[0]).getByText("2")).toBeInTheDocument();
    expect(screen.getByTestId("standings-count")).toHaveTextContent("1 player found of 4");

    await user.clear(search);
    await user.type(search, "zed");
    expect(screen.queryAllByTestId(/^leaderboard-row-/)).toHaveLength(0);
    expect(screen.getByText(/Nobody called .zed. has points yet this season\./)).toBeInTheDocument();
  });

  it("says the standings are final once the season is over", async () => {
    renderPage(publicSeasonLeaderboardDto({ season: { id: "s1", name: "Winter 2026", startDate: "2026-04-01T00:00:00.000Z", endDate: null, isActive: false } }));
    expect(await screen.findByText("Final standings")).toBeInTheDocument();
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
  });

  it("says when no points have been awarded yet", async () => {
    renderPage(publicSeasonLeaderboardDto({ entries: [], tournaments: { completed: 0, total: 3 } }));
    expect(await screen.findByText("No points awarded yet")).toBeInTheDocument();
    expect(screen.getByTestId("season-progress")).toHaveTextContent("After 0 of 3 tournaments");
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("says when the season does not exist", async () => {
    renderPage(apiError(404, "NOT_FOUND", "Season not found"));
    expect(await screen.findByRole("heading", { name: "Season not found" })).toBeInTheDocument();
  });

  it("says when the leaderboard could not be loaded, and loads it on Try again", async () => {
    let calls = 0;
    server.use(
      http.get("/api/public/seasons/s1/leaderboard", () => {
        calls += 1;
        return calls === 1 ? apiError(500, "INTERNAL", "Something went wrong") : HttpResponse.json(publicSeasonLeaderboardDto());
      }),
    );
    const user = userEvent.setup();
    renderWithApp(<PublicSeasonPage />, { path: "/season/s1", route: "/season/:seasonId" });

    expect(await screen.findByRole("alert")).toHaveTextContent("The leaderboard could not be loaded");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Summer 2026" })).toBeInTheDocument();
  });
});

describe("the season page's rules", () => {
  const season = publicSeasonLeaderboardDto().season;

  it("counts a season as running through its last day, by the server's clock", () => {
    const lastDay = Date.parse("2027-03-31T00:00:00.000Z");
    expect(isRunning(season, lastDay + 23 * 60 * 60 * 1000)).toBe(true);
    expect(isRunning(season, lastDay + 24 * 60 * 60 * 1000)).toBe(false);
    expect(isRunning({ ...season, isActive: false }, lastDay - 1)).toBe(false);
    // A season saved without an end before DATA-22 holds the epoch: it has no end.
    expect(isRunning({ ...season, endDate: "1970-01-01T00:00:00.000Z" }, lastDay * 2)).toBe(true);
  });

  it("says how far through the season the standings are", () => {
    expect(progressText({ completed: 5, total: 12 })).toBe("After 5 of 12 tournaments");
    expect(progressText({ completed: 1, total: 1 })).toBe("After 1 of 1 tournament");
    expect(progressText({ completed: 0, total: 0 })).toBe("No tournaments yet");
  });

  it("matches the start of any word of a name, ignoring case and spaces around the search", () => {
    const { entries } = publicSeasonLeaderboardDto();
    expect(matchingEntries(entries, "  jones ").map((entry) => entry.player.name)).toEqual(["Bea Jones"]);
    expect(matchingEntries(entries, "")).toBe(entries);
  });

  it("finds a name by the seat finder's rule: word starts, any accent (P4REV4-CQ-07)", () => {
    const { entries } = publicSeasonLeaderboardDto();
    const zoe = { ...entries[0], player: { ...entries[0].player, id: "p-zoe", name: "Zoë Ngata" } };
    const withZoe = [...entries, zoe];
    expect(matchingEntries(withZoe, "zoe").map((entry) => entry.player.name)).toEqual(["Zoë Ngata"]);
    expect(matchingEntries(withZoe, "gata")).toEqual([]);
  });
});
