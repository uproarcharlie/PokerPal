import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicSeason } from "@shared/api/public";
import type { LeaderboardEntryDto } from "@shared/api/seasons";
import { clubDto, seasonDto } from "@test/helpers/f4-seasons";
import { apiError, mockSignedIn, renderWithApp, type MockUser } from "@test/helpers/web";
import { server } from "@test/msw/server";
import LeaderboardsPage from "./leaderboards";

const td: MockUser = { id: "u-td", name: "Tia Director", email: "tia@club.test", role: "full_member" };

const spring = seasonDto({ id: "s1", name: "Spring 2026", clubId: "c1" });
const winter = seasonDto({ id: "s2", name: "Winter 2025", clubId: "c1", isActive: false });

const entry = (rank: number, id: string, name: string, points: number, tournaments: number, imageUrl: string | null = null): LeaderboardEntryDto => ({
  rank,
  player: { id, name, imageUrl },
  points,
  tournaments,
});

const springBoard = [
  entry(1, "p1", "Ava Ngata", 1250, 3, "/uploads/ava.webp"),
  entry(2, "p2", "Ben Hale", 80, 2),
  entry(2, "p3", "Cal Iti", 80, 1),
  entry(4, "p4", "Dee Moana", 10, 1),
];

function mockSeasons(seasons: PublicSeason[] = [spring, winter]) {
  const asked: string[] = [];
  server.use(
    http.get("/api/seasons", () => HttpResponse.json(seasons)),
    http.get("/api/clubs", () => HttpResponse.json([clubDto({ id: "c1", name: "Central Stars" })])),
    http.get("/api/seasons/:id/leaderboard", ({ params }) => {
      asked.push(String(params.id));
      if (params.id === "s1") return HttpResponse.json(springBoard);
      if (params.id === "s2") return HttpResponse.json([entry(1, "p2", "Ben Hale", 40, 1)]);
      return apiError(404, "NOT_FOUND", "Season not found");
    }),
  );
  return asked;
}

/** jsdom's Blob is not Node's, so it is read the way a page would read it. */
function readText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

function renderLeaderboards(path = "/leaderboards") {
  const user = userEvent.setup();
  const { location } = renderWithApp(<LeaderboardsPage />, { path, route: "/leaderboards" });
  return { user, href: location };
}

beforeEach(() => {
  mockSignedIn(td);
});

afterEach(() => vi.restoreAllMocks());

