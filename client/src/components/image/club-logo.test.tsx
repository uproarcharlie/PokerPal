import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ClubLogo } from "./club-logo";

describe("ClubLogo", () => {
  it("fits the whole logo on its tile, never cropping it", () => {
    render(<ClubLogo name="Central Stars" imageUrl="/uploads/club_logo/0b9f6a6e-1d2c-4c39-9a4e-2f6f5e0c1a11/512.webp" size="xl" labelled />);

    const image = screen.getByRole("img", { name: "Central Stars logo" });
    expect(image).toHaveClass("object-contain");
    expect(image).not.toHaveClass("object-cover");
    expect(image).toHaveAttribute("sizes", "80px");
  });

  it("falls back to the club's real initials", () => {
    render(<ClubLogo name="Central Stars" imageUrl={null} labelled />);

    expect(screen.getByRole("img", { name: "Central Stars logo" })).toHaveTextContent("CS");
  });
});
