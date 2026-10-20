import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import type { Viewer } from "@shared/api/common";
import type { PublicPointsAllocation, PublicPointsSystem } from "@shared/api/public";
import { clubDto, pointsSystemDto, seasonDto } from "@test/helpers/f4-seasons";
import { apiError, mockSignedIn, renderWithApp, type MockUser } from "@test/helpers/web";
import { server } from "@test/msw/server";
import SeasonSettingsPage from "./season-settings";

const owner: MockUser = { id: "u-owner", name: "Olive Owner", email: "olive@club.test", role: "full_member" };

const season = seasonDto({ id: "s1", name: "Spring 2026", clubId: "c1" });
const OWNER: Viewer = { canManage: true, canOwn: true };
const MANAGER: Viewer = { canManage: true, canOwn: false };

const standard = pointsSystemDto({ id: "ps1", seasonId: "s1", name: "Standard", participationPoints: 10, knockoutPoints: 5 });
const standardAllocations: PublicPointsAllocation[] = [
  { id: "a1", pointsSystemId: "ps1", position: 1, positionEnd: null, points: 100, description: "Winner" },
  { id: "a2", pointsSystemId: "ps1", position: 4, positionEnd: 10, points: 25, description: null },
];

function mockSeason({ viewer = OWNER, systems = [standard] }: { viewer?: Viewer; systems?: PublicPointsSystem[] } = {}) {
  const calls = { season: 0, systems: 0 };
  server.use(
    http.get("/api/seasons/s1", () => {
      calls.season += 1;
      return HttpResponse.json(season);
    }),
    http.get("/api/clubs/c1", () => HttpResponse.json(clubDto({ id: "c1", name: "Central Stars", viewer }))),
    http.get("/api/seasons/s1/points-systems", () => {
      calls.systems += 1;
      return HttpResponse.json(systems);
    }),
    http.get("/api/points-systems/:id/allocations", ({ params }) =>
      HttpResponse.json(params.id === "ps1" ? standardAllocations : []),
    ),
  );
  return calls;
}

function renderSettings() {
  const user = userEvent.setup();
  return { user, ...renderWithApp(<SeasonSettingsPage />, { path: "/seasons/s1/settings", route: "/seasons/:id/settings" }) };
}

beforeEach(() => mockSignedIn(owner));

describe("SeasonSettingsPage: profile", () => {
  it("leaves the end date empty for a season saved with the legacy 1970 end, so a rename is not refused for it (P3REV2-CQ-04)", async () => {
    mockSeason();
    server.use(http.get("/api/seasons/s1", () => HttpResponse.json({ ...season, endDate: "1970-01-01T00:00:00.000Z" })));
    renderSettings();

    expect(await screen.findByLabelText("Season Name*")).toHaveValue("Spring 2026");
    expect(screen.getByLabelText("End Date")).toHaveValue("");
  });

  it("fills the form from the season and shows its club read-only", async () => {
    mockSeason();
    renderSettings();

    expect(await screen.findByLabelText("Season Name*")).toHaveValue("Spring 2026");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Spring 2026 Settings");
    expect(screen.getByLabelText("Start Date*")).toHaveValue("2026-03-01");
    expect(screen.getByLabelText("End Date")).toHaveValue("");
    expect(screen.getByRole("checkbox", { name: "Active Season" })).toBeChecked();
    // A season never changes club (the server refuses with CANNOT_MOVE), so there is nothing to choose.
    expect(screen.getByLabelText("Club")).toHaveValue("Central Stars");
    expect(screen.getByLabelText("Club")).toHaveAttribute("readonly");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Seasons" })).toHaveAttribute("href", "/seasons");
  });

  it("saves the changes without the club, a blank end date meaning none", async () => {
    const calls = mockSeason();
    let sent: unknown;
    server.use(
      http.put("/api/seasons/s1", async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ ...season, name: "Spring Series" });
      }),
    );
    const { user } = renderSettings();

    const name = await screen.findByLabelText("Season Name*");
    await user.clear(name);
    await user.type(name, "Spring Series");
    await user.click(screen.getByRole("checkbox", { name: "Active Season" }));
    const seasonLoads = calls.season;
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(await screen.findByText("Season updated successfully!")).toBeInTheDocument();
    expect(sent).toEqual({ name: "Spring Series", startDate: "2026-03-01T00:00:00.000Z", endDate: null, isActive: false });
    await waitFor(() => expect(calls.season).toBeGreaterThan(seasonLoads));
  });

  it("puts the server's VALIDATION problem on the field it names", async () => {
    mockSeason();
    server.use(
      http.put("/api/seasons/s1", () =>
        apiError(400, "VALIDATION", "Invalid season data", [
          { code: "custom", path: ["endDate"], message: "The end date must be on or after the start date" },
        ]),
      ),
    );
    const { user } = renderSettings();

    await user.type(await screen.findByLabelText("End Date"), "2026-12-01");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(await screen.findByText("The end date must be on or after the start date")).toBeInTheDocument();
    expect(screen.getByLabelText("End Date")).toHaveAttribute("aria-invalid", "true");
  });

  it("shows any other refusal as the server's sentence", async () => {
    mockSeason();
    server.use(http.put("/api/seasons/s1", () => apiError(403, "FORBIDDEN", "Only the club's staff can do that")));
    const { user } = renderSettings();

    await user.click(await screen.findByRole("button", { name: "Save Changes" }));

    expect(await screen.findByText("Only the club's staff can do that")).toBeInTheDocument();
  });

  it("requires a name and a start date", async () => {
    mockSeason();
    const { user } = renderSettings();

    await user.clear(await screen.findByLabelText("Season Name*"));
    await user.clear(screen.getByLabelText("Start Date*"));
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(await screen.findAllByText("Required")).toHaveLength(2);
  });
});

