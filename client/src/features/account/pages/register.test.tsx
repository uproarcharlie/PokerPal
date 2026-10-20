import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@test/msw/server";
import { sessionUser } from "@test/helpers/f5-dto";
import { apiError, mockSignedOut, renderWithApp } from "@test/helpers/web";
import RegisterPage from "./register";

function renderRegister(search = "") {
  return renderWithApp(<RegisterPage />, { path: `/register${search}` });
}

interface SignUpEntry {
  name?: string;
  email?: string;
  phone?: string;
  password?: string;
  confirm?: string;
}

async function fillIn({ name = "Ada Admin", email = "ada@example.test", phone = "", password = "Sturdy-Pass2", confirm }: SignUpEntry = {}) {
  await userEvent.type(await screen.findByLabelText("Full Name*"), name);
  await userEvent.type(screen.getByLabelText("Email*"), email);
  if (phone) await userEvent.type(screen.getByLabelText("Phone (Optional)"), phone);
  await userEvent.type(screen.getByLabelText("Password*"), password);
  await userEvent.type(screen.getByLabelText("Confirm Password*"), confirm ?? password);
}

/** Records what POST /api/auth/register received, answering as the server does for a new account. */
function acceptSignUp(): { body?: unknown } {
  const seen: { body?: unknown } = {};
  server.use(
    http.post("/api/auth/register", async ({ request }) => {
      seen.body = await request.json();
      return HttpResponse.json({ message: "Registration successful", user: sessionUser({ name: "Ada Admin" }) }, { status: 201 });
    }),
  );
  return seen;
}

describe("Register page", () => {
  it("creates the account without a phone when none is given, signs in and lands on the staff home (the dashboard)", async () => {
    mockSignedOut();
    const seen = acceptSignUp();
    const { location } = renderRegister();

    expect(await screen.findByRole("heading", { level: 1, name: "Create Account" })).toBeInTheDocument();
    await fillIn();
    await userEvent.click(screen.getByRole("button", { name: "Create Account" }));

    await waitFor(() => expect(location()).toBe("/dashboard"));
    expect(seen.body).toEqual({ email: "ada@example.test", password: "Sturdy-Pass2", name: "Ada Admin" });
    expect(screen.getByText("Welcome, Ada Admin!")).toBeInTheDocument();
  });

  it("sends the phone when one is given, and returns to the page that asked for sign-up", async () => {
    mockSignedOut();
    const seen = acceptSignUp();
    const { location } = renderRegister("?next=%2Fstaff-invite");

    expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login?next=%2Fstaff-invite");
    await fillIn({ phone: "021 555 0101" });
    await userEvent.click(screen.getByRole("button", { name: "Create Account" }));

    await waitFor(() => expect(location()).toBe("/staff-invite"));
    expect(seen.body).toMatchObject({ phone: "021 555 0101" });
  });

  it("catches a mistyped confirmation and a weak password before sending anything", async () => {
    mockSignedOut();
    renderRegister();

    await fillIn({ password: "weakpass", confirm: "weakpasz" });
    await userEvent.click(screen.getByRole("button", { name: "Create Account" }));

    expect(
      await screen.findByText(
        "Password must contain at least one uppercase letter. Password must contain at least one number.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Password*")).toHaveAttribute("aria-invalid", "true");

    await userEvent.clear(screen.getByLabelText("Password*"));
    await userEvent.type(screen.getByLabelText("Password*"), "Sturdy-Pass2");
    await userEvent.click(screen.getByRole("button", { name: "Create Account" }));
    expect(await screen.findByText("Passwords do not match")).toBeInTheDocument();
  });

  it("puts a taken email under the email field", async () => {
    mockSignedOut();
    server.use(http.post("/api/auth/register", () => apiError(409, "EMAIL_TAKEN", "An account with that email already exists")));
    renderRegister();

    await fillIn();
    await userEvent.click(screen.getByRole("button", { name: "Create Account" }));

    expect(await screen.findByText("An account with that email already exists")).toBeInTheDocument();
    expect(screen.getByLabelText("Email*")).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("lists the rules the server says a password breaks under the password field", async () => {
    mockSignedOut();
    server.use(
      http.post("/api/auth/register", () =>
        apiError(400, "WEAK_PASSWORD", "Password does not meet requirements", ["Password must be at least 8 characters long"]),
      ),
    );
    renderRegister();

    await fillIn();
    await userEvent.click(screen.getByRole("button", { name: "Create Account" }));

    expect(await screen.findByText("Password must be at least 8 characters long.")).toBeInTheDocument();
  });

  it("tells a network that has made too many accounts to try later", async () => {
    mockSignedOut();
    server.use(
      http.post("/api/auth/register", () =>
        apiError(429, "RATE_LIMITED", "Too many accounts created from this network. Please try again later."),
      ),
    );
    renderRegister();

    await fillIn();
    await userEvent.click(screen.getByRole("button", { name: "Create Account" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Too many attempts");
    expect(alert).toHaveTextContent("Too many accounts created from this network. Please try again later.");
  });

  it("uses New Zealand examples in its placeholders", async () => {
    mockSignedOut();
    renderRegister();

    expect(await screen.findByLabelText("Phone (Optional)")).toHaveAttribute("placeholder", "e.g. 021 123 4567");
    expect(screen.getByLabelText("Full Name*")).toHaveAttribute("placeholder", "e.g. Jane Smith");
  });

  it("marks examples as examples, and shows no dots in an empty password box that read as a saved password (MA-13)", async () => {
    mockSignedOut();
    renderRegister();

    for (const label of ["Full Name*", "Email*", "Phone (Optional)"]) {
      expect(await screen.findByLabelText(label)).toHaveAttribute("placeholder", expect.stringMatching(/^e\.g\. /));
    }
    expect(screen.getByLabelText("Password*")).not.toHaveAttribute("placeholder");
    expect(screen.getByLabelText("Confirm Password*")).not.toHaveAttribute("placeholder");
  });

  it("marks every field but the phone as required, for screen readers too (the * itself is hidden from them)", async () => {
    mockSignedOut();
    renderRegister();

    for (const label of ["Full Name*", "Email*", "Password*", "Confirm Password*"]) {
      expect(await screen.findByLabelText(label)).toHaveAttribute("aria-required", "true");
    }
    expect(screen.getByLabelText("Phone (Optional)")).not.toHaveAttribute("aria-required");
  });
});
