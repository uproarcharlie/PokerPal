import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@test/msw/server";
import { installFakeXhr } from "@test/helpers/fake-xhr";
import { apiError, mockSignedIn, renderWithApp, type MockUser } from "@test/helpers/web";
import { clubDto, LOGO_URL, MANAGER_VIEW, NEW_LOGO_URL, OWNER_VIEW, staffDto } from "@test/helpers/f3-clubs";
import type { ClubDto } from "@shared/api/public";
import { qk } from "@/lib/api/query-keys";
import ClubSettingsPage from "./club-settings";

const admin: MockUser = { id: "u-admin", name: "Ada Admin", email: "ada@club.test", role: "admin" };
const member: MockUser = { id: "u-member", name: "Max Member", email: "max@club.test", role: "full_member" };

let club: ClubDto;
let clubReads = 0;
let staffReads = 0;
let sent: Record<string, unknown> | null;

/** The club as the server holds it: PUT merges into it and answers with it, as the API does. */
function serveClub(initial: ClubDto) {
  club = initial;
  server.use(
    http.get("/api/clubs/c1", () => {
      clubReads += 1;
      return HttpResponse.json(club);
    }),
    http.put("/api/clubs/c1", async ({ request }) => {
      sent = (await request.json()) as Record<string, unknown>;
      club = { ...club, ...sent } as ClubDto;
      return HttpResponse.json(club);
    }),
  );
}

