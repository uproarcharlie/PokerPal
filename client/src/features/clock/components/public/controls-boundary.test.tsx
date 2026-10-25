import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockSignedOut, renderWithApp } from "@test/helpers/web";
import { CONTROLS_RETRY_MS, ControlsBoundary } from "./controls-boundary";

/** The staff's controls: failing (a script that did not arrive) while `network.down`. */
const network = { down: true };
function Controls() {
  if (network.down) throw new Error("Failed to fetch dynamically imported module");
  return <div role="toolbar" aria-label="Clock controls" />;
}

function showControls() {
  network.down = true;
  return renderWithApp(
    <ControlsBoundary>
      <Controls />
    </ControlsBoundary>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  mockSignedOut();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ControlsBoundary", () => {
  it("says the TV's controls did not load, and loads them again on Retry (TDN2-CONTROLS-CHUNK-SILENT)", async () => {
    showControls();
    expect(await screen.findByRole("alert")).toHaveTextContent("The clock controls didn't load");
    network.down = false;
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("toolbar", { name: "Clock controls" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("tries again on its own, for a TV nobody is standing at", async () => {
    showControls();
    await screen.findByRole("alert");
    // Still down at the first try: it says so again, and tries again later.
    await act(() => vi.advanceTimersByTimeAsync(CONTROLS_RETRY_MS));
    expect(screen.getByRole("alert")).toHaveTextContent("The clock controls didn't load");
    network.down = false;
    await act(() => vi.advanceTimersByTimeAsync(CONTROLS_RETRY_MS));
    expect(screen.getByRole("toolbar", { name: "Clock controls" })).toBeInTheDocument();
  });
});
