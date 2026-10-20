import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import type { DashboardStatsDto } from "@shared/api/dashboard";
import type { ClubDto, PublicSeason } from "@shared/api/public";
import type { LeaderboardEntryDto } from "@shared/api/seasons";
import type { TournamentListItemDto } from "@shared/api/tournaments";
import { server } from "@test/msw/server";
import { clubDto, leaderboardEntry, seasonDto, tournamentListItem } from "@test/helpers/f5-dto";
import { apiError, mockSignedIn, renderWithApp } from "@test/helpers/web";
import DashboardPage from "./dashboard";

// The create form is the tournaments feature's, tested there: here it only has to open.
vi.mock("@/features/tournaments/components/create-tournament-dialog", () => ({
  CreateTournamentDialog: ({ open }: { open: boolean }) => (open ? <div role="dialog" aria-label="Create Tournament" /> : null),
}));

const TESS = { id: "u1", name: "Tess TD", email: "tess@club.test", role: "full_member" } as const;

const STATS: DashboardStatsDto = { activeTournaments: 2, totalPlayers: 37, totalPrizePool: 1234, activeClubs: 1 };
const mine = clubDto({ id: "c1", name: "Central Stars", createdAt: "2026-01-01T00:00:00.000Z" });
const newer = clubDto({ id: "c3", name: "Onehunga Aces", createdAt: "2026-05-01T00:00:00.000Z" });
const theirs = clubDto({ id: "c2", name: "Other Club", viewer: { canManage: false, canOwn: false } });

interface World {
  stats?: DashboardStatsDto | Response;
  clubs?: ClubDto[];
  tournaments?: TournamentListItemDto[];
  seasons?: PublicSeason[];
  leaderboard?: LeaderboardEntryDto[];
  memberCounts?: Record<string, number>;
}

/** The server's filters, as GET /api/tournaments and GET /api/seasons apply them. */
const filtered = <T extends { clubId: string; status?: string }>(rows: readonly T[], request: Request) => {
  const params = new URL(request.url).searchParams;
  return rows.filter((row) => ["clubId", "status"].every((key) => !params.has(key) || params.get(key) === row[key as keyof T]));
};

function serve({ stats = STATS, clubs = [mine, theirs], tournaments = [], seasons = [], leaderboard = [], memberCounts = {} }: World = {}) {
  const asked: string[] = [];
  server.use(
    http.get("/api/dashboard/stats", () => (stats instanceof Response ? stats : HttpResponse.json(stats))),
    http.get("/api/clubs", () => HttpResponse.json(clubs)),
    http.get("/api/clubs/member-counts", () => HttpResponse.json(memberCounts)),
    http.get("/api/tournaments", ({ request }) => {
      asked.push(new URL(request.url).search);
      return HttpResponse.json(filtered(tournaments, request));
    }),
    http.get("/api/seasons", ({ request }) => {
      asked.push(`seasons${new URL(request.url).search}`);
      return HttpResponse.json(filtered(seasons, request));
    }),
    http.get("/api/seasons/:id/leaderboard", () => HttpResponse.json(leaderboard)),
  );
  return asked;
}

function renderDashboard() {
  mockSignedIn(TESS);
  return renderWithApp(<DashboardPage />, { path: "/dashboard" });
}

