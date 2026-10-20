import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScrollRegion } from "./scroll-region";

afterEach(() => vi.restoreAllMocks());

describe("ScrollRegion", () => {
  it("joins the tab order while its content is wider than it, so the keyboard can scroll it", () => {
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(640);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(343);
    render(<ScrollRegion label="Standings">a wide table</ScrollRegion>);

    expect(screen.getByRole("region", { name: "Standings" })).toHaveAttribute("tabindex", "0");
  });

  it("is a named region but no tab stop when everything fits", () => {
    render(<ScrollRegion label="Standings">a narrow table</ScrollRegion>);

    const region = screen.getByRole("region", { name: "Standings" });
    expect(region).toHaveTextContent("a narrow table");
    expect(region).not.toHaveAttribute("tabindex");
  });
});
