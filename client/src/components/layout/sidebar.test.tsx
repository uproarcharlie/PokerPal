import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@test/msw/server";
import { mockSignedIn, renderWithApp } from "@test/helpers/web";
import { Sidebar } from "./sidebar";

const TESS = { id: "u1", name: "Tess Te Kanawa", email: "tess@club.test", role: "full_member" } as const;

describe("Sidebar", () => {
  it("lists the staff sections, the dashboard first, and Users only for an admin", async () => {
    mockSignedIn(TESS);
    renderWithApp(<Sidebar />, { path: "/clubs" });

    await waitFor(() => expect(screen.getByTestId("nav-dashboard")).toHaveAttribute("href", "/dashboard"));
    const main = screen.getByRole("navigation", { name: "Main" });
    expect(within(main).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Dashboard",
      "Clubs",
      "Seasons",
      "Tournaments",
      "Leaderboards",
      "Players",
      "Settings",
    ]);
    expect(screen.queryByTestId("nav-users")).not.toBeInTheDocument();
  });

  it("offers Users to an admin", async () => {
    mockSignedIn({ ...TESS, role: "admin" });
    renderWithApp(<Sidebar />, { path: "/clubs" });

    expect(await screen.findByTestId("nav-users")).toHaveAttribute("href", "/users");
  });

  it.each([
    ["/clubs/c1/settings", "nav-clubs"],
    ["/admin/tournaments/t1", "nav-tournaments"],
    ["/admin/registrations/t1", "nav-tournaments"],
    ["/seasons/s1/settings", "nav-seasons"],
    ["/dashboard", "nav-dashboard"],
  ])("marks the section %s is in as the current page", async (path, testId) => {
    mockSignedIn(TESS);
    renderWithApp(<Sidebar />, { path });

    await waitFor(() => expect(screen.getByTestId(testId)).toHaveAttribute("aria-current", "page"));
    const current = screen.getAllByRole("link").filter((link) => link.getAttribute("aria-current") === "page");
    expect(current).toHaveLength(1);
  });

  it("shows who is signed in with their initials, and signs them out from the account menu", async () => {
    mockSignedIn(TESS);
    let signedOut = false;
    server.use(
      http.post("/api/auth/logout", () => {
        signedOut = true;
        return HttpResponse.json({ message: "Logout successful" });
      }),
    );
    renderWithApp(<Sidebar />, { path: "/clubs" });

    const account = await screen.findByRole("button", { name: /Tess Te Kanawa/ });
    expect(account).toHaveTextContent("TT");
    expect(account).toHaveTextContent("Full Member");

    await userEvent.click(account);
    await userEvent.click(await screen.findByRole("menuitem", { name: "Log out" }));

    expect(await screen.findByText("You have been logged out successfully")).toBeInTheDocument();
    expect(signedOut).toBe(true);
  });

  it("keeps the phone menu out of reach until it is opened, and Escape closes it again", async () => {
    mockSignedIn(TESS);
    renderWithApp(<Sidebar />, { path: "/clubs" });

    const toggle = await screen.findByRole("button", { name: "Open menu" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("dialog", { name: "Menu" })).not.toBeInTheDocument();

    await userEvent.click(toggle);
    const menu = await screen.findByRole("dialog", { name: "Menu" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(within(menu).getByRole("link", { name: "Players" })).toBeInTheDocument();
    // The drawer's links carry no test ids: the laptop column (hidden by CSS) has them.
    expect(within(menu).queryByTestId("nav-players")).not.toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Menu" })).not.toBeInTheDocument());
    expect(toggle).toHaveFocus();
  });

  it("closes the phone menu once a section is chosen", async () => {
    mockSignedIn(TESS);
    const { location } = renderWithApp(<Sidebar />, { path: "/clubs" });

    await userEvent.click(await screen.findByRole("button", { name: "Open menu" }));
    const menu = await screen.findByRole("dialog", { name: "Menu" });
    await userEvent.click(within(menu).getByRole("link", { name: "Seasons" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Menu" })).not.toBeInTheDocument());
    expect(location()).toBe("/seasons");
  });
});
