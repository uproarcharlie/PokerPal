import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { logoLimit, nativeLogoSize, TvLogo } from "./tv-logo";

const STORED = "/uploads/club_logo/0b1e6f9e-2a51-4c0e-9d2f-5d7c3a1b2c3d/1024.webp";
const LEGACY = "/uploads/central-stars.png";

/** The image as the browser loaded it, `width` × `height` as it reports them. */
function load(image: HTMLElement, width: number, height: number) {
  Object.defineProperty(image, "naturalWidth", { configurable: true, value: width });
  Object.defineProperty(image, "naturalHeight", { configurable: true, value: height });
  fireEvent.load(image);
}

afterEach(() => vi.unstubAllGlobals());

describe("the club's logo on the TV (round 5, item 24)", () => {
  it("knows a stored logo's own size from its largest variant, the shape from what the browser loaded", () => {
    // The browser reports the variant it chose (here 512 of a 2:1 logo): the logo itself is 1024 wide.
    expect(nativeLogoSize(STORED, { width: 512, height: 256 })).toEqual({ width: 1024, height: 512 });
    expect(nativeLogoSize(STORED, { width: 128, height: 256 })).toEqual({ width: 512, height: 1024 });
    // An image stored before variants is what the file holds.
    expect(nativeLogoSize(LEGACY, { width: 120, height: 60 })).toEqual({ width: 120, height: 60 });
    expect(nativeLogoSize(LEGACY, { width: 0, height: 0 })).toBeNull();
  });

  it("never blows a logo up past twice its own size, in the screen's own pixels", () => {
    expect(logoLimit({ width: 120, height: 60 }, 1)).toEqual({ width: 240, height: 120 });
    // A 4K TV at 200%: twice the pixels is the same CSS size as the logo itself.
    expect(logoLimit({ width: 120, height: 60 }, 2)).toEqual({ width: 120, height: 60 });
    expect(logoLimit({ width: 120, height: 60 }, 0)).toEqual({ width: 240, height: 120 });
  });

  it("asks for the variant the box needs, not a thumbnail, fitted whole with the glow behind it", () => {
    render(<TvLogo name="Central Stars" imageUrl={STORED} width={486} height={162} />);
    const image = screen.getByRole("img", { name: "Central Stars logo" });
    expect(image).toHaveAttribute("sizes", "486px");
    expect(image.getAttribute("srcset")).toContain("1024.webp 1024w");
    expect(image).toHaveAttribute("loading", "eager");
    expect(image).toHaveClass("object-contain");
    expect(image.style.filter).toContain("drop-shadow");
    expect(screen.getByTestId("display-logo")).toHaveStyle({ width: "486.0px", height: "162.0px" });
  });

  it("caps a small, old logo at twice its size once it has loaded", () => {
    vi.stubGlobal("devicePixelRatio", 1);
    render(<TvLogo name="Central Stars" imageUrl={LEGACY} width={972} height={324} />);
    const image = screen.getByRole("img", { name: "Central Stars logo" });
    expect(image.style.maxWidth).toBe("");
    load(image, 120, 60);
    expect(image).toHaveStyle({ maxWidth: "240.0px", maxHeight: "120.0px" });
  });

  it("leaves a large logo free to fill its box", () => {
    vi.stubGlobal("devicePixelRatio", 1);
    render(<TvLogo name="Central Stars" imageUrl={STORED} width={972} height={324} />);
    const image = screen.getByRole("img", { name: "Central Stars logo" });
    load(image, 1024, 512);
    // 2048 × 1024 at most: more than the box.
    expect(image).toHaveStyle({ maxWidth: "2048.0px", maxHeight: "1024.0px" });
  });

  it("shows the club's initials without a logo", () => {
    render(<TvLogo name="Central Stars" imageUrl={null} width={300} height={100} />);
    expect(screen.getByRole("img", { name: "Central Stars logo" })).toHaveTextContent("CS");
  });
});