beforeEach(() => {
  clubReads = 0;
  staffReads = 0;
  sent = null;
  mockSignedIn(member);
  server.use(
    http.get("/api/clubs/c1/managers", () => {
      staffReads += 1;
      return HttpResponse.json(staffDto());
    }),
  );
  serveClub(
    clubDto({
      viewer: MANAGER_VIEW,
      description: "<p>Fridays at Club 2020</p>",
      imageUrl: LOGO_URL,
      address: "57 Princes Street, Onehunga",
      timezone: "Pacific/Chatham",
      facebookUrl: "https://facebook.com/centralstars",
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

function renderSettings() {
  return renderWithApp(<ClubSettingsPage />, { path: "/clubs/c1/settings", route: "/clubs/:id/settings" });
}

const save = () => screen.getByRole("button", { name: "Save Changes" });

describe("ClubSettingsPage: who sees what", () => {
  it("shows the owner or an admin every tab, the Managers tab and Delete Club", async () => {
    mockSignedIn(admin);
    serveClub(clubDto({ viewer: OWNER_VIEW }));
    const user = userEvent.setup();
    renderSettings();

    expect(await screen.findByRole("heading", { level: 1, name: "Central Stars Settings" })).toBeInTheDocument();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Profile", "Social links", "Tournaments", "Colours", "Managers"]);
    expect(screen.getByRole("button", { name: /Delete Club/ })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Managers" }));
    expect(await screen.findByTestId("staff-owner")).toHaveTextContent("No owner yet");
    // An admin may also invite a new owner (SEC-P2REV-03).
    expect(screen.getByTestId("invite-role")).toBeInTheDocument();
  });

  it("lets a manager edit the club but not its staff or deletion, and never asks for its staff", async () => {
    renderSettings();

    expect(await screen.findByText("Central Stars Settings")).toBeInTheDocument();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Profile", "Social links", "Tournaments", "Colours"]);
    expect(screen.queryByRole("button", { name: /Delete Club/ })).not.toBeInTheDocument();
    expect(staffReads).toBe(0);
  });

  it("turns away someone who does not run the club", async () => {
    serveClub(clubDto());
    renderSettings();

    expect(await screen.findByText("Access Denied")).toBeInTheDocument();
    expect(screen.queryByText("Central Stars Settings")).not.toBeInTheDocument();
  });

  it("says a club that does not exist was not found, and a failed load is an error to retry", async () => {
    server.use(http.get("/api/clubs/c1", () => apiError(404, "NOT_FOUND", "Club not found")));
    const { unmount } = renderSettings();
    expect(await screen.findByText("Club Not Found")).toBeInTheDocument();
    unmount();

    server.use(http.get("/api/clubs/c1", () => apiError(503, "SERVICE_UNAVAILABLE", "The server is busy. Please try again.")));
    renderSettings();
    expect(await screen.findByRole("alert")).toHaveTextContent("The server is busy. Please try again.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("ClubSettingsPage: tournament defaults and colours (round 5)", () => {
  it("puts the club's tables and the sign-up photo rule on the Tournaments tab, and saves the rule with one tap", async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(await screen.findByRole("tab", { name: "Tournaments" }));
    expect(screen.getByTestId("club-table-defaults")).toBeVisible();
    await user.click(within(screen.getByTestId("signup-photo-field")).getByRole("switch", { name: "Require a photo to sign up" }));

    await waitFor(() => expect(sent).toEqual({ requireSignupPhoto: true }));
  });

  it("puts the club's colours, with their presets, on the Colours tab", async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(await screen.findByRole("tab", { name: "Colours" }));
    expect(screen.getByText("Club colours")).toBeVisible();
    expect(screen.getByRole("button", { name: /Central Stars/ })).toBeVisible();
  });
});

describe("ClubSettingsPage: Profile", () => {
  it("starts from the club as stored: its logo, description, address and time zone (img-03, CC-02)", async () => {
    renderSettings();

    expect(await screen.findByRole("img", { name: "Upload preview" })).toHaveAttribute("src", LOGO_URL);
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
    expect(await screen.findByRole("textbox", { name: "Description" })).toHaveTextContent("Fridays at Club 2020");
    expect(screen.getByLabelText("Club Name*")).toHaveValue("Central Stars");
    expect(screen.getByLabelText("Address")).toHaveValue("57 Princes Street, Onehunga");
    expect(screen.getByLabelText("Time zone")).toHaveValue("Pacific/Chatham");
  });

  it("names the club's rake (\"AP\") with one tap, and saves it with the profile", async () => {
    const user = userEvent.setup();
    const { queryClient } = renderSettings();
    // A tournament's prize pool and TV display seen earlier carry the old name (P4REV4-CQ-04).
    queryClient.setQueryData(qk.tournaments.prizePool("t1"), { rakeLabel: "Rake" });
    queryClient.setQueryData(qk.tournaments.display("t1"), { money: { rakeLabel: "Rake" } });
    const label = await screen.findByLabelText("Name for the rake");
    expect(label).toHaveValue("");
    expect(label).toHaveAccessibleDescription(/Leave it blank for .Rake./);

    await user.click(screen.getByRole("button", { name: "AP" }));
    expect(label).toHaveValue("AP");
    expect(screen.getByRole("button", { name: "AP" })).toHaveAttribute("aria-pressed", "true");
    await user.click(save());

    expect(await screen.findByText("Club updated successfully!")).toBeInTheDocument();
    expect(sent).toMatchObject({ rakeLabel: "AP" });
    expect(screen.getByLabelText("Name for the rake")).toHaveValue("AP");
    expect(queryClient.getQueryState(qk.tournaments.prizePool("t1"))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(qk.tournaments.display("t1"))?.isInvalidated).toBe(true);
  });

  it("saves the profile fields only, says so, and shows what the server stored", async () => {
    const user = userEvent.setup();
    renderSettings();
    const name = await screen.findByLabelText("Club Name*");
    const reads = clubReads;

    await user.clear(name);
    await user.type(name, "Central Stars NZ");
    await user.clear(screen.getByLabelText("Address"));
    await user.type(screen.getByLabelText("Address"), "Club 2020, Onehunga");
    await user.selectOptions(screen.getByLabelText("Time zone"), "Pacific/Auckland");
    await user.click(save());

    expect(await screen.findByText("Club updated successfully!")).toBeInTheDocument();
    expect(sent).toEqual({
      name: "Central Stars NZ",
      slug: "central-stars",
      description: "<p>Fridays at Club 2020</p>",
      imageUrl: LOGO_URL,
      address: "Club 2020, Onehunga",
      timezone: "Pacific/Auckland",
      rakeLabel: null,
    });
    await waitFor(() => expect(clubReads).toBeGreaterThan(reads));
    expect(screen.getByRole("heading", { level: 1, name: "Central Stars NZ Settings" })).toBeInTheDocument();
  });

  it("sets a club without a time zone to the one its pages have always used", async () => {
    serveClub(clubDto({ viewer: MANAGER_VIEW, timezone: null }));
    const user = userEvent.setup();
    renderSettings();

    expect(await screen.findByLabelText("Time zone")).toHaveValue("Pacific/Auckland");
    await user.click(save());

    await waitFor(() => expect(sent?.timezone).toBe("Pacific/Auckland"));
  });

  it("keeps an older slug that breaks today's rules when it is left alone, and checks one that is changed", async () => {
    serveClub(clubDto({ viewer: MANAGER_VIEW, slug: "Old_Slug" }));
    const user = userEvent.setup();
    renderSettings();

    await user.click(await screen.findByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(sent?.slug).toBe("Old_Slug"));

    sent = null;
    await user.clear(screen.getByLabelText("URL Slug*"));
    await user.type(screen.getByLabelText("URL Slug*"), "admin");
    await user.click(save());

    expect(await screen.findByText("That URL is reserved; choose another")).toBeInTheDocument();
    expect(sent).toBeNull();
  });

  it("puts a taken slug under the slug field", async () => {
    server.use(http.put("/api/clubs/c1", () => apiError(409, "SLUG_TAKEN", "That club URL is already taken")));
    const user = userEvent.setup();
    renderSettings();

    const slug = await screen.findByLabelText("URL Slug*");
    await user.clear(slug);
    await user.type(slug, "other-club");
    await user.click(save());

    expect(await screen.findByText("That club URL is already taken")).toBeInTheDocument();
    expect(slug).toHaveAttribute("aria-invalid", "true");
  });

  it("says why any other save was refused", async () => {
    server.use(http.put("/api/clubs/c1", () => apiError(403, "FORBIDDEN", "Only the club's owner, its managers or an admin can do that")));
    const user = userEvent.setup();
    renderSettings();

    await user.click(await screen.findByRole("button", { name: "Save Changes" }));

    expect(await screen.findByText("Could not save the club")).toBeInTheDocument();
    expect(screen.getByText("Only the club's owner, its managers or an admin can do that")).toBeInTheDocument();
  });

  it("keeps Save disabled while a new logo uploads, then saves it (img-15)", async () => {
    const uploads = installFakeXhr();
    const user = userEvent.setup();
    renderSettings();
    await screen.findByRole("img", { name: "Upload preview" });

    const input = document.querySelector('input[type="file"]:not([capture])') as HTMLInputElement;
    await user.upload(input, new File([new Uint8Array(64)], "logo.png", { type: "image/png" }));
    await waitFor(() => expect(uploads).toHaveLength(1));
    expect(screen.getByRole("button", { name: "Uploading image…" })).toBeDisabled();

    act(() => uploads[0].respond(201, { kind: "club_logo", url: NEW_LOGO_URL, variants: {}, width: 512, height: 512, dominantColor: null }));
    await user.click(await screen.findByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(sent?.imageUrl).toBe(NEW_LOGO_URL));
  });

  it("removes the logo by saving none", async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(await screen.findByRole("button", { name: "Remove" }));
    await user.click(save());

    await waitFor(() => expect(sent).not.toBeNull());
    expect(sent?.imageUrl).toBeNull();
  });

  it("never wipes a half-typed edit when the club is refreshed from the server", async () => {
    const user = userEvent.setup();
    const { queryClient } = renderSettings();
    const name = await screen.findByLabelText("Club Name*");

    await user.type(name, " (draft)");
    club = { ...club, description: "<p>Changed elsewhere</p>" };
    await act(() => queryClient.invalidateQueries({ queryKey: qk.clubs.detail("c1") }));

    expect(name).toHaveValue("Central Stars (draft)");
  });

  it("keeps a half-made edit while another tab is open", async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.type(await screen.findByLabelText("Club Name*"), " NZ");
    await user.click(screen.getByRole("tab", { name: "Social links" }));
    await user.click(screen.getByRole("tab", { name: "Profile" }));

    expect(screen.getByLabelText("Club Name*")).toHaveValue("Central Stars NZ");
  });
});

describe("ClubSettingsPage: Social links", () => {
  it("saves the links only, blank ones as none", async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(await screen.findByRole("tab", { name: "Social links" }));
    const panel = screen.getByRole("tabpanel", { name: "Social links" });
    expect(within(panel).getByLabelText("Facebook")).toHaveValue("https://facebook.com/centralstars");
    await user.clear(within(panel).getByLabelText("Facebook"));
    await user.type(within(panel).getByLabelText("Website"), "https://centralstars.co.nz");
    await user.click(within(panel).getByRole("button", { name: "Save Changes" }));

    expect(await screen.findByText("Club updated successfully!")).toBeInTheDocument();
    expect(sent).toEqual({
      discordUrl: null,
      twitterUrl: null,
      facebookUrl: null,
      instagramUrl: null,
      websiteUrl: "https://centralstars.co.nz",
    });
  });

  it("refuses a link that is not an http(s) address before sending it", async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(await screen.findByRole("tab", { name: "Social links" }));
    const panel = screen.getByRole("tabpanel", { name: "Social links" });
    await user.type(within(panel).getByLabelText("Discord"), "javascript:alert(1)");
    await user.click(within(panel).getByRole("button", { name: "Save Changes" }));

    expect(await within(panel).findByText("Only http and https links are allowed")).toBeInTheDocument();
    expect(sent).toBeNull();
  });
});

describe("ClubSettingsPage: Delete Club", () => {
  const CLUB_NAME = clubDto().name;
  beforeEach(() => serveClub(clubDto({ viewer: OWNER_VIEW })));

  it("deletes the club once confirmed, and returns to the clubs", async () => {
    const deleted = vi.fn();
    server.use(
      http.delete("/api/clubs/c1", () => {
        deleted();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    const { location } = renderSettings();

    await user.click(await screen.findByRole("button", { name: /Delete Club/ }));
    const dialog = await screen.findByRole("alertdialog", { name: "Delete Club" });
    expect(within(dialog).getByRole("button", { name: "Delete club" })).toBeDisabled();
    await user.type(within(dialog).getByLabelText(`Type ${CLUB_NAME} to confirm`), CLUB_NAME);
    expect(deleted).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Delete club" }));

    await waitFor(() => expect(location()).toBe("/clubs"));
    expect(deleted).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Club deleted successfully!")).toBeInTheDocument();
  });

  it("keeps the dialog open with the server's reason when the delete is refused", async () => {
    server.use(http.delete("/api/clubs/c1", () => apiError(403, "FORBIDDEN", "Only the club's owner or an admin can do that")));
    const user = userEvent.setup();
    const { location } = renderSettings();

    await user.click(await screen.findByRole("button", { name: /Delete Club/ }));
    const dialog = await screen.findByRole("alertdialog", { name: "Delete Club" });
    await user.type(within(dialog).getByLabelText(`Type ${CLUB_NAME} to confirm`), CLUB_NAME);
    await user.click(within(dialog).getByRole("button", { name: "Delete club" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Only the club's owner or an admin can do that");
    expect(location()).toBe("/clubs/c1/settings");
  });
});
