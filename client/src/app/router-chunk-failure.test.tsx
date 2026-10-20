/** AppRouter when the staff layout's own script cannot be loaded (P3REV4-PERF-01). */
import { act, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockSignedIn, renderWithApp } from "@test/helpers/web";
import { SCRIPT_RETRY_MS } from "./lazy-page";
import { AppRouter } from "./router";

vi.mock("./layouts/admin-layout", () => {
  throw new TypeError("Failed to fetch dynamically imported module: /assets/admin-layout-abc.js");
});
vi.mock("@/features/clubs/pages/clubs", () => ({ default: () => <h1>Club Management</h1> }));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("AppRouter when the staff layout's script will not load", () => {
  it("shows a way out with Reload, never a blank screen", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockSignedIn({ id: "u1", name: "Tess TD", email: "tess@club.test", role: "full_member" });
    renderWithApp(<AppRouter />, { path: "/clubs" });

    await act(() => vi.advanceTimersByTimeAsync(SCRIPT_RETRY_MS + 10));

    // The app's own boundary (its way home is the site's home, not the staff one), not a blank page.
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go back home" })).toHaveAttribute("href", "/");
  });
});
