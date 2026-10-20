import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@test/msw/server";
import { sessionUser } from "@test/helpers/f5-dto";
import { apiError, renderWithApp } from "@test/helpers/web";
import { useAuth } from "@/contexts/auth-context";
import SettingsPage from "./settings";

const TESS = sessionUser({ id: "u1", name: "Tess TD", email: "tess@club.test", phone: "021 555 0101" });

function signedInAs(user = TESS) {
  server.use(http.get("/api/auth/me", () => HttpResponse.json({ user, impersonator: null, managedClubIds: [] })));
}

/** The name the rest of the app (the sidebar) shows for the signed-in user. */
function SignedInName() {
  const { user } = useAuth();
  return <p data-testid="signed-in-as">{user?.name}</p>;
}

function renderSettings() {
  return renderWithApp(
    <>
      <SettingsPage />
      <SignedInName />
    </>,
    { path: "/settings" },
  );
}

const section = (name: string) => screen.getByRole("region", { name });

describe("Settings page", () => {
  it("shows the account's id and role, and the profile as stored", async () => {
    signedInAs();
    renderSettings();

    expect(await screen.findByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    const account = section("Account Information");
    expect(within(account).getByText("u1")).toBeInTheDocument();
    expect(within(account).getByText("Full Member")).toBeInTheDocument();
    const profile = section("Profile Information");
    expect(within(profile).getByLabelText("Full Name")).toHaveValue("Tess TD");
    expect(within(profile).getByLabelText("Email")).toHaveValue("tess@club.test");
    expect(within(profile).getByLabelText("Phone (Optional)")).toHaveValue("021 555 0101");
  });

  it("saves the profile, clears a removed phone, and shows the new name everywhere without a reload", async () => {
    signedInAs();
    let body: unknown;
    server.use(
      http.put("/api/auth/profile", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ message: "Profile updated successfully", user: { ...TESS, name: "Tess Tuhoe", phone: null } });
      }),
    );
    renderSettings();

    const profile = await screen.findByRole("region", { name: "Profile Information" });
    await userEvent.clear(within(profile).getByLabelText("Full Name"));
    await userEvent.type(within(profile).getByLabelText("Full Name"), "Tess Tuhoe");
    await userEvent.clear(within(profile).getByLabelText("Phone (Optional)"));
    await userEvent.click(within(profile).getByRole("button", { name: "Save Changes" }));

    expect(await screen.findByText("Your profile has been updated successfully.")).toBeInTheDocument();
    expect(body).toEqual({ name: "Tess Tuhoe", email: "tess@club.test", phone: null });
    expect(screen.getByTestId("signed-in-as")).toHaveTextContent("Tess Tuhoe");
    expect(within(profile).getByLabelText("Full Name")).toHaveValue("Tess Tuhoe");
  });

  it("puts an email someone else has under the email field", async () => {
    signedInAs();
    server.use(http.put("/api/auth/profile", () => apiError(409, "EMAIL_TAKEN", "An account with that email already exists")));
    renderSettings();

    const profile = await screen.findByRole("region", { name: "Profile Information" });
    await userEvent.clear(within(profile).getByLabelText("Email"));
    await userEvent.type(within(profile).getByLabelText("Email"), "taken@club.test");
    await userEvent.click(within(profile).getByRole("button", { name: "Save Changes" }));

    expect(await within(profile).findByText("An account with that email already exists")).toBeInTheDocument();
    expect(screen.getByTestId("signed-in-as")).toHaveTextContent("Tess TD");
  });

  it("says when the profile could not be saved", async () => {
    signedInAs();
    server.use(http.put("/api/auth/profile", () => apiError(500, "INTERNAL", "Something went wrong on our side. Please try again.")));
    renderSettings();

    const profile = await screen.findByRole("region", { name: "Profile Information" });
    await userEvent.click(within(profile).getByRole("button", { name: "Save Changes" }));

    expect(await screen.findByText("Update failed")).toBeInTheDocument();
    expect(screen.getByText("Something went wrong on our side. Please try again.")).toBeInTheDocument();
  });

  it("asks for a name before saving", async () => {
    signedInAs();
    renderSettings();

    const profile = await screen.findByRole("region", { name: "Profile Information" });
    await userEvent.clear(within(profile).getByLabelText("Full Name"));
    await userEvent.click(within(profile).getByRole("button", { name: "Save Changes" }));

    expect(await within(profile).findByText("Required")).toBeInTheDocument();
  });
});

describe("Settings page: change password", () => {
  async function fillPasswords(current: string, next: string, confirm = next) {
    const form = await screen.findByRole("region", { name: "Change Password" });
    await userEvent.type(within(form).getByLabelText("Current Password"), current);
    await userEvent.type(within(form).getByLabelText("New Password"), next);
    await userEvent.type(within(form).getByLabelText("Confirm New Password"), confirm);
    await userEvent.click(within(form).getByRole("button", { name: "Change Password" }));
    return form;
  }

  it("sends the current and new passwords (not the confirmation), then clears the form", async () => {
    signedInAs();
    let body: unknown;
    server.use(
      http.post("/api/auth/change-password", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ message: "Password changed successfully" });
      }),
    );
    renderSettings();

    const form = await fillPasswords("Old-Pass1", "New-Pass22");

    expect(await screen.findByText("Your password has been changed successfully.")).toBeInTheDocument();
    expect(body).toEqual({ currentPassword: "Old-Pass1", newPassword: "New-Pass22" });
    expect(within(form).getByLabelText("Current Password")).toHaveValue("");
    expect(within(form).getByLabelText("New Password")).toHaveValue("");
  });

  it("checks the new password's rules and the confirmation before sending", async () => {
    signedInAs();
    renderSettings();

    const form = await fillPasswords("Old-Pass1", "short");
    expect(await within(form).findByText(/Password must be at least 8 characters long/)).toBeInTheDocument();

    await userEvent.clear(within(form).getByLabelText("New Password"));
    await userEvent.type(within(form).getByLabelText("New Password"), "New-Pass22");
    await userEvent.click(within(form).getByRole("button", { name: "Change Password" }));
    expect(await within(form).findByText("New password and confirmation must match.")).toBeInTheDocument();
  });

  it("puts a wrong current password under that field, and does not sign anyone out", async () => {
    signedInAs();
    server.use(http.post("/api/auth/change-password", () => apiError(401, "WRONG_PASSWORD", "Current password is incorrect")));
    renderSettings();

    const form = await fillPasswords("Not-It1", "New-Pass22");

    expect(await within(form).findByText("Current password is incorrect")).toBeInTheDocument();
    expect(within(form).getByLabelText("Current Password")).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText("Signed out")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("signed-in-as")).toHaveTextContent("Tess TD"));
  });

  it("tells someone changing it too often to wait", async () => {
    signedInAs();
    server.use(
      http.post("/api/auth/change-password", () =>
        apiError(429, "RATE_LIMITED", "Too many password changes. Please wait 15 minutes and try again."),
      ),
    );
    renderSettings();

    await fillPasswords("Old-Pass1", "New-Pass22");

    expect(await screen.findByText("Password change failed")).toBeInTheDocument();
    expect(screen.getByText("Too many password changes. Please wait 15 minutes and try again.")).toBeInTheDocument();
  });
});
