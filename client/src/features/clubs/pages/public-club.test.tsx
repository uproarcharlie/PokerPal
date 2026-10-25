import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "@test/msw/server";
import { apiError, mockSignedOut, renderWithApp } from "@test/helpers/web";
import { clubDto, leaderboardEntry, LOGO_URL, seasonDto, tournamentItem } from "@test/helpers/f3-clubs";
import type { PublicSeason } from "@shared/api/public";
import type { LeaderboardEntryDto } from "@shared/api/seasons";
import type { TournamentListItemDto } from "@shared/api/tournaments";
import PublicClubPage from "./public-club";

const club = clubDto({
  description: '<h2>Welcome</h2><p>Fridays at <strong>Club 2020</strong>.</p><script>alert(1)</script>',
  imageUrl: LOGO_URL,
  discordUrl: "javascript:alert(document.cookie)",
  twitterUrl: "data:text/html,<script>alert(1)</script>",
  facebookUrl: "https://facebook.example/central-stars",
  websiteUrl: "https://centralstars.example",
  rakeLabel: "AP",
});

let tournaments: TournamentListItemDto[];
let seasons: PublicSeason[];
let leaderboards: Record<string, LeaderboardEntryDto[]>;
let leaderboardReads: string[];

beforeEach(() => {
  mockSignedOut();
  tournaments = [];
  seasons = [];
  leaderboards = {};
  leaderboardReads = [];
  server.use(
    http.get("/api/clubs/slug/central-stars", () => HttpResponse.json(club)),
    http.get("/api/tournaments", () => HttpResponse.json(tournaments)),
    http.get("/api/seasons", () => HttpResponse.json(seasons)),
    http.get("/api/seasons/:id/leaderboard", ({ params }) => {
      const id = String(params.id);
      leaderboardReads.push(id);
      return HttpResponse.json(leaderboards[id] ?? []);
    }),
  );
});

function renderPage(path = "/club/central-stars") {
  return renderWithApp(<PublicClubPage />, { path, route: "/club/:slug" });
}