describe("SeasonSettingsPage: who sees what", () => {
  it("offers Delete Season to the club's owner or an admin only", async () => {
    mockSeason({ viewer: MANAGER });
    renderSettings();

    expect(await screen.findByLabelText("Season Name*")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Season" })).not.toBeInTheDocument();
  });

  it("turns away someone who does not run the club", async () => {
    mockSeason({ viewer: { canManage: false, canOwn: false } });
    renderSettings();

    expect(await screen.findByText("Access Denied")).toBeInTheDocument();
    expect(screen.queryByLabelText("Season Name*")).not.toBeInTheDocument();
  });

  it("says when the season does not exist", async () => {
    server.use(http.get("/api/seasons/s1", () => apiError(404, "NOT_FOUND", "Season not found")));
    renderSettings();

    expect(await screen.findByText("Season Not Found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Seasons" })).toHaveAttribute("href", "/seasons");
  });

  it("shows a failed load with a retry", async () => {
    mockSeason();
    let fail = true;
    server.use(http.get("/api/seasons/s1", () => (fail ? apiError(500, "INTERNAL", "Something went wrong on our side") : HttpResponse.json(season))));
    const { user } = renderSettings();

    expect(await screen.findByRole("alert")).toHaveTextContent("The season could not be loaded");
    fail = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByLabelText("Season Name*")).toHaveValue("Spring 2026");
  });
});

describe("SeasonSettingsPage: deleting the season", () => {
  it("deletes it after a confirmation that says what happens to its tournaments, then goes back to the seasons", async () => {
    mockSeason();
    let deleted = false;
    server.use(
      http.delete("/api/seasons/s1", () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { user, location } = renderSettings();

    await user.click(await screen.findByRole("button", { name: "Delete Season" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Delete Spring 2026?" });
    expect(dialog).toHaveTextContent("Its tournaments and their results are kept");
    await user.click(within(dialog).getByRole("button", { name: "Delete Season" }));

    await waitFor(() => expect(location()).toBe("/seasons"));
    expect(deleted).toBe(true);
    expect(screen.getByText("Season deleted successfully!")).toBeInTheDocument();
  });

  it("keeps the confirmation open with the server's sentence when the delete is refused", async () => {
    mockSeason();
    server.use(http.delete("/api/seasons/s1", () => apiError(403, "FORBIDDEN", "Only the club's owner or an admin can do that")));
    const { user, location } = renderSettings();

    await user.click(await screen.findByRole("button", { name: "Delete Season" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete Season" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Only the club's owner or an admin can do that");
    expect(location()).toBe("/seasons/s1/settings");
  });
});

describe("SeasonSettingsPage: points systems", () => {
  it("lists the season's points systems with the points each position earns", async () => {
    mockSeason();
    const { user } = renderSettings();

    await user.click(await screen.findByRole("tab", { name: "Points Systems" }));

    const card = await screen.findByTestId("points-system-ps1");
    expect(card).toHaveTextContent("Participation: 10 pts");
    expect(card).toHaveTextContent("Knockout: 5 pts");
    const positions = await within(card).findByRole("list", { name: "Standard position points" });
    expect(within(positions).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "1st: 100 pts (Winner)",
      "4th–10th: 25 pts",
    ]);
  });

  it("says when the season has no points systems yet", async () => {
    mockSeason({ systems: [] });
    const { user } = renderSettings();

    await user.click(await screen.findByRole("tab", { name: "Points Systems" }));

    expect(await screen.findByText(/No points systems yet/)).toBeInTheDocument();
  });

  it("deletes a points system only after a confirmation, then refreshes the list", async () => {
    const calls = mockSeason();
    let deleted: string | undefined;
    server.use(
      http.delete("/api/points-systems/:id", ({ params }) => {
        deleted = String(params.id);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { user } = renderSettings();

    await user.click(await screen.findByRole("tab", { name: "Points Systems" }));
    await user.click(await screen.findByRole("button", { name: "Delete Standard" }));
    expect(deleted).toBeUndefined();
    const dialog = await screen.findByRole("alertdialog", { name: "Delete Standard?" });
    const loads = calls.systems;
    await user.click(within(dialog).getByRole("button", { name: "Delete points system" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(deleted).toBe("ps1");
    expect(calls.systems).toBeGreaterThan(loads);
    expect(screen.getByText("Points system deleted successfully!")).toBeInTheDocument();
  });

  it("keeps focus on the list's heading once the deleted system's card has gone (P3REV-MA-FOCUS-AFTER-REMOVE)", async () => {
    let systems = [standard];
    mockSeason();
    server.use(
      http.get("/api/seasons/s1/points-systems", () => HttpResponse.json(systems)),
      http.delete("/api/points-systems/:id", () => {
        systems = [];
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { user } = renderSettings();

    await user.click(await screen.findByRole("tab", { name: "Points Systems" }));
    await user.click(await screen.findByRole("button", { name: "Delete Standard" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete points system" }));

    expect(await screen.findByText(/No points systems yet/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Existing Points Systems" })).toHaveFocus());
  });

  it("keeps a half-typed profile while the other tab is open", async () => {
    mockSeason();
    const { user } = renderSettings();

    await user.type(await screen.findByLabelText("Season Name*"), " (draft)");
    await user.click(screen.getByRole("tab", { name: "Points Systems" }));
    await user.click(screen.getByRole("tab", { name: "Profile" }));

    expect(screen.getByLabelText("Season Name*")).toHaveValue("Spring 2026 (draft)");
  });
});
