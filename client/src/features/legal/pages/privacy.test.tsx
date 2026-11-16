import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { mockSignedOut, renderWithApp } from "@test/helpers/web";
import { PRIVACY_CONTACT_EMAIL, PRIVACY_UPDATED } from "../privacy-contact";
import Privacy from "./privacy";

beforeEach(() => {
  mockSignedOut();
});

describe("Privacy (CC-06)", () => {
  it("says what is collected, why, who sees it, how long it is kept and what a person may ask for", () => {
    renderWithApp(<Privacy />, { path: "/privacy" });

    expect(screen.getByRole("heading", { level: 1, name: "Privacy" })).toBeInTheDocument();
    for (const section of ["What we collect", "Why we collect it", "Who can see it", "Where it is kept, and for how long", "Your rights"]) {
      expect(screen.getByRole("heading", { level: 2, name: section })).toBeInTheDocument();
    }
    expect(screen.getByText(/your phone number, if you give one, so a club can recognise you/)).toBeInTheDocument();
    expect(screen.getByText(/Your phone number is seen only by the staff of the club you first played at/)).toBeInTheDocument();
    expect(screen.getByText(/Under the Privacy Act 2020 you can ask/)).toBeInTheDocument();
    // Round 6: the visit counter the site's security headers now let run.
    expect(screen.getByText(/Cloudflare Web Analytics, which sets no cookies and does not identify you/)).toBeInTheDocument();
    expect(document.title).toBe("Privacy | LovePoker.club");
  });

  it("names the bank account a club keeps for transfers, and how each player paid, and who sees them (R8REV0-PRIV-04)", () => {
    renderWithApp(<Privacy />, { path: "/privacy" });

    expect(screen.getByText(/whether you have paid for an entry and, when the club's staff note it, how: in cash or by bank transfer/)).toBeInTheDocument();
    expect(screen.getByText(/If your club takes payments by bank transfer, we keep the bank account its staff enter: the account name \(which may be a person's/)).toBeInTheDocument();
    expect(screen.getByText(/Who has paid, and how, is seen only by the club's staff and the site's administrators/)).toBeInTheDocument();
    expect(screen.getByText(/A club's bank account details are seen by its staff, the site's administrators, and a player right after they sign up/)).toHaveTextContent(
      "They never appear on a public page, the club's TV screen or to other players.",
    );
    expect(screen.getByText(`Last updated ${PRIVACY_UPDATED}`)).toBeInTheDocument();
    expect(PRIVACY_UPDATED).toBe("17 November 2026");
  });

  it("gives an address for requests and the Privacy Commissioner for complaints", () => {
    renderWithApp(<Privacy />, { path: "/privacy" });

    expect(screen.getByRole("link", { name: PRIVACY_CONTACT_EMAIL })).toHaveAttribute("href", `mailto:${PRIVACY_CONTACT_EMAIL}`);
    expect(screen.getByRole("link", { name: /Office of the Privacy Commissioner/ })).toHaveAttribute("href", "https://www.privacy.org.nz");
  });
});