describe("LeaderboardsPage", () => {
  it("shows the season named in the address, ranked by the server, ties sharing a rank", async () => {
    mockSeasons();
    renderLeaderboards("/leaderboards?season=s1");

    const first = await screen.findByTestId("leaderboard-entry-1");
    expect(first).toHaveTextContent("Rank 1");
    expect(first).toHaveTextContent("Ava Ngata");
    expect(first).toHaveTextContent("3 tournaments");
    expect(first).toHaveTextContent("1,250points");
    // Tied players share the server's rank; the next one is 4th, not 3rd.
    expect(screen.getByTestId("leaderboard-entry-2")).toHaveTextContent(/^Rank 2.*Ben Hale/);
    expect(screen.getByTestId("leaderboard-entry-3")).toHaveTextContent(/^Rank 2.*Cal Iti/);
    expect(screen.getByTestId("leaderboard-entry-4")).toHaveTextContent(/^Rank 4.*Dee Moana1 tournament10points/);
    expect(screen.getByTestId("total-players")).toHaveTextContent("4");
    expect(screen.getByRole("region", { name: "Season Leaderboard" })).toHaveTextContent("Spring 2026 - Central StarsActive");
    expect(screen.getByRole("combobox", { name: "Season" })).toHaveTextContent("Spring 2026 - Central Stars");
  });

  it("shows each player's photo, or their initials", async () => {
    mockSeasons();
    renderLeaderboards("/leaderboards?season=s1");

    const first = await screen.findByTestId("leaderboard-entry-1");
    // Decorative beside the written name, so screen readers do not read the name twice.
    expect(first.querySelector("img")).toHaveAttribute("alt", "");
    expect(first.querySelector("img")?.getAttribute("src")).toContain("/uploads/ava");
    expect(screen.getByTestId("leaderboard-entry-2").querySelector("img")).toBeNull();
    expect(within(screen.getByTestId("leaderboard-entry-2")).getByText("BH")).toBeInTheDocument();
  });

  it("asks for a season when the address names none, without asking for a leaderboard", async () => {
    const asked = mockSeasons();
    renderLeaderboards();

    expect(await screen.findByText("Select a Season")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toBeDisabled();
    expect(asked).toEqual([]);
  });

  it("shows the season picked and puts it in the address", async () => {
    const asked = mockSeasons();
    const { user, href } = renderLeaderboards("/leaderboards?season=s1");

    await screen.findByTestId("leaderboard-entry-4");
    await user.click(screen.getByRole("combobox", { name: "Season" }));
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Spring 2026 - Central StarsActive",
      "Winter 2025 - Central Stars",
    ]);
    await user.click(screen.getByRole("option", { name: "Winter 2025 - Central Stars" }));

    await waitFor(() => expect(screen.queryByTestId("leaderboard-entry-2")).not.toBeInTheDocument());
    expect(screen.getByTestId("leaderboard-entry-1")).toHaveTextContent("Ben Hale");
    expect(href()).toBe("/leaderboards?season=s2");
    expect(asked).toEqual(["s1", "s2"]);
  });

  it("says when there are no seasons at all", async () => {
    mockSeasons([]);
    renderLeaderboards();

    // The old page asked for a season here, which could never be picked.
    expect(await screen.findByText("No Seasons Available")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create Club" })).toHaveAttribute("href", "/clubs");
    expect(screen.getByRole("link", { name: "Create Season" })).toHaveAttribute("href", "/seasons");
  });

  it("says when the season has no results yet", async () => {
    mockSeasons();
    server.use(http.get("/api/seasons/s1/leaderboard", () => HttpResponse.json([])));
    renderLeaderboards("/leaderboards?season=s1");

    expect(await screen.findByText("No Leaderboard Data")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View Tournaments" })).toHaveAttribute("href", "/tournaments");
    expect(screen.getByTestId("total-players")).toHaveTextContent("0");
    expect(screen.getByRole("button", { name: "Export" })).toBeDisabled();
  });

  it("says when the season in the address does not exist", async () => {
    mockSeasons();
    renderLeaderboards("/leaderboards?season=gone");

    expect(await screen.findByText("Season Not Found")).toBeInTheDocument();
  });

  it("shows a failed leaderboard with a retry", async () => {
    mockSeasons();
    let fail = true;
    server.use(
      http.get("/api/seasons/s1/leaderboard", () =>
        fail ? apiError(500, "INTERNAL", "Something went wrong on our side") : HttpResponse.json(springBoard),
      ),
    );
    const { user } = renderLeaderboards("/leaderboards?season=s1");

    expect(await screen.findByRole("alert")).toHaveTextContent("The leaderboard could not be loaded");
    fail = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("leaderboard-entry-4")).toBeInTheDocument();
  });

  it("shows the seasons failing to load with a retry", async () => {
    mockSeasons();
    server.use(http.get("/api/seasons", () => apiError(500, "INTERNAL", "Something went wrong on our side")));
    renderLeaderboards("/leaderboards?season=s1");

    expect(await screen.findByRole("alert")).toHaveTextContent("Seasons could not be loaded");
    expect(screen.getByRole("combobox", { name: "Season" })).toBeDisabled();
  });

  it("exports the leaderboard as a CSV file named after the season", async () => {
    mockSeasons();
    const downloads: Array<{ name: string; href: string }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push({ name: this.download, href: this.href });
    });
    const { user } = renderLeaderboards("/leaderboards?season=s1");

    await screen.findByTestId("leaderboard-entry-4");
    await user.click(screen.getByRole("button", { name: "Export" }));

    expect(downloads).toHaveLength(1);
    expect(downloads[0].name).toBe("spring-2026-leaderboard.csv");
    const blob = vi.mocked(URL.createObjectURL).mock.lastCall?.[0] as Blob;
    expect(blob.type).toBe("text/csv;charset=utf-8");
    const text = await readText(blob);
    expect(text.split("\r\n").slice(0, 3)).toEqual(["Rank,Player,Points,Tournaments", "1,Ava Ngata,1250,3", "2,Ben Hale,80,2"]);
  });
});