describe("Dashboard", () => {
  it("shows the server's totals for the viewer's clubs, with no made-up trends", async () => {
    serve();
    renderDashboard();

    expect(await screen.findByTestId("active-tournaments-count")).toHaveTextContent("2");
    expect(screen.getByTestId("total-players-count")).toHaveTextContent("37");
    expect(screen.getByTestId("total-prize-pool")).toHaveTextContent("$1,234");
    expect(screen.getByTestId("active-clubs-count")).toHaveTextContent("1");
    expect(screen.queryByText(/^\+\d+%?$/)).not.toBeInTheDocument();
  });

  it("says when the totals could not be loaded, and still shows the rest", async () => {
    serve({ stats: apiError(500, "INTERNAL", "Something went wrong on our side. Please try again.") });
    renderDashboard();

    expect(await screen.findByText("The totals could not be loaded")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Active Tournaments" })).toBeInTheDocument();
  });

  it("lists the running and open tournaments of the viewer's own clubs only, soonest first, with the ways in", async () => {
    serve({
      tournaments: [
        tournamentListItem({ id: "t2", name: "Late Show", status: "in_progress", startDateTime: "2026-10-24T08:00:00.000Z" }),
        tournamentListItem({ id: "t1", name: "Friday Freezeout", seasonId: "s1", startDateTime: "2026-10-23T06:30:00.000Z" }),
        tournamentListItem({ id: "t3", name: "Draft Game", status: "scheduled" }),
        tournamentListItem({ id: "t4", name: "Finished Game", status: "completed" }),
        tournamentListItem({ id: "t5", name: "Someone Else's Game", clubId: "c2", confirmedPlayerCount: null }),
      ],
      seasons: [seasonDto()],
    });
    renderDashboard();

    const table = await screen.findByRole("table", { name: "Active tournaments" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell")[0].textContent)).toEqual([
      "Friday FreezeoutSeason: Summer 2026",
      "Late ShowSeason: No Season",
    ]);
    expect(within(rows[0]).getByText("Registration Open")).toBeInTheDocument();
    expect(within(rows[1]).getByText("In Progress")).toBeInTheDocument();
    expect(within(rows[0]).getByText("12/40")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Fri, 23 Oct 2026, 7:30 pm")).toBeInTheDocument();
    expect(within(rows[0]).getByRole("link", { name: "Manage Friday Freezeout" })).toHaveAttribute("href", "/admin/tournaments/t1");
    expect(within(rows[0]).getByRole("link", { name: "Public view of Friday Freezeout" })).toHaveAttribute("href", "/tournament/t1");
  });

  it("offers to create the first tournament when none is running, opening the create form", async () => {
    serve();
    renderDashboard();

    await userEvent.click(await screen.findByTestId("create-first-tournament"));

    expect(screen.getByRole("dialog", { name: "Create Tournament" })).toBeInTheDocument();
  });

  it("lists the viewer's newest clubs with their counts, each a link to the club", async () => {
    serve({
      clubs: [mine, theirs, newer],
      memberCounts: { c1: 12, c3: 1 },
      tournaments: [tournamentListItem({ clubId: "c1" }), tournamentListItem({ id: "t9", clubId: "c1", status: "completed" })],
    });
    renderDashboard();

    const recent = await screen.findByRole("region", { name: "Recent Clubs" });
    const links = await within(recent).findAllByRole("link", { name: /Central Stars|Onehunga Aces/ });
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/clubs/c3", "/clubs/c1"]);
    await waitFor(() => expect(links[1]).toHaveTextContent("12 members • 2 tournaments"));
    expect(links[0]).toHaveTextContent("1 member • 0 tournaments");
    expect(within(recent).queryByText("Other Club")).not.toBeInTheDocument();
  });

  it("says a club's count could not be loaded, rather than leaving a blank for ever (P3REV5-CQ-07)", async () => {
    serve({ clubs: [mine], memberCounts: { c1: 12 } });
    server.use(http.get("/api/tournaments", () => apiError(500, "INTERNAL", "Something went wrong on our side. Please try again.")));
    renderDashboard();

    const recent = await screen.findByRole("region", { name: "Recent Clubs" });
    const row = await within(recent).findByRole("link", { name: /Central Stars/ });
    await waitFor(() => expect(row).toHaveTextContent("12 members • –"));
    expect(row).toHaveTextContent("could not be loaded");
  });

  it("lets its cards shrink to a narrow phone, so the page never scrolls sideways (MA-P3REV1-06)", async () => {
    serve();
    renderDashboard();

    const cards = await screen.findByTestId("dashboard-cards");
    expect(cards).toHaveClass("[&>*]:min-w-0");
  });

  it("shows the same Manage link as the tournaments page (P3REV5-CQ-06)", async () => {
    serve({ tournaments: [tournamentListItem({ clubId: "c1", status: "in_progress" })] });
    renderDashboard();

    const manage = await screen.findByRole("link", { name: /^Manage / });
    expect(manage).toHaveClass("h-10");
    expect(manage).not.toHaveClass("h-9");
  });

  it("shows the top five of the viewer's current season, linking to its full leaderboard", async () => {
    serve({
      seasons: [seasonDto({ id: "s0", name: "Winter", startDate: "2026-03-01T00:00:00.000Z" }), seasonDto(), seasonDto({ id: "s9", clubId: "c2", name: "Theirs" })],
      leaderboard: [1, 2, 3, 4, 5, 6].map((rank) => leaderboardEntry(rank, `Player ${rank}`, 100 - rank)),
    });
    renderDashboard();

    const top = await screen.findByRole("list", { name: "Summer 2026 top 5" });
    expect(within(top).getAllByRole("listitem")).toHaveLength(5);
    expect(within(top).getAllByRole("listitem")[0]).toHaveTextContent("Rank 1P1Player 199 pts");
    expect(screen.getByRole("link", { name: "Full leaderboard" })).toHaveAttribute("href", "/leaderboards?season=s1");
  });

  it("says when there is no active season to rank", async () => {
    serve({ seasons: [seasonDto({ isActive: false })] });
    renderDashboard();

    expect(await screen.findByRole("heading", { name: "No active season" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Seasons" })).toHaveAttribute("href", "/seasons");
  });

  it("says when the clubs could not be loaded", async () => {
    serve();
    server.use(http.get("/api/clubs", () => apiError(500, "INTERNAL", "Something went wrong on our side. Please try again.")));
    renderDashboard();

    expect(await screen.findByText("Your clubs could not be loaded")).toBeInTheDocument();
  });

  it("asks the server only for live tournaments, each club's own list and its seasons, never every tournament (P3REV4-PERF-09)", async () => {
    const asked = serve({
      clubs: [mine, theirs],
      tournaments: [tournamentListItem({ id: "t1", clubId: "c1" }), tournamentListItem({ id: "t9", clubId: "c1", status: "completed" })],
      seasons: [seasonDto(), seasonDto({ id: "s9", clubId: "c2", name: "Theirs" })],
      leaderboard: [leaderboardEntry(1, "Ava", 1250)],
    });
    renderDashboard();

    const top = await screen.findByRole("list", { name: "Summer 2026 top 5" });
    expect(within(top).getByRole("listitem")).toHaveTextContent("1,250 pts");
    await waitFor(() => expect(asked).toContain("?clubId=c1"));
    expect(asked).toEqual(expect.arrayContaining(["?status=registration", "?status=in_progress", "seasons?clubId=c1"]));
    expect(asked).not.toContain("");
    expect(asked).not.toContain("seasons");
  });
});
