import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "@test/msw/server";
import { apiError, mockSignedIn, renderWithApp } from "@test/helpers/web";
import { clubDto, MANAGER_VIEW, seasonDto, tournamentItem } from "@test/helpers/f3-clubs";
import type { ClubDto } from "@shared/api/public";
import ClubDetailsPage from "./club-details";

let club: ClubDto;
let tournamentQuery: string | null;
let seasonQuery: string | null;

beforeEach(() => {
  mockSignedIn({ id: "u1", name: "Max Manager", email: "max@club.test", role: "full_member" });
  club = clubDto({ viewer: MANAGER_VIEW, description: '<p>Fridays at <strong>Club 2020</strong></p><img src=x onerror="alert(1)">' });
  tournamentQuery = null;
  seasonQuery = null;
  server.use(
    http.get("/api/clubs/c1", () => HttpResponse.json(club)),
    http.get("/api/clubs/c1/members-count", () => HttpResponse.json({ count: 42 })),
    http.get("/api/tournaments", ({ request }) => {
      tournamentQuery = new URL(request.url).search;
      return HttpResponse.json([
        tournamentItem({ id: "t-old", name: "August Opener", status: "completed", startDateTime: "2026-08-01T07:00:00.000Z" }),
        tournamentItem({ id: "t-new", name: "Friday Freezeout", status: "registration", startDateTime: "2026-10-24T06:30:00.000Z" }),
        tournamentItem({ id: "t-off", name: "Called Off", status: "cancelled", startDateTime: "2026-09-12T07:00:00.000Z" }),
      ]);
    }),
    http.get("/api/seasons", ({ request }) => {
      seasonQuery = new URL(request.url).search;
      return HttpResponse.json([
        seasonDto({ id: "s1", name: "Summer 2026", endDate: "2027-03-31T10:00:00.000Z" }),
        seasonDto({ id: "s0", name: "Winter 2026", isActive: false, endDate: "1970-01-01T00:00:00.000Z", startDate: "2026-05-01T00:00:00.000Z" }),
      ]);
    }),
  );
});

function renderPage() {
  return renderWithApp(<ClubDetailsPage />, { path: "/clubs/c1", route: "/clubs/:id" });
}

describe("ClubDetailsPage", () => {
  it("shows the club, its description cleaned, its public link and its figures", async () => {
    renderPage();

    expect(await screen.findByTestId("club-name")).toHaveTextContent("Central Stars");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Central Stars");
    expect(screen.getByText("Est. 15 Jan 2026")).toBeInTheDocument();
    const description = screen.getByTestId("club-description");
    expect(description).toHaveTextContent("Fridays at Club 2020");
    expect(description.querySelector("img")).toBeNull();
    expect(screen.getByTestId("public-club-url")).toHaveTextContent(`${window.location.origin}/club/central-stars`);
    expect(screen.getByRole("link", { name: "View Public Page" })).toHaveAttribute("href", `${window.location.origin}/club/central-stars`);

    await waitFor(() => expect(screen.getByTestId("total-tournaments")).toHaveTextContent("3"));
    expect(screen.getByTestId("active-tournaments")).toHaveTextContent("1");
    expect(screen.getByTestId("active-seasons")).toHaveTextContent("1");
    await waitFor(() => expect(screen.getByTestId("members-count")).toHaveTextContent("42"));
    // Only this club's tournaments and seasons are asked for.
    expect(tournamentQuery).toBe("?clubId=c1");
    expect(seasonQuery).toBe("?clubId=c1");
  });

  it("lists the latest tournaments first, each opening its admin page, with its real status", async () => {
    renderPage();

    const list = await screen.findByRole("list", { name: "Recent Tournaments" });
    const links = within(list).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      expect.stringContaining("Friday Freezeout"),
      expect.stringContaining("Called Off"),
      expect.stringContaining("August Opener"),
    ]);
    expect(links[0]).toHaveAttribute("href", "/admin/tournaments/t-new");
    expect(links[0]).toHaveTextContent("24 Oct 2026");
    expect(links[0]).toHaveTextContent("Registration Open");
    // A cancelled tournament says so (it used to read "cancelled" as a raw word).
    expect(links[1]).toHaveTextContent("Cancelled");
  });

  it("links each season to its leaderboard, and shows no end for a season saved without one", async () => {
    renderPage();

    const leaderboard = await screen.findByRole("link", { name: "View Leaderboard for Summer 2026" });
    expect(leaderboard).toHaveAttribute("href", "/leaderboards?season=s1");
    expect(screen.getByText("1 Oct 2026 – 31 Mar 2027")).toBeInTheDocument();
    expect(screen.getByText("1 May 2026")).toBeInTheDocument();
    expect(screen.queryByText(/1970/)).not.toBeInTheDocument();
  });

  it("gives the club's staff the ways to run it", async () => {
    renderPage();
    expect(await screen.findByRole("link", { name: "Settings" })).toHaveAttribute("href", "/clubs/c1/settings");
    expect(screen.getByRole("link", { name: "Create Tournament" })).toHaveAttribute("href", "/tournaments?create=c1");
    expect(screen.getByRole("link", { name: "Create Season" })).toHaveAttribute("href", "/seasons?create=c1");
  });

  it("shows no staff links to someone who does not run the club", async () => {
    club = clubDto();
    renderPage();

    expect(await screen.findByTestId("club-name")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Settings" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Create Tournament" })).not.toBeInTheDocument();
  });

  it("copies the public link", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Copy link" }));

    expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}/club/central-stars`);
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("says a club that does not exist was not found", async () => {
    server.use(http.get("/api/clubs/c1", () => apiError(404, "NOT_FOUND", "Club not found")));
    renderPage();

    expect(await screen.findByText("Club Not Found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Clubs" })).toHaveAttribute("href", "/clubs");
  });

  it("says when the club could not be loaded, rather than that it does not exist", async () => {
    server.use(http.get("/api/clubs/c1", () => apiError(500, "INTERNAL", "Something went wrong on our side. Please try again.")));
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("This club could not be loaded");
    expect(screen.queryByText("Club Not Found")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
