import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "@test/msw/server";
import { apiError, mockSignedOut, renderWithApp } from "@test/helpers/web";
import { staffDto } from "@test/helpers/f3-clubs";
import type { ClubStaffDto, CreateStaffInviteResponse, StaffInviteDto } from "@shared/api/clubs";
import { useClubStaff } from "../staff-hooks";
import { ClubStaffCard } from "./club-staff-card";

const owner = { id: "u-owner", name: "Olive Owner", email: "olive@club.test" };
const manager = { id: "u-man", name: "Max Manager", email: "max@club.test" };
const staff: ClubStaffDto = staffDto({ owner, managers: [{ user: manager, role: "manager", createdAt: "2026-10-01T00:00:00.000Z" }] });
const invite = (overrides: Partial<StaffInviteDto> = {}): StaffInviteDto => ({
  id: "i1",
  email: "nina@club.test",
  role: "manager",
  createdAt: "2026-10-19T00:00:00.000Z",
  // 11:30 pm on the 25th in UTC is already the 26th in Auckland.
  expiresAt: "2026-10-25T23:30:00.000Z",
  ...overrides,
});
const TOKEN = "s3cret-token-from-the-server-0123456789abcd";

/** The club's staff as the server holds it: changes answer with it and the next GET returns it. */
let stored: ClubStaffDto;
function serveStaff(initial: ClubStaffDto) {
  stored = initial;
  server.use(http.get("/api/clubs/c1/managers", () => HttpResponse.json(stored)));
}
const answer = (next: ClubStaffDto, status = 200) => {
  stored = next;
  return HttpResponse.json(next, { status });
};

/** The card as club settings shows it: fed by GET /api/clubs/:id/managers. */
function StaffSection({ canInviteOwner }: { canInviteOwner: boolean }) {
  const { data } = useClubStaff("c1", true);
  return data ? <ClubStaffCard clubId="c1" staff={data} canInviteOwner={canInviteOwner} timeZone="Pacific/Auckland" /> : null;
}

function renderCard({ canInviteOwner = false } = {}) {
  return renderWithApp(<StaffSection canInviteOwner={canInviteOwner} />);
}

