import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pageNavigation } from "@/lib/page-navigation";
import { isChunkLoadError, RouteErrorBoundary } from "./error-boundary";

function Broken({ error }: { error: Error }): never {
  throw error;
}

afterEach(() => vi.restoreAllMocks());

describe("RouteErrorBoundary", () => {
  it("shows a way out instead of a blank page, and reports the error", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const reload = vi.spyOn(pageNavigation, "reload").mockImplementation(() => {});
    render(
      <RouteErrorBoundary homeHref="/clubs">
        <Broken error={new Error("boom")} />
      </RouteErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
    expect(screen.getByRole("link", { name: "Go back home" })).toHaveAttribute("href", "/clubs");
    expect(consoleError).toHaveBeenCalledWith("A page failed to render", expect.any(Error), expect.any(String));

    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(reload).toHaveBeenCalled();
  });

  it("says a page's script could not be loaded, naming both causes: the connection or a deploy (P3REV4-PERF-01)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <RouteErrorBoundary homeHref="/">
        <Broken error={new TypeError("Failed to fetch dynamically imported module: /assets/page-abc.js")} />
      </RouteErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("This page could not be loaded");
    expect(screen.getByRole("alert")).toHaveTextContent("Check your connection, then reload.");
  });

  it("recovers when the location changes", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { rerender } = render(
      <RouteErrorBoundary homeHref="/" resetKey="/a">
        <Broken error={new Error("boom")} />
      </RouteErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();

    rerender(
      <RouteErrorBoundary homeHref="/" resetKey="/b">
        <p>Fine page</p>
      </RouteErrorBoundary>,
    );

    expect(screen.getByText("Fine page")).toBeInTheDocument();
  });

  it("isChunkLoadError knows the browsers' wordings", () => {
    expect(isChunkLoadError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isChunkLoadError(new TypeError("error loading dynamically imported module"))).toBe(true);
    expect(isChunkLoadError(new Error("Cannot read properties of undefined"))).toBe(false);
    expect(isChunkLoadError("nope")).toBe(false);
  });
});