describe("PublicClubPage", () => {
  it("shows the club's name, logo and description, cleaned of anything but formatting", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { level: 1, name: "Central Stars" })).toBeInTheDocument();
    expect(document.querySelector(`img[src="${LOGO_URL}"]`)).toHaveClass("object-contain");
    expect(screen.getByRole("heading", { name: "Welcome" })).toBeInTheDocument();
    expect(screen.getByText("Club 2020")).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
    expect(screen.getByText("Powered by LovePoker.club")).toBeInTheDocument();
  });

  it("links only to http(s) addresses, whatever an older club row holds (P2REV0-SEC-05)", async () => {
    renderPage();

    expect(await screen.findByRole("link", { name: "Facebook" })).toHaveAttribute("href", "https://facebook.example/central-stars");
    expect(screen.getByRole("link", { name: "Website" })).toHaveAttribute("href", "https://centralstars.example");
    expect(screen.queryByRole("link", { name: "Discord" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Twitter/X" })).toBeNull();
    for (const link of screen.getAllByRole("link")) {
      expect(link.getAttribute("href") ?? "").not.toMatch(/^\s*(javascript|data):/i);
    }
  });

  it("says plainly when there is no such club, and when it could not be loaded", async () => {
    server.use(http.get("/api/clubs/slug/:slug", () => apiError(404, "NOT_FOUND", "Club not found")));
    const { unmount } = renderPage("/club/no-such-club");
    expect(await screen.findByText("Club not found")).toBeInTheDocument();
    unmount();

    server.use(http.get("/api/clubs/slug/:slug", () => apiError(500, "INTERNAL", "Something went wrong on our side. Please try again.")));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("This club could not be loaded");
  });

  it("lists the club's running seasons on the Details tab", async () => {
    seasons = [seasonDto({ name: "Summer 2026", endDate: "2027-03-31T10:00:00.000Z" }), seasonDto({ id: "s0", name: "Winter 2026", isActive: false })];
    renderPage();

    const active = await screen.findByRole("heading", { name: "Active Seasons" });
    const section = active.closest("section") as HTMLElement;
    expect(within(section).getByText("Summer 2026")).toBeInTheDocument();
    expect(within(section).getByText("31 Mar 2027")).toBeInTheDocument();
    expect(within(section).queryByText("Winter 2026")).not.toBeInTheDocument();
  });

  it("lists live, upcoming and past tournaments in the club's time zone, and never a cancelled one", async () => {
    tournaments = [
      tournamentItem({ id: "live", name: "Tonight's Game", status: "in_progress" }),
      tournamentItem({ id: "later", name: "Late Show", status: "scheduled", startDateTime: "2026-11-20T06:30:00.000Z" }),
      tournamentItem({ id: "soon", name: "Friday Freezeout", status: "registration", startDateTime: "2026-10-24T06:30:00.000Z", buyInAmount: "100" }),
      tournamentItem({ id: "done", name: "August Opener", status: "completed" }),
      tournamentItem({ id: "off", name: "Called Off", status: "cancelled" }),
    ];
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("tab", { name: "Tournaments" }));

    const live = (await screen.findByRole("heading", { name: "Live Tournaments" })).closest("section") as HTMLElement;
    expect(within(live).getByRole("link", { name: "Tonight's Game" })).toHaveAttribute("href", "/tournament/live");
    expect(within(live).getByText("Live")).toBeInTheDocument();

    const upcoming = screen.getByRole("heading", { name: "Upcoming Tournaments" }).closest("section") as HTMLElement;
    const cards = within(upcoming).getAllByRole("listitem");
    expect(cards.map((card) => within(card).getByRole("heading").textContent)).toEqual(["Friday Freezeout", "Late Show"]);
    // 06:30 UTC is 7:30 pm in Auckland.
    expect(cards[0]).toHaveTextContent("Sat, 24 Oct 2026");
    expect(cards[0]).toHaveTextContent("7:30 pm");
    expect(cards[0]).toHaveTextContent("Buy-in: $100.00");
    expect(cards[0]).toHaveTextContent("Registration Open");
    expect(cards[1]).toHaveTextContent("Upcoming");

    const past = screen.getByRole("heading", { name: "Past Tournaments" }).closest("section") as HTMLElement;
    expect(within(past).getByText("August Opener")).toBeInTheDocument();
    expect(screen.queryByText("Called Off")).not.toBeInTheDocument();
  });

  it("counts each tournament's field against Max players, with the waiting list apart, never \"19 / 18\" (round 6, B4)", async () => {
    tournaments = [
      tournamentItem({ id: "soon", name: "Friday Freezeout", status: "registration", maxPlayers: 18, registeredCount: 19, waitingListCount: 1 }),
      tournamentItem({ id: "later", name: "Late Show", status: "scheduled", maxPlayers: 18, registeredCount: 7, waitingListCount: 0 }),
      tournamentItem({ id: "done", name: "August Opener", status: "completed", maxPlayers: 18, registeredCount: 19, waitingListCount: 1 }),
    ];
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("tab", { name: "Tournaments" }));

    const cardOf = (name: string) => screen.getByRole("link", { name }).closest("li") as HTMLElement;
    expect(await screen.findByRole("link", { name: "Friday Freezeout" })).toBeInTheDocument();
    expect(cardOf("Friday Freezeout")).toHaveTextContent("18 / 18 players · 1 waiting");
    expect(cardOf("Friday Freezeout")).not.toHaveTextContent("19 / 18");
    expect(cardOf("Late Show")).toHaveTextContent("7 / 18 players");
    expect(cardOf("August Opener")).toHaveTextContent("18 / 18 players");
    expect(cardOf("August Opener")).not.toHaveTextContent("waiting");
  });

  it("says when nothing is coming up", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("tab", { name: "Tournaments" }));

    expect(await screen.findByText("No upcoming tournaments scheduled")).toBeInTheDocument();
  });

  it("shows the running season's standings first, fetching only the season shown", async () => {
    seasons = [
      seasonDto({ id: "old", name: "Winter 2025", isActive: false, startDate: "2025-05-01T00:00:00.000Z" }),
      seasonDto({ id: "now", name: "Summer 2026", isActive: true, startDate: "2026-10-01T00:00:00.000Z" }),
    ];
    leaderboards = {
      now: [leaderboardEntry(1, "Ana Ace", 1200, { tournaments: 3 }), leaderboardEntry(1, "Bo Bluff", 1200), leaderboardEntry(3, "Cy Call", 90)],
      old: [leaderboardEntry(1, "Old Timer", 50)],
    };
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("tab", { name: "Standings" }));

    expect(screen.getAllByRole("tab").slice(3).map((tab) => tab.textContent)).toEqual(["Summer 2026Active", "Winter 2025"]);
    const table = await screen.findByRole("table", { name: "Summer 2026 leaderboard" });
    const rows = within(table).getAllByRole("row").slice(1);
    // Tied players share a place.
    expect(rows.map((row) => within(row).getAllByRole("cell")[0].textContent)).toEqual(["1", "1", "3"]);
    expect(rows[0]).toHaveTextContent("Ana Ace");
    expect(rows[0]).toHaveTextContent("1st Place");
    expect(rows[0]).toHaveTextContent("1,200pts");
    expect(rows[2]).toHaveTextContent("3rd Place");
    expect(leaderboardReads).toEqual(["now"]);

    await user.click(screen.getByRole("tab", { name: "Winter 2025" }));

    expect(await screen.findByRole("table", { name: "Winter 2025 leaderboard" })).toHaveTextContent("Old Timer");
    expect(leaderboardReads).toEqual(["now", "old"]);
  });

  it("offers every season, not only three, once a club has more (PUB-26)", async () => {
    seasons = ["2023", "2024", "2025", "2026"].map((year, index) =>
      seasonDto({ id: `s${year}`, name: `Season ${year}`, isActive: index === 3, startDate: `${year}-01-01T00:00:00.000Z` }),
    );
    leaderboards = { s2023: [leaderboardEntry(1, "Early Bird", 10)] };
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("tab", { name: "Standings" }));
    const picker = await screen.findByLabelText("Season");
    expect(within(picker).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Season 2026 (Active)",
      "Season 2025",
      "Season 2024",
      "Season 2023",
    ]);
    expect(await screen.findByText("No Leaderboard Data")).toBeInTheDocument();

    await user.selectOptions(picker, "s2023");

    expect(await screen.findByRole("table", { name: "Season 2023 leaderboard" })).toHaveTextContent("Early Bird");
  });

  it("says when a leaderboard could not be loaded", async () => {
    seasons = [seasonDto()];
    server.use(http.get("/api/seasons/:id/leaderboard", () => apiError(500, "INTERNAL", "Something went wrong on our side. Please try again.")));
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("tab", { name: "Standings" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("The leaderboard could not be loaded"));
  });

  it("says when the club has no seasons", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("tab", { name: "Standings" }));

    expect(await screen.findByText("No seasons available")).toBeInTheDocument();
  });
});
