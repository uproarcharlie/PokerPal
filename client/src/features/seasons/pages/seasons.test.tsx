import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import type { ClubDto, PublicSeason } from "@shared/api/public";
import { clubDto, seasonDto } from "@test/helpers/f4-seasons";
import { apiError, mockSignedIn, renderWithApp, type MockUser } from "@test/helpers/web";
import { server } from "@test/msw/server";
import SeasonsPage from "./seasons";

const admin: MockUser = { id: "u-admin", name: "Ada Admin", email: "ada@club.test", role: "admin" };

const centralStars = clubDto({ id: "c1", name: "Central Stars", imageUrl: "/uploads/cs.png", viewer: { canManage: true, canOwn: true } });
const otherClub = clubDto({ id: "c2", name: "Other Club" });
const northShore = clubDto({ id: "c3", name: "North Shore Poker", viewer: { canManage: true, canOwn: false } });

const spring = seasonDto({ id: "s1", name: "Spring 2026", clubId: "c1" });
const summer = seasonDto({
  id: "s2",
  name: "Summer 2025",
  clubId: "c2",
  startDate: "2025-12-01T00:00:00.000Z",
  endDate: "2026-02-28T00:00:00.000Z",
  isActive: false,
});

function mockLists({ seasons = [spring, summer], clubs = [centralStars, otherClub, northShore] }: { seasons?: PublicSeason[]; clubs?: ClubDto[] } = {}) {
  const calls = { seasons: 0 };
  server.use(
    http.get("/api/seasons", () => {
      calls.seasons += 1;
      return HttpResponse.json(seasons);
    }),
    http.get("/api/clubs", () => HttpResponse.json(clubs)),
    // Counted by the server: the page never downloads every tournament to count them (P3REV3-CQ-12).
    http.get("/api/tournaments/counts", () => HttpResponse.json({ clubs: { c1: { total: 3, active: 0 }, c2: { total: 1, active: 0 } }, seasons: { s1: 2, s2: 1 } })),
  );
  return calls;
}

function renderSeasons() {
  return renderWithApp(<SeasonsPage />, { path: "/seasons" });
}

beforeEach(() => {
  mockSignedIn(admin);
});

