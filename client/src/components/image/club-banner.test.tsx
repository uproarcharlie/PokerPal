import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ClubBanner } from "./club-banner";

describe("ClubBanner", () => {
  it("keeps a 3:1 box with or without a banner", () => {
    const { container, rerender } = render(<ClubBanner imageUrl="/uploads/club_banner/x/1280.webp" alt="Central Stars at Club 2020" priority />);
    expect(container.firstElementChild).toHaveClass("aspect-[3/1]");
    expect(screen.getByRole("img", { name: "Central Stars at Club 2020" })).toHaveClass("object-cover");

    rerender(<ClubBanner imageUrl={null} fallback={<span>CS</span>} />);
    expect(container.firstElementChild).toHaveClass("aspect-[3/1]");
    expect(screen.getByText("CS")).toBeInTheDocument();
  });
});
