import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { server } from "@test/msw/server";
import { apiError, mockSignedIn, mockSignedOut, renderWithApp } from "@test/helpers/web";
import StaffInvitePage from "./staff-invite";

const TOKEN = "s3cret-token-from-the-link-0123456789abcdef";

/** Opens the page as a click on the invitation link does: the secret in the fragment. */
function openLink(hash = `#${TOKEN}`) {
  window.history.replaceState(null, "", `/staff-invite${hash}`);
  return renderWithApp(<StaffInvitePage />, { path: "/staff-invite" });
}

afterEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("StaffInvitePage (SEC-P2REV-03)", () => {
  it("asks a visitor to sign in or sign up first, coming back here, and keeps the secret out of the address bar", async () => {
    mockSignedOut();
    openLink();

    expect(await screen.findByTestId("invite-sign-in")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login?next=%2Fstaff-invite");
    expect(screen.getByRole("link", { name: "Create an account" })).toHaveAttribute("href", "/register?next=%2Fstaff-invite");
    expect(window.location.hash).toBe("");
    expect(screen.queryByTestId("invite-accept")).not.toBeInTheDocument();
  });

  it("accepts with the secret kept while the visitor signed in, and says which club they now run", async () => {
    mockSignedOut();
    const first = openLink();
    await screen.findByTestId("invite-sign-in");
    first.unmount();

    // Back from signing in: no fragment any more.
    let sent: unknown;
    mockSignedIn({ id: "u1", name: "Sam", email: "sam@club.test", role: "full_member" });
    server.use(
      http.post("/api/staff-invites/accept", async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ clubId: "c1", clubName: "Central Stars", role: "manager" });
      }),
    );
    const user = userEvent.setup();
    openLink("");

    await user.click(await screen.findByTestId("invite-accept"));

    expect(await screen.findByTestId("invite-accepted")).toHaveTextContent("You are now a manager of Central Stars.");
    expect(sent).toEqual({ token: TOKEN });
    expect(window.sessionStorage.getItem("pokerpal.staffInvite")).toBeNull();
  });

  it("says when the invitation is for another account, and keeps it to try again after switching", async () => {
    mockSignedIn({ id: "u2", name: "Someone Else", email: "else@club.test", role: "full_member" });
    server.use(
      http.post("/api/staff-invites/accept", () =>
        apiError(403, "INVITE_FOR_ANOTHER_ACCOUNT", "This invitation is for another email address: sign in with the account that uses the address it was sent to"),
      ),
    );
    const user = userEvent.setup();
    openLink();

    await user.click(await screen.findByTestId("invite-accept"));

    expect(await screen.findByTestId("invite-error")).toHaveTextContent("This invitation is for another email address");
    await waitFor(() => expect(window.sessionStorage.getItem("pokerpal.staffInvite")).toBe(TOKEN));
  });

  it("explains that the link is needed when opened without one", async () => {
    mockSignedIn({ id: "u1", name: "Sam", email: "sam@club.test", role: "full_member" });
    openLink("");

    expect(await screen.findByTestId("invite-missing")).toBeInTheDocument();
    expect(screen.queryByTestId("invite-accept")).not.toBeInTheDocument();
  });
});
