import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@test/msw/server";
import { apiError, mockSignedIn, renderWithApp, type MockUser } from "@test/helpers/web";
import ClubSettings from "./club-settings";

const club = { id: "c1", name: "Central Stars", slug: "central-stars", description: "<p>Fridays</p>", imageUrl: null };
const staff = { clubId: "c1", owner: null, managers: [], invites: [] };

const admin: MockUser = { id: "u-admin", name: "Ada Admin", email: "ada@club.test", role: "admin" };
const member: MockUser = { id: "u-member", name: "Max Member", email: "max@club.test", role: "full_member" };

function mockClub(canManage: boolean, staffAnswer: () => Response) {
  server.use(
    http.get("/api/clubs/c1", () => HttpResponse.json({ ...club, viewer: { canManage } })),
    http.get("/api/clubs/c1/managers", staffAnswer),
  );
}

function renderSettings() {
  return renderWithApp(<ClubSettings />, { path: "/clubs/c1/settings", route: "/clubs/:id/settings" });
}

describe("ClubSettings", () => {
  it("shows the editor, the Managers tab and Delete to someone who may change the club's staff", async () => {
    mockSignedIn(admin);
    mockClub(true, () => HttpResponse.json(staff));
    const user = userEvent.setup();
    renderSettings();

    await user.click(await screen.findByRole("tab", { name: "Managers" }));

    expect(await screen.findByTestId("staff-owner")).toHaveTextContent("No owner yet");
    // An admin may also invite a new owner (SEC-P2REV-03).
    expect(screen.getByTestId("invite-role")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Delete Club/ })).toBeInTheDocument();
  });

  it("lets a manager edit the club but not its staff or deletion (the staff list answers 403)", async () => {
    mockSignedIn(member);
    mockClub(true, () => apiError(403, "FORBIDDEN", "Only the club's owner can do that"));
    renderSettings();

    expect(await screen.findByText("Central Stars Settings")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Edit Profile" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Managers" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete Club/ })).not.toBeInTheDocument();
  });

  it("turns away someone who does not run the club", async () => {
    mockSignedIn(member);
    mockClub(false, () => apiError(403, "FORBIDDEN", "Not yours"));
    renderSettings();

    expect(await screen.findByText("Access Denied")).toBeInTheDocument();
    expect(screen.queryByText("Central Stars Settings")).not.toBeInTheDocument();
  });
});