describe("SeasonsPage", () => {
  it("lists every season with its club, dates and tournament count", async () => {
    mockLists();
    renderSeasons();

    const springCard = await screen.findByTestId("season-card-s1");
    expect(springCard).toHaveTextContent("Spring 2026");
    expect(springCard).toHaveTextContent("Central Stars");
    expect(springCard).toHaveTextContent("Active Season");
    expect(springCard).toHaveTextContent("Start Date1 Mar 2026");
    expect(springCard).toHaveTextContent("End DateOngoing");
    expect(within(springCard).getByText("Tournaments").nextElementSibling).toHaveTextContent("2");
    // The club's logo, not just its initials (img-29).
    expect(springCard.querySelector('img[src="/uploads/cs.png"]')).not.toBeNull();

    const summerCard = screen.getByTestId("season-card-s2");
    expect(summerCard).toHaveTextContent("End Date28 Feb 2026");
    expect(summerCard).not.toHaveTextContent("Active Season");
    expect(within(summerCard).getByText("Tournaments").nextElementSibling).toHaveTextContent("1");
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/dashboard");
  });

  it("shows a season saved with the legacy 1970 end as ongoing, as the club pages do (P3REV2-CQ-04)", async () => {
    mockLists({ seasons: [seasonDto({ id: "s1", name: "Spring 2026", clubId: "c1", endDate: "1970-01-01T00:00:00.000Z" })] });
    renderSeasons();

    expect(await screen.findByTestId("season-card-s1")).toHaveTextContent("End DateOngoing");
    expect(screen.queryByText("1 Jan 1970")).not.toBeInTheDocument();
  });

  it("links each season to its leaderboard, and to its settings for the club's staff only", async () => {
    mockLists();
    renderSeasons();

    expect(await screen.findByTestId("view-leaderboard-s1")).toHaveAttribute("href", "/leaderboards?season=s1");
    expect(screen.getByTestId("view-leaderboard-s2")).toHaveAttribute("href", "/leaderboards?season=s2");
    expect(screen.getByTestId("settings-season-s1")).toHaveAttribute("href", "/seasons/s1/settings");
    expect(screen.queryByTestId("settings-season-s2")).not.toBeInTheDocument();
    // The old "View" button did nothing; there is no other page to view.
    expect(screen.queryByRole("button", { name: "View" })).not.toBeInTheDocument();
  });

  it("offers to create the first season when there are none", async () => {
    mockLists({ seasons: [] });
    renderSeasons();

    expect(await screen.findByText("No Seasons Found")).toBeInTheDocument();
    expect(screen.getByTestId("create-first-season")).toBeEnabled();
  });

  it("shows a failed load with a retry, never the empty state", async () => {
    mockLists();
    let fail = true;
    server.use(
      http.get("/api/seasons", () => (fail ? apiError(500, "INTERNAL", "Something went wrong on our side") : HttpResponse.json([spring]))),
    );
    const user = userEvent.setup();
    renderSeasons();

    expect(await screen.findByRole("alert")).toHaveTextContent("Seasons could not be loaded");
    expect(screen.queryByText("No Seasons Found")).not.toBeInTheDocument();

    fail = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("season-card-s1")).toBeInTheDocument();
  });

  it("shows the tournament count as unknown when the tournaments could not be loaded", async () => {
    mockLists();
    server.use(http.get("/api/tournaments/counts", () => apiError(500, "INTERNAL", "Something went wrong on our side")));
    renderSeasons();

    const card = await screen.findByTestId("season-card-s1");
    await waitFor(() => expect(within(card).getByText("Tournaments").nextElementSibling).toHaveTextContent("–"));
  });
});

