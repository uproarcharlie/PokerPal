import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@test/msw/server";
import { sessionUser } from "@test/helpers/f5-dto";
import { apiError, mockSignedIn, mockSignedOut, renderWithApp } from "@test/helpers/web";
import LoginPage from "./login";

function renderLogin(search = "") {
  return renderWithApp(<LoginPage />, { path: `/login${search}` });
}

async function signIn(email: string, password: string) {
  await userEvent.type(await screen.findByLabelText("Email"), email);
  await userEvent.type(screen.getByLabelText("Password"), password);
  await userEvent.click(screen.getByRole("button", { name: "Sign In" }));
}

describe("Login page", () => {
  it("signs in with the email as stored (trimmed, lower-case) and lands on the clubs page", async () => {
    mockSignedOut();
    let body: unknown;
    server.use(
      http.post("/api/auth/login", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ message: "Login successful", user: sessionUser() });
      }),
    );
    const { location } = renderLogin();

    expect(await screen.findByRole("heading", { level: 1, name: "Welcome Back" })).toBeInTheDocument();
    await signIn("  Tess@Club.TEST ", "Sturdy-Pass2");

    // The staff home, as the logo and every other "home" (P3REV5-CQ-13).
    await waitFor(() => expect(location()).toBe("/dashboard"));
    expect(body).toEqual({ email: "tess@club.test", password: "Sturdy-Pass2" });
    expect(screen.getByText("Welcome back, Tess TD!")).toBeInTheDocument();
  });

  it("returns to the page that asked for sign-in (an invitation link), and only to a page on this site", async () => {
    mockSignedOut();
    server.use(http.post("/api/auth/login", () => HttpResponse.json({ message: "Login successful", user: sessionUser() })));
    const { location } = renderLogin("?next=%2Fstaff-invite");

    expect(await screen.findByRole("link", { name: "Register" })).toHaveAttribute("href", "/register?next=%2Fstaff-invite");
    await signIn("tess@club.test", "Sturdy-Pass2");

    await waitFor(() => expect(location()).toBe("/staff-invite"));
  });

  it("sends someone already signed in straight on, without showing the form", async () => {
    mockSignedIn({ id: "u1", name: "Tess TD", email: "tess@club.test", role: "full_member" });
    const { location } = renderLogin("?next=//evil.example");

    await waitFor(() => expect(location()).toBe("/dashboard"));
    expect(screen.queryByRole("button", { name: "Sign In" })).not.toBeInTheDocument();
  });

  it("says a wrong password is wrong, and clears the password for another go", async () => {
    mockSignedOut();
    server.use(http.post("/api/auth/login", () => apiError(401, "INVALID_CREDENTIALS", "Invalid email or password")));
    renderLogin();

    await signIn("tess@club.test", "not-it");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Sign-in failed");
    expect(alert).toHaveTextContent("Invalid email or password");
    expect(screen.getByLabelText("Password")).toHaveValue("");
    await waitFor(() => expect(screen.getByLabelText("Password")).toHaveFocus());
    expect(screen.getByLabelText("Email")).toHaveValue("tess@club.test");
    expect(screen.queryByText("Signed out")).not.toBeInTheDocument();
  });

  it("tells someone who has tried too often to wait, in the server's words", async () => {
    mockSignedOut();
    server.use(
      http.post("/api/auth/login", () =>
        apiError(429, "RATE_LIMITED", "Too many failed attempts. Please wait 15 minutes and try again."),
      ),
    );
    renderLogin();

    await signIn("tess@club.test", "not-it");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Too many attempts");
    expect(alert).toHaveTextContent("Too many failed attempts. Please wait 15 minutes and try again.");
  });

  it("explains a disabled account", async () => {
    mockSignedOut();
    server.use(http.post("/api/auth/login", () => apiError(403, "ACCOUNT_DISABLED", "Account is disabled")));
    renderLogin();

    await signIn("tess@club.test", "Sturdy-Pass2");

    expect(await screen.findByRole("alert")).toHaveTextContent("Account disabled");
  });

  it("says when the server cannot be reached", async () => {
    mockSignedOut();
    server.use(http.post("/api/auth/login", () => HttpResponse.error()));
    renderLogin();

    await signIn("tess@club.test", "Sturdy-Pass2");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No connection");
    expect(alert).toHaveTextContent("Could not reach the server. Check your connection and try again.");
  });

  it("asks for both fields before sending anything", async () => {
    mockSignedOut();
    renderLogin();

    await userEvent.click(await screen.findByRole("button", { name: "Sign In" }));

    expect(await screen.findAllByText("Required")).toHaveLength(2);
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
  });

  it("shows the password on request", async () => {
    mockSignedOut();
    renderLogin();

    const password = await screen.findByLabelText("Password");
    expect(password).toHaveAttribute("type", "password");
    await userEvent.click(screen.getByRole("button", { name: "Show password" }));

    expect(password).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Show password" })).toHaveAttribute("aria-pressed", "true");
  });
});
