import { act, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { mockSignedIn, mockSignedOut, renderWithApp } from "@test/helpers/web";
import { AppRouter } from "./router";

// Each page is a stand-in naming itself: these tests are about which page and layout a URL gets.
const page = (name: string) => ({ default: () => <h1>{name}</h1> });
// A page with a link to another page in its own layout, as Manage, the dashboard's cards and back links are.
const pageLinkingTo = async (name: string, href: string, label: string) => {
  const { Link } = await import("wouter");
  return {
    default: () => (
      <>
        <h1>{name}</h1>
        <Link href={href}>{label}</Link>
      </>
    ),
  };
};
vi.mock("@/features/landing/pages/landing", () => pageLinkingTo("Landing page", "/home", "Find a club"));
vi.mock("@/features/clubs/pages/public-home", () => page("Club directory"));
vi.mock("@/features/clubs/pages/public-club", () => page("Public club page"));
vi.mock("@/features/clubs/pages/clubs", () => pageLinkingTo("Club Management", "/seasons", "See the seasons"));
vi.mock("@/features/clubs/pages/club-details", () => page("Club details"));
vi.mock("@/features/seasons/pages/seasons", () => page("Seasons"));
vi.mock("@/features/users/pages/user-management", () => page("User management"));
vi.mock("@/features/account/pages/login", () => page("Sign in"));
vi.mock("@/features/public-tournament/pages/public-register", () => page("Tournament sign-up"));
vi.mock("@/features/tournaments/pages/tournament-details", () => ({
  default: () => {
    throw new Error("the page crashed");
  },
}));

const TESS = { id: "u1", name: "Tess TD", email: "tess@club.test", role: "full_member" } as const;

describe("AppRouter", () => {
  it("shows public pages on their own, without the staff sidebar", async () => {
    mockSignedOut();
    renderWithApp(<AppRouter />, { path: "/register/t1" });

    expect(await screen.findByRole("heading", { name: "Tournament sign-up" })).toBeInTheDocument();
    expect(screen.queryByTestId("nav-clubs")).not.toBeInTheDocument();
  });

  it("sends a visitor on a staff page to sign in, and back there afterwards", async () => {
    mockSignedOut();
    const { location } = renderWithApp(<AppRouter />, { path: "/clubs" });

    await waitFor(() => expect(location()).toBe("/login?next=%2Fclubs"));
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("shows staff pages inside the sidebar layout", async () => {
    mockSignedIn(TESS);
    renderWithApp(<AppRouter />, { path: "/clubs" });

    expect(await screen.findByRole("heading", { name: "Club Management" })).toBeInTheDocument();
    expect(screen.getByTestId("nav-clubs")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#main");
  });

  it("tells a visitor on an unknown address that there is no such page, instead of asking them to sign in", async () => {
    mockSignedOut();
    const { location } = renderWithApp(<AppRouter />, { path: "/no-such-page" });

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
    expect(location()).toBe("/no-such-page");
    expect(screen.queryByTestId("nav-clubs")).not.toBeInTheDocument();
  });

  it("keeps a signed-in person's sidebar on an unknown address", async () => {
    mockSignedIn(TESS);
    renderWithApp(<AppRouter />, { path: "/clubs/c1/nothing-here" });

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByTestId("nav-clubs")).toBeInTheDocument();
    // The staff home, the one the logo and signing in lead to (P3REV5-CQ-13).
    expect(screen.getByRole("link", { name: "Go to the dashboard" })).toHaveAttribute("href", "/dashboard");
  });

  it("keeps people who are not admins out of user management", async () => {
    mockSignedIn(TESS);
    const { location } = renderWithApp(<AppRouter />, { path: "/users" });

    await waitFor(() => expect(location()).toBe("/home"));
  });

  it("keeps the same sidebar while moving between staff pages", async () => {
    mockSignedIn(TESS);
    renderWithApp(<AppRouter />, { path: "/clubs" });
    await screen.findByRole("heading", { name: "Club Management" });
    const sidebarLink = screen.getByTestId("nav-seasons");

    act(() => sidebarLink.click());

    expect(await screen.findByRole("heading", { name: "Seasons" })).toBeInTheDocument();
    expect(screen.getByTestId("nav-seasons")).toBe(sidebarLink);
  });

  it("opens each staff page at its top, not where the last page was scrolled to (P3REV4-PERF-E)", async () => {
    mockSignedIn(TESS);
    renderWithApp(<AppRouter />, { path: "/clubs" });
    await screen.findByRole("heading", { name: "Club Management" });
    const main = document.getElementById("main") as HTMLElement;
    main.scrollTop = 900;

    act(() => screen.getByTestId("nav-seasons").click());

    expect(await screen.findByRole("heading", { name: "Seasons" })).toBeInTheDocument();
    expect(document.getElementById("main")).toBe(main);
    expect(main.scrollTop).toBe(0);
  });

  it("puts focus on the new staff page when the link followed went with the old one (MA-REV-04)", async () => {
    mockSignedIn(TESS);
    renderWithApp(<AppRouter />, { path: "/clubs" });
    const link = await screen.findByRole("link", { name: "See the seasons" });
    link.focus();

    act(() => link.click());

    expect(await screen.findByRole("heading", { name: "Seasons" })).toBeInTheDocument();
    await waitFor(() => expect(document.getElementById("main")).toHaveFocus());
  });

  it("leaves focus on the sidebar link someone used to move page", async () => {
    mockSignedIn(TESS);
    renderWithApp(<AppRouter />, { path: "/clubs" });
    await screen.findByRole("heading", { name: "Club Management" });
    const sidebarLink = screen.getByTestId("nav-seasons");
    sidebarLink.focus();

    act(() => sidebarLink.click());

    expect(await screen.findByRole("heading", { name: "Seasons" })).toBeInTheDocument();
    expect(sidebarLink).toHaveFocus();
  });

  it("puts focus on the new public page too, whose main can take it now (MA-REV-04)", async () => {
    mockSignedOut();
    renderWithApp(<AppRouter />, { path: "/" });
    const link = await screen.findByRole("link", { name: "Find a club" });
    link.focus();

    act(() => link.click());

    expect(await screen.findByRole("heading", { name: "Club directory" })).toBeInTheDocument();
    await waitFor(() => expect(document.getElementById("main")).toHaveFocus());
    expect(document.getElementById("main")).toHaveAttribute("tabindex", "-1");
  });

  it("leaves focus alone on the first page shown", async () => {
    mockSignedOut();
    renderWithApp(<AppRouter />, { path: "/" });

    expect(await screen.findByRole("heading", { name: "Landing page" })).toBeInTheDocument();
    expect(document.body).toHaveFocus();
  });

  it("contains a page that crashes, leaving the sidebar to move on with", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockSignedIn(TESS);
    renderWithApp(<AppRouter />, { path: "/admin/tournaments/t1" });

    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
    expect(screen.getByTestId("nav-clubs")).toBeInTheDocument();

    act(() => screen.getByTestId("nav-clubs").click());

    expect(await screen.findByRole("heading", { name: "Club Management" })).toBeInTheDocument();
    vi.restoreAllMocks();
  });
});
