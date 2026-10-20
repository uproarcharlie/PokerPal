import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlayerAvatar } from "./player-avatar";

describe("PlayerAvatar", () => {
  it("shows the photo square-cropped, named when it stands alone", () => {
    render(<PlayerAvatar name="Alice Smith" imageUrl="/uploads/a.webp" size="lg" labelled />);

    const image = screen.getByRole("img", { name: "Alice Smith" });
    expect(image).toHaveClass("object-cover");
    expect(image).toHaveAttribute("width", "64");
  });

  it("is decoration beside a written name", () => {
    const { container } = render(<PlayerAvatar name="Alice Smith" imageUrl="/uploads/a.webp" />);

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(container.querySelector("img")).toHaveAttribute("alt", "");
  });

  it("falls back to initials, for no photo or a broken one", () => {
    const { rerender, container } = render(<PlayerAvatar name="Alice Smith" imageUrl="" labelled />);
    expect(screen.getByRole("img", { name: "Alice Smith" })).toHaveTextContent("AS");

    rerender(<PlayerAvatar name="Bob" imageUrl="/uploads/gone.webp" />);
    fireEvent.error(container.querySelector("img") as HTMLImageElement);
    expect(screen.getByText("B")).toHaveAttribute("aria-hidden", "true");
  });
});