beforeEach(() => {
  mockSignedOut();
  serveStaff(staff);
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
        stored = { ...staff, invites: [invite()] };
        const body: CreateStaffInviteResponse = { staff: stored, invite: invite(), token: TOKEN };
        return HttpResponse.json(body, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderCard();

    expect(await screen.findByTestId("invite-submit")).toBeDisabled();
    await user.type(screen.getByTestId("invite-email"), "Nina@Club.test");
    await user.click(screen.getByTestId("invite-submit"));

    expect(await screen.findByTestId("invite-created")).toHaveTextContent("Send this link to nina@club.test");
    expect(screen.getByTestId("invite-link")).toHaveValue(`${window.location.origin}/staff-invite#${TOKEN}`);
    // The expiry date is the club's: the 26th in Auckland.
    expect(screen.getByTestId("invite-row-i1")).toHaveTextContent("As manager, until 26 Oct 2026");
    expect(screen.queryByTestId("manager-row-u-new")).not.toBeInTheDocument();
    expect(sent).toEqual({ email: "nina@club.test", role: "manager" });
    expect(screen.getByTestId("invite-email")).toHaveValue("");
  });

  describe("keeps focus on the card when what had it goes (P3REV-MA-FOCUS-AFTER-REMOVE)", () => {
    it("puts focus on the managers heading once a removed manager's row has gone", async () => {
      server.use(http.delete("/api/clubs/c1/managers/u-man", () => answer({ ...staff, managers: [] })));
      const user = userEvent.setup();
      renderCard();

      await user.click(await screen.findByRole("button", { name: "Remove Max Manager" }));
      await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Remove manager" }));

      await waitFor(() => expect(screen.getByRole("heading", { name: "Managers", level: 3 })).toHaveFocus());
    });

    it("puts focus on the invitations heading, or on the card once the last invitation is withdrawn", async () => {
      serveStaff({ ...staff, invites: [invite(), invite({ id: "i2", email: "ari@club.test" })] });
      server.use(
        http.delete("/api/clubs/c1/invites/i1", () => answer({ ...staff, invites: [invite({ id: "i2", email: "ari@club.test" })] })),
        http.delete("/api/clubs/c1/invites/i2", () => answer(staff)),
      );
      const user = userEvent.setup();
      renderCard();

      await user.click(await screen.findByRole("button", { name: "Withdraw the invitation for nina@club.test" }));
      await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Withdraw invitation" }));
      await waitFor(() => expect(screen.getByRole("heading", { name: "Invitations waiting to be accepted" })).toHaveFocus());

      await user.click(screen.getByRole("button", { name: "Withdraw the invitation for ari@club.test" }));
      await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Withdraw invitation" }));
      await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
      expect(screen.queryByRole("heading", { name: "Invitations waiting to be accepted" })).not.toBeInTheDocument();
      await waitFor(() => expect(screen.getByRole("heading", { name: "Managers", level: 2 })).toHaveFocus());
      // One toast for each invitation withdrawn: they stack.
      expect(await screen.findAllByText("Invitation withdrawn")).toHaveLength(2);
    });

    it("moves focus to the new link, ready to copy, instead of leaving it on a disabled Invite", async () => {
      server.use(
        http.post("/api/clubs/c1/invites", () => {
          stored = { ...staff, invites: [invite()] };
          return HttpResponse.json({ staff: stored, invite: invite(), token: TOKEN } satisfies CreateStaffInviteResponse, { status: 201 });
        }),
      );
      const user = userEvent.setup();
      renderCard();

      await user.type(await screen.findByTestId("invite-email"), "nina@club.test");
      await user.click(screen.getByTestId("invite-submit"));

      await waitFor(() => expect(screen.getByTestId("invite-link")).toHaveFocus());
      expect(screen.getByTestId("invite-submit")).toBeDisabled();
    });
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
    serveStaff({ ...staff, invites: [invite()] });
    server.use(http.delete("/api/clubs/c1/invites/i1", () => answer(staff)));
    const user = userEvent.setup();
    renderCard();

    await user.click(await screen.findByRole("button", { name: "Withdraw the invitation for nina@club.test" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Withdraw this invitation?" });
    expect(confirm).toHaveTextContent("The link sent to nina@club.test stops working");
    await user.click(within(confirm).getByRole("button", { name: "Withdraw invitation" }));

    await waitFor(() => expect(screen.queryByTestId("invite-row-i1")).not.toBeInTheDocument());
    expect(await screen.findByText("Invitation withdrawn")).toBeInTheDocument();
  });

  it("wraps a long address instead of cutting it off, so the owner can check where an invitation went (MA-15)", async () => {
    serveStaff({ ...staff, invites: [invite({ email: "jordan.dealer.longname@harbourside-poker.co.nz" })] });
    renderCard();

    const address = await within(await screen.findByTestId("invite-row-i1")).findByText("jordan.dealer.longname@harbourside-poker.co.nz");
    expect(address).toHaveClass("break-all");
    expect(address).not.toHaveClass("truncate");
  });

  it("leaves an admin's owner invitation for an admin to withdraw", async () => {
    serveStaff({ ...staff, invites: [invite({ role: "owner" })] });
    renderCard();

    expect(await screen.findByTestId("invite-row-i1")).toHaveTextContent("As owner");
    expect(screen.queryByRole("button", { name: /Withdraw/ })).not.toBeInTheDocument();
  });

  it("removes a manager once the owner confirms, and not on one tap (P3REV2-CQ-11)", async () => {
    let removed = 0;
    server.use(
      http.delete("/api/clubs/c1/managers/u-man", () => {
        removed += 1;
        return answer({ ...staff, managers: [] });
      }),
    );
    const user = userEvent.setup();
    renderCard();

    await user.click(await screen.findByRole("button", { name: "Remove Max Manager" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Remove Max Manager?" });
    expect(removed).toBe(0);
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(screen.getByTestId("manager-row-u-man")).toBeInTheDocument();
    expect(removed).toBe(0);

    await user.click(screen.getByRole("button", { name: "Remove Max Manager" }));
    await user.click(within(await screen.findByRole("alertdialog", { name: "Remove Max Manager?" })).getByRole("button", { name: "Remove manager" }));

    expect(await screen.findByTestId("no-managers")).toBeInTheDocument();
    expect(removed).toBe(1);
    expect(await screen.findByText("Manager removed")).toBeInTheDocument();
  });

  it("says why a manager could not be removed, and keeps them listed", async () => {
    server.use(http.delete("/api/clubs/c1/managers/u-man", () => apiError(403, "FORBIDDEN", "Only the club's owner or an admin can do that")));
    const user = userEvent.setup();
    renderCard();

    await user.click(await screen.findByRole("button", { name: "Remove Max Manager" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Remove Max Manager?" });
    await user.click(within(confirm).getByRole("button", { name: "Remove manager" }));

    expect(await within(confirm).findByRole("alert")).toHaveTextContent("Only the club's owner or an admin can do that");
    expect(screen.getByTestId("manager-row-u-man")).toBeInTheDocument();
  });

  it("lets an admin invite the owner of a club that has none", async () => {
    let sent: unknown;
    serveStaff({ ...staff, owner: null });
    server.use(
      http.post("/api/clubs/c1/invites", async ({ request }) => {
        sent = await request.json();
        const created = invite({ email: "charlie@eccuity.com", role: "owner" });
        stored = { ...staff, owner: null, invites: [created] };
        return HttpResponse.json({ staff: stored, invite: created, token: TOKEN }, { status: 201 });
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