describe("Create New Season", () => {
  async function openDialog() {
    const user = userEvent.setup();
    renderSeasons();
    await user.click(await screen.findByTestId("create-season-button"));
    return { user, dialog: await screen.findByRole("dialog", { name: "Create New Season" }) };
  }

  it("creates a season in a club the viewer runs, with no end date, and refreshes the list", async () => {
    const calls = mockLists();
    let sent: unknown;
    server.use(
      http.post("/api/seasons", async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json(seasonDto({ id: "s3", name: "Winter League", clubId: "c3" }), { status: 201 });
      }),
    );
    const { user, dialog } = await openDialog();

    await user.type(within(dialog).getByLabelText("Season Name*"), "Winter League");
    await user.click(within(dialog).getByRole("combobox", { name: "Club" }));
    // Only the clubs the viewer runs.
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Central Stars", "North Shore Poker"]);
    await user.click(screen.getByRole("option", { name: "North Shore Poker" }));
    await user.type(within(dialog).getByLabelText("Start Date*"), "2026-06-01");
    const seasonsBefore = calls.seasons;
    await user.click(within(dialog).getByRole("button", { name: "Create Season" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(sent).toEqual({ clubId: "c3", name: "Winter League", startDate: "2026-06-01T00:00:00.000Z", endDate: null, isActive: true });
    expect(calls.seasons).toBeGreaterThan(seasonsBefore);
    expect(screen.getByText("Season created successfully!")).toBeInTheDocument();
  });

  it("asks for a name, a club and a start date before sending anything", async () => {
    mockLists();
    let posted = false;
    server.use(
      http.post("/api/seasons", () => {
        posted = true;
        return HttpResponse.json({}, { status: 201 });
      }),
    );
    const { user, dialog } = await openDialog();

    await user.click(within(dialog).getByRole("button", { name: "Create Season" }));

    expect(await within(dialog).findByText("Choose a club")).toBeInTheDocument();
    expect(within(dialog).getAllByText("Required")).toHaveLength(2);
    expect(within(dialog).getByLabelText("Season Name*")).toHaveAttribute("aria-invalid", "true");
    expect(posted).toBe(false);
  });

  it("refuses an end date before the start date", async () => {
    mockLists({ clubs: [centralStars] });
    const { user, dialog } = await openDialog();

    await user.type(within(dialog).getByLabelText("Season Name*"), "Backwards");
    await user.type(within(dialog).getByLabelText("Start Date*"), "2026-06-01");
    await user.type(within(dialog).getByLabelText("End Date"), "2026-05-01");
    await user.click(within(dialog).getByRole("button", { name: "Create Season" }));

    expect(await within(dialog).findByText("The end date must be on or after the start date")).toBeInTheDocument();
  });

  it("chooses the club for someone who runs only one", async () => {
    mockLists({ clubs: [centralStars, otherClub] });
    const { dialog } = await openDialog();

    expect(within(dialog).getByRole("combobox", { name: "Club" })).toHaveTextContent("Central Stars");
  });

  it("opens with the club chosen from a club page's link, then drops the link's query (CA-31)", async () => {
    mockLists();
    const user = userEvent.setup();
    const { location } = renderWithApp(<SeasonsPage />, { path: "/seasons?create=c3" });

    const dialog = await screen.findByRole("dialog", { name: "Create New Season" });
    expect(within(dialog).getByRole("combobox", { name: "Club" })).toHaveTextContent("North Shore Poker");

    await user.click(within(dialog).getByTestId("cancel-season"));
    await waitFor(() => expect(location()).toBe("/seasons"));
  });

  it("ignores a club in the link that the viewer does not run", async () => {
    mockLists();
    renderWithApp(<SeasonsPage />, { path: "/seasons?create=c2" });

    const dialog = await screen.findByRole("dialog", { name: "Create New Season" });
    expect(within(dialog).getByRole("combobox", { name: "Club" })).toHaveTextContent("Select a club");
  });

  it("keeps the dialog open with the server's sentence when the season is refused", async () => {
    mockLists({ clubs: [centralStars] });
    server.use(http.post("/api/seasons", () => apiError(403, "FORBIDDEN", "Only the club's staff can do that")));
    const { user, dialog } = await openDialog();

    await user.type(within(dialog).getByLabelText("Season Name*"), "Spring");
    await user.type(within(dialog).getByLabelText("Start Date*"), "2026-06-01");
    await user.click(within(dialog).getByRole("button", { name: "Create Season" }));

    expect(await screen.findByText("Only the club's staff can do that")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Create New Season" })).toBeInTheDocument();
  });

  it("puts a server VALIDATION problem on the field it names", async () => {
    mockLists({ clubs: [centralStars] });
    server.use(
      http.post("/api/seasons", () =>
        apiError(400, "VALIDATION", "Invalid season data", [{ code: "too_big", path: ["name"], message: "That name is taken this year" }]),
      ),
    );
    const { user, dialog } = await openDialog();

    await user.type(within(dialog).getByLabelText("Season Name*"), "Spring");
    await user.type(within(dialog).getByLabelText("Start Date*"), "2026-06-01");
    await user.click(within(dialog).getByRole("button", { name: "Create Season" }));

    expect(await within(dialog).findByText("That name is taken this year")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Season Name*")).toHaveAttribute("aria-invalid", "true");
  });

  it("keeps Create disabled while the season is being saved", async () => {
    mockLists({ clubs: [centralStars] });
    let release: () => void = () => {};
    server.use(
      http.post("/api/seasons", async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return HttpResponse.json(seasonDto({ id: "s3", name: "Spring", clubId: "c1" }), { status: 201 });
      }),
    );
    const { user, dialog } = await openDialog();

    await user.type(within(dialog).getByLabelText("Season Name*"), "Spring");
    await user.type(within(dialog).getByLabelText("Start Date*"), "2026-06-01");
    await user.click(within(dialog).getByRole("button", { name: "Create Season" }));

    expect(await within(dialog).findByRole("button", { name: "Creating..." })).toHaveAttribute("aria-disabled", "true");
    release();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
