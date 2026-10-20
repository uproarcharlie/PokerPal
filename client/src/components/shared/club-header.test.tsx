import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { mockSignedOut, renderWithApp } from "@test/helpers/web";
import { ClubHeader } from "./club-header";

describe("ClubHeader", () => {
  it("links to the club's page with its logo and name, leaving the heading to the page", () => {
    mockSignedOut();
    renderWithApp(<ClubHeader club={{ name: "Central Stars", slug: "central-stars", imageUrl: null }} caption="Friday 7:30 pm" />);

    const link = screen.getByRole("link", { name: /Central Stars/ });
    expect(link).toHaveAttribute("href", "/club/central-stars");
    expect(link).toHaveTextContent("CS");
    expect(screen.getByText("Friday 7:30 pm")).toBeInTheDocument();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("is not a link for a club without a page address", () => {
    mockSignedOut();
    renderWithApp(<ClubHeader club={{ name: "Central Stars" }} />);

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("Poker club")).toBeInTheDocument();
  });
});
