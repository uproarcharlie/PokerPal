import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlatformFooter, PublicFooter } from "./public-footer";

describe("the public pages' footer (P3REV5-CQ-05)", () => {
  it("signs a club's page off with the club and the platform's credit, and just the credit while the club loads", () => {
    const year = new Date().getFullYear();
    const { rerender } = render(<PublicFooter club={{ name: "Central Stars", imageUrl: null }} />);
    const footer = screen.getByRole("contentinfo");
    expect(footer).toHaveTextContent("Central Stars");
    expect(footer).toHaveTextContent("Powered by LovePoker.club");
    expect(footer).toHaveTextContent(`© ${year} Central Stars. All rights reserved.`);

    rerender(<PublicFooter club={undefined} />);
    expect(screen.getByRole("contentinfo")).toHaveTextContent(/^Powered by LovePoker\.club$/);
  });

  it("gives the platform's own pages the platform's line, in the same band", () => {
    render(<PlatformFooter />);

    expect(screen.getByRole("contentinfo")).toHaveTextContent("LovePoker.club - Where Poker Communities Thrive");
    expect(screen.getByRole("contentinfo")).toHaveClass("mt-12", "border-t", "bg-card");
  });
});
