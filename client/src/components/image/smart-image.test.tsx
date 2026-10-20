import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IMAGE_RETRY_MS, SmartImage } from "./smart-image";

const AVATAR = "/uploads/player_avatar/0b9f6a6e-1d2c-4c39-9a4e-2f6f5e0c1a11/256.webp";

describe("SmartImage", () => {
  it("offers every stored width of a new upload, sized for where it is drawn", () => {
    render(<SmartImage src={AVATAR} alt="Alice" width={40} height={40} />);

    const image = screen.getByRole("img", { name: "Alice" });
    expect(image).toHaveAttribute("src", AVATAR);
    expect(image.getAttribute("srcset")).toBe(
      ["48", "96", "256"].map((width) => `/uploads/player_avatar/0b9f6a6e-1d2c-4c39-9a4e-2f6f5e0c1a11/${width}.webp ${width}w`).join(", "),
    );
    expect(image).toHaveAttribute("sizes", "40px");
    expect(image).toHaveAttribute("width", "40");
    expect(image).toHaveAttribute("height", "40");
    expect(image).toHaveAttribute("loading", "lazy");
    expect(image).toHaveAttribute("decoding", "async");
  });

  it("uses an image stored before variants as it is", () => {
    render(<SmartImage src="https://images.example.com/clubs/logo.png" alt="Logo" width={64} height={64} priority />);

    const image = screen.getByRole("img", { name: "Logo" });
    expect(image).not.toHaveAttribute("srcset");
    expect(image).toHaveAttribute("loading", "eager");
  });

  it("shows the fallback for no image, an empty one, or one that fails to load", () => {
    const { rerender } = render(<SmartImage src="" alt="Alice" width={40} height={40} fallback={<span>AB</span>} />);
    expect(screen.getByText("AB")).toBeInTheDocument();

    rerender(<SmartImage src={null} alt="Alice" width={40} height={40} fallback={<span>AB</span>} />);
    expect(screen.getByText("AB")).toBeInTheDocument();

    rerender(<SmartImage src={AVATAR} alt="Alice" width={40} height={40} fallback={<span>AB</span>} />);
    fireEvent.error(screen.getByRole("img", { name: "Alice" }));
    expect(screen.getByText("AB")).toBeInTheDocument();

    // A different picture gets its own chance.
    rerender(<SmartImage src="/uploads/other.webp" alt="Alice" width={40} height={40} fallback={<span>AB</span>} />);
    expect(screen.getByRole("img", { name: "Alice" })).toHaveAttribute("src", "/uploads/other.webp");
  });

  it("tries a picture again once the connection is back, and once more a little later (P3REV3-IMG-03)", () => {
    vi.useFakeTimers();
    render(<SmartImage src={AVATAR} alt="Alice" width={40} height={40} fallback={<span>AB</span>} />);

    // Lost while the venue's Wi-Fi dropped: initials, then the photo again when the browser is back online.
    fireEvent.error(screen.getByRole("img", { name: "Alice" }));
    expect(screen.getByText("AB")).toBeInTheDocument();
    act(() => void window.dispatchEvent(new Event("online")));
    expect(screen.getByRole("img", { name: "Alice" })).toHaveAttribute("src", AVATAR);

    // A failure while online is tried once more after a while...
    fireEvent.error(screen.getByRole("img", { name: "Alice" }));
    act(() => vi.advanceTimersByTime(IMAGE_RETRY_MS - 1));
    expect(screen.queryByRole("img", { name: "Alice" })).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("img", { name: "Alice" })).toBeInTheDocument();

    // ...and one that fails again keeps its fallback (a file that is gone), until the connection changes.
    fireEvent.error(screen.getByRole("img", { name: "Alice" }));
    act(() => vi.advanceTimersByTime(IMAGE_RETRY_MS * 10));
    expect(screen.getByText("AB")).toBeInTheDocument();
    act(() => void window.dispatchEvent(new Event("online")));
    expect(screen.getByRole("img", { name: "Alice" })).toBeInTheDocument();
    vi.useRealTimers();
  });
});
