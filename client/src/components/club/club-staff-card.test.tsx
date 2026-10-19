import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { useQuery } from "@tanstack/react-query";
import { server } from "@test/msw/server";
import { apiError, mockSignedOut, renderWithApp } from "@test/helpers/web";
import type { ClubStaffDto, CreateStaffInviteResponse, StaffInviteDto } from "@shared/api/clubs";
import { ClubStaffCard, clubStaffQueryKey } from "./club-staff-card";

const owner = { id: "u-owner", name: "Olive Owner", email: "olive@club.test" };
const manager = { id: "u-man", name: "Max Manager", email: "max@club.test" };
const staff: ClubStaffDto = {
  clubId: "c1",
  owner,
  managers: [{ user: manager, role: "manager", createdAt: "2026-10-01T00:00:00.000Z" }],
  invites: [],
};
const invite = (overrides: Partial<StaffInviteDto> = {}): StaffInviteDto => ({
  id: "i1",
  email: "nina@club.test",
  role: "manager",
  createdAt: "2026-10-19T00:00:00.000Z",
  expiresAt: "2026-10-26T00:00:00.000Z",
  ...overrides,
});
const TOKEN = "s3cret-token-from-the-server-0123456789abcd";

/** The card as club settings shows it: fed by GET /api/clubs/:id/managers. */
function StaffSection({ canInviteOwner }: { canInviteOwner: boolean }) {
  const { data } = useQuery<ClubStaffDto>({ queryKey: clubStaffQueryKey("c1") });
  return data ? <ClubStaffCard clubId="c1" staff={data} canInviteOwner={canInviteOwner} /> : null;
}

function renderCard({ canInviteOwner = false } = {}) {
  return renderWithApp(<StaffSection canInviteOwner={canInviteOwner} />);
}

beforeEach(() => {
  // jsdom has no pointer capture or scrollIntoView, which Radix's Select calls when it opens.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  mockSignedOut();
  server.use(http.get("/api/clubs/c1/managers", () => HttpResponse.json(staff)));
});

describe("ClubStaffCard", () => {
  it("lists the owner and the managers", async () => {
    renderCard();

    expect(await screen.findByTestId("staff-owner")).toHaveTextContent("Olive Owner");
    expect(screen.getByTestId("manager-row-u-man")).toHaveTextContent("max@club.test");
    expect(screen.queryByTestId("invite-role")).not.toBeInTheDocument();
  });

  it("invites a manager by email and shows the link to send, never adding anyone itself (SEC-P2REV-03)", async () => {
    let sent: unknown;
    server.use(
      http.post("/api/clubs/c1/invites", async ({ request }) => {
        sent = await request.json();
        const body: CreateStaffInviteResponse = { staff: { ...staff, invites: [invite()] }, invite: invite(), token: TOKEN };
        return HttpResponse.json(body, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderCard();

    await user.type(await screen.findByTestId("invite-email"), "nina@club.test");
    await user.click(screen.getByTestId("invite-submit"));

    expect(await screen.findByTestId("invite-created")).toHaveTextContent("Send this link to nina@club.test");
    expect(screen.getByTestId("invite-link")).toHaveValue(`${window.location.origin}/staff-invite#${TOKEN}`);
    expect(screen.getByTestId("invite-row-i1")).toHaveTextContent("As manager");
    expect(screen.queryByTestId("manager-row-u-new")).not.toBeInTheDocument();
    expect(sent).toEqual({ email: "nina@club.test", role: "manager" });
    expect(screen.getByTestId("invite-email")).toHaveValue("");
  });

  it("shows why an invitation could not be made", async () => {
    server.use(http.post("/api/clubs/c1/invites", () => apiError(409, "ALREADY_MANAGER", "That address belongs to one of the club's managers")));
    const user = userEvent.setup();
    renderCard();

    await user.type(await screen.findByTestId("invite-email"), "max@club.test");
    await user.click(screen.getByTestId("invite-submit"));

    expect(await screen.findByRole("alert")).toHaveTextContent("That address belongs to one of the club's managers");
  });

  it("withdraws an invitation still waiting", async () => {
    server.use(
      http.get("/api/clubs/c1/managers", () => HttpResponse.json({ ...staff, invites: [invite()] })),
      http.delete("/api/clubs/c1/invites/i1", () => HttpResponse.json(staff)),
    );
    const user = userEvent.setup();
    renderCard();

    await user.click(await screen.findByRole("button", { name: "Withdraw the invitation for nina@club.test" }));

    await waitFor(() => expect(screen.queryByTestId("invite-row-i1")).not.toBeInTheDocument());
  });

  it("leaves an admin's owner invitation for an admin to withdraw", async () => {
    server.use(http.get("/api/clubs/c1/managers", () => HttpResponse.json({ ...staff, invites: [invite({ role: "owner" })] })));
    renderCard();

    expect(await screen.findByTestId("invite-row-i1")).toHaveTextContent("As owner");
    expect(screen.queryByRole("button", { name: /Withdraw/ })).not.toBeInTheDocument();
  });

  it("removes a manager", async () => {
    server.use(http.delete("/api/clubs/c1/managers/u-man", () => HttpResponse.json({ ...staff, managers: [] })));
    const user = userEvent.setup();
    renderCard();

    await user.click(await screen.findByRole("button", { name: "Remove Max Manager" }));

    expect(await screen.findByTestId("no-managers")).toBeInTheDocument();
  });

  it("lets an admin invite the owner of a club that has none", async () => {
    let sent: unknown;
    server.use(
      http.get("/api/clubs/c1/managers", () => HttpResponse.json({ ...staff, owner: null })),
      http.post("/api/clubs/c1/invites", async ({ request }) => {
        sent = await request.json();
        const created = invite({ email: "charlie@eccuity.com", role: "owner" });
        return HttpResponse.json({ staff: { ...staff, owner: null, invites: [created] }, invite: created, token: TOKEN }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderCard({ canInviteOwner: true });

    expect(await screen.findByTestId("staff-owner")).toHaveTextContent("No owner yet");
    await user.type(screen.getByTestId("invite-email"), "charlie@eccuity.com");
    await user.click(screen.getByTestId("invite-role"));
    await user.click(await screen.findByRole("option", { name: "Owner" }));
    await user.click(screen.getByTestId("invite-submit"));

    expect(await screen.findByTestId("invite-created")).toHaveTextContent("They become the club's owner");
    expect(sent).toEqual({ email: "charlie@eccuity.com", role: "owner" });
  });
});
