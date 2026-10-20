import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { mockSignedIn, mockSignedOut, renderWithApp } from "@test/helpers/web";
import LandingPage from "./landing";

describe("Landing page", () => {
  it("pitches the platform under one name, with headings in the page's own colours", async () => {
    mockSignedOut();
    const { container } = renderWithApp(<LandingPage />);

    const title = screen.getByRole("heading", { level: 1, name: "Run Your Poker Club Like a Pro" });
    expect(title).toHaveClass("text-foreground");
    expect(screen.getByRole("heading", { level: 2, name: "Ready to level up your poker club?" })).toHaveClass("text-primary-foreground");
    expect(container).not.toHaveTextContent("PokerPal");
    expect(screen.getByRole("heading", { level: 2, name: "Why clubs love LovePoker.club" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toContain("Club Lifetime");
  });

  it("leads every call to action somewhere real: sign in, sign up, the club directory and the privacy page", async () => {
    mockSignedOut();
    const { container } = renderWithApp(<LandingPage />);

    expect(await screen.findByRole("link", { name: "Log In" })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: /Get Started Free/ })).toHaveAttribute("href", "/register");
    expect(screen.getByRole("link", { name: "See It In Action" })).toHaveAttribute("href", "/home");
    for (const link of screen.getAllByRole("link", { name: /Start Free|Get Lifetime Access/ })) {
      expect(link).toHaveAttribute("href", "/register");
    }
    const footer = screen.getByRole("navigation", { name: "Footer" });
    expect(within(footer).getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
    expect(within(footer).getByRole("link", { name: "Find a club" })).toHaveAttribute("href", "/home");
    expect(within(footer).queryByRole("link", { name: "Terms" })).not.toBeInTheDocument();
    expect(container.querySelectorAll('a[href="#"]')).toHaveLength(0);
    // Calls to action are links: no button on the page leads nowhere.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText(`© ${new Date().getFullYear()} LovePoker.club. All rights reserved.`)).toBeInTheDocument();
  });

  it("offers someone signed in the way to their dashboard instead of signing in again", async () => {
    mockSignedIn({ id: "u1", name: "Tess TD", email: "tess@club.test", role: "full_member" });
    renderWithApp(<LandingPage />);

    expect(await screen.findByRole("link", { name: "Go to Dashboard" })).toHaveAttribute("href", "/dashboard");
    expect(screen.queryByRole("link", { name: "Log In" })).not.toBeInTheDocument();
  });
});
