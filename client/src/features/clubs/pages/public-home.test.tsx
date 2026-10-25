import { screen, within } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "@test/msw/server";
import { apiError, mockSignedOut, renderWithApp } from "@test/helpers/web";
import { clubDto, LOGO_URL, tournamentItem } from "@test/helpers/f3-clubs";
import PublicHomePage from "./public-home";

let clubsQuery: string;
let tournamentsQuery: string;

beforeEach(() => {
  mockSignedOut();
  server.use(
    http.get("/api/clubs", ({ request }) => {
      clubsQuery = new URL(request.url).search;
      return HttpResponse.json([
        clubDto({ imageUrl: LOGO_URL, description: `<p><strong>Welcome</strong> to ${"the friendliest game in town, ".repeat(5)}</p>` }),
        clubDto({ id: "c2", name: "Perth Poker", slug: "perth-poker", timezone: "Australia/Perth" }),
      ]);
    }),
    http.get("/api/tournaments", ({ request }) => {
      tournamentsQuery = new URL(request.url).search;
      return HttpResponse.json([
        tournamentItem({ id: "t1", name: "Friday Freezeout", registeredCount: 12, maxPlayers: 30 }),
        tournamentItem({ id: "t2", name: "Perth Monday", clubId: "c2", startDateTime: "2026-10-26T15:30:00.000Z" }),
        tournamentItem({ id: "t3", name: "Elsewhere", clubId: "c-unlisted" }),
        tournamentItem({ id: "t4", name: "Full House", registeredCount: 20, waitingListCount: 2, maxPlayers: 18 }),
      ]);
    }),
    // A club past the first page of the list, asked for by id.
    http.get("/api/clubs/c-unlisted", () => HttpResponse.json(clubDto({ id: "c-unlisted", name: "Hobart Hold'em", slug: "hobart", timezone: "Australia/Hobart" }))),
  );
});

function renderPage() {
  return renderWithApp(<PublicHomePage />, { path: "/home" });
}

const cardOf = (heading: HTMLElement) => heading.closest("li") as HTMLElement;

describe("PublicHomePage", () => {
  it("asks for the first clubs and the soonest upcoming tournaments only", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "Friday Freezeout" })).toBeInTheDocument();
    expect(clubsQuery).toBe("?limit=24");
    expect(tournamentsQuery).toBe("?upcoming=true&limit=6");
  });

  it("lists upcoming tournaments with their club, day (in the club's zone) and sign-ups, each opening its page", async () => {
    renderPage();

    const freezeout = cardOf(await screen.findByRole("heading", { name: "Friday Freezeout" }));
    expect(freezeout).toHaveTextContent("Central Stars");
    expect(freezeout).toHaveTextContent("Sat, 24 Oct 2026");
    expect(freezeout).toHaveTextContent("12 / 30 players");
    expect(within(freezeout).getByRole("link", { name: "View Details for Friday Freezeout" })).toHaveAttribute("href", "/tournament/t1");

    // 15:30 UTC on the 26th is still Monday night in Perth (it is already Tuesday in Auckland).
    expect(cardOf(screen.getByRole("heading", { name: "Perth Monday" }))).toHaveTextContent("Mon, 26 Oct 2026");
    // A tournament whose club is past the clubs listed still names its own club, asked for by id (P3REV3-CQ-04).
    expect(await within(cardOf(screen.getByRole("heading", { name: "Elsewhere" }))).findByText("Hobart Hold'em")).toBeInTheDocument();
    expect(cardOf(screen.getByRole("heading", { name: "Elsewhere" }))).not.toHaveTextContent("Central Stars");
  });

  it("counts a full tournament's field against Max players, the waiting list apart, never \"20 / 18\" (round 5, item 15)", async () => {
    renderPage();

    const full = cardOf(await screen.findByRole("heading", { name: "Full House" }));
    expect(full).toHaveTextContent("18 / 18 players · 2 waiting");
    expect(full).not.toHaveTextContent("20 / 18");
  });

  it("lists the clubs with their whole logo (not cropped into a banner) and a plain-text excerpt (CC-21)", async () => {
    renderPage();

    const central = cardOf(await screen.findByRole("heading", { name: "Central Stars" }));
    const logo = central.querySelector(`img[src="${LOGO_URL}"]`);
    expect(logo).toHaveClass("object-contain");
    expect(central).toHaveTextContent("Welcome to the friendliest game in town");
    expect(central.querySelector("strong")).toBeNull();
    expect(central).toHaveTextContent("…");
    expect(within(central).getByRole("link", { name: "View Club Central Stars" })).toHaveAttribute("href", "/club/central-stars");
    expect(within(cardOf(screen.getByRole("heading", { name: "Perth Poker" }))).getByText("PP")).toBeInTheDocument();
  });

  it("keeps its headings while loading, and says when there is nothing to list", async () => {
    server.use(
      http.get("/api/tournaments", async () => {
        await delay(50);
        return HttpResponse.json([]);
      }),
      http.get("/api/clubs", () => HttpResponse.json([])),
    );
    renderPage();

    expect(screen.getByRole("heading", { name: "Upcoming Tournaments" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "LovePoker.club" })).toBeInTheDocument();
    expect(screen.getAllByRole("status").length).toBeGreaterThan(0);
    expect(await screen.findByText("No upcoming tournaments at the moment")).toBeInTheDocument();
    expect(await screen.findByText("No clubs available yet")).toBeInTheDocument();
  });

  it("says when a list could not be loaded, instead of showing it as empty", async () => {
    server.use(http.get("/api/tournaments", () => apiError(500, "INTERNAL", "Something went wrong on our side. Please try again.")));
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Upcoming tournaments could not be loaded");
    expect(screen.queryByText("No upcoming tournaments at the moment")).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Central Stars" })).toBeInTheDocument();
  });
});
